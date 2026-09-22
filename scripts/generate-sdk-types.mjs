import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(new URL("../docs/openapi.json", import.meta.url), "utf8"));
const names = ["EventInput", "EventResponse", "SchemaFailure", "ErrorResponse"];
function type(schema, python = false) {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if (!Object.keys(schema).length) return "JsonValue";
  if (schema.type === "array") return python ? `list[${type(schema.items, true)}]` : `${type(schema.items)}[]`;
  const value = ({ string: ["string", "str"], integer: ["number", "int"], number: ["number", "float"], boolean: ["boolean", "bool"] })[schema.type];
  if (!value) throw new Error(`Unsupported SDK schema: ${JSON.stringify(schema)}`);
  return value[python ? 1 : 0];
}
let ts = '// Generated from docs/openapi.json; run npm run sdk:generate.\nexport type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };\n';
let py = '# Generated from docs/openapi.json; run npm run sdk:generate.\nfrom typing import NotRequired, TypedDict, Union\n\nJsonValue = Union[None, bool, int, float, str, list["JsonValue"], dict[str, "JsonValue"]]\n';
for (const name of names) {
  const schema = spec.components.schemas[name];
  ts += `\nexport interface ${name} {\n`;
  py += `\n\nclass ${name}(TypedDict):\n`;
  for (const [key, field] of Object.entries(schema.properties)) {
    const required = schema.required.includes(key);
    ts += `  ${key}${required ? "" : "?"}: ${type(field)};\n`;
    py += `    ${key}: ${required ? type(field, true) : `NotRequired[${type(field, true)}]`}\n`;
  }
  ts += '}\n';
}
writeFileSync(new URL("../packages/node/src/generated.ts", import.meta.url), ts);
writeFileSync(new URL("../packages/python/src/hooka_relay/generated.py", import.meta.url), py);
