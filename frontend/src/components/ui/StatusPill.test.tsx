import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders friendly labels for known states", () => {
    render(<StatusPill state="setup" />);
    expect(screen.getByText("Setup")).toBeInTheDocument();
  });

  it("renders 'Iterating' with the yellow pill class", () => {
    const { container } = render(<StatusPill state="iterating" />);
    const pill = container.querySelector(".pill");
    expect(pill).toHaveClass("pill-yellow");
    expect(pill).toHaveTextContent("Iterating");
  });

  it("renders 'Locked' with the green pill class", () => {
    const { container } = render(<StatusPill state="locked" />);
    expect(container.querySelector(".pill")).toHaveClass("pill-green");
  });

  it("renders 'Abandoned' with the red pill class", () => {
    const { container } = render(<StatusPill state="abandoned" />);
    expect(container.querySelector(".pill")).toHaveClass("pill-red");
  });

  it("falls back to the raw state for unknown states", () => {
    render(<StatusPill state="weird_state" />);
    expect(screen.getByText("weird_state")).toBeInTheDocument();
  });
});
