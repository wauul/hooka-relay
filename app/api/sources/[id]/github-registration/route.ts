import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, ownApplication, sameOrigin, userId } from "@/lib/access";
import { boundedJson } from "@/lib/input-limits";
import { encryptSecret } from "@/lib/secrets";
import { workspaceTransaction } from "@/lib/workspaces";

const inputSchema = z.object({
  owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
  repository: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  token: z.string().min(20).max(512),
  events: z.array(z.enum(["push", "pull_request", "issues", "issue_comment", "release", "workflow_run"])).min(1).max(6),
}).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(req);
    const source = await db.webhookSource.findUnique({ where: { id: (await params).id } });
    if (!source) throw new Error("NOT_FOUND");
    const app = await ownApplication(source.applicationId, "manage");
    if (source.provider !== "GITHUB" || source.status !== "SETUP_IN_PROGRESS" || source.lastVerifiedAt) throw new Error("GitHub registration is only available during setup");
    const input = inputSchema.parse(await boundedJson(req, 4096));
    const secret = randomBytes(32).toString("hex");
    const ingestionUrl = `${new URL(process.env.NEXTAUTH_URL || req.url).origin}/api/inbound/${source.ingestionToken}`;
    const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${input.token}`, "X-GitHub-Api-Version": "2026-03-10" };
    const existing = await fetch(`https://api.github.com/repos/${input.owner}/${input.repository}/hooks?per_page=100`, {
      redirect: "error", signal: AbortSignal.timeout(10000), headers,
    });
    if (!existing.ok) return Response.json({ error: "GitHub could not inspect repository webhooks. Check repository access and Webhooks read permission." }, { status: 502 });
    const hooks = await existing.json() as { config?: { url?: string } }[];
    if (hooks.some(hook => hook.config?.url === ingestionUrl)) return Response.json({ error: "This source already has a GitHub webhook. Send or redeliver a signed event to finish setup." }, { status: 409 });
    // Save first so GitHub's immediate ping can be verified. A failed API call
    // leaves this draft source editable and does not retain the GitHub token.
    await workspaceTransaction(app.workspaceId, await userId(), "manage", tx => tx.webhookSource.update({ where: { id: source.id }, data: { encryptedProviderSecret: encryptSecret(secret, app.id), setupStep: 5 } }));
    let response: Response;
    try {
      response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repository}/hooks`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "web", active: true, events: input.events, config: { url: ingestionUrl, content_type: "json", secret, insecure_ssl: "0" } }),
      });
    } catch (error) {
      await db.webhookSource.update({ where: { id: source.id }, data: { encryptedProviderSecret: source.encryptedProviderSecret } });
      throw error;
    }
    if (!response.ok) {
      await db.webhookSource.update({ where: { id: source.id }, data: { encryptedProviderSecret: source.encryptedProviderSecret } });
      return Response.json({ error: response.status === 401 || response.status === 403 ? "GitHub rejected the token or Webhooks write permission" : response.status === 404 ? "Repository not found or token has no access" : "GitHub could not create the webhook" }, { status: 502 });
    }
    const hook = await response.json() as { id?: number; html_url?: string };
    return Response.json({ hookId: hook.id, repository: `${input.owner}/${input.repository}`, ingestionUrl }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
