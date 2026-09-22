import { after } from "next/server";
import { flushObservability } from "@/lib/observability-runtime";
import { z } from "zod";
import { ownEndpoint, sameOrigin, apiError } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { sendEndpointTest } from "@/lib/endpoint-test";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) after(flushObservability);
  try {
    sameOrigin(req);
    const ep = await ownEndpoint((await params).id, "test");
    const limited = await ipRateLimit(req, "events");
    if (limited) return limited;
    z.object({}).strict().parse(await boundedJson(req));
    const result = await sendEndpointTest(ep);
    if ("limited" in result) return Response.json({ error: "Synthetic test rate limit exceeded", retryAfter: result.limited }, { status: 429, headers: { "Retry-After": String(result.limited) } });
    return Response.json(result, { status: 202 });
  } catch (error) { return apiError(error); }
}
