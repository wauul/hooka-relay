ALTER TABLE "Application" ADD COLUMN "portalTokenHash" TEXT, ADD COLUMN "portalTokenEncrypted" TEXT;
CREATE UNIQUE INDEX "Application_portalTokenHash_key" ON "Application"("portalTokenHash");
ALTER TABLE "Endpoint" ADD COLUMN "portalOwnerHash" TEXT;
CREATE INDEX "Endpoint_applicationId_portalOwnerHash_idx" ON "Endpoint"("applicationId", "portalOwnerHash");
