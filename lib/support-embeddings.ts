import path from "node:path";
let extractor: Promise<import("@xenova/transformers").FeatureExtractionPipeline> | undefined;
export async function embedSupport(text: string): Promise<number[]> {
  extractor ??= (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    env.cacheDir = process.env.HF_HOME || path.join(process.env.VERCEL ? "/tmp" : ".tools", "support-models");
    env.backends.onnx.wasm.numThreads = 1;
    return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
  })().catch(error => { extractor = undefined; throw error; });
  const result = await (await extractor)(text, { pooling: "mean", normalize: true });
  const vector = Array.from(result.data as Float32Array);
  if (vector.length !== 384 || vector.some(v => !Number.isFinite(v))) throw new Error("Invalid support embedding");
  return vector;
}
