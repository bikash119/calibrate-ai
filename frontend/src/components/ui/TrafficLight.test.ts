import { describe, expect, it } from "vitest";

import { trafficStatusFor } from "./TrafficLight";

describe("trafficStatusFor", () => {
  // QWK status: green if LLM-H is within H-H 95% CI; yellow within 0.10 below;
  // red beyond. The H-H lower bound is the only relevant input.

  it("is green when LLM-H matches the H-H lower bound", () => {
    expect(trafficStatusFor(0.7, { qwkLow: 0.7 })).toBe("green");
  });

  it("is green when LLM-H exceeds the H-H ceiling", () => {
    expect(trafficStatusFor(0.95, { qwkLow: 0.7 })).toBe("green");
  });

  it("is yellow when LLM-H is within 0.10 of the H-H lower bound", () => {
    expect(trafficStatusFor(0.65, { qwkLow: 0.7 })).toBe("yellow");
    expect(trafficStatusFor(0.6, { qwkLow: 0.7 })).toBe("yellow");
  });

  it("is red when LLM-H is more than 0.10 below the H-H lower bound", () => {
    expect(trafficStatusFor(0.5, { qwkLow: 0.7 })).toBe("red");
  });

  it("treats the 0.10 boundary as yellow, not red", () => {
    // Strict greater-than-or-equal at the boundary: green and yellow only
    expect(trafficStatusFor(0.6, { qwkLow: 0.7 })).toBe("yellow");
  });
});
