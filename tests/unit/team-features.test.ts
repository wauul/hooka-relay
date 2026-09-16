import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db", () => ({ db: {} }));
import { actions, permitted, type Role } from "../../lib/permissions";
import { keyIsValid, keyGraceHours } from "../../lib/api-keys";
import { endpointTransition } from "../../lib/endpoint-status";
describe("role/action matrix", () => {
  const allowed = {
    OWNER: ["view", "test", "replay", "manage", "invite", "transfer", "delete"],
    ADMIN: ["view", "test", "replay", "manage", "invite", "leave"],
    MEMBER: ["view", "test", "replay", "leave"],
  };
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as Role[]) {
    for (const action of actions.filter((a) => a !== "kick" && a !== "roles"))
      it(`${role} / ${action}`, () =>
        expect(permitted(role, action)).toBe(allowed[role].includes(action)));
    for (const target of ["OWNER", "ADMIN", "MEMBER"] as Role[]) {
      it(`${role} kick ${target}`, () =>
        expect(permitted(role, "kick", target)).toBe(
          (role === "OWNER" && target !== "OWNER") ||
            (role === "ADMIN" && target === "MEMBER"),
        ));
      it(`${role} change ${target}`, () =>
        expect(permitted(role, "roles", target)).toBe(
          role !== "MEMBER" && target !== "OWNER",
        ));
    }
  }
});
it("accepts the old key strictly within its grace window", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const app = {
    currentApiKey: "new",
    previousApiKey: "old",
    previousApiKeyExpiresAt: now,
  };
  expect(keyIsValid(app, "new", now)).toBe(true);
  expect(keyIsValid(app, "old", new Date(now.getTime() - 1))).toBe(true);
  expect(keyIsValid(app, "old", now)).toBe(false);
  expect(keyIsValid(app, "old", new Date(now.getTime() + 1))).toBe(false);
  expect(keyIsValid(app, "wrong", now)).toBe(false);
  expect(
    keyIsValid({ ...app, previousApiKeyExpiresAt: null }, "old", now),
  ).toBe(false);
});
it("validates grace configuration", () => {
  vi.stubEnv("API_KEY_GRACE_HOURS", "2");
  expect(keyGraceHours()).toBe(2);
  vi.stubEnv("API_KEY_GRACE_HOURS", "0");
  expect(() => keyGraceHours()).toThrow();
  vi.unstubAllEnvs();
});
it.each(["ACTIVE", "PAUSED"] as const)(
  "pauses and resumes %s idempotently",
  (state) => {
    expect(endpointTransition(state, "pause")).toBe("PAUSED");
    expect(endpointTransition(state, "resume")).toBe("ACTIVE");
  },
);
