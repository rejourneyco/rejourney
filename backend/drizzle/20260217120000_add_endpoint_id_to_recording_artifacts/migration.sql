-- Add endpoint_id to recording_artifacts
-- Pins each artifact to the storage endpoint used for upload, so the ingest worker
-- downloads from the same endpoint. Enables weighted load balancing in k3s (multiple
-- S3 endpoints) while ensuring API (presign) and worker (download) use the same endpoint.
-- Self-hosted and dev Docker typically use a single endpoint; k3s may use multiple.

ALTER TABLE "recording_artifacts"
ADD COLUMN IF NOT EXISTS "endpoint_id" varchar(255);

COMMENT ON COLUMN "recording_artifacts"."endpoint_id" IS 'Storage endpoint ID used for upload (from storage_endpoints or env-fallback). Worker uses this for download; falls back to project default if null (legacy artifacts).';
