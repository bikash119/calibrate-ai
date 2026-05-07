/**
 * MetricsTable: pivots flat AgreementMetricItem rows into one row per criterion.
 * The pivot logic is where silent display bugs would mask real metric problems.
 */

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgreementMetricItem } from "../../schemas";
import { MetricsTable } from "./MetricsTable";

function makeMetric(overrides: Partial<AgreementMetricItem>): AgreementMetricItem {
  return {
    project_id: 1,
    iteration_id: null,
    split: "all",
    criterion_id: 10,
    criterion_name: "team",
    metric: "qwk",
    value: 0.8,
    ci_low: 0.7,
    ci_high: 0.9,
    n: 50,
    computed_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

describe("MetricsTable", () => {
  it("renders an empty-state when no rows are given", () => {
    render(<MetricsTable rows={[]} />);
    expect(screen.getByText(/No metrics yet/)).toBeInTheDocument();
  });

  it("groups multiple metric rows by criterion", () => {
    const rows = [
      makeMetric({ metric: "qwk", value: 0.85, n: 30 }),
      makeMetric({ metric: "exact", value: 0.7, n: 30 }),
      makeMetric({ metric: "within_1", value: 0.95, n: 30 }),
      makeMetric({ metric: "krippendorff", value: 0.78, n: 30 }),
    ];
    render(<MetricsTable rows={rows} />);
    const tableRows = screen.getAllByRole("row");
    // 1 header + 1 criterion = 2 rows total
    expect(tableRows).toHaveLength(2);
    const dataRow = tableRows[1];
    expect(within(dataRow).getByText("team")).toBeInTheDocument();
    expect(within(dataRow).getByText("0.850")).toBeInTheDocument();
    expect(within(dataRow).getByText("[0.70, 0.90]")).toBeInTheDocument();
    expect(within(dataRow).getByText("0.70")).toBeInTheDocument();
    expect(within(dataRow).getByText("0.95")).toBeInTheDocument();
    expect(within(dataRow).getByText("0.780")).toBeInTheDocument();
  });

  it("sorts criteria alphabetically", () => {
    const rows = [
      makeMetric({ criterion_id: 2, criterion_name: "team", metric: "qwk" }),
      makeMetric({ criterion_id: 1, criterion_name: "market", metric: "qwk" }),
    ];
    render(<MetricsTable rows={rows} />);
    const dataRows = screen.getAllByRole("row").slice(1); // strip header
    expect(within(dataRows[0]).getByText("market")).toBeInTheDocument();
    expect(within(dataRows[1]).getByText("team")).toBeInTheDocument();
  });

  it("ignores project-overall rows (criterion_id NULL)", () => {
    const rows = [
      makeMetric({ criterion_id: null, criterion_name: null, metric: "qwk" }),
      makeMetric({ criterion_id: 1, criterion_name: "team", metric: "qwk" }),
    ];
    render(<MetricsTable rows={rows} />);
    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(1);
    expect(within(dataRows[0]).getByText("team")).toBeInTheDocument();
  });

  it("hides the krippendorff column when in LLM-H mode", () => {
    // baselineByCriterion present → LLM-H view
    const rows = [makeMetric({ metric: "qwk", value: 0.6 })];
    const baselineByCriterion = new Map([[10, { qwk: 0.8, ci_low: 0.7 }]]);
    render(<MetricsTable rows={rows} baselineByCriterion={baselineByCriterion} />);
    expect(screen.queryByText("α")).not.toBeInTheDocument();
  });

  it("shows the krippendorff column when no baseline overlay", () => {
    const rows = [makeMetric({ metric: "qwk", value: 0.6 })];
    render(<MetricsTable rows={rows} />);
    expect(screen.getByText("α")).toBeInTheDocument();
  });

  it("renders dash for missing metric values", () => {
    const rows = [makeMetric({ metric: "qwk", value: null, ci_low: null, ci_high: null })];
    render(<MetricsTable rows={rows} />);
    // Three dashes: QWK value, CI, exact (no exact metric provided)
    const dataRow = screen.getAllByRole("row")[1];
    const dashes = within(dataRow).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
