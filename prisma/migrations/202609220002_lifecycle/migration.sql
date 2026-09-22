-- CreateEnum
CREATE TYPE "EndpointKind" AS ENUM ('BUSINESS', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "ApplicationKeyScope" AS ENUM ('READ_ONLY', 'INGEST_ONLY');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "recoveryAvailableAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Endpoint" ADD COLUMN     "customHeadersEncrypted" TEXT,
ADD COLUMN     "deliveryRatePerMinute" INTEGER,
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'production',
ADD COLUMN     "kind" "EndpointKind" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "nextDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "transform" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "operational" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApplicationKey" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scope" "ApplicationKeyScope" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTypeVersion" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "schema" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTypeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalNotice" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OperationalNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryJob" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "endpointId" TEXT,
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "queued" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationKey_hash_key" ON "ApplicationKey"("hash");

-- CreateIndex
CREATE INDEX "ApplicationKey_applicationId_idx" ON "ApplicationKey"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventTypeVersion_applicationId_eventType_version_key" ON "EventTypeVersion"("applicationId", "eventType", "version");

-- CreateIndex
CREATE INDEX "OperationalNotice_sentAt_nextAttemptAt_idx" ON "OperationalNotice"("sentAt", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "RecoveryJob_status_createdAt_idx" ON "RecoveryJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Event_applicationId_createdAt_id_idx" ON "Event"("applicationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ApplicationKey" ADD CONSTRAINT "ApplicationKey_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTypeVersion" ADD CONSTRAINT "EventTypeVersion_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalNotice" ADD CONSTRAINT "OperationalNotice_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryJob" ADD CONSTRAINT "RecoveryJob_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing opt-in schemas become the first catalog version without changing validation.
INSERT INTO "EventTypeVersion" (id,"applicationId","eventType",version,description,schema,"createdAt")
SELECT 'catalog_' || md5("applicationId" || ':' || "eventType"), "applicationId", "eventType", 1, '', schema, "createdAt" FROM "EventSchema";
