import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { db } from "./db";
export async function userId() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new Error("UNAUTHORIZED");
  return id;
}
export async function ownApplication(id: string) {
  const uid = await userId();
  const app = await db.application.findFirst({ where: { id, userId: uid } });
  if (!app) throw new Error("NOT_FOUND");
  return app;
}
export async function ownEndpoint(id: string) {
  const uid = await userId();
  const endpoint = await db.endpoint.findFirst({
    where: { id, application: { userId: uid } },
  });
  if (!endpoint) throw new Error("NOT_FOUND");
  return endpoint;
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
