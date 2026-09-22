import { describe, expect, it, vi } from "vitest";
import Ajv from "ajv";
import spec from "../../docs/openapi.json";
vi.mock("../../lib/db", () => ({ db: {} }));
vi.mock("../../lib/queue/client", () => ({ publish: vi.fn() }));
import { eventInput } from "../../lib/events";
describe("SDK event contract", () => {
  it("matches actual input validation at string boundaries and for arbitrary JSON", () => {
    const validate = new Ajv({ strict: false }).compile(spec.components.schemas.EventInput);
    for (const input of [
      { type: "order.created", payload: null }, { type: "a".repeat(120), payload: [1, true, {}], idempotencyKey: "x".repeat(200) },
      { type: "", payload: 1 }, { type: "a".repeat(121), payload: {} }, { type: "space forbidden", payload: {} },
      { type: "test" }, { type: "test", payload: {}, idempotencyKey: "" },
      { type: "test", payload: {}, idempotencyKey: "x".repeat(201) }, { type: "test", payload: {}, idempotencyKey: "line\nbreak" },
    ]) expect(validate(input)).toBe(eventInput.safeParse(input).success);
  });
  it("resolves every contract reference and gives each operation an identity", () => {
    const ids = new Set<string>();
    for (const path of Object.values(spec.paths)) for (const operation of Object.values(path)) {
      expect(ids.has(operation.operationId)).toBe(false); ids.add(operation.operationId);
    }
    function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      if ("$ref" in value) {
        const name = String(value.$ref).replace("#/components/schemas/", "");
        expect(name in spec.components.schemas).toBe(true);
      }
      Object.values(value).forEach(walk);
    }
    walk(spec);
  });
});
