CREATE TYPE "CustomerMode" AS ENUM ('LEGACY', 'ISOLATED');
ALTER TABLE "Application" ADD COLUMN "customerMode" "CustomerMode" NOT NULL DEFAULT 'LEGACY';

CREATE TABLE "Customer" (
  "id" text PRIMARY KEY,
  "applicationId" text NOT NULL REFERENCES "Application"("id") ON DELETE CASCADE,
  "externalId" text NOT NULL,
  "name" text NOT NULL,
  "portalTokenHash" text UNIQUE,
  "portalTokenEncrypted" text,
  "recoveryAvailableAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Customer_applicationId_externalId_key" UNIQUE ("applicationId", "externalId"),
  CONSTRAINT "Customer_applicationId_id_key" UNIQUE ("applicationId", "id")
);
ALTER TABLE "Endpoint" ADD COLUMN "customerId" text;
ALTER TABLE "Event" ADD COLUMN "customerId" text;
ALTER TABLE "Event" ADD COLUMN "billable" boolean NOT NULL DEFAULT true;
ALTER TABLE "RecoveryJob" ADD COLUMN "customerId" text;
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_applicationId_customerId_fkey" FOREIGN KEY ("applicationId", "customerId") REFERENCES "Customer"("applicationId", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Event" ADD CONSTRAINT "Event_applicationId_customerId_fkey" FOREIGN KEY ("applicationId", "customerId") REFERENCES "Customer"("applicationId", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "RecoveryJob" ADD CONSTRAINT "RecoveryJob_applicationId_customerId_fkey" FOREIGN KEY ("applicationId", "customerId") REFERENCES "Customer"("applicationId", "id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX "Endpoint_applicationId_customerId_idx" ON "Endpoint"("applicationId", "customerId");
CREATE INDEX "Event_applicationId_customerId_createdAt_idx" ON "Event"("applicationId", "customerId", "createdAt");

CREATE TABLE "WorkspaceUsageMonth" (
  "workspaceId" text NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "month" date NOT NULL,
  "acceptedEvents" bigint NOT NULL DEFAULT 0,
  "destinationDeliveries" bigint NOT NULL DEFAULT 0,
  "retryAttempts" bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("workspaceId", "month")
);
CREATE INDEX "WorkspaceUsageMonth_month_idx" ON "WorkspaceUsageMonth"("month");

-- Hold writers while backfilling and installing the triggers so no accepted
-- event can fall between the historical count and live metering.
BEGIN;
LOCK TABLE "Event", "Delivery", "DeliveryAttempt" IN SHARE ROW EXCLUSIVE MODE;
-- Existing synthetic and operational events have never been invoiceable.
UPDATE "Event" SET "billable" = false WHERE operational = true OR "idempotencyKey" LIKE 'synthetic-%' OR "idempotencyKey" LIKE 'inbound-simulated:%';
INSERT INTO "WorkspaceUsageMonth" ("workspaceId", "month", "acceptedEvents", "destinationDeliveries", "retryAttempts")
SELECT "workspaceId", month, sum(accepted), sum(deliveries), sum(retries)
FROM (
  SELECT a."workspaceId", date_trunc('month', e."createdAt" AT TIME ZONE 'UTC')::date AS month,
    count(*)::bigint AS accepted, 0::bigint AS deliveries, 0::bigint AS retries
  FROM "Event" e JOIN "Application" a ON a.id = e."applicationId" WHERE e.billable GROUP BY 1, 2
  UNION ALL
  SELECT a."workspaceId", date_trunc('month', d."createdAt" AT TIME ZONE 'UTC')::date,
    0, count(*)::bigint, 0
  FROM "Delivery" d JOIN "Event" e ON e.id = d."eventId" JOIN "Application" a ON a.id = e."applicationId"
  WHERE e.billable GROUP BY 1, 2
  UNION ALL
  SELECT a."workspaceId", date_trunc('month', t."createdAt" AT TIME ZONE 'UTC')::date,
    0, 0, count(*)::bigint
  FROM "DeliveryAttempt" t JOIN "Event" e ON e.id = t."eventId" JOIN "Application" a ON a.id = e."applicationId"
  WHERE e.billable AND t."attemptNumber" > 1 AND t.status <> 'SKIPPED_CIRCUIT_OPEN' GROUP BY 1, 2
) counts GROUP BY "workspaceId", month;

CREATE FUNCTION hooka_meter_usage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target_workspace text;
DECLARE target_month date;
DECLARE billable_event boolean;
BEGIN
  IF TG_TABLE_NAME = 'Event' THEN
    IF NOT NEW.billable THEN RETURN NEW; END IF;
    SELECT "workspaceId" INTO target_workspace FROM public."Application" WHERE id = NEW."applicationId";
    target_month := date_trunc('month', NEW."createdAt" AT TIME ZONE 'UTC')::date;
    INSERT INTO public."WorkspaceUsageMonth" ("workspaceId", "month", "acceptedEvents") VALUES (target_workspace, target_month, 1)
    ON CONFLICT ("workspaceId", "month") DO UPDATE SET "acceptedEvents" = public."WorkspaceUsageMonth"."acceptedEvents" + 1;
  ELSIF TG_TABLE_NAME = 'Delivery' THEN
    SELECT a."workspaceId", e.billable INTO target_workspace, billable_event
    FROM public."Event" e JOIN public."Application" a ON a.id = e."applicationId" WHERE e.id = NEW."eventId";
    IF NOT billable_event THEN RETURN NEW; END IF;
    target_month := date_trunc('month', NEW."createdAt" AT TIME ZONE 'UTC')::date;
    INSERT INTO public."WorkspaceUsageMonth" ("workspaceId", "month", "destinationDeliveries") VALUES (target_workspace, target_month, 1)
    ON CONFLICT ("workspaceId", "month") DO UPDATE SET "destinationDeliveries" = public."WorkspaceUsageMonth"."destinationDeliveries" + 1;
  ELSE
    IF NEW."attemptNumber" <= 1 OR NEW.status = 'SKIPPED_CIRCUIT_OPEN' THEN RETURN NEW; END IF;
    SELECT a."workspaceId", e.billable INTO target_workspace, billable_event
    FROM public."Event" e JOIN public."Application" a ON a.id = e."applicationId" WHERE e.id = NEW."eventId";
    IF NOT billable_event THEN RETURN NEW; END IF;
    target_month := date_trunc('month', NEW."createdAt" AT TIME ZONE 'UTC')::date;
    INSERT INTO public."WorkspaceUsageMonth" ("workspaceId", "month", "retryAttempts") VALUES (target_workspace, target_month, 1)
    ON CONFLICT ("workspaceId", "month") DO UPDATE SET "retryAttempts" = public."WorkspaceUsageMonth"."retryAttempts" + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hooka_meter_event AFTER INSERT ON "Event" FOR EACH ROW EXECUTE FUNCTION hooka_meter_usage();
CREATE TRIGGER hooka_meter_delivery AFTER INSERT ON "Delivery" FOR EACH ROW EXECUTE FUNCTION hooka_meter_usage();
CREATE TRIGGER hooka_meter_attempt AFTER INSERT ON "DeliveryAttempt" FOR EACH ROW EXECUTE FUNCTION hooka_meter_usage();
COMMIT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hooka_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Customer" TO hooka_runtime;
    GRANT SELECT ON "WorkspaceUsageMonth" TO hooka_runtime;
  END IF;
END $$;
