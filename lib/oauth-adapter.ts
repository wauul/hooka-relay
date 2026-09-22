import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import type { User } from "@prisma/client";
import { db } from "./db";
import { userDisplayName } from "./display-name";
const mapped = (u: User): AdapterUser => ({ id: u.id, email: u.email, emailVerified: u.emailVerified, name: u.displayName, image: null });
// JWT sessions need identity persistence only. Provider bearer/refresh tokens are
// deliberately not stored: signing in grants no background GitHub/Google access.
export const oauthAdapter: Adapter = {
  async createUser(data: Omit<AdapterUser, "id">) {
    const email = data.email.toLowerCase().trim();
    return mapped(await db.user.create({ data: { email, displayName: userDisplayName({ email }), emailVerified: new Date() } }));
  },
  async getUser(id) { const u = await db.user.findUnique({ where: { id } }); return u ? mapped(u) : null; },
  async getUserByEmail(email) { const u = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } }); return u ? mapped(u) : null; },
  async getUserByAccount({ provider, providerAccountId }) { const a = await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider, providerAccountId } }, include: { user: true } }); return a ? mapped(a.user) : null; },
  async updateUser(data) { return mapped(await db.user.update({ where: { id: data.id }, data: { ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}) } })); },
  async linkAccount({ userId, provider, providerAccountId }: AdapterAccount) { await db.oAuthAccount.create({ data: { userId, provider, providerAccountId } }); },
  async unlinkAccount({ provider, providerAccountId }: Pick<AdapterAccount, "provider" | "providerAccountId">) { await db.oAuthAccount.delete({ where: { provider_providerAccountId: { provider, providerAccountId } } }); },
};
