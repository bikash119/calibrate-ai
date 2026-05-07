import { describe, expect, it } from "vitest";

import {
  detectLayout,
  firstUnmappedColumn,
  isPlanReady,
  overrideMapping,
  pivotRows,
  setIdColumn,
} from "./humanScoresWide";

describe("detectLayout", () => {
  it("auto-detects external_id column", () => {
    const plan = detectLayout(
      ["external_id", "alice_team", "bob_team"],
      ["team"],
    );
    expect(plan.idColumn).toBe("external_id");
  });

  it("falls back to common id-column aliases", () => {
    expect(
      detectLayout(["id", "alice_team"], ["team"]).idColumn,
    ).toBe("id");
    expect(
      detectLayout(["application_id", "alice_team"], ["team"]).idColumn,
    ).toBe("application_id");
  });

  it("splits eval_criterion when criterion matches the rubric", () => {
    const plan = detectLayout(
      ["external_id", "alice_team", "bob_market"],
      ["team", "market"],
    );
    expect(plan.columns[0]).toMatchObject({
      header: "alice_team",
      evaluator: "alice",
      criterion: "team",
      criterionMatched: true,
      separator: "_",
    });
    expect(plan.columns[1]).toMatchObject({
      evaluator: "bob",
      criterion: "market",
    });
  });

  it("handles criterion_evaluator order", () => {
    const plan = detectLayout(
      ["external_id", "team_alice", "market_bob"],
      ["team", "market"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: "alice",
      criterion: "team",
    });
  });

  it("prefers longer separators when both match", () => {
    const plan = detectLayout(
      ["external_id", "alice__team_capability"],
      ["team_capability"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: "alice",
      criterion: "team_capability",
      separator: "__",
    });
  });

  it("handles dot and dash separators", () => {
    const plan = detectLayout(
      ["external_id", "alice.team", "bob - market"],
      ["team", "market"],
    );
    expect(plan.columns[0]).toMatchObject({ separator: "." });
    expect(plan.columns[1]).toMatchObject({ separator: " - " });
  });

  it("flags columns with no criterion match for review", () => {
    const plan = detectLayout(
      ["external_id", "alice_unknown"],
      ["team", "market"],
    );
    expect(plan.columns[0].criterionMatched).toBe(false);
    // Still parses the split as a fallback so the operator can fix it.
    expect(plan.columns[0].evaluator).toBe("alice");
    expect(plan.columns[0].criterion).toBe("unknown");
  });

  it("handles bare criterion column with no evaluator prefix", () => {
    const plan = detectLayout(
      ["external_id", "team"],
      ["team"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: null,
      criterion: "team",
      criterionMatched: true,
    });
  });

  it("returns empty plan when headers are empty", () => {
    const plan = detectLayout([], ["team"]);
    expect(plan.idColumn).toBeNull();
    expect(plan.columns).toEqual([]);
  });

  it("ignores case when matching criterion names", () => {
    const plan = detectLayout(
      ["external_id", "Alice_Team"],
      ["team"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: "Alice",
      criterion: "Team",
      criterionMatched: true,
    });
  });
});

// ------------------------------------------------------------------ //

describe("overrideMapping", () => {
  it("updates evaluator without touching criterion", () => {
    const plan = detectLayout(["external_id", "alice_team"], ["team"]);
    const next = overrideMapping(plan, "alice_team", { evaluator: "ALICE" }, ["team"]);
    expect(next.columns[0].evaluator).toBe("ALICE");
    expect(next.columns[0].criterion).toBe("team");
  });

  it("re-checks criterionMatched when criterion is overridden", () => {
    const plan = detectLayout(["external_id", "alice_unknown"], ["team", "market"]);
    expect(plan.columns[0].criterionMatched).toBe(false);
    const next = overrideMapping(plan, "alice_unknown", { criterion: "team" }, ["team", "market"]);
    expect(next.columns[0].criterionMatched).toBe(true);
  });
});

describe("setIdColumn", () => {
  it("replaces the id column", () => {
    const plan = detectLayout(["foo", "alice_team"], ["team"]);
    expect(plan.idColumn).toBeNull();
    const next = setIdColumn(plan, "foo");
    expect(next.idColumn).toBe("foo");
  });
});

// ------------------------------------------------------------------ //

describe("isPlanReady / firstUnmappedColumn", () => {
  it("flags missing id column", () => {
    const plan = detectLayout(["foo", "alice_team"], ["team"]);
    expect(isPlanReady(plan)).toBe(false);
  });

  it("returns the first column with no criterion", () => {
    let plan = detectLayout(["external_id", "alice_team", "bob_xxx"], ["team"]);
    plan = overrideMapping(plan, "bob_xxx", { criterion: null }, ["team"]);
    expect(firstUnmappedColumn(plan)).toBe("bob_xxx");
  });

  it("returns null when ready", () => {
    const plan = detectLayout(["external_id", "alice_team"], ["team"]);
    expect(isPlanReady(plan)).toBe(true);
    expect(firstUnmappedColumn(plan)).toBeNull();
  });
});

// ------------------------------------------------------------------ //

describe("pivotRows", () => {
  const headers = ["external_id", "alice_team", "bob_team", "alice_market"];
  const rows: Record<string, string>[] = [
    { external_id: "app-001", alice_team: "4", bob_team: "5", alice_market: "3" },
    { external_id: "app-002", alice_team: "3", bob_team: "", alice_market: "4" },
    { external_id: "app-003", alice_team: "5", bob_team: "5", alice_market: "5" },
  ];

  it("pivots fully-mapped wide rows to long form", () => {
    const plan = detectLayout(headers, ["team", "market"]);
    const result = pivotRows(plan, rows);
    // 3 apps × {alice_team, alice_market, bob_team} but bob_team for app-002 is blank
    // so 3*3 - 1 = 8 long rows
    expect(result.rows).toHaveLength(8);
    expect(result.issues).toEqual([]);
    expect(result.evaluators).toEqual(["alice", "bob"]);
    expect(result.criteria).toEqual(["market", "team"]);
  });

  it("skips blank cells", () => {
    const plan = detectLayout(headers, ["team", "market"]);
    const result = pivotRows(plan, rows);
    const bobApp002 = result.rows.find(
      (r) => r.external_id === "app-002" && r.evaluator_id === "bob",
    );
    expect(bobApp002).toBeUndefined();
  });

  it("emits an issue for non-integer scores and skips that row", () => {
    const plan = detectLayout(headers, ["team", "market"]);
    const bad = [{ external_id: "app-x", alice_team: "n/a", bob_team: "5", alice_market: "3" }];
    const result = pivotRows(plan, bad);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].kind).toBe("invalid_score");
    expect(result.rows).toHaveLength(2); // bob_team + alice_market only
  });

  it("returns missing_id_column issue when no id column is set", () => {
    const plan = detectLayout(["foo", "alice_team"], ["team"]);
    const result = pivotRows(plan, [{ foo: "x", alice_team: "3" }]);
    expect(result.rows).toEqual([]);
    expect(result.issues[0].kind).toBe("missing_id_column");
  });

  it("builds a coverage map keyed by evaluator → criterion", () => {
    const plan = detectLayout(headers, ["team", "market"]);
    const result = pivotRows(plan, rows);
    expect(result.coverage.get("alice")?.get("team")).toBe(3); // all 3 apps
    expect(result.coverage.get("bob")?.get("team")).toBe(2);   // app-002 was blank
    expect(result.coverage.get("alice")?.get("market")).toBe(3);
  });

  it("ignores columns with null evaluator or criterion", () => {
    let plan = detectLayout(headers, ["team", "market"]);
    plan = overrideMapping(plan, "alice_team", { criterion: null }, ["team", "market"]);
    const result = pivotRows(plan, rows);
    // alice_team is now skipped; only bob_team + alice_market remain
    expect(result.rows.every((r) => r.criterion_name !== "team" || r.evaluator_id !== "alice")).toBe(true);
  });

  it("handles rows where the id cell is blank", () => {
    const plan = detectLayout(headers, ["team", "market"]);
    const blankIdRows = [{ external_id: "", alice_team: "3", bob_team: "4", alice_market: "5" }];
    const result = pivotRows(plan, blankIdRows);
    expect(result.rows).toEqual([]);
  });
});
