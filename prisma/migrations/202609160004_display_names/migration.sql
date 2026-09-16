ALTER TABLE "User" ADD COLUMN "displayName" TEXT;
UPDATE "User" SET "displayName" = LEFT(SPLIT_PART(email, '@', 1), 40);
-- Only rename the untouched, automatically migrated personal workspaces.
UPDATE "Workspace" w SET name = u."displayName" || '''s Workspace' FROM "User" u
WHERE w.id = 'personal_' || u.id AND w.name = u.email || '''s Workspace';
