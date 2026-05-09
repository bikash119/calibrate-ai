import { describe, expect, it } from "vitest";

import {
  detectLayout,
  firstUnmappedColumn,
  isPlanReady,
  overrideMapping,
  pivotRows,
  setFileEvaluator,
  setIdColumn,
  setLayout,
  sliceGridForPivot,
} from "./humanScoresWide";

// detectLayout no longer auto-matches columns to criteria — every column
// starts with `criterion: null` and the operator picks. These tests cover
// what IS still auto-detected: ID column, separator, layout flip,
// evaluator extraction in per-column mode.

describe("detectLayout", () => {
  it("auto-detects external_id column", () => {
    const plan = detectLayout(
      ["external_id", "alice_team", "bob_team"],
      ["team"],
    );
    expect(plan.idColumn).toBe("external_id");
  });

  it("falls back to common id-column aliases", () => {
    expect(detectLayout(["id", "alice_team"], ["team"]).idColumn).toBe("id");
    expect(
      detectLayout(["application_id", "alice_team"], ["team"]).idColumn,
    ).toBe("application_id");
  });

  it("extracts evaluator from `evaluator_criterion` headers but leaves criterion blank", () => {
    const plan = detectLayout(
      ["external_id", "alice_team", "bob_market"],
      ["team", "market"],
    );
    expect(plan.layout).toBe("per-column");
    expect(plan.columns[0]).toMatchObject({
      header: "alice_team",
      evaluator: "alice",
      criterion: null,
      criterionMatched: false,
      separator: "_",
    });
    expect(plan.columns[1]).toMatchObject({
      evaluator: "bob",
      criterion: null,
    });
  });

  it("uses left-of-separator as evaluator regardless of rubric (no swap heuristic)", () => {
    // Was previously auto-swapped to {evaluator: alice, criterion: team}
    // when the rubric had `team`. We dropped the swap — convention now is
    // strictly evaluator_criterion. Operator overrides if the file uses
    // criterion_evaluator order.
    const plan = detectLayout(
      ["external_id", "team_alice"],
      ["team"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: "team",
      criterion: null,
    });
  });

  it("prefers longer separators when both match", () => {
    const plan = detectLayout(
      ["external_id", "alice__team_capability"],
      ["team_capability"],
    );
    expect(plan.columns[0]).toMatchObject({
      evaluator: "alice",
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

  it("flips to per-file when no column splits on a known separator", () => {
    const plan = detectLayout(
      ["ID", "Team", "Target market", "Total"],
      ["team", "target_market"],
    );
    expect(plan.layout).toBe("per-file");
    // None of the columns have a criterion auto-filled — operator picks.
    expect(plan.columns.every((c) => c.criterion === null)).toBe(true);
  });

  it("returns empty plan when headers are empty", () => {
    const plan = detectLayout([], ["team"]);
    expect(plan.idColumn).toBeNull();
    expect(plan.columns).toEqual([]);
  });
});

// ------------------------------------------------------------------ //

describe("overrideMapping", () => {
  it("updates evaluator and flags criterion when overridden", () => {
    let plan = detectLayout(["external_id", "alice_team"], ["team"]);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, ["team"]);
    expect(plan.columns[0].criterion).toBe("team");
    expect(plan.columns[0].criterionMatched).toBe(true);
  });

  it("clears criterionMatched when the override sets a non-rubric criterion", () => {
    let plan = detectLayout(["external_id", "alice_team"], ["team"]);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, ["team"]);
    expect(plan.columns[0].criterionMatched).toBe(true);
    plan = overrideMapping(plan, "alice_team", { criterion: "garbage" }, ["team"]);
    expect(plan.columns[0].criterionMatched).toBe(false);
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
    let plan = detectLayout(["external_id", "alice_team"], ["team"]);
    expect(firstUnmappedColumn(plan)).toBe("alice_team"); // criterion not set
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, ["team"]);
    expect(firstUnmappedColumn(plan)).toBeNull();
  });

  it("returns null when ready (per-column)", () => {
    let plan = detectLayout(["external_id", "alice_team"], ["team"]);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, ["team"]);
    expect(isPlanReady(plan)).toBe(true);
    expect(firstUnmappedColumn(plan)).toBeNull();
  });
});

// ------------------------------------------------------------------ //

describe("pivotRows", () => {
  const headers = ["external_id", "alice_team", "bob_team", "alice_market"];
  const criteriaNames = ["team", "market"];

  // Helper: detectLayout no longer fills criteria, so every test that
  // pivots needs to apply the mappings manually.
  const buildPlan = () => {
    let plan = detectLayout(headers, criteriaNames);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "bob_team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "alice_market", { criterion: "market" }, criteriaNames);
    return plan;
  };

  const rows: Record<string, string>[] = [
    { external_id: "app-001", alice_team: "4", bob_team: "5", alice_market: "3" },
    { external_id: "app-002", alice_team: "3", bob_team: "", alice_market: "4" },
    { external_id: "app-003", alice_team: "5", bob_team: "5", alice_market: "5" },
  ];

  it("pivots fully-mapped wide rows to long form", () => {
    const result = pivotRows(buildPlan(), rows);
    // 3 apps × 3 mapped columns − 1 blank = 8 long rows
    expect(result.rows).toHaveLength(8);
    expect(result.issues).toEqual([]);
    expect(result.evaluators).toEqual(["alice", "bob"]);
    expect(result.criteria).toEqual(["market", "team"]);
  });

  it("skips blank cells", () => {
    const result = pivotRows(buildPlan(), rows);
    const bobApp002 = result.rows.find(
      (r) => r.external_id === "app-002" && r.evaluator_id === "bob",
    );
    expect(bobApp002).toBeUndefined();
  });

  it("emits an issue for non-integer scores and skips that row", () => {
    const bad = [
      { external_id: "app-x", alice_team: "n/a", bob_team: "5", alice_market: "3" },
    ];
    const result = pivotRows(buildPlan(), bad);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].kind).toBe("invalid_score");
    expect(result.rows).toHaveLength(2); // bob_team + alice_market only
  });

  it("returns missing_id_column issue when no id column is set", () => {
    let plan = detectLayout(["foo", "alice_team"], ["team"]);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, ["team"]);
    const result = pivotRows(plan, [{ foo: "x", alice_team: "3" }]);
    expect(result.rows).toEqual([]);
    expect(result.issues[0].kind).toBe("missing_id_column");
  });

  it("builds a coverage map keyed by evaluator → criterion", () => {
    const result = pivotRows(buildPlan(), rows);
    expect(result.coverage.get("alice")?.get("team")).toBe(3); // all 3 apps
    expect(result.coverage.get("bob")?.get("team")).toBe(2); // app-002 was blank
    expect(result.coverage.get("alice")?.get("market")).toBe(3);
  });

  it("ignores columns with null evaluator or criterion", () => {
    let plan = buildPlan();
    plan = overrideMapping(plan, "alice_team", { criterion: null }, criteriaNames);
    const result = pivotRows(plan, rows);
    expect(
      result.rows.every(
        (r) => r.criterion_name !== "team" || r.evaluator_id !== "alice",
      ),
    ).toBe(true);
  });

  it("handles rows where the id cell is blank", () => {
    const result = pivotRows(buildPlan(), [
      { external_id: "", alice_team: "3", bob_team: "4", alice_market: "5" },
    ]);
    expect(result.rows).toEqual([]);
  });
});

describe("sliceGridForPivot", () => {
  it("slices a single-header-row CSV into headers + rows", () => {
    const grid: (string | null)[][] = [
      ["external_id", "alice_team", "bob_team"],
      ["app-1", "3", "2"],
      ["app-2", "1", "3"],
    ];
    const { headers, rows } = sliceGridForPivot(grid, 0, 1);
    expect(headers).toEqual(["external_id", "alice_team", "bob_team"]);
    expect(rows).toEqual([
      { external_id: "app-1", alice_team: "3", bob_team: "2" },
      { external_id: "app-2", alice_team: "1", bob_team: "3" },
    ]);
  });

  it("supports a multi-row header (category row above real headers)", () => {
    const grid: (string | null)[][] = [
      [null, "team", "team", "market", "market"],
      ["external_id", "alice_team", "bob_team", "alice_market", "bob_market"],
      ["app-1", "3", "2", "1", "3"],
    ];
    const { headers, rows } = sliceGridForPivot(grid, 1, 2);
    expect(headers).toEqual([
      "external_id", "alice_team", "bob_team", "alice_market", "bob_market",
    ]);
    expect(rows).toEqual([
      {
        external_id: "app-1",
        alice_team: "3",
        bob_team: "2",
        alice_market: "1",
        bob_market: "3",
      },
    ]);
  });

  it("synthesizes col_N placeholders for empty header cells", () => {
    const grid: (string | null)[][] = [
      ["external_id", "", null, "alice_team"],
      ["app-1", "x", "y", "3"],
    ];
    const { headers, rows } = sliceGridForPivot(grid, 0, 1);
    expect(headers).toEqual(["external_id", "col_2", "col_3", "alice_team"]);
    expect(rows[0]).toEqual({
      external_id: "app-1",
      col_2: "x",
      col_3: "y",
      alice_team: "3",
    });
  });

  it("drops blank data rows but keeps rows with any non-empty cell", () => {
    const grid: (string | null)[][] = [
      ["external_id", "alice_team"],
      ["app-1", "3"],
      ["", ""],
      [null, null],
      ["app-2", ""],
    ];
    const { rows } = sliceGridForPivot(grid, 0, 1);
    expect(rows).toEqual([
      { external_id: "app-1", alice_team: "3" },
      { external_id: "app-2", alice_team: "" },
    ]);
  });

  it("trims whitespace in both headers and cells", () => {
    const grid: (string | null)[][] = [
      ["  external_id  ", "  alice_team  "],
      ["  app-1  ", "  3  "],
    ];
    const { headers, rows } = sliceGridForPivot(grid, 0, 1);
    expect(headers).toEqual(["external_id", "alice_team"]);
    expect(rows[0]).toEqual({ external_id: "app-1", alice_team: "3" });
  });

  it("returns empty arrays for an out-of-range header row", () => {
    const grid: (string | null)[][] = [
      ["external_id", "alice_team"],
      ["app-1", "3"],
    ];
    const { headers, rows } = sliceGridForPivot(grid, 5, 6);
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });
});

// ------------------------------------------------------------------ //

describe("per-file layout (one evaluator per file)", () => {
  const headers = ["ID", "Team", "Target market", "Market fit", "Total"];
  const criteriaNames = ["team", "target_market", "market_fit"];

  it("auto-picks per-file layout when no column splits cleanly", () => {
    const plan = detectLayout(headers, criteriaNames);
    expect(plan.layout).toBe("per-file");
    expect(plan.fileEvaluator).toBeNull();
    expect(plan.idColumn).toBe("ID");
    // No criterion auto-fill — operator picks.
    expect(plan.columns.every((c) => c.criterion === null)).toBe(true);
  });

  it("isPlanReady requires fileEvaluator + per-column criteria in per-file mode", () => {
    let plan = detectLayout(headers, criteriaNames);
    plan = setIdColumn(plan, "ID");
    expect(isPlanReady(plan)).toBe(false); // fileEvaluator missing
    plan = setFileEvaluator(plan, "alice");
    expect(isPlanReady(plan)).toBe(false); // criteria not yet picked
    for (const h of ["Team", "Target market", "Market fit"]) {
      plan = overrideMapping(
        plan, h, { criterion: criteriaNames[0] }, criteriaNames,
      );
    }
    expect(isPlanReady(plan)).toBe(false); // 'Total' still unmapped
    plan = overrideMapping(plan, "Total", { excluded: true }, criteriaNames);
    expect(isPlanReady(plan)).toBe(true);
  });

  it("pivotRows uses fileEvaluator for every emitted row in per-file mode", () => {
    let plan = detectLayout(headers, criteriaNames);
    plan = setIdColumn(plan, "ID");
    plan = setFileEvaluator(plan, "evaluator_01");
    plan = overrideMapping(plan, "Team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "Target market", { criterion: "target_market" }, criteriaNames);
    plan = overrideMapping(plan, "Market fit", { criterion: "market_fit" }, criteriaNames);
    plan = overrideMapping(plan, "Total", { excluded: true }, criteriaNames);

    const rows = [
      { ID: "app-1", Team: "3", "Target market": "2", "Market fit": "3", Total: "8" },
      { ID: "app-2", Team: "2", "Target market": "3", "Market fit": "2", Total: "7" },
    ];
    const r = pivotRows(plan, rows);
    expect(r.rows).toHaveLength(6); // 2 apps × 3 criteria
    expect(r.rows.every((row) => row.evaluator_id === "evaluator_01")).toBe(true);
    expect(r.rows.some((row) => row.criterion_name === "Total")).toBe(false);
  });

  it("returns an issue when per-file plan has no fileEvaluator", () => {
    let plan = detectLayout(headers, criteriaNames);
    plan = setIdColumn(plan, "ID");
    plan = overrideMapping(plan, "Team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "Target market", { criterion: "target_market" }, criteriaNames);
    plan = overrideMapping(plan, "Market fit", { criterion: "market_fit" }, criteriaNames);
    plan = overrideMapping(plan, "Total", { excluded: true }, criteriaNames);
    // fileEvaluator still null
    const r = pivotRows(plan, [
      { ID: "app-1", Team: "3", "Target market": "2", "Market fit": "3", Total: "8" },
    ]);
    expect(r.rows).toHaveLength(0);
    expect(r.issues[0].message).toContain("evaluator id");
  });

  it("setLayout flips between per-file and per-column without losing evaluator data", () => {
    let plan = detectLayout(["alice_team", "alice_market"], ["team", "market"]);
    expect(plan.layout).toBe("per-column");
    plan = setLayout(plan, "per-file");
    expect(plan.columns[0].evaluator).toBe("alice");
    plan = setLayout(plan, "per-column");
    expect(plan.layout).toBe("per-column");
    expect(plan.columns[0].evaluator).toBe("alice");
  });
});

describe("excluded columns", () => {
  const criteriaNames = ["team", "market"];

  it("pivotRows skips excluded columns", () => {
    let plan = detectLayout(
      ["external_id", "alice_team", "alice_market"],
      criteriaNames,
    );
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "alice_market", { excluded: true }, criteriaNames);
    const rows = [{ external_id: "app-1", alice_team: "3", alice_market: "2" }];
    const r = pivotRows(plan, rows);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].criterion_name).toBe("team");
  });

  it("isPlanReady ignores excluded columns when checking readiness", () => {
    let plan = detectLayout(["external_id", "alice_team", "Notes"], criteriaNames);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, criteriaNames);
    expect(isPlanReady(plan)).toBe(false); // 'Notes' has no criterion
    plan = overrideMapping(plan, "Notes", { excluded: true }, criteriaNames);
    expect(isPlanReady(plan)).toBe(true);
  });

  it("firstUnmappedColumn skips excluded columns", () => {
    let plan = detectLayout(
      ["external_id", "Notes", "alice_team"], criteriaNames,
    );
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, criteriaNames);
    expect(firstUnmappedColumn(plan)).toBe("Notes");
    plan = overrideMapping(plan, "Notes", { excluded: true }, criteriaNames);
    expect(firstUnmappedColumn(plan)).toBeNull();
  });
});
