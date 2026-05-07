/**
 * Vitest setup — runs before each test file.
 *
 * - Wires `@testing-library/jest-dom` matchers into expect.
 * - Cleans up the DOM between tests (RTL doesn't auto-cleanup with vitest's
 *   default config).
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
