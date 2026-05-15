-- Give the issue detection reader read-only access to every current and future
-- table in the public schema. This forward migration covers databases where
-- 20260510000000_issue_detection_reader_role has already run.
--
-- The app migration user owns the public tables, so ALTER DEFAULT PRIVILEGES
-- applies to future tables created by later Drizzle migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'issue_detection_reader') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO issue_detection_reader';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO issue_detection_reader';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO issue_detection_reader';
  END IF;
END
$$;
