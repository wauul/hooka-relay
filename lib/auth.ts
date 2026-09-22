import { decode } from "next-auth/jwt";
import type { NextAuthOptions } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { oauthAdapter } from "./oauth-adapter";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "./db";
export const authOptions: NextAuthOptions = {
  adapter: oauthAdapter,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  jwt: { async decode(params) {
    const token = await decode(params);
    if (!token?.sub) return null;
    const user = await db.user.findUnique({ where: { id: token.sub }, select: { sessionVersion: true } });
    // NextAuth also decodes JWTs during OAuth linking; reject reset-revoked
    // sessions there, not only when loading a dashboard session.
    return user && (token.sessionVersion ?? 0) === user.sessionVersion ? token : null;
  } },
  providers: [
    ...(process.env.GITHUB_ID && process.env.GITHUB_SECRET ? [GitHub({ clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET,
      userinfo: { url: "https://api.github.com/user", async request({ client, tokens }) {
        const profile = await client.userinfo(tokens.access_token!);
        const result = await fetch("https://api.github.com/user/emails", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(8000) });
        if (!result.ok) throw new Error("Could not verify GitHub email");
        const emails: { email: string; primary: boolean; verified: boolean }[] = await result.json();
        const verified = emails.find(e => e.primary && e.verified);
        if (!verified) throw new Error("Verify your primary GitHub email first");
        return { ...profile, email: verified.email.toLowerCase(), email_verified: true };
      } },
    })] : []),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })] : []),
    Credentials({
      name: "Email and password",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials.password ||
          credentials.password.length > 72
        )
          return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (
          !user || !user.hashedPassword ||
          !(await compare(credentials.password, user.hashedPassword))
        )
          return null;
        if (!user.emailVerified) throw new Error("EMAIL_UNVERIFIED");
        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === "google" || account?.provider === "github") return (profile as { email_verified?: boolean })?.email_verified === true;
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      if (token.sub) {
        const current = await db.user.findUnique({ where: { id: token.sub }, select: { sessionVersion: true } });
        if (!current || (!user && (token.sessionVersion ?? 0) !== current.sessionVersion)) return {};
        token.sessionVersion = current.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
};
