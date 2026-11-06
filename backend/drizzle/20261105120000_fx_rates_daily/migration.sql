-- One set of USD exchange rates per calendar day, written once and never changed,
-- so revenue converted at a day's rate stays the same forever.
CREATE TABLE IF NOT EXISTS fx_rates_daily (
    date date PRIMARY KEY,
    rates jsonb NOT NULL,
    rates_date date NOT NULL,
    source varchar(32) NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
);
