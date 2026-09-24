import { db } from "@/lib/db";
import { apiError, userId } from "@/lib/access";
import { operatorUsage, usageCsv } from "@/lib/usage";

export async function GET(req: Request) {
  try {
    const uid = await userId();
    const user = await db.user.findUnique({ where: { id: uid }, select: { email: true } });
    if (!user) throw new Error("NOT_FOUND");
    const url = new URL(req.url);
    const report = await operatorUsage(user.email, url);
    if (url.searchParams.get("format") === "csv") return new Response(usageCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=hooka-usage.csv", "Cache-Control": "no-store" } });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
