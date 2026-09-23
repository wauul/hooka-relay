ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'LINEAR';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'SQUARE';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'INTERCOM';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'MAILGUN';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'ZOOM';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'FACEBOOK';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'INSTAGRAM';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'WHATSAPP';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'TIKTOK';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'LINKEDIN';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'ZENDESK';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'TYPEFORM';
ALTER TYPE "WebhookProvider" ADD VALUE IF NOT EXISTS 'PADDLE';

ALTER TABLE "WebhookSource" ADD COLUMN "setupStep" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "WebhookSource" ADD COLUMN "verificationTokenHash" TEXT;
UPDATE "WebhookSource" SET "setupStep" = CASE
  WHEN "status" <> 'SETUP_IN_PROGRESS' THEN 6
  WHEN "destinationUrl" IS NOT NULL THEN 5
  WHEN "encryptedProviderSecret" IS NOT NULL THEN 4
  ELSE 2
END;

-- This development project no longer exposes the pre-standard signing mode.
UPDATE "Endpoint" SET "signatureFormat" = 'STANDARD';
ALTER TYPE "SignatureFormat" RENAME TO "SignatureFormat_old";
CREATE TYPE "SignatureFormat" AS ENUM ('STANDARD');
ALTER TABLE "Endpoint" ALTER COLUMN "signatureFormat" DROP DEFAULT;
ALTER TABLE "Endpoint" ALTER COLUMN "signatureFormat" TYPE "SignatureFormat" USING "signatureFormat"::text::"SignatureFormat";
ALTER TABLE "Endpoint" ALTER COLUMN "signatureFormat" SET DEFAULT 'STANDARD';
DROP TYPE "SignatureFormat_old";
