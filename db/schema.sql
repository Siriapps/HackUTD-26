-- Avon Night Shift — Tiger Data (TimescaleDB) schema. Idempotent; apply with scripts/db/ingest.ts.
-- The browser analyse() on the loaded folder stays the source of truth for detection and plans
-- (judging constraint); this database mirrors telemetry and holds what must be shared/persisted.
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS datasets (
  dataset      text PRIMARY KEY,            -- folder name, e.g. full_week
  network      jsonb NOT NULL,
  ops          jsonb NOT NULL,
  first_ts     timestamptz,
  last_ts      timestamptz,
  rows         bigint,
  ingested_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telemetry (
  ts        timestamptz NOT NULL,
  dataset   text        NOT NULL,
  asset_id  text        NOT NULL,
  metric    text        NOT NULL,
  value     double precision NOT NULL,
  UNIQUE (dataset, asset_id, metric, ts)
);
SELECT create_hypertable('telemetry', 'ts', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
CREATE INDEX IF NOT EXISTS telemetry_asset_ts ON telemetry (dataset, asset_id, metric, ts DESC);

-- Hourly rollup for long-range trends.
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_1h
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', ts) AS bucket, dataset, asset_id, metric,
       avg(value) AS avg, min(value) AS min, max(value) AS max, last(value, ts) AS last, count(*) AS n
FROM telemetry
GROUP BY bucket, dataset, asset_id, metric
WITH NO DATA;
SELECT add_continuous_aggregate_policy('telemetry_1h',
  start_offset => NULL, end_offset => INTERVAL '0', schedule_interval => INTERVAL '10 minutes', if_not_exists => TRUE);

-- Shared state written by the app (incident memory, technician replies, tickets, outcomes).
CREATE TABLE IF NOT EXISTS incidents (
  id            text PRIMARY KEY,           -- `${dataset}|${event_id}`
  dataset       text NOT NULL,
  event_id      text NOT NULL,
  system_id     text NOT NULL,
  facility_id   text NOT NULL,
  asset_id      text NOT NULL,
  category      text NOT NULL,
  onset_ts      timestamptz NOT NULL,
  end_ts        timestamptz,
  status        text NOT NULL,
  confidence    double precision,
  evidence      jsonb,
  plan          jsonb,
  visual_report jsonb,
  verdict       text,                       -- confirmed | dismissed
  resolution    text,                       -- what the technician did
  dispatch      jsonb,                      -- OpenAlert snapshot for the On-call board after restart
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch jsonb;
-- Live Incident Response: Gemini session transcript, runbook state, and report.
-- messages.channel gains the value 'gemini' (text; no enum restriction).
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS live jsonb;

CREATE TABLE IF NOT EXISTS outcomes (
  id        text PRIMARY KEY,               -- `${dataset}|${event_id}`
  dataset   text NOT NULL,
  category  text NOT NULL,
  payload   jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          bigserial PRIMARY KEY,
  ts          timestamptz NOT NULL DEFAULT now(),
  incident_id text REFERENCES incidents(id),
  channel     text NOT NULL,                -- discord | photon | sms | voice
  direction   text NOT NULL,                -- out | in
  recipient   text,
  body        text NOT NULL,
  payload     jsonb
);

CREATE TABLE IF NOT EXISTS tickets (
  id          bigserial PRIMARY KEY,
  incident_id text REFERENCES incidents(id),
  provider    text NOT NULL,                -- github
  external_id text NOT NULL,
  url         text,
  assignee    text,
  state       text NOT NULL,
  opened_at   timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);

CREATE TABLE IF NOT EXISTS calibration (
  version      integer NOT NULL,
  generated_at timestamptz NOT NULL,
  payload      jsonb NOT NULL,
  PRIMARY KEY (version, generated_at)
);
