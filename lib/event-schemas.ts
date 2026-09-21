import Ajv, { type ValidateFunction } from "ajv";
import { createHash } from "node:crypto";
import { InputLimitError, checkJsonDepth } from "./input-limits";
export class PayloadSchemaError extends InputLimitError {
  constructor(public failures: { path: string; message: string }[]) { super(400, "Payload does not match the event schema"); }
}
const cache = new Map<string, ValidateFunction>();
const keywords = new Set(["$schema", "type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minProperties", "maxProperties", "enum", "const", "title", "description"]);
export function compileEventSchema(schema: unknown) {
  const text = JSON.stringify(schema);
  if (!text || Buffer.byteLength(text) > 16384) throw new InputLimitError(400, "Schema must be at most 16 KiB");
  checkJsonDepth(text, 12);
  let nodes = 0;
  function visit(value: unknown) {
    if (++nodes > 250) throw new InputLimitError(400, "Schema exceeds 250 nodes");
    if (typeof value === "boolean") return;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputLimitError(400, "Use a JSON Schema object or boolean");
    for (const [key, child] of Object.entries(value)) {
      // Regex, references and combinatorial schemas can exhaust a shared server.
      if (!keywords.has(key)) throw new InputLimitError(400, `Unsupported schema keyword: ${key}`);
      if (key === "properties") {
        if (!child || typeof child !== "object" || Array.isArray(child)) throw new InputLimitError(400, "Invalid properties schema");
        for (const nested of Object.values(child)) visit(nested);
      } else if (key === "items" || key === "additionalProperties") visit(child);
      else if (key === "enum" && (!Array.isArray(child) || child.length > 100)) throw new InputLimitError(400, "Use at most 100 enum values");
    }
  }
  visit(schema);
  const key = createHash("sha256").update(text).digest("hex");
  const existing = cache.get(key); if (existing) return existing;
  try {
    const validate = new Ajv({ strict: true, allErrors: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false }).compile(schema as object | boolean);
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, validate);
    return validate;
  } catch { throw new InputLimitError(400, "Invalid or unsupported JSON Schema (draft-07)"); }
}
export function validateEventPayload(schema: unknown, payload: unknown) {
  const validate = compileEventSchema(schema);
  if (!validate(payload)) throw new PayloadSchemaError((validate.errors || []).slice(0, 5).map(e => ({ path: e.instancePath || "/", message: e.message || "Invalid value" })));
}
