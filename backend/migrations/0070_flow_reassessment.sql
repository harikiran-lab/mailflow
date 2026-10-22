-- Requests survive restarts and are coalesced into the existing account job.
ALTER TABLE integration_jobs ADD COLUMN full_reassessment_at TIMESTAMPTZ;
ALTER TABLE integration_jobs ADD COLUMN last_reassessed_at TIMESTAMPTZ;
ALTER TABLE integration_jobs ADD COLUMN affected_threads TEXT[] NOT NULL DEFAULT '{}';
