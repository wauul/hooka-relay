CREATE TYPE "SignatureFormat" AS ENUM ('LEGACY', 'STANDARD');
ALTER TABLE "Endpoint" ADD COLUMN "signatureFormat" "SignatureFormat" NOT NULL DEFAULT 'LEGACY', ADD COLUMN "secretVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "previousSecret" TEXT, ADD COLUMN "previousSecretVersion" INTEGER, ADD COLUMN "previousSecretExpiresAt" TIMESTAMP(3);
CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY, "applicationId" TEXT NOT NULL, "endpointId" TEXT NOT NULL, "actorId" TEXT NOT NULL, action TEXT NOT NULL, "secretVersion" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AuditLog_applicationId_createdAt_idx" ON "AuditLog"("applicationId", "createdAt");
CREATE INDEX "AuditLog_endpointId_createdAt_idx" ON "AuditLog"("endpointId", "createdAt");
