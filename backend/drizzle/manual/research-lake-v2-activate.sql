-- Activate Research Lake V2 only after migrations have completed and every API
-- and V1 worker pod is running code that uses schema-versioned job uniqueness.
-- Run with psql directly against the PostgreSQL writer, not through PgBouncer.
-- ON_ERROR_STOP is mandatory: a failed preflight must never fall through to the
-- destructive legacy-index drop.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '30min';

DO $$
DECLARE
    expected_name text;
    expected_columns text[];
    expected_predicate text;
    expected_unique boolean;
    actual_columns text[];
    actual_predicate text;
    actual_valid boolean;
    actual_ready boolean;
    actual_unique boolean;
BEGIN
    FOR expected_name, expected_columns, expected_predicate, expected_unique IN
        SELECT *
        FROM (
            VALUES
                (
                    'research_extraction_jobs_session_lake_schema_unique',
                    ARRAY['session_id', 'lake_type', 'schema_version']::text[],
                    NULL::text,
                    true
                ),
                (
                    'research_extraction_jobs_v2_claim_idx',
                    ARRAY['lake_type', 'job_lane', 'status', 'next_retry_at', 'due_at', 'session_id']::text[],
                    'schema_version=2',
                    false
                ),
                (
                    'research_extraction_jobs_v2_fair_claim_idx',
                    ARRAY['lake_type', 'job_lane', 'status', 'project_id', 'due_at', 'created_at']::text[],
                    'schema_version=2',
                    false
                ),
                (
                    'research_extraction_jobs_v2_project_status_idx',
                    ARRAY['project_id', 'lake_type', 'status', 'due_at']::text[],
                    'schema_version=2',
                    false
                )
        ) AS expected(name, columns, predicate, is_unique)
    LOOP
        SELECT
            ARRAY(
                SELECT attribute.attname
                FROM unnest(index_meta.indkey::smallint[]) WITH ORDINALITY AS key_column(attnum, position)
                JOIN pg_attribute attribute
                  ON attribute.attrelid = index_meta.indrelid
                 AND attribute.attnum = key_column.attnum
                WHERE key_column.position <= index_meta.indnkeyatts
                ORDER BY key_column.position
            ),
            CASE
                WHEN index_meta.indpred IS NULL THEN NULL
                ELSE replace(replace(replace(pg_get_expr(index_meta.indpred, index_meta.indrelid), '(', ''), ')', ''), ' ', '')
            END,
            index_meta.indisvalid,
            index_meta.indisready,
            index_meta.indisunique
        INTO actual_columns, actual_predicate, actual_valid, actual_ready, actual_unique
        FROM pg_index index_meta
        WHERE index_meta.indexrelid = to_regclass(format('public.%I', expected_name))
          AND index_meta.indrelid = 'public.research_extraction_jobs'::regclass;

        IF NOT FOUND
           OR actual_columns IS DISTINCT FROM expected_columns
           OR actual_predicate IS DISTINCT FROM expected_predicate
           OR actual_valid IS DISTINCT FROM true
           OR actual_ready IS DISTINCT FROM true
           OR actual_unique IS DISTINCT FROM expected_unique THEN
            RAISE EXCEPTION
                'Research Lake V2 index % failed preflight: columns=%, predicate=%, valid=%, ready=%, unique=%',
                expected_name,
                actual_columns,
                actual_predicate,
                actual_valid,
                actual_ready,
                actual_unique;
        END IF;
    END LOOP;
END $$;

DROP INDEX CONCURRENTLY IF EXISTS "research_extraction_jobs_session_lake_unique";
