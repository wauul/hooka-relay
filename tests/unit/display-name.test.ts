import { expect, it } from "vitest";
import { userDisplayName, displayNameSchema } from "../../lib/display-name";
it("uses an edited display name and falls back to the email prefix", () => {
  expect(userDisplayName({ email: "alice@example.com" })).toBe("alice");
  expect(
    userDisplayName({ email: "alice@example.com", displayName: "  Alice W  " }),
  ).toBe("Alice W");
  expect(
    userDisplayName({ email: "alice@example.com", displayName: " " }),
  ).toBe("alice");
  expect(
    userDisplayName({ email: "a".repeat(60) + "@example.com" }),
  ).toHaveLength(40);
});
it("validates display names without requiring unique usernames", () => {
  expect(displayNameSchema.parse("  Alice W  ")).toBe("Alice W");
  for (const name of ["", "  ", "a".repeat(41), "alice\nbob", "alice\x00"])
    expect(displayNameSchema.safeParse(name).success).toBe(false);
});
