import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { compare, hash } from "bcryptjs";
const email = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../lib/transactional-email", () => ({ sendTransactionalEmail: email }));
import { db } from "../../lib/db";
import { consumeAuthToken, issueAuthEmail, tokenHash } from "../../lib/auth-email";
import { oauthAdapter } from "../../lib/oauth-adapter";
import { authOptions } from "../../lib/auth";
import { POST as forgot } from "../../app/api/account/forgot-password/route";
import { POST as signup } from "../../app/api/signup/route";
let user: { id: string; email: string };
const request = (email: string) => new Request("http://localhost/api/account/forgot-password", { method: "POST", headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": "192.0.2.200" }, body: JSON.stringify({ email }) });
beforeEach(async () => { vi.clearAllMocks(); vi.stubEnv("NEXTAUTH_URL", "http://localhost"); vi.stubEnv("VERCEL", "1"); user = await db.user.create({ data: { email: `${randomUUID()}@auth.test`, hashedPassword: await hash("existing-password", 4) } }); await db.ipRateBucket.deleteMany({ where: { key: { startsWith: "recovery:" } } }); });
afterEach(async () => { await db.user.delete({ where: { id: user.id } }); vi.unstubAllEnvs(); });
afterAll(() => db.$disconnect());
const sentToken = () => new URL(email.mock.calls.at(-1)![0].url).searchParams.get("token")!;
it("preserves migrated accounts and requires confirmation for new credentials accounts", async () => {
  expect((await db.user.findUniqueOrThrow({ where: { id: "migration-owner" } })).emailVerified).not.toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBeNull();
  const provider = authOptions.providers.find(p => p.id === "credentials")!;
  const authorize = (provider as unknown as { options: { authorize: (c: { email: string; password: string }) => Promise<unknown> } }).options.authorize;
  await expect(authorize({ email: user.email, password: "existing-password" })).rejects.toThrow("EMAIL_UNVERIFIED");
  await issueAuthEmail(user.email, "VERIFY", "/invites/accept?token=invitation"); const token = sentToken();
  expect(await db.authToken.findUnique({ where: { hash: token } })).toBeNull();
  expect(await consumeAuthToken(token, "VERIFY")).toBe("/invites/accept?token=invitation");
  expect(await authorize({ email: user.email, password: "existing-password" })).toMatchObject({ id: user.id });
  await expect(consumeAuthToken(token, "VERIFY")).rejects.toThrow();
});
it("rejects wrong-purpose and expired links, with atomic single-use reset and session revocation", async () => {
  const oldJwt = await encode({ secret: "test", token: { sub: user.id, sessionVersion: 0 } });
  await issueAuthEmail(user.email, "RESET"); const token = sentToken();
  await expect(consumeAuthToken(token, "VERIFY")).rejects.toThrow();
  await db.authToken.update({ where: { hash: tokenHash(token) }, data: { expiresAt: new Date(0) } });
  await expect(consumeAuthToken(token, "RESET", "replacement-password")).rejects.toThrow();
  await db.authToken.update({ where: { hash: tokenHash(token) }, data: { expiresAt: new Date(Date.now() + 60000) } });
  const results = await Promise.allSettled([consumeAuthToken(token, "RESET", "replacement-password"), consumeAuthToken(token, "RESET", "replacement-password")]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } }); expect(updated.sessionVersion).toBe(1); expect(await authOptions.jwt!.decode!({ token: oldJwt, secret: "test" })).toBeNull(); expect(await compare("replacement-password", updated.hashedPassword!)).toBe(true);
  expect(await db.authToken.count({ where: { userId: user.id } })).toBe(0);
});
it("returns identical forgot-password responses and enforces a dedicated IP budget", async () => {
  vi.stubEnv("RECOVERY_IP_LIMIT_PER_MINUTE", "2");
  const known = await forgot(request(user.email)), absent = await forgot(request("absent@auth.test"));
  expect(known.status).toBe(200); expect(await known.json()).toEqual(await absent.json());
  const limited = await forgot(request(user.email)); expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("60"); expect(email).toHaveBeenCalledTimes(1);
});
it("applies an address cooldown without replacing a valid link; email failure leaves no dead token", async () => {
  await issueAuthEmail(user.email, "VERIFY"); const token = sentToken(); await issueAuthEmail(user.email, "VERIFY"); expect(email).toHaveBeenCalledTimes(1);
  expect(await db.authToken.findUnique({ where: { hash: tokenHash(token) } })).not.toBeNull();
  email.mockRejectedValueOnce(new Error("outage")); await expect(issueAuthEmail(user.email, "RESET")).rejects.toThrow();
  expect(await db.authToken.count({ where: { userId: user.id, purpose: "RESET" } })).toBe(0);
});
it("persists OAuth identity without storing provider access tokens and does not overwrite credential identity", async () => {
  await oauthAdapter.linkAccount!({ userId: user.id, type: "oauth", provider: "github", providerAccountId: randomUUID(), access_token: "never-store-me" });
  const account = await db.oAuthAccount.findFirstOrThrow({ where: { userId: user.id } }); expect(JSON.stringify(account)).not.toContain("never-store-me");
  expect(await oauthAdapter.getUserByAccount!({ provider: account.provider, providerAccountId: account.providerAccountId })).toMatchObject({ id: user.id });
  expect((await oauthAdapter.getUserByEmail!(user.email))?.id).toBe(user.id);
});
it("new signup sends verification and duplicate signup never replaces the password", async () => {
  const signupEmail = `${randomUUID()}@signup.test`; const call = () => signup(new Request("http://localhost/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: signupEmail, password: "signup-password" }) }));
  try { expect((await call()).status).toBe(201); const first = await db.user.findUniqueOrThrow({ where: { email: signupEmail } }); expect(first.emailVerified).toBeNull(); expect(email).toHaveBeenCalled(); expect((await call()).status).toBe(201); expect((await db.user.findUniqueOrThrow({ where: { email: signupEmail } })).hashedPassword).toBe(first.hashedPassword); } finally { await db.user.deleteMany({ where: { email: signupEmail } }); }
});
