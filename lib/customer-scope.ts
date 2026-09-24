import type { Prisma } from "@prisma/client";
import { WorkspaceError } from "./workspaces";

export async function validateCustomer(
  tx: Prisma.TransactionClient,
  applicationId: string,
  customerId: string | undefined,
) {
  const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, select: { customerMode: true } });
  if (app.customerMode === "LEGACY") {
    if (customerId) throw new WorkspaceError(400, "This application uses legacy routing");
    return null;
  }
  if (!customerId || !await tx.customer.findFirst({ where: { id: customerId, applicationId }, select: { id: true } }))
    throw new WorkspaceError(404, "Customer not found");
  return customerId;
}
