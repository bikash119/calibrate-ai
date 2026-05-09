import { describe, expect, it } from "vitest";

import {
  detectLayout,
  overrideMapping,
  setIdColumn,
  setLayout,
} from "./humanScoresWide";
import {
  applyCacheToPlan,
  clearCache,
  loadCache,
  planToCache,
  saveCache,
  type WideUploadCache,
} from "./wideUploadCache";

/** Minimal in-memory Storage stand-in for tests. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(k: string): string | null { return this.store.get(k) ?? null; }
  key(i: number): string | null { return [...this.store.keys()][i] ?? null; }
  removeItem(k: string): void { this.store.delete(k); }
  setItem(k: string, v: string): void { this.store.set(k, v); }
}

describe("planToCache", () => {
  it("snapshots layout, id column, and per-column mapping (incl. excluded)", () => {
    const criteriaNames = ["team", "market"];
    let plan = detectLayout(["external_id", "alice_team", "Notes"], criteriaNames);
    plan = overrideMapping(plan, "alice_team", { criterion: "team" }, criteriaNames);
    plan = overrideMapping(plan, "Notes", { excluded: true }, criteriaNames);
    const cache = planToCache(plan);
    expect(cache.layout).toBe("per-column");
    expect(cache.idColumnHeader).toBe("external_id");
    expect(cache.columnMappings.alice_team).toEqual({ criterion: "team", excluded: false });
    expect(cache.columnMappings.Notes).toEqual({ criterion: null, excluded: true });
  });
});

describe("applyCacheToPlan", () => {
  const cache: WideUploadCache = {
    layout: "per-file",
    idColumnHeader: "ID",
    columnMappings: {
      "Team": { criterion: "team", excluded: false },
      "Target market": { criterion: "target_market", excluded: false },
      "Total": { criterion: null, excluded: true },
    },
  };

  it("applies criterion + excluded to matching headers and restores layout", () => {
    const fresh = detectLayout(
      ["ID", "Team", "Target market", "Total"],
      ["team", "target_market"],
    );
    const applied = applyCacheToPlan(fresh, cache);
    expect(applied.layout).toBe("per-file");
    const cols = Object.fromEntries(applied.columns.map((c) => [c.header, c]));
    expect(cols.Team.criterion).toBe("team");
    expect(cols.Team.criterionMatched).toBe(true);
    expect(cols.Total.excluded).toBe(true);
  });

  it("leaves headers absent from the cache untouched", () => {
    const fresh = detectLayout(
      ["ID", "Team", "Brand new column"],
      ["team", "target_market"],
    );
    const applied = applyCacheToPlan(fresh, cache);
    const newCol = applied.columns.find((c) => c.header === "Brand new column")!;
    expect(newCol.criterion).toBeNull();
    expect(newCol.excluded).toBe(false);
  });

  it("restores idColumnHeader when it exists in the new file", () => {
    let fresh = detectLayout(["random", "ID", "Team"], ["team"]);
    fresh = setIdColumn(fresh, "random"); // operator's previous pick was different
    const applied = applyCacheToPlan(fresh, cache);
    expect(applied.idColumn).toBe("ID");
  });

  it("trusts the cache's idColumnHeader even if the new file doesn't have it", () => {
    // Conscious tradeoff: operator overrides if the cached id column is
    // stale; otherwise applying it unconditionally lets the cross-file
    // workflow work without re-validation gymnastics.
    let fresh = detectLayout(["external_id", "Team"], ["team"]);
    expect(fresh.idColumn).toBe("external_id");
    const applied = applyCacheToPlan(fresh, cache); // cache says 'ID'
    expect(applied.idColumn).toBe("ID");
  });

  it("layout from the cache wins even if auto-detect picked a different one", () => {
    let fresh = detectLayout(["external_id", "alice_team"], ["team"]);
    expect(fresh.layout).toBe("per-column"); // auto-detected
    const cachedAsPerFile: WideUploadCache = {
      ...cache,
      layout: "per-file",
    };
    const applied = applyCacheToPlan(fresh, cachedAsPerFile);
    expect(applied.layout).toBe("per-file");
  });
});

describe("loadCache / saveCache / clearCache", () => {
  it("round-trips a cache through the storage layer", () => {
    const storage = new MemoryStorage();
    const cache: WideUploadCache = {
      layout: "per-file",
      idColumnHeader: "ID",
      columnMappings: { Team: { criterion: "team", excluded: false } },
    };
    saveCache(42, cache, storage);
    expect(loadCache(42, storage)).toEqual(cache);
  });

  it("returns null when nothing is stored for a project", () => {
    const storage = new MemoryStorage();
    expect(loadCache(99, storage)).toBeNull();
  });

  it("returns null on malformed JSON without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem("wide-upload-mappings:v1:42", "not json");
    expect(loadCache(42, storage)).toBeNull();
  });

  it("returns null on schema-mismatched JSON without throwing", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "wide-upload-mappings:v1:42",
      JSON.stringify({ layout: "weird", idColumnHeader: 5 }),
    );
    expect(loadCache(42, storage)).toBeNull();
  });

  it("isolates per project", () => {
    const storage = new MemoryStorage();
    saveCache(1, {
      layout: "per-file",
      idColumnHeader: "ID",
      columnMappings: {},
    }, storage);
    saveCache(2, {
      layout: "per-column",
      idColumnHeader: "external_id",
      columnMappings: {},
    }, storage);
    expect(loadCache(1, storage)?.layout).toBe("per-file");
    expect(loadCache(2, storage)?.layout).toBe("per-column");
  });

  it("clearCache removes the entry", () => {
    const storage = new MemoryStorage();
    saveCache(1, {
      layout: "per-file",
      idColumnHeader: null,
      columnMappings: {},
    }, storage);
    clearCache(1, storage);
    expect(loadCache(1, storage)).toBeNull();
  });
});

describe("end-to-end round-trip", () => {
  it("file 1 upload → cache → file 2 starts pre-filled", () => {
    const storage = new MemoryStorage();
    const criteriaNames = ["team", "target_market"];

    // File 1 — operator finalizes mappings manually
    let f1 = detectLayout(["ID", "Team", "Target market", "Total"], criteriaNames);
    f1 = setIdColumn(f1, "ID");
    f1 = setLayout(f1, "per-file");
    f1 = overrideMapping(f1, "Team", { criterion: "team" }, criteriaNames);
    f1 = overrideMapping(f1, "Target market", { criterion: "target_market" }, criteriaNames);
    f1 = overrideMapping(f1, "Total", { excluded: true }, criteriaNames);
    saveCache(7, planToCache(f1), storage);

    // File 2 (different evaluator, identical schema)
    let f2 = detectLayout(["ID", "Team", "Target market", "Total"], criteriaNames);
    const cached = loadCache(7, storage);
    expect(cached).not.toBeNull();
    f2 = applyCacheToPlan(f2, cached!);

    expect(f2.layout).toBe("per-file");
    expect(f2.idColumn).toBe("ID");
    const cols = Object.fromEntries(f2.columns.map((c) => [c.header, c]));
    expect(cols.Team.criterion).toBe("team");
    expect(cols["Target market"].criterion).toBe("target_market");
    expect(cols.Total.excluded).toBe(true);
  });
});
