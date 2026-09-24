import { describe, expect, it } from "vitest";
import { resolveGroup, shouldRun } from "../../lib/routing";

describe("group outcome", () => {
  for (const [policy, outcomes, expected] of [
    ["ALL_MUST_SUCCEED", ["SUCCESS"], "SUCCESS"],
    ["ALL_MUST_SUCCEED", ["SUCCESS", "SUCCESS"], "SUCCESS"],
    ["ALL_MUST_SUCCEED", ["SUCCESS", "FAILED"], "FAILED"],
    ["ALL_MUST_SUCCEED", ["FAILED", "FAILED"], "FAILED"],
    ["ANY_MUST_SUCCEED", ["SUCCESS", "FAILED"], "SUCCESS"],
    ["ANY_MUST_SUCCEED", ["FAILED", "SUCCESS"], "SUCCESS"],
    ["ANY_MUST_SUCCEED", ["FAILED", "FAILED"], "FAILED"],
    ["ANY_MUST_SUCCEED", [], "FAILED"],
  ] as const) it(`${policy}: ${outcomes.join(",") || "empty"}`, () => {
    expect(resolveGroup(policy, [...outcomes])).toBe(expected);
  });
});

describe("group trigger", () => {
  for (const condition of ["ALWAYS", "ON_PREVIOUS_SUCCESS", "ON_PREVIOUS_FAILURE"] as const) {
    for (const previous of [null, "SUCCESS", "FAILED", "SKIPPED"] as const) {
      it(`${condition} after ${previous}`, () => {
        expect(shouldRun(condition, previous)).toBe(previous === null || condition === "ALWAYS" || (condition === "ON_PREVIOUS_SUCCESS" && previous === "SUCCESS") || (condition === "ON_PREVIOUS_FAILURE" && previous === "FAILED"));
      });
    }
  }
});
