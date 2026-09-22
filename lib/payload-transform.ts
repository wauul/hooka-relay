import { getQuickJS } from "quickjs-emscripten";
import { checkJsonDepth } from "./input-limits";
// Separate WASM engine: no Node globals, modules, filesystem, network or host
// callbacks are exposed. Limits also cover JSON serialization inside the VM.
export async function transformPayload(source: string | null, payload: unknown): Promise<string> {
  const input = JSON.stringify(payload);
  if (!source) return input;
  if (source.length > 4096) throw new Error("Transform exceeds 4096 characters");
  const engine = await getQuickJS();
  const deadline = Date.now() + 25;
  const output = engine.evalCode(`(() => { const output = (${source})(JSON.parse(${JSON.stringify(input)})); if (output && typeof output.then === "function") throw new Error("Async transforms are unsupported"); return JSON.stringify(output); })()`, {
    memoryLimitBytes: 16 * 1024 * 1024, maxStackSizeBytes: 128 * 1024,
    shouldInterrupt: () => Date.now() >= deadline,
  });
  if (typeof output !== "string" || Buffer.byteLength(output) > 262144) throw new Error("Transform must return JSON within 256 KiB");
  checkJsonDepth(output); JSON.parse(output);
  return output;
}
