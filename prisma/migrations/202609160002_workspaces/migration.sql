BEGIN;
-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EndpointStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_userId_fkey";

-- DropForeignKey
ALTER TABLE "Endpoint" DROP CONSTRAINT "Endpoint_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_eventId_fkey";

-- DropForeignKey
ALTER TABLE "Delivery" DROP CONSTRAINT "Delivery_endpointId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryAttempt" DROP CONSTRAINT "DeliveryAttempt_eventId_fkey";

-- DropForeignKey
ALTER TABLE "DeliveryAttempt" DROP CONSTRAINT "DeliveryAttempt_endpointId_fkey";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "previousApiKey" TEXT,
ADD COLUMN     "previousApiKeyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "workspaceId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Endpoint" ADD COLUMN     "status" "EndpointStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);


-- Preserve original IDs, keys and all delivery data. Keep the legacy userId
-- column for audit/rollback; application access uses workspace membership only.
INSERT INTO "Workspace" (id, name, "createdAt")
SELECT 'personal_' || u.id, u.email || '''s Workspace', u."createdAt"
FROM "User" u WHERE EXISTS (SELECT 1 FROM "Application" a WHERE a."userId" = u.id);
INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role)
SELECT 'owner_' || u.id, 'personal_' || u.id, u.id, 'OWNER'
FROM "User" u WHERE EXISTS (SELECT 1 FROM "Application" a WHERE a."userId" = u.id);
UPDATE "Application" SET "workspaceId" = 'personal_' || "userId";
ALTER TABLE "Application" ALTER COLUMN "workspaceId" SET NOT NULL;
CREATE INDEX "Application_workspaceId_idx" ON "Application"("workspaceId");
CREATE UNIQUE INDEX "Workspace_one_owner" ON "WorkspaceMember"("workspaceId") WHERE role = 'OWNER';
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_no_owner" CHECK (role <> 'OWNER');
-- Deferred validation permits atomic creation and ownership transfer, while
-- guaranteeing every surviving workspace has exactly one owner at commit.
CREATE FUNCTION check_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Workspace' THEN wid := COALESCE(NEW.id, OLD.id);
  ELSE wid := COALESCE(NEW."workspaceId", OLD."workspaceId"); END IF;
  IF EXISTS (SELECT 1 FROM "Workspace" WHERE id = wid) AND
     (SELECT count(*) FROM "WorkspaceMember" WHERE "workspaceId" = wid AND role = 'OWNER') <> 1 THEN
    RAISE EXCEPTION 'Workspace must have exactly one owner';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER workspace_owner_members AFTER INSERT OR UPDATE OR DELETE ON "WorkspaceMember"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_owner();
CREATE CONSTRAINT TRIGGER workspace_owner_create AFTER INSERT ON "Workspace"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_workspace_owner();

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_token_key" ON "WorkspaceInvite"("token");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_status_idx" ON "WorkspaceInvite"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_previousApiKey_key" ON "Application"("previousApiKey");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
