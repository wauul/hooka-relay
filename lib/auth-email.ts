import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { db } from "./db";
import { InputLimitError } from "./input-limits";
import { sendTransactionalEmail } from "./transactional-email";
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const safeAuthCallback = (path?: string) => path?.startsWith("/invites/accept?token=") && !/[\r\n\\]/.test(path) ? path : "/dashboard";
export async function issueAuthEmail(email: string, purpose: "VERIFY" | "RESET", callbackPath?: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || (purpose === "VERIFY" && user.emailVerified) || (purpose === "RESET" && !user.hashedPassword)) return;
  const token = randomBytes(32).toString("hex");
  const record = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    // An address-level cooldown prevents a distributed email flood. Resending
    // never invalidates an unused link, so an attacker cannot deny verification.
    if (await tx.authToken.findFirst({ where: { userId: user.id, purpose, createdAt: { gt: new Date(Date.now() - 60000) } } })) return null;
    return tx.authToken.create({ data: { hash: tokenHash(token), userId: user.id, purpose, expiresAt: new Date(Date.now() + (purpose === "VERIFY" ? 86400000 : 1800000)), callbackPath: safeAuthCallback(callbackPath) } });
  });
  if (!record) return;
  const link = new URL(purpose === "VERIFY" ? "/verify-email" : "/reset-password", process.env.NEXTAUTH_URL);
  link.searchParams.set("token", token);
  try { await sendTransactionalEmail({ id: `auth-${record.hash}`, to: user.email, subject: purpose === "VERIFY" ? "Confirm your Hooka Relay email" : "Reset your Hooka Relay password", title: purpose === "VERIFY" ? "Confirm your email address" : "Choose a new password", body: purpose === "VERIFY" ? "Confirm this email address to finish setting up your account. This link expires in 24 hours." : "We received a request to reset your password. This link expires in 30 minutes and can be used once.", action: purpose === "VERIFY" ? "Confirm email" : "Reset password", url: link.toString() }); }
  catch { await db.authToken.deleteMany({ where: { hash: record.hash } }); throw new Error("Email unavailable"); }
}
export async function consumeAuthToken(token: string, purpose: "VERIFY" | "RESET", password?: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new InputLimitError(400, "This link is invalid or has expired. Request a new one.");
  const passwordHash = purpose === "RESET" && password ? await hash(password, 12) : undefined;
  return db.$transaction(async tx => {
    const record = await tx.authToken.findUnique({ where: { hash: tokenHash(token) } });
    if (!record || record.purpose !== purpose || record.expiresAt <= new Date()) throw new InputLimitError(400, "This link is invalid or has expired. Request a new one.");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${record.userId} FOR UPDATE`;
    const consumed = await tx.authToken.deleteMany({ where: { hash: record.hash, expiresAt: { gt: new Date() } } });
    if (!consumed.count) throw new InputLimitError(400, "This link has already been used.");
    if (purpose === "RESET") {
      if (!passwordHash) throw new InputLimitError(400, "A new password is required.");
      // Revoke all previously issued sessions and reset links atomically. A stolen
      // JWT must not survive recovery of the account by its email owner.
      await tx.user.update({ where: { id: record.userId }, data: { hashedPassword: passwordHash, emailVerified: new Date(), sessionVersion: { increment: 1 } } });
      await tx.authToken.deleteMany({ where: { userId: record.userId } });
    } else {
      await tx.user.update({ where: { id: record.userId }, data: { emailVerified: new Date() } });
      await tx.authToken.deleteMany({ where: { userId: record.userId, purpose: "VERIFY" } });
    }
    return record.callbackPath;
  });
}
