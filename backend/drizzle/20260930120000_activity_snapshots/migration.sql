-- Identifier-free historical activity survives routine session identity expiry.
CREATE TABLE activity_snapshots (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date date NOT NULL,
    platform varchar(20) NOT NULL,
    dau integer NOT NULL,
    mau integer NOT NULL,
    dau_complete boolean NOT NULL,
    mau_complete boolean NOT NULL,
    membership_complete boolean NOT NULL DEFAULT false,
    identity_frozen boolean NOT NULL DEFAULT false,
    version_dau jsonb NOT NULL DEFAULT '{}'::jsonb,
    country_dau jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, date, platform)
);

--> statement-breakpoint
-- Temporary daily participation, bounded by the existing visitor ledger lifetime
-- and pruned after 31 days. No raw identifier or session pointer is stored.
CREATE TABLE visitor_activity_days (
    visitor_id uuid NOT NULL REFERENCES project_visitors(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date date NOT NULL,
    platform varchar(20) NOT NULL,
    identity_key varchar(40) NOT NULL,
    PRIMARY KEY (project_id, date, platform, identity_key, visitor_id)
);
--> statement-breakpoint
CREATE INDEX visitor_activity_days_visitor_idx ON visitor_activity_days(visitor_id);
--> statement-breakpoint
CREATE INDEX visitor_activity_days_date_idx ON visitor_activity_days(date);
