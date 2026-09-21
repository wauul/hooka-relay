CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE "SupportDocument" (id TEXT PRIMARY KEY, source TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL, embedding vector(384) NOT NULL);
CREATE TABLE "SupportCorpus" (id INTEGER PRIMARY KEY, revision TEXT NOT NULL);
CREATE TABLE "SupportAnswerCache" (key TEXT PRIMARY KEY, answer TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "SupportAnswerCache_expiresAt_idx" ON "SupportAnswerCache"("expiresAt");
CREATE TABLE "SupportDecision" (id TEXT PRIMARY KEY, "inScope" BOOLEAN NOT NULL, reason TEXT NOT NULL, "cacheHit" BOOLEAN NOT NULL DEFAULT false, completed BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "SupportDecision_createdAt_idx" ON "SupportDecision"("createdAt");
