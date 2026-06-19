-- Migration: multi-user data isolation + missing columns
-- Apply via Supabase SQL editor or Supabase MCP apply_migration.
-- Safe to run multiple times (all statements are IF NOT EXISTS / IF EXISTS).

-- 1. Jobs: add apply_type and posted_at (stored by discovery agent, missing from initial schema)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_type text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS posted_at  timestamptz;

-- 2. Matches: add profile_id so each user's matching results are isolated
ALTER TABLE matches ADD COLUMN IF NOT EXISTS profile_id uuid references profiles(id) on delete set null;
CREATE INDEX IF NOT EXISTS matches_profile_idx ON matches (profile_id);

-- 3. Applications: add profile_id so each user's applications are isolated
ALTER TABLE applications ADD COLUMN IF NOT EXISTS profile_id uuid references profiles(id) on delete set null;
CREATE INDEX IF NOT EXISTS applications_profile_idx ON applications (profile_id);

-- 4. Form submissions table (used by form_filler agent, missing from initial schema)
CREATE TABLE IF NOT EXISTS form_submissions (
    id           uuid primary key default gen_random_uuid(),
    profile_id   uuid references profiles(id) on delete set null,
    job_id       uuid references jobs(id) on delete set null,
    url          text not null,
    form_title   text,
    fills        jsonb default '[]'::jsonb,
    dry_run      boolean default true,
    submitted_at timestamptz default now(),
    created_at   timestamptz default now()
);

CREATE INDEX IF NOT EXISTS form_submissions_profile_idx ON form_submissions (profile_id);
CREATE INDEX IF NOT EXISTS form_submissions_created_idx ON form_submissions (created_at DESC);

-- 5. Email drafts: add lead / generating to the valid status values (already used in code)
-- No ALTER needed — Postgres text columns accept any value by default unless there's a CHECK constraint.
-- If you added a CHECK constraint earlier, run:
-- ALTER TABLE email_drafts DROP CONSTRAINT IF EXISTS email_drafts_status_check;
