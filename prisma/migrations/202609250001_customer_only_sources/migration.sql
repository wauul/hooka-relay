BEGIN;

ALTER TABLE "WebhookSource" ADD COLUMN "customerId" text;
ALTER TABLE "WebhookSource" ADD CONSTRAINT "WebhookSource_applicationId_customerId_fkey"
  FOREIGN KEY ("applicationId", "customerId") REFERENCES "Customer"("applicationId", "id")
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "WebhookSource_applicationId_customerId_idx" ON "WebhookSource"("applicationId", "customerId");

-- All pre-pilot applications are test fixtures. Give each one a single
-- customer without changing its application ID, API keys or source tokens.
INSERT INTO "Customer" (id, "applicationId", "externalId", name)
SELECT 'test-' || a.id, a.id, 'test', 'Test customer'
FROM "Application" a
WHERE a."customerMode" = 'LEGACY'
ON CONFLICT ("applicationId", "externalId") DO NOTHING;

UPDATE "Endpoint" e SET "customerId" = c.id
FROM "Customer" c WHERE c."applicationId" = e."applicationId"
  AND c."externalId" = 'test' AND e."customerId" IS NULL;
UPDATE "Event" e SET "customerId" = c.id
FROM "Customer" c WHERE c."applicationId" = e."applicationId"
  AND c."externalId" = 'test' AND e."customerId" IS NULL;
UPDATE "RecoveryJob" r SET "customerId" = c.id
FROM "Customer" c WHERE c."applicationId" = r."applicationId"
  AND c."externalId" = 'test' AND r."customerId" IS NULL;
UPDATE "WebhookSource" s SET "customerId" = c.id
FROM "Customer" c WHERE c."applicationId" = s."applicationId"
  AND c."externalId" = 'test' AND s."customerId" IS NULL;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Endpoint" WHERE "customerId" IS NULL)
    OR EXISTS (SELECT 1 FROM "Event" WHERE "customerId" IS NULL)
    OR EXISTS (SELECT 1 FROM "RecoveryJob" WHERE "customerId" IS NULL)
    OR EXISTS (SELECT 1 FROM "WebhookSource" WHERE "customerId" IS NULL)
    OR EXISTS (
      SELECT 1 FROM "WebhookSource" s
      JOIN "Endpoint" e ON e.id = s."endpointId"
      WHERE e."applicationId" <> s."applicationId" OR e."customerId" <> s."customerId"
    )
    OR EXISTS (
      SELECT 1 FROM "DestinationGroup" g
      JOIN "WebhookSource" s ON s.id = g."webhookSourceId"
      JOIN "RoutingDestination" d ON d."destinationGroupId" = g.id
      JOIN "Endpoint" e ON e.id = d."endpointId"
      WHERE e."applicationId" <> s."applicationId" OR e."customerId" <> s."customerId"
    )
  THEN RAISE EXCEPTION 'Customer backfill left unassigned or cross-customer records'; END IF;
END $$;

-- Old shared portal links must no longer grant application-wide access.
UPDATE "Application" SET "customerMode" = 'ISOLATED', "portalTokenHash" = NULL,
  "portalTokenEncrypted" = NULL WHERE "customerMode" <> 'ISOLATED';
ALTER TABLE "Application" ALTER COLUMN "customerMode" SET DEFAULT 'ISOLATED';

COMMIT;
