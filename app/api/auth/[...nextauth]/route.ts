import { ipRateLimit } from "@/lib/ip-rate-limit";
import { apiError } from "@/lib/access";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
const handler = NextAuth(authOptions);
export { handler as GET };
export async function POST(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  try {
    const limited = await ipRateLimit(req, "auth");
    if (limited) return limited;
    // Delegate unchanged to NextAuth: its double-submit CSRF check remains active.
    return handler(req, context);
  } catch (e) { return apiError(e); }
}
