CREATE TABLE "IpRateBucket" (
  key TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  hits INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (key, bucket)
);
CREATE INDEX "IpRateBucket_expiresAt_idx" ON "IpRateBucket"("expiresAt");
