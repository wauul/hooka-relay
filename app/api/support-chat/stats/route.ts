import { userId } from "@/lib/access";
import { db } from "@/lib/db";
export async function GET() {
  let id: string;
  try { id = await userId(); } catch { return Response.json({ error: "Unauthorized" }, { status: 401 }); }
  // Workspace administrators are not platform administrators. An explicit
  // operator allowlist prevents one tenant reading global support statistics.
  if (!process.env.SUPPORT_ADMIN_USER_IDS?.split(",").map(s => s.trim()).includes(id)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const [totalQuestions, declined, cacheHits] = await Promise.all([db.supportDecision.count(), db.supportDecision.count({ where: { inScope: false } }), db.supportDecision.count({ where: { cacheHit: true } })]);
  return Response.json({ window: "retained 30 days", totalQuestions, declinedPercent: totalQuestions ? declined * 100 / totalQuestions : 0, cacheHitRate: totalQuestions ? cacheHits / totalQuestions : 0 }, { headers: { "Cache-Control": "no-store" } });
}
