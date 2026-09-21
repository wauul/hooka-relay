export class InputLimitError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Count structural nesting before JSON.parse to reject parser/serializer bombs.
// Brackets inside quoted strings (including escaped quotes) are not structure.
export function checkJsonDepth(text: string, maximum = 32) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      if (++depth > maximum)
        throw new InputLimitError(
          400,
          `JSON exceeds maximum nesting depth of ${maximum}`,
        );
    } else if (char === "}" || char === "]") depth--;
  }
}
export async function boundedJson(
  req: Request,
  maximum = 262144,
): Promise<unknown> {
  const length = req.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maximum)
    throw new InputLimitError(413, "Payload exceeds 256 KB");
  const reader = req.body?.getReader();
  if (!reader) throw new InputLimitError(400, "JSON body required");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      // Stop reading immediately; req.text() would first buffer the entire attack.
      if (bytes > maximum) {
        await reader.cancel();
        throw new InputLimitError(413, "Payload exceeds 256 KB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
  checkJsonDepth(text);
  return JSON.parse(text);
}
