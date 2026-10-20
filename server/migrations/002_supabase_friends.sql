ALTER TABLE users ADD COLUMN display_name text CHECK (length(display_name) <= 32);
ALTER TABLE users ADD COLUMN auth_provider text NOT NULL DEFAULT 'local-test' CHECK (auth_provider IN ('local-test','supabase'));
ALTER TABLE rooms ADD COLUMN code text UNIQUE;
UPDATE rooms SET code=upper(substr(md5(id::text),1,8));
ALTER TABLE rooms ALTER COLUMN code SET NOT NULL;
ALTER TABLE rooms ADD CONSTRAINT room_code_format CHECK (code ~ '^[A-Z0-9]{8}$');
-- Server-owned schema. There are deliberately no browser-role policies.
-- The backend connects as its schema owner; no frontend receives this DB login.
DO $$ DECLARE t text; r text; s text := current_schema(); BEGIN
 FOR t IN SELECT unnest(ARRAY['users','user_settings','wallets','sessions','rooms','room_seats','hands','room_events','action_receipts','hand_results','chip_ledger','schema_migrations']) LOOP
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',s,t);
  EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC',s,t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %I',s,t,r); END IF;
  END LOOP;
 END LOOP;
 IF s <> 'public' THEN
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC',s);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I',s,r); END IF;
  END LOOP;
 END IF;
END $$;
