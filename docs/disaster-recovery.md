# Neon point-in-time recovery

**Status: documented but not yet verified.** The current project has no paid Neon trial for the requested restore drill, and its two branch slots are occupied. Do not claim a tested recovery time or recovery point until the drill below is completed on a disposable branch.

## Before an incident

1. In Neon, record the production branch name, its history retention window, project ID, and the current `DATABASE_URL` secret locations in Vercel and Railway. Check the plan's current restore limits in the Neon console; they can change. Set a calendar reminder to rehearse this runbook after a trial or suitable plan is available.
2. Keep the `ENDPOINT_SECRET_ENCRYPTION_KEY` and any versioned keys backed up outside Neon. A database restore cannot recover an encryption key lost from the application environment.
3. Preserve a recent logical export outside Neon if recovery beyond the history window is required. A point-in-time restore only reaches timestamps retained by Neon.

## Non-production restore drill

1. Make room for a disposable branch. In the Neon console, create `drill/pitr-YYYYMMDD` from production. Verify its connection string points to the drill branch, **never production**, before running any SQL. Do not direct a running Hooka worker at it; that would consume or publish old queued work.
2. In the drill branch SQL editor, run:

   ```sql
   CREATE TABLE IF NOT EXISTS pitr_drill (id text PRIMARY KEY, marker text NOT NULL);
   INSERT INTO pitr_drill (id, marker) VALUES ('hooka-drill', 'before')
     ON CONFLICT (id) DO UPDATE SET marker = EXCLUDED.marker;
   SELECT now() AS restore_target_utc;
   ```

   Record the returned UTC timestamp and verify `marker = 'before'`. Wait until the clock advances, then run `UPDATE pitr_drill SET marker = 'after' WHERE id = 'hooka-drill';` and confirm `after` is visible.
3. Open **Backup & Restore / Restore** for the **drill branch** in Neon. Choose the recorded UTC timestamp, inside the available history window. If Time Travel Assist is offered, query `SELECT marker FROM pitr_drill WHERE id = 'hooka-drill'` at that timestamp and confirm `before` before proceeding. Read Neon's target/backup branch summary: the selected target must be the drill branch. Perform the restore; do not select production.
4. Reconnect to the drill branch and confirm `marker = 'before'`, `SELECT count(*) FROM "Application"` works, and the latest migration in `_prisma_migrations` is present. Record the actual restore duration, timestamp, plan, Neon branch ID, and any connection interruption. Remove the drill branch after capturing the evidence.

## Production incident procedure

1. Stop writes at ingress and pause the worker before restoring. Record the incident time, last known good time, branch ID, and affected event IDs. Capture a logical export or create a forensic branch of the damaged state if capacity allows.
2. In Neon's restore screen, select the **production** branch and a timestamp before the damage but within the retained history. Use Time Travel Assist to inspect affected rows. Have a second operator review the target branch, UTC timestamp, and expected data loss before confirming the restore.
3. Restore, then verify the production connection string, schema migration level, key rows, and application login. Restart the web and worker only after checking old outbox/delivery rows so replays do not surprise receivers. Validate a controlled test event, RabbitMQ connectivity, and Grafana metrics/alerts.
4. Reconcile events accepted after the chosen restore timestamp from external producers or logs. Neon PITR cannot preserve post-target writes. Record actual recovery point/time and notify affected customers through the incident process.

Neon's [branch restore documentation](https://neon.com/docs/guides/branch-restore) and [Time Travel Assist walkthrough](https://neon.com/blog/announcing-point-in-time-restore) are the source for the console flow. Verify the console's current labels and retention before any live restore.
