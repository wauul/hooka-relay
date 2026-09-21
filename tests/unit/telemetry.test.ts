import { expect, it } from "vitest";
import { filterTelemetry } from "../../lib/telemetry";
it.each(["https://example.com/portal/secret", "/invites/accept?token=secret"])("never reports capability URL %s", url => expect(filterTelemetry({ url })).toBeNull());
it("keeps ordinary product analytics", () => { const e = { url: "https://example.com/docs" }; expect(filterTelemetry(e)).toBe(e); });
