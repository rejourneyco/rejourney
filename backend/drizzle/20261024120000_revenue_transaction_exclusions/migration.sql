-- Revenue book corrections: provider transactions a project manager excluded
-- (test purchases, duplicates). Keyed by the provider's stable transaction id
-- so exclusions survive re-syncs that rewrite revenue_provider_transactions.
CREATE TABLE IF NOT EXISTS revenue_transaction_exclusions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL,
    external_transaction_id varchar(255) NOT NULL,
    occurred_at timestamp NOT NULL,
    currency varchar(12) NOT NULL,
    amount_cents integer NOT NULL DEFAULT 0,
    reason text,
    excluded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS revenue_transaction_exclusions_project_provider_tx_unique
    ON revenue_transaction_exclusions (project_id, provider, external_transaction_id);
