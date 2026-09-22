import { after } from "next/server";
import { traced } from "@/lib/observability";
import { flushObservability } from "@/lib/observability-runtime";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { boundedJson } from "@/lib/input-limits";
import { applicationForKey } from "@/lib/api-keys";
import { eventInput, ingest } from "@/lib/events";
import { apiError } from "@/lib/access";
import { admitEvent } from "@/lib/rate-limit";
export const maxDuration = 30;
export async function POST(req: Request) {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) after(flushObservability);
  return traced("api.events", { "http.request.method": "POST" }, async span => {
    const response = await handlePost(req);
    span.setAttribute("http.response.status_code", response.status);
    const traceId = span.spanContext().traceId;
    if (traceId !== "0".repeat(32)) response.headers.set("X-Trace-Id", traceId);
    return response;
  });
}
async function handlePost(req: Request) {
  try {
    const limited = await ipRateLimit(req, "events");
    if (limited) return limited;
    const key =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      req.headers.get("x-api-key");
    if (!key)
      return Response.json({ error: "API key required" }, { status: 401 });
    const app = await applicationForKey(key);
    if (!app)
      return Response.json({ error: "Invalid API key" }, { status: 401 });
    const input = eventInput.parse(await boundedJson(req));
    const retryAfter = await admitEvent(app.id);
    if (retryAfter) return Response.json({ error: "Rate limit exceeded", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
    return Response.json(
      await ingest(app.id, input),
      { status: 202 },
    );
  } catch (e) {
    return apiError(e);
  }
}
