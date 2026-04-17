DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'monitoring') THEN
    GRANT USAGE ON SCHEMA public TO monitoring;
    GRANT SELECT ON TABLE
      public.storage_endpoints,
      public.recording_artifacts,
      public.ingest_jobs,
      public.session_backup_log,
      public.session_backup_queue,
      public.retention_deletion_log
    TO monitoring;
  END IF;
END
$$;
