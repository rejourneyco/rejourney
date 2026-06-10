-- Custom SQL migration file, put your code below! --
DROP TABLE IF EXISTS "session_backup_log" CASCADE;
DROP TABLE IF EXISTS "session_backup_queue" CASCADE;
DROP TABLE IF EXISTS "session_backup_run_lock" CASCADE;