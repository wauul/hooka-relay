-- Production uses a restricted runtime role. Disposable CI databases do not
-- have that role, so grant only when it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hooka_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WebhookSource" TO hooka_runtime;
  END IF;
END
$$;
