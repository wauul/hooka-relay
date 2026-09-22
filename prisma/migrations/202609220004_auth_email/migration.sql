-- Existing accounts keep access; verification is required for all future credentials signups.
ALTER TABLE "User" ALTER COLUMN "hashedPassword" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "emailVerified" TIMESTAMP(3), ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
UPDATE "User" SET "emailVerified" = "createdAt";
CREATE TABLE "OAuthAccount" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, provider TEXT NOT NULL, "providerAccountId" TEXT NOT NULL);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"(provider,"providerAccountId");
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
CREATE TABLE "AuthToken" (hash TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, purpose TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "callbackPath" TEXT NOT NULL DEFAULT '/dashboard');
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId",purpose);
CREATE INDEX "AuthToken_expiresAt_idx" ON "AuthToken"("expiresAt");
