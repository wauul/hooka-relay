import { userDisplayName } from "./display-name";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { permitted, type Action, type Role } from "./permissions";
import { sendInvite } from "./invite-email";

export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function membership(
  workspaceId: string,
  userId: string,
  action: Action = "view",
  tx: Prisma.TransactionClient = db,
) {
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!member) throw new WorkspaceError(404, "Workspace not found");
  if (!permitted(member.role, action))
    throw new WorkspaceError(
      403,
      action === "leave"
        ? "Transfer ownership before leaving, or delete the workspace."
        : "Your workspace role does not permit this action.",
    );
  return member;
}
// Serialize membership writes to protect transfers, concurrent accepts and kicks.
export async function workspaceTransaction<T>(
  workspaceId: string,
  userId: string,
  action: Action,
  work: (tx: Prisma.TransactionClient, member: { role: Role }) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    return work(tx, await membership(workspaceId, userId, action, tx));
  });
}
export function createWorkspace(userId: string, name: string) {
  return db.workspace.create({
    data: { name, members: { create: { userId, role: "OWNER" } } },
  });
}
export async function defaultWorkspace(userId: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const member = await tx.workspaceMember.findFirst({
      where: { userId },
      orderBy: { joinedAt: "asc" },
    });
    if (member) return member.workspaceId;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return (
      await tx.workspace.create({
        data: {
          name: `${userDisplayName(user)}'s Workspace`,
          members: { create: { userId, role: "OWNER" } },
        },
      })
    ).id;
  });
}
export async function inviteMember(
  workspaceId: string,
  userId: string,
  email: string,
  role: "ADMIN" | "MEMBER",
) {
  const invite = await workspaceTransaction(
    workspaceId,
    userId,
    "invite",
    async (tx) => {
      if (
        await tx.workspaceMember.findFirst({
          where: { workspaceId, user: { email } },
        })
      )
        throw new WorkspaceError(409, "This email is already a member.");
      await tx.workspaceInvite.updateMany({
        where: { workspaceId, email, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      return tx.workspaceInvite.create({
        data: {
          workspaceId,
          email,
          role,
          invitedByUserId: userId,
          token: randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
        include: { workspace: true },
      });
    },
  );
  try {
    await sendInvite(invite);
  } catch {
    await db.workspaceInvite.updateMany({
      where: { id: invite.id, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    throw new WorkspaceError(
      503,
      "Invite email could not be sent. Check email configuration and try again.",
    );
  }
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt,
  };
}
export async function acceptInvite(token: string, userId: string) {
  const invite = await db.workspaceInvite.findUnique({ where: { token } });
  if (!invite) throw new WorkspaceError(404, "Invitation not found.");
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${invite.workspaceId} FOR UPDATE`;
    const current = await tx.workspaceInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== current.email.toLowerCase())
      throw new WorkspaceError(
        403,
        "Sign in with the email address this invitation was sent to.",
      );
    const where = {
      workspaceId_userId: { workspaceId: current.workspaceId, userId },
    };
    if (
      current.status === "ACCEPTED" &&
      (await tx.workspaceMember.findUnique({ where }))
    )
      return { workspaceId: current.workspaceId };
    if (current.status !== "PENDING")
      throw new WorkspaceError(410, "This invitation is no longer valid.");
    if (current.expiresAt <= new Date()) {
      await tx.workspaceInvite.update({
        where: { id: current.id },
        data: { status: "EXPIRED" },
      });
      return null;
    }
    await tx.workspaceMember.upsert({
      where,
      create: { workspaceId: current.workspaceId, userId, role: current.role },
      update: {},
    });
    await tx.workspaceInvite.update({
      where: { id: current.id },
      data: { status: "ACCEPTED" },
    });
    return { workspaceId: current.workspaceId };
  });
  if (!result) throw new WorkspaceError(410, "This invitation has expired.");
  return result;
}
export async function changeMember(
  workspaceId: string,
  actorId: string,
  targetId: string,
  role?: "ADMIN" | "MEMBER",
) {
  return workspaceTransaction(
    workspaceId,
    actorId,
    "view",
    async (tx, actor) => {
      const where = { workspaceId_userId: { workspaceId, userId: targetId } };
      const target = await tx.workspaceMember.findUnique({ where });
      if (!target) throw new WorkspaceError(404, "Member not found.");
      if (
        targetId === actorId ||
        !permitted(actor.role, role ? "roles" : "kick", target.role)
      )
        throw new WorkspaceError(
          403,
          "This member cannot be changed with your role. Use Leave to leave voluntarily.",
        );
      if (role) return tx.workspaceMember.update({ where, data: { role } });
      await tx.workspaceMember.delete({ where });
      const user = await tx.user.findUniqueOrThrow({ where: { id: targetId } });
      await tx.workspaceInvite.updateMany({
        where: { workspaceId, email: user.email, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      return { ok: true };
    },
  );
}
export async function leaveWorkspace(workspaceId: string, userId: string) {
  return workspaceTransaction(workspaceId, userId, "leave", async (tx) => {
    await tx.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await tx.workspaceInvite.updateMany({
      where: { workspaceId, email: user.email, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    return { ok: true };
  });
}
export function transferOwnership(
  workspaceId: string,
  userId: string,
  targetId: string,
) {
  return workspaceTransaction(workspaceId, userId, "transfer", async (tx) => {
    if (userId === targetId)
      throw new WorkspaceError(400, "Choose another member.");
    await membership(workspaceId, targetId, "view", tx);
    await tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId } },
      data: { role: "ADMIN" },
    });
    await tx.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetId } },
      data: { role: "OWNER" },
    });
    return { ok: true };
  });
}

// Token possession is required before exposing the invitation's account context.
export async function invitationDetails(token: string) {
  const invite = await db.workspaceInvite.findUnique({
    where: { token },
    include: { workspace: { select: { name: true } } },
  });
  if (!invite) throw new WorkspaceError(404, "Invitation not found.");
  if (invite.status !== "PENDING")
    throw new WorkspaceError(
      410,
      "This invitation has already been answered or revoked.",
    );
  if (invite.expiresAt <= new Date())
    throw new WorkspaceError(
      410,
      "This invitation has expired. Ask the workspace admin for a new one.",
    );
  const account = await db.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });
  return {
    email: invite.email,
    workspaceName: invite.workspace.name,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    accountExists: !!account,
  };
}
export async function declineInvite(token: string, userId: string) {
  const invite = await db.workspaceInvite.findUnique({ where: { token } });
  if (!invite) throw new WorkspaceError(404, "Invitation not found.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${invite.workspaceId} FOR UPDATE`;
    const current = await tx.workspaceInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== current.email.toLowerCase())
      throw new WorkspaceError(403, "Sign in with the invited email address.");
    if (current.status === "DECLINED") return { ok: true };
    if (current.status !== "PENDING" || current.expiresAt <= new Date())
      throw new WorkspaceError(410, "This invitation is no longer valid.");
    await tx.workspaceInvite.update({
      where: { id: current.id },
      data: { status: "DECLINED" },
    });
    return { ok: true };
  });
}
