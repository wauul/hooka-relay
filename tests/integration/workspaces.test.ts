import { POST as rotateSigning } from "../../app/api/endpoints/[id]/rotate-secret/route";
import { PATCH as changeRetry } from "../../app/api/endpoints/[id]/retry-policy/route";
import { POST as createAppRoute } from "../../app/api/applications/route";
import { GET as endpointList } from "../../app/api/applications/[id]/endpoints/route";
import { GET as endpointDetails } from "../../app/api/endpoints/[id]/attempts/route";
import { encryptSecret, hashApiKey } from "../../lib/secrets";
import { createApplication } from "../fixtures";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ session: vi.fn(), email: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("../../lib/invite-email", () => ({ sendInvite: mocks.email }));
vi.mock("../../lib/queue/client", () => ({
  publish: vi.fn().mockResolvedValue(undefined),
}));
import { db } from "../../lib/db";
import {
  invitationDetails,
  declineInvite,
  createWorkspace,
  inviteMember,
  acceptInvite,
  changeMember,
  leaveWorkspace,
  transferOwnership,
} from "../../lib/workspaces";
import { POST as inviteRoute } from "../../app/api/workspaces/[id]/invites/route";
import { POST as declineRoute } from "../../app/api/invites/[token]/decline/route";
import { POST as acceptRoute } from "../../app/api/invites/[token]/accept/route";
import { DELETE as kickRoute } from "../../app/api/workspaces/[id]/members/[userId]/route";
import { POST as leaveRoute } from "../../app/api/workspaces/[id]/leave/route";
import {
  POST as rotateRoute,
  GET as appRoute,
  DELETE as deleteApp,
} from "../../app/api/applications/[id]/route";
import { PATCH as pauseRoute } from "../../app/api/endpoints/[id]/pause/route";
import { PATCH as resumeRoute } from "../../app/api/endpoints/[id]/resume/route";
import { POST as events } from "../../app/api/v1/events/route";
import { cliApi } from "../../lib/cli-api";
import {
  GET as listWorkspaces,
  POST as newWorkspace,
} from "../../app/api/workspaces/route";
import {
  GET as workspaceDetails,
  PATCH as renameWorkspace,
  DELETE as deleteWorkspace,
} from "../../app/api/workspaces/[id]/route";
import { DELETE as revokeInvite } from "../../app/api/workspaces/[id]/invites/[inviteId]/route";
import { POST as replay } from "../../app/api/events/[id]/replay/route";
import {
  GET as getProfile,
  PATCH as updateProfile,
} from "../../app/api/profile/route";
import { POST as signup } from "../../app/api/signup/route";
let users: { id: string; email: string }[];
let workspaceId: string;
const req = (body: unknown = {}, method = "POST") =>
  new Request("http://localhost/api/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
const context = (id = workspaceId) => ({ params: Promise.resolve({ id }) });
const session = (index: number) =>
  mocks.session.mockResolvedValue({ user: { id: users[index].id } });
beforeEach(async () => {
  mocks.email.mockReset().mockResolvedValue(undefined);
  users = [];
  for (let i = 0; i < 4; i++)
    users.push(
      await db.user.create({
        data: {
          email: `${randomUUID()}@example.com`,
          hashedPassword: "unused",
        },
      }),
    );
  workspaceId = (await createWorkspace(users[0].id, "Team")).id;
  await db.workspaceMember.createMany({
    data: [
      { workspaceId, userId: users[1].id, role: "ADMIN" },
      { workspaceId, userId: users[2].id, role: "MEMBER" },
    ],
  });
  session(0);
});
afterEach(async () => {
  await db.workspace.deleteMany({
    where: { members: { some: { userId: { in: users.map((u) => u.id) } } } },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  vi.unstubAllEnvs();
});
it("invites by email, accepts through session routes and is idempotent", async () => {
  const response = await inviteRoute(
    req({ email: users[3].email.toUpperCase(), role: "MEMBER" }),
    context(),
  );
  expect(response.status).toBe(201);
  expect(mocks.email).toHaveBeenCalledTimes(1);
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  expect(invite.token).toMatch(/^[a-f0-9]{64}$/);
  session(2);
  expect(
    (
      await acceptRoute(req(), {
        params: Promise.resolve({ token: invite.token }),
      })
    ).status,
  ).toBe(403);
  session(3);
  const accepted = await Promise.all([
    acceptRoute(req(), { params: Promise.resolve({ token: invite.token }) }),
    acceptRoute(req(), { params: Promise.resolve({ token: invite.token }) }),
  ]);
  expect(accepted.map((r) => r.status)).toEqual([200, 200]);
  expect(
    await db.workspaceMember.count({
      where: { workspaceId, userId: users[3].id },
    }),
  ).toBe(1);
  expect(
    await db.workspaceInvite.findUnique({ where: { id: invite.id } }),
  ).toMatchObject({ status: "ACCEPTED" });
});
it("rejects expired, revoked and owner-role invites and handles email failure", async () => {
  expect(
    (
      await inviteRoute(
        req({ email: users[3].email, role: "OWNER" }),
        context(),
      )
    ).status,
  ).toBe(400);
  await inviteMember(workspaceId, users[0].id, users[3].email, "ADMIN");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(acceptInvite(invite.token, users[3].id)).rejects.toThrow(
    "expired",
  );
  expect(
    await db.workspaceInvite.findUnique({ where: { id: invite.id } }),
  ).toMatchObject({ status: "EXPIRED" });
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { status: "REVOKED" },
  });
  await expect(acceptInvite(invite.token, users[3].id)).rejects.toThrow(
    "no longer valid",
  );
  mocks.email.mockRejectedValueOnce(new Error("resend unavailable"));
  await expect(
    inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER"),
  ).rejects.toThrow("could not be sent");
  expect(
    await db.workspaceInvite.count({
      where: { workspaceId, status: "PENDING" },
    }),
  ).toBe(0);
});
it("enforces kick, leave, role change and transfer permissions", async () => {
  for (const actor of [1, 2]) {
    session(actor);
    expect(
      (
        await kickRoute(req({}, "DELETE"), {
          params: Promise.resolve({ id: workspaceId, userId: users[0].id }),
        })
      ).status,
    ).toBe(403);
  }
  session(2);
  expect(
    (
      await inviteRoute(
        req({ email: users[3].email, role: "MEMBER" }),
        context(),
      )
    ).status,
  ).toBe(403);
  await expect(
    changeMember(workspaceId, users[2].id, users[1].id),
  ).rejects.toThrow();
  session(0);
  expect((await leaveRoute(req(), context())).status).toBe(403);
  await transferOwnership(workspaceId, users[0].id, users[2].id);
  expect(
    await db.workspaceMember.count({ where: { workspaceId, role: "OWNER" } }),
  ).toBe(1);
  await expect(
    changeMember(workspaceId, users[1].id, users[0].id),
  ).rejects.toThrow();
  await changeMember(workspaceId, users[2].id, users[1].id);
  await leaveWorkspace(workspaceId, users[0].id);
  expect(await db.workspaceMember.count({ where: { workspaceId } })).toBe(1);
});
it("prevents removed users from reusing an accepted invitation", async () => {
  await inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  await acceptInvite(invite.token, users[3].id);
  await changeMember(workspaceId, users[1].id, users[3].id);
  await expect(acceptInvite(invite.token, users[3].id)).rejects.toThrow();
});
it("enforces tenant and member restrictions on application and endpoint writes", async () => {
  const app = await createApplication({
    data: { workspaceId, name: "App", currentApiKey: randomUUID() },
  });
  const ep = await db.endpoint.create({
    data: {
      applicationId: app.id,
      url: "https://example.com",
      secret: "secret",
      eventTypes: ["*"],
    },
  });
  session(2);
  expect((await rotateRoute(req(), context(app.id))).status).toBe(403);
  expect((await deleteApp(req({}, "DELETE"), context(app.id))).status).toBe(
    403,
  );
  expect((await pauseRoute(req({}, "PATCH"), context(ep.id))).status).toBe(403);
  const visible = await (
    await appRoute(req(undefined, "GET"), context(app.id))
  ).json();
  expect(visible.currentApiKey).toBeUndefined();
  session(3);
  expect((await appRoute(req(undefined, "GET"), context(app.id))).status).toBe(
    404,
  );
});
it("rotates keys with shared rate limiting and rejects expired old keys in both APIs", async () => {
  vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", "2");
  const app = await createApplication({
    data: { workspaceId, name: "App", currentApiKey: randomUUID() },
  });
  const rotated = await rotateRoute(req(), context(app.id));
  expect(rotated.status).toBe(200);
  const result = await rotated.json();
  expect((await rotateRoute(req(), context(app.id))).status).toBe(409);
  const send = (key: string) =>
    events(
      new Request("http://localhost/api/v1/events", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: JSON.stringify({ type: "test", payload: {} }),
      }),
    );
  expect((await send(app.currentApiKey)).status).toBe(202);
  expect((await send(result.currentApiKey)).status).toBe(202);
  const limited = await send(result.currentApiKey);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  await db.application.update({
    where: { id: app.id },
    data: { previousApiKeyExpiresAt: new Date(0) },
  });
  expect((await send(app.currentApiKey)).status).toBe(401);
  expect(
    (
      await cliApi(
        new Request("http://localhost/api/v1/me", {
          headers: { authorization: `Bearer ${app.currentApiKey}` },
        }),
        ["me"],
      )
    ).status,
  ).toBe(401);
});
it("pauses without delivery intents or skipped logs and resumes without backfill", async () => {
  const app = await createApplication({
    data: { workspaceId, name: "App", currentApiKey: randomUUID() },
  });
  const ep = await db.endpoint.create({
    data: {
      applicationId: app.id,
      url: "https://example.com",
      secret: "secret",
      eventTypes: ["*"],
    },
  });
  expect((await pauseRoute(req({}, "PATCH"), context(ep.id))).status).toBe(200);
  const response = await events(
    new Request("http://localhost/api/v1/events", {
      method: "POST",
      headers: { authorization: `Bearer ${app.currentApiKey}` },
      body: JSON.stringify({ type: "test", payload: {} }),
    }),
  );
  const event = await response.json();
  expect(response.status).toBe(202);
  expect(await db.delivery.count({ where: { eventId: event.id } })).toBe(0);
  expect(await db.deliveryAttempt.count({ where: { eventId: event.id } })).toBe(
    0,
  );
  expect((await resumeRoute(req({}, "PATCH"), context(ep.id))).status).toBe(
    200,
  );
  expect(await db.delivery.count({ where: { eventId: event.id } })).toBe(0);
  expect(
    (await replay(req({ endpointId: ep.id }), context(event.id))).status,
  ).toBe(202);
  expect(
    await db.delivery.count({
      where: { eventId: event.id, endpointId: ep.id },
    }),
  ).toBe(1);
});
it("supports workspace CRUD with server-side role checks and cascades only its own data", async () => {
  session(2);
  expect(
    (await workspaceDetails(req(undefined, "GET"), context())).status,
  ).toBe(200);
  expect(
    (await renameWorkspace(req({ name: "No" }, "PATCH"), context())).status,
  ).toBe(403);
  expect((await deleteWorkspace(req({}, "DELETE"), context())).status).toBe(
    403,
  );
  session(1);
  expect(
    (await renameWorkspace(req({ name: "Renamed" }, "PATCH"), context()))
      .status,
  ).toBe(200);
  expect((await deleteWorkspace(req({}, "DELETE"), context())).status).toBe(
    403,
  );
  session(0);
  const second = await (await newWorkspace(req({ name: "Second" }))).json();
  const listed = await (await listWorkspaces()).json();
  expect(listed).toHaveLength(2);
  const app = await createApplication({
    data: {
      workspaceId: second.id,
      name: "Disposable",
      currentApiKey: randomUUID(),
    },
  });
  await db.event.create({
    data: {
      applicationId: app.id,
      type: "test",
      payload: {},
      idempotencyKey: "delete-test",
    },
  });
  expect(
    (await deleteWorkspace(req({}, "DELETE"), context(second.id))).status,
  ).toBe(200);
  expect(await db.application.findUnique({ where: { id: app.id } })).toBeNull();
  expect(
    await db.workspace.findUnique({ where: { id: workspaceId } }),
  ).not.toBeNull();
});
it("accepts an invite after the recipient registers, and enforces revocation", async () => {
  const email = `${randomUUID()}@example.com`;
  await inviteMember(workspaceId, users[0].id, email, "MEMBER");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId, email },
  });
  expect(
    (await signup(req({ email, password: "test-registration-password" })))
      .status,
  ).toBe(201);
  users.push(await db.user.findUniqueOrThrow({ where: { email } }));
  await acceptInvite(invite.token, users[4].id);
  expect(
    await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: users[4].id } },
    }),
  ).toMatchObject({ role: "MEMBER" });
  await inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER");
  const pending = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId, email: users[3].email },
  });
  session(2);
  const params = {
    params: Promise.resolve({ id: workspaceId, inviteId: pending.id }),
  };
  expect((await revokeInvite(req({}, "DELETE"), params)).status).toBe(403);
  session(0);
  expect((await revokeInvite(req({}, "DELETE"), params)).status).toBe(200);
  await expect(acceptInvite(pending.token, users[3].id)).rejects.toThrow();
});
it("enforces the rolling limit under concurrency and reopens the budget after expiry", async () => {
  vi.stubEnv("EVENTS_RATE_LIMIT_PER_MINUTE", "3");
  const app = await createApplication({
    data: { workspaceId, name: "Concurrent", currentApiKey: randomUUID() },
  });
  const send = () =>
    events(
      new Request("http://localhost/api/v1/events", {
        method: "POST",
        headers: { authorization: `Bearer ${app.currentApiKey}` },
        body: JSON.stringify({ type: "test", payload: {} }),
      }),
    );
  const responses = await Promise.all(Array.from({ length: 7 }, send));
  expect(responses.filter((r) => r.status === 202)).toHaveLength(3);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(4);
  expect(await db.event.count({ where: { applicationId: app.id } })).toBe(3);
  await db.eventAdmission.updateMany({
    where: { applicationId: app.id },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  expect((await send()).status).toBe(202);
});
it("database constraints reject losing the last owner and adding a second owner", async () => {
  await expect(
    db.workspaceMember.deleteMany({ where: { workspaceId, role: "OWNER" } }),
  ).rejects.toThrow();
  await expect(
    db.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: users[1].id } },
      data: { role: "OWNER" },
    }),
  ).rejects.toThrow();
  expect(
    await db.workspaceMember.count({ where: { workspaceId, role: "OWNER" } }),
  ).toBe(1);
});

it("invitation context selects signup or login and never exposes unavailable invites", async () => {
  await inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  expect(await invitationDetails(invite.token)).toMatchObject({
    email: users[3].email,
    accountExists: true,
    workspaceName: "Team",
  });
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { email: "new-account@example.com" },
  });
  expect(await invitationDetails(invite.token)).toMatchObject({
    accountExists: false,
  });
  expect(
    (
      await signup(
        req({
          email: "wrong@example.com",
          password: "a-valid-password",
          inviteToken: invite.token,
        }),
      )
    ).status,
  ).toBe(403);
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(invitationDetails(invite.token)).rejects.toMatchObject({
    status: 410,
  });
  await expect(invitationDetails("missing")).rejects.toMatchObject({
    status: 404,
  });
});
it("only the invited account can decline; declining creates no membership and blocks acceptance", async () => {
  await inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  await expect(declineInvite(invite.token, users[2].id)).rejects.toMatchObject({
    status: 403,
  });
  expect(await declineInvite(invite.token, users[3].id)).toEqual({ ok: true });
  expect(await declineInvite(invite.token, users[3].id)).toEqual({ ok: true });
  expect(
    await db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: users[3].id } },
    }),
  ).toBeNull();
  expect(
    (await db.workspaceInvite.findUniqueOrThrow({ where: { id: invite.id } }))
      .status,
  ).toBe("DECLINED");
  await expect(acceptInvite(invite.token, users[3].id)).rejects.toMatchObject({
    status: 410,
  });
  await expect(invitationDetails(invite.token)).rejects.toMatchObject({
    status: 410,
  });
  await expect(declineInvite("missing", users[3].id)).rejects.toMatchObject({
    status: 404,
  });
});
it("accepted and expired invitations cannot be declined", async () => {
  await inviteMember(workspaceId, users[0].id, users[3].email, "ADMIN");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { expiresAt: new Date(0) },
  });
  await expect(declineInvite(invite.token, users[3].id)).rejects.toMatchObject({
    status: 410,
  });
  await db.workspaceInvite.update({
    where: { id: invite.id },
    data: { expiresAt: new Date(Date.now() + 60000) },
  });
  await acceptInvite(invite.token, users[3].id);
  await expect(declineInvite(invite.token, users[3].id)).rejects.toMatchObject({
    status: 410,
  });
});

it("decline route requires authentication and the recipient session", async () => {
  await inviteMember(workspaceId, users[0].id, users[3].email, "MEMBER");
  const invite = await db.workspaceInvite.findFirstOrThrow({
    where: { workspaceId },
  });
  const ctx = { params: Promise.resolve({ token: invite.token }) };
  mocks.session.mockResolvedValue(null);
  expect((await declineRoute(req(), ctx)).status).toBe(401);
  session(2);
  expect((await declineRoute(req(), ctx)).status).toBe(403);
  session(3);
  expect((await declineRoute(req(), ctx)).status).toBe(200);
});

it("display names are editable only on the current account and appear in team details", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await getProfile()).status).toBe(401);
  expect(
    (await updateProfile(req({ displayName: "Name" }, "PATCH"))).status,
  ).toBe(401);
  session(2);
  const profile = await (await getProfile()).json();
  expect(profile.displayName).toBe(users[2].email.split("@")[0]);
  expect(profile.hashedPassword).toBeUndefined();
  expect(
    (
      await updateProfile(
        req({ displayName: "  Friendly Name  ", userId: users[0].id }, "PATCH"),
      )
    ).status,
  ).toBe(200);
  expect((await getProfile()).status).toBe(200);
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: users[2].id } }))
      .displayName,
  ).toBe("Friendly Name");
  expect(
    (await db.user.findUniqueOrThrow({ where: { id: users[0].id } }))
      .displayName,
  ).toBeNull();
  const details = await (
    await workspaceDetails(req({}, "GET"), context())
  ).json();
  expect(
    details.members.find((m: { userId: string }) => m.userId === users[2].id)
      .user.displayName,
  ).toBe("Friendly Name");
  expect((await updateProfile(req({ displayName: " " }, "PATCH"))).status).toBe(
    400,
  );
  expect(
    (await updateProfile(req({ displayName: "a".repeat(41) }, "PATCH"))).status,
  ).toBe(400);
});

it("discloses a new API key only once and restricts signing secrets to admins", async () => {
  const response = await createAppRoute(req({ name: "Secure app", workspaceId }));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const app = await response.json();
  expect(app.currentApiKey).toMatch(/^hr_live_/);
  expect((await db.application.findUniqueOrThrow({ where: { id: app.id } })).currentApiKey).toBe(hashApiKey(app.currentApiKey));
  expect((await (await appRoute(req(undefined, "GET"), context(app.id))).json()).currentApiKey).toBeUndefined();
  const endpoint = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com", eventTypes: ["*"], secret: encryptSecret("secret-for-admins", app.id) } });
  expect((await (await endpointDetails(req(undefined, "GET"), context(endpoint.id))).json()).endpoint.secret).toBe("secret-for-admins");
  session(2);
  expect((await (await endpointDetails(req(undefined, "GET"), context(endpoint.id))).json()).endpoint.secret).toBeUndefined();
  const listed = await (await endpointList(req(undefined, "GET"), context(app.id))).json();
  expect(listed[0].secret).toBeUndefined();
});

it("keeps standard retries by default and restricts policy changes to admins", async () => {
  const app = await createApplication({ data: { workspaceId, name: "Retry", currentApiKey: randomUUID() } });
  const ep = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com", eventTypes: ["*"], secret: encryptSecret("secret", app.id) } });
  expect(ep.retryPolicy).toBe("STANDARD"); session(2);
  expect((await changeRetry(req({ retryPolicy: "AGGRESSIVE" }, "PATCH"), context(ep.id))).status).toBe(403);
  session(1); expect((await changeRetry(req({ retryPolicy: "AGGRESSIVE" }, "PATCH"), context(ep.id))).status).toBe(200);
  expect((await db.endpoint.findUniqueOrThrow({ where: { id: ep.id } })).retryPolicy).toBe("AGGRESSIVE");
  expect((await changeRetry(req({ retryPolicy: "UNKNOWN" }, "PATCH"), context(ep.id))).status).toBe(400);
  session(3); expect((await changeRetry(req({ retryPolicy: "RELAXED" }, "PATCH"), context(ep.id))).status).toBe(404);
});

it("restricts signing management to administrators and audits secret display", async () => {
  const app = await createApplication({ data: { workspaceId, name: "Signing", currentApiKey: randomUUID() } });
  const ep = await db.endpoint.create({ data: { applicationId: app.id, url: "https://example.com", secret: encryptSecret("legacy", app.id), eventTypes: ["*"] } });
  for (const index of [2, 3]) {
    session(index);
    expect((await rotateSigning(req(), context(ep.id))).status).toBe(index === 2 ? 403 : 404);
  }
  session(1);
  expect((await rotateSigning(req(), context(ep.id))).status).toBe(200);
  expect((await rotateSigning(req(), context(ep.id))).status).toBe(409);
  expect((await endpointDetails(req(undefined, "GET"), context(ep.id))).status).toBe(200);
  expect(await db.auditLog.count({ where: { endpointId: ep.id, actorId: users[1].id, action: "signing_secret.revealed" } })).toBe(2);
  await db.auditLog.deleteMany({ where: { endpointId: ep.id } });
});
