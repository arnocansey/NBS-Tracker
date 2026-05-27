-- No Bed Syndrome Tracker operational upgrade.
-- Run this once against the PostgreSQL database before using the new workflow.

ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hospitals'
      AND column_name = 'contact_number'
  ) THEN
    EXECUTE 'UPDATE hospitals SET phone = COALESCE(phone, contact_number) WHERE phone IS NULL';
  END IF;
END $$;

ALTER TABLE beds
  ADD COLUMN IF NOT EXISTS bed_number TEXT,
  ADD COLUMN IF NOT EXISTS hospital_id INTEGER REFERENCES hospitals(id),
  ADD COLUMN IF NOT EXISTS cleaning_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'beds'
      AND column_name = 'last_updated_at'
  ) THEN
    EXECUTE 'UPDATE beds SET updated_at = COALESCE(updated_at, last_updated_at, NOW())';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_beds_status_cleaning_started
  ON beds (current_status, cleaning_started_at);

CREATE INDEX IF NOT EXISTS idx_beds_hospital_specialty
  ON beds (hospital_id, specialty_type);

ALTER TABLE transfer_requests
  ADD COLUMN IF NOT EXISTS assigned_bed_id INTEGER REFERENCES beds(bed_id),
  ADD COLUMN IF NOT EXISTS requested_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decision_notes TEXT,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE transfer_requests
SET status = 'PENDING'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_transfer_requests_status_priority
  ON transfer_requests (status, priority, created_at);

CREATE TABLE IF NOT EXISTS bed_history (
  history_id SERIAL PRIMARY KEY,
  bed_id INTEGER REFERENCES beds(bed_id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  patient_name TEXT,
  from_status TEXT,
  to_status TEXT,
  performed_by TEXT,
  notes TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bed_history
  ADD COLUMN IF NOT EXISTS history_id INTEGER,
  ADD COLUMN IF NOT EXISTS from_status TEXT,
  ADD COLUMN IF NOT EXISTS to_status TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE SEQUENCE IF NOT EXISTS bed_history_history_id_seq;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bed_history'
      AND column_name = 'id'
  ) THEN
    EXECUTE 'UPDATE bed_history SET history_id = COALESCE(history_id, id) WHERE history_id IS NULL';
  ELSE
    EXECUTE 'UPDATE bed_history SET history_id = nextval(''bed_history_history_id_seq'') WHERE history_id IS NULL';
  END IF;
END $$;

ALTER TABLE bed_history
  ALTER COLUMN history_id SET DEFAULT nextval('bed_history_history_id_seq');

CREATE INDEX IF NOT EXISTS idx_bed_history_bed_timestamp
  ON bed_history (bed_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  request_id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status
  ON password_reset_requests (status, requested_at DESC);
