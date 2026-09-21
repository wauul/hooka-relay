CREATE TABLE "EventSchema" (
  "applicationId" TEXT NOT NULL REFERENCES "Application"(id) ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  schema JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("applicationId", "eventType")
);
