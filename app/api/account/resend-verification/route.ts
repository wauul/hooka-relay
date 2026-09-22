import { z } from "zod";
import { apiError, sameOrigin } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { ipRateLimit } from "@/lib/ip-rate-limit";
import { issueAuthEmail } from "@/lib/auth-email";
export async function POST(req: Request) {
  try {
    sameOrigin(req); const limited = await ipRateLimit(req, "recovery"); if (limited) return limited;
    const data = z.object({ email: z.string().email().max(254), callbackPath: z.string().max(300).optional() }).strict().parse(await boundedJson(req));
    // Same body/status even for unknown users or a provider outage: neither leaks account existence.
    try { await issueAuthEmail(data.email, "VERIFY", data.callbackPath); } catch { console.warn("Account email unavailable"); }
    return Response.json({ message: "If this email is eligible, we have sent a link. Check your inbox and spam folder." }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return apiError(e); }
}
