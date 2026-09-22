import { revealSigningSecret } from "@/lib/signing-secrets";
import { publicEndpoint } from "@/lib/endpoint-config";
import { db } from "@/lib/db";
import { ownEndpoint, apiError, userId } from "@/lib/access";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ep = await ownEndpoint((await params).id);
    const since = new Date(Date.now() - 86400000);
    const [attempts, total, success] = await Promise.all([
      db.deliveryAttempt.findMany({
        where: { endpointId: ep.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          event: { select: { id: true, type: true, idempotencyKey: true } },
        },
      }),
      db.deliveryAttempt.count({
        where: {
          endpointId: ep.id,
          createdAt: { gte: since },
          status: { not: "SKIPPED_CIRCUIT_OPEN" },
        },
      }),
      db.deliveryAttempt.count({
        where: {
          endpointId: ep.id,
          createdAt: { gte: since },
          status: "SUCCESS",
        },
      }),
    ]);
    return Response.json({
      endpoint: { ...publicEndpoint(ep), secret: ep.role === "MEMBER" ? undefined : await revealSigningSecret(ep, await userId()) },
      attempts,
      successRate: total ? Math.round((success / total) * 100) : null,
      total,
    });
  } catch (e) {
    return apiError(e);
  }
}
