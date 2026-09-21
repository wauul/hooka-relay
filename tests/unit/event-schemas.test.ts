import { expect, it } from "vitest";
import { compileEventSchema, validateEventPayload, PayloadSchemaError } from "../../lib/event-schemas";
const schema = { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"], additionalProperties: false };
it("validates without coercion/defaults or mutating data", () => {
  const payload = { orderId: "42" }; expect(() => validateEventPayload(schema, payload)).not.toThrow(); expect(payload).toEqual({ orderId: "42" });
  expect(() => validateEventPayload(schema, { orderId: 42 })).toThrow(PayloadSchemaError);
  expect(() => validateEventPayload(schema, {})).toThrow(PayloadSchemaError);
});
it.each(["pattern", "$ref", "anyOf", "uniqueItems", "$async", "format"])("rejects costly keyword %s", keyword => expect(() => compileEventSchema({ [keyword]: "unsafe" })).toThrow("Unsupported"));
it("rejects invalid and oversized schemas, supports booleans and reuses compiled schemas", () => {
  expect(() => compileEventSchema({ type: "made-up" })).toThrow(); expect(() => compileEventSchema({ description: "x".repeat(17000) })).toThrow();
  expect(() => validateEventPayload(true, null)).not.toThrow(); expect(() => validateEventPayload(false, {})).toThrow(PayloadSchemaError);
  expect(compileEventSchema(schema)).toBe(compileEventSchema(schema));
});
it("reports a payload path without echoing the submitted payload", () => {
  try { validateEventPayload(schema, { orderId: 42 }); throw Error("expected failure"); } catch (e) { expect(e).toBeInstanceOf(PayloadSchemaError); expect((e as PayloadSchemaError).failures[0]).toMatchObject({ path: "/orderId", message: "must be string" }); }
});
