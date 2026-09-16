import { WorkspaceError, membership } from "./workspaces";
import type { Action } from "./permissions";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";
export async function userId() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error("UNAUTHORIZED");
  return id;
}
export async function ownApplication(id: string, action: Action = "view") {
  const uid = await userId();
  const app = await db.application.findFirst({ where: { id, workspace: { members: { some: { userId: uid } } } } });
  if (!app) throw new Error("NOT_FOUND");
  const member = await membership(app.workspaceId, uid, action);
  return { ...app, role: member.role };
}
export async function ownEndpoint(id: string, action: Action = "view") {
  const uid = await userId();
  const endpoint = await db.endpoint.findFirst({
    where: { id, application: { workspace: { members: { some: { userId: uid } } } } },
  });
  if (!endpoint) throw new Error("NOT_FOUND");
  const app = await db.application.findUniqueOrThrow({ where: { id: endpoint.applicationId } });
  const member = await membership(app.workspaceId, uid, action);
  return { ...endpoint, role: member.role };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(process.env.NEXTAUTH_URL || request.url).origin
  )
    throw new Error("FORBIDDEN");
}
export function apiError(e: unknown) {
  if (e instanceof WorkspaceError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof Error && e.message === "KEY_GRACE_ACTIVE") return Response.json({ error: "The previous key is still in its grace period. Wait until it expires before rotating again." }, { status: 409 });
  if (
    e instanceof Error &&
    !["UNAUTHORIZED", "NOT_FOUND", "FORBIDDEN"].includes(e.message)
  ) {
    console.error("API request failed", {
      name: e.name,
      code: (e as { code?: string }).code,
    });
  }
  const message = e instanceof Error ? e.message : "Internal error";
  const status =
    message === "UNAUTHORIZED"
      ? 401
      : message === "NOT_FOUND"
        ? 404
        : message === "FORBIDDEN"
          ? 403
          : 400;
  return Response.json(
    {
      error: ["UNAUTHORIZED", "NOT_FOUND", "FORBIDDEN"].includes(message)
        ? message
        : "Invalid request. Check your inputs and try again.",
    },
    { status },
  );
}
