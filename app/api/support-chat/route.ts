import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { boundedJson, InputLimitError } from "@/lib/input-limits";
import { apiError, sameOrigin } from "@/lib/access";
import { SupportRateLimitError } from "@/lib/support-gate";
import { supportAnswer } from "@/lib/support-store";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const raw = await boundedJson(req, 12288);
    const session = await getServerSession(authOptions);
    const result = await supportAnswer(req, raw, (session?.user as { id?: string } | undefined)?.id);
    return Response.json({ answer: result.answer, ...(process.env.NODE_ENV === "development" ? { cacheHit: result.cacheHit } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupportRateLimitError) return Response.json({ error: "Support question limit reached. Try again after the quota resets." }, { status: 429, headers: { "Retry-After": "86400", "Cache-Control": "no-store" } });
    const response = apiError(error);
    if (response.status < 500 && response.status !== 400) return response;
    // Keep validation errors useful but never disclose provider/database details.
    if (error instanceof InputLimitError || (error instanceof Error && error.name === "ZodError")) return response;
    return Response.json({ error: "Support is temporarily unavailable. Please use the documentation." }, { status: 503 });
  }
}
