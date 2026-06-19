-- Migration: add opportunity_type to jobs table for internship/fellowship module
-- Run once in Supabase SQL editor

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS opportunity_type text DEFAULT 'job';

-- Backfill existing rows
UPDATE jobs SET opportunity_type = 'job' WHERE opportunity_type IS NULL;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_jobs_opportunity_type ON jobs(opportunity_type);
