DROP TRIGGER IF EXISTS skip_api_endpoint_daily_stats_writes ON public.api_endpoint_daily_stats;

DROP FUNCTION IF EXISTS public.skip_api_endpoint_daily_stats_writes();

DROP TABLE IF EXISTS public.api_endpoint_daily_stats;

-- Keep a tiny no-op compatibility shell during rolling deploys. The heavy
-- historical table is gone, new code has no runtime dependency on this object,
-- and old pods that have not rolled yet will not crash on INSERT ... ON CONFLICT.
CREATE TABLE IF NOT EXISTS public.api_endpoint_daily_stats (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    date date NOT NULL,
    endpoint text NOT NULL,
    region varchar(50) NOT NULL DEFAULT 'unknown',
    total_calls bigint NOT NULL DEFAULT 0,
    total_errors bigint NOT NULL DEFAULT 0,
    sum_latency_ms bigint NOT NULL DEFAULT 0,
    status_code_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
    p50_latency_ms integer,
    p90_latency_ms integer,
    p99_latency_ms integer,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT api_endpoint_daily_stats_project_date_endpoint_region_unique UNIQUE (project_id, date, endpoint, region)
);

CREATE OR REPLACE FUNCTION public.skip_api_endpoint_daily_stats_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN NULL;
END;
$$;

CREATE TRIGGER skip_api_endpoint_daily_stats_writes
BEFORE INSERT OR UPDATE ON public.api_endpoint_daily_stats
FOR EACH ROW
EXECUTE FUNCTION public.skip_api_endpoint_daily_stats_writes();
