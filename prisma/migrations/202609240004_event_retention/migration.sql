CREATE INDEX "Event_createdAt_id_idx" ON "Event"("createdAt", "id");
CREATE INDEX "InboundReceipt_receivedAt_id_idx" ON "InboundReceipt"("receivedAt", "id");

-- The maintenance worker uses the restricted runtime role in production.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hooka_runtime') THEN
    GRANT DELETE ON TABLE "Event", "InboundReceipt" TO hooka_runtime;
  END IF;
END
$$;
