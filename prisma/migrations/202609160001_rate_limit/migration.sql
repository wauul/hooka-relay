CREATE TABLE "EventAdmission" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventAdmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventAdmission_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EventAdmission_applicationId_createdAt_idx" ON "EventAdmission"("applicationId", "createdAt");
