-- Stable instance generations prevent a platform-restarted old process from
-- reclaiming leadership during a rolling deploy. No player data is stored here.
CREATE TABLE authority_instances (
  instance_id text PRIMARY KEY CHECK (length(instance_id) BETWEEN 1 AND 256),
  generation bigserial NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE authority_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE authority_instances FROM PUBLIC;
DO $$ DECLARE r text; s text := current_schema(); BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON TABLE %I.authority_instances FROM %I',s,r);
  END IF;
 END LOOP;
END $$;
