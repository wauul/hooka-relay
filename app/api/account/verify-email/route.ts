import { z } from "zod";
import { apiError, sameOrigin } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { consumeAuthToken } from "@/lib/auth-email";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const limited = await ipRateLimit(req, "recovery"); if (limited) return limited;
    const data = z.object({ token: z.string().length(64) }).strict().parse(await boundedJson(req));
    const callbackPath = await consumeAuthToken(data.token, "VERIFY");
    return Response.json({ ok: true, callbackPath }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
