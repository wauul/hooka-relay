import https from "node:https";
import { resolveEndpoint } from "./security";
export type HttpResult = {
  code: number | null;
  body: string;
  headers: Record<string, string>;
  error: string | null;
  duration: number;
};
export async function deliver(
  url: string,
  body: string | Buffer,
  headers: Record<string, string>,
): Promise<HttpResult> {
  const start = Date.now();
  try {
    let dnsTimer: NodeJS.Timeout | undefined;
    const resolved = await Promise.race([
      resolveEndpoint(url),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error("timeout")), 10_000);
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    return await new Promise<HttpResult>((resolve) => {
      let done = false;
      const finish = (result: Omit<HttpResult, "duration">) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ...result, duration: Date.now() - start });
      };
      // Pin the validated public IP in the TLS request; preserve hostname for
      // certificate verification/SNI. This prevents DNS rebinding SSRF.
      const req = https.request(
        resolved.url,
        {
          method: "POST",
          headers,
          family: resolved.address.family,
          lookup: (_hostname, _options, callback) =>
            callback(null, resolved.address.address, resolved.address.family),
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            if (bytes < 16_384) chunks.push(chunk.subarray(0, 16_384 - bytes));
            bytes += chunk.length;
            if (bytes > 16_384) {
              finish({
                code: res.statusCode || null,
                body:
                  Buffer.concat(chunks).toString() + "\n[truncated at 16 KB]",
                headers: Object.fromEntries(
                  Object.entries(res.headers).map(([k, v]) => [k, String(v)]),
                ),
                error: null,
              });
              res.destroy();
            }
          });
          res.on("end", () =>
            finish({
              code: res.statusCode || null,
              body: Buffer.concat(chunks).toString(),
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [k, String(v)]),
              ),
              error: null,
            }),
          );
          res.on("error", () =>
            finish({
              code: null,
              body: "",
              headers: {},
              error: "connection_error",
            }),
          );
        },
      );
      // An absolute deadline includes TLS, response headers, and streaming body.
      const timer = setTimeout(
        () => {
          finish({ code: null, body: "", headers: {}, error: "timeout" });
          req.destroy();
        },
        Math.max(1, 10_000 - (Date.now() - start)),
      );
      req.on("error", () =>
        finish({
          code: null,
          body: "",
          headers: {},
          error: "connection_error",
        }),
      );
      // Redirects are not followed: an endpoint cannot redirect into a private network.
      req.end(body);
    });
  } catch (error) {
    return {
      code: null,
      body: "",
      headers: {},
      error:
        error instanceof Error && error.message === "timeout"
          ? "timeout"
          : "connection_error",
      duration: Date.now() - start,
    };
  }
}
