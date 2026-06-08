-- Reference schema — reflects the live Supabase DB after all migrations.
-- Apply changes incrementally via Supabase MCP (apply_migration), not all-at-once.

create extension if not exists vector;

-- User profiles (one row per candidate, linked to Supabase auth user)
create table if not exists profiles (
    id               uuid primary key default gen_random_uuid(),
    user_id          text unique,                        -- auth.users.id
    full_name        text,
    email            text,
    phone            text,
    whatsapp_number  text,
    date_of_birth    text,
    cnic             text,
    address          text,
    linkedin_url     text,
    github_url       text,
    university       text,
    department       text,
    semester         text,
    cgpa             text,
    resume_text      text,
    resume_embedding vector(768),                        -- Gemini text-embedding-004 (768-dim)
    target_title     text,
    target_location  text,
    keywords         text[] default '{}',
    preferences      jsonb default '{}'::jsonb,
    personal_details jsonb default '{}'::jsonb,          -- free-form extra fields for form auto-fill
    created_at       timestamptz default now(),
    updated_at       timestamptz default now()
);

-- Discovered job postings
create table if not exists jobs (
    id                    uuid primary key default gen_random_uuid(),
    source                text not null,                 -- 'adzuna'
    external_id           text,
    title                 text,
    company               text,
    location              text,
    description           text,
    description_embedding vector(768),
    apply_method          text,                          -- 'google_form' | 'greenhouse_api' | 'lever_api' | 'ashby_api' | 'manual'
    apply_url             text,
    raw                   jsonb,
    discovered_at         timestamptz default now(),
    unique (source, external_id)
);

-- AI-scored match decisions
create table if not exists matches (
    id         uuid primary key default gen_random_uuid(),
    job_id     uuid references jobs(id) on delete cascade,
    score      float,
    reasoning  text,
    decision   text,                                     -- 'apply' | 'skip'
    strengths  jsonb default '[]'::jsonb,
    gaps       jsonb default '[]'::jsonb,
    created_at timestamptz default now(),
    unique (job_id)
);

-- Application records (tailored docs + submission state)
create table if not exists applications (
    id               uuid primary key default gen_random_uuid(),
    job_id           uuid references jobs(id) on delete cascade,
    tailored_resume  text,
    cover_letter     text,
    status           text default 'prepared',            -- 'prepared' | 'submitted' | 'error' | 'manual_pending' | 'rejected'
    submit_payload   jsonb,
    submitted_at     timestamptz,
    error            text,
    created_at       timestamptz default now(),
    unique (job_id)
);

-- Human-in-the-loop review decisions
create table if not exists reviews (
    id          uuid primary key default gen_random_uuid(),
    job_id      uuid references jobs(id) on delete cascade,
    review_type text not null,                           -- 'match' | 'application'
    status      text default 'pending',                  -- 'pending' | 'approved' | 'rejected'
    notes       text,
    reviewed_at timestamptz,
    created_at  timestamptz default now(),
    unique (job_id, review_type)
);

-- Audit log for all inter-agent events
create table if not exists agent_events (
    id         bigserial primary key,
    agent      text not null,
    event_type text not null,
    payload    jsonb,
    created_at timestamptz default now()
);

-- Indexes
create index if not exists profiles_user_id_idx      on profiles (user_id);
create index if not exists jobs_source_idx            on jobs (source);
create index if not exists matches_decision_idx       on matches (decision);
create index if not exists applications_status_idx    on applications (status);
create index if not exists reviews_status_idx         on reviews (status);
create index if not exists reviews_type_idx           on reviews (review_type);
create index if not exists agent_events_agent_idx     on agent_events (agent, event_type);

-- IVFFlat cosine similarity indexes (768-dim)
create index if not exists jobs_embedding_idx
    on jobs using ivfflat (description_embedding vector_cosine_ops) with (lists = 100);

create index if not exists profiles_embedding_idx
    on profiles using ivfflat (resume_embedding vector_cosine_ops) with (lists = 10);

-- OAuth2 tokens (Gmail, etc.)
create table if not exists oauth_tokens (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null,                              -- auth.users.id
    provider     text not null,                              -- 'gmail'
    access_token text,
    refresh_token text not null,
    expires_at   timestamptz,
    scope        text,
    email        text,                                       -- the connected Google email
    created_at   timestamptz default now(),
    updated_at   timestamptz default now(),
    unique (user_id, provider)
);

-- Email drafts — generated from WhatsApp forwards or Gmail scans, pending user approval
create table if not exists email_drafts (
    id               uuid primary key default gen_random_uuid(),
    user_id          text,                                   -- auth.users.id (nullable for WhatsApp-only users)
    source           text not null,                          -- 'whatsapp' | 'gmail_scan' | 'manual'
    from_phone       text,                                   -- WhatsApp sender phone (e.g. +447700900000)
    job_title        text,
    company          text,
    job_description  text,
    hr_email         text,                                   -- recipient — found via Hunter.io / extraction
    hr_name          text,
    subject          text,
    email_body       text,                                   -- full crafted email text
    tailored_resume  text,
    cover_letter     text,
    source_url       text,                                   -- original job posting URL
    source_message   text,                                   -- original WhatsApp/email text
    status           text default 'pending_approval',        -- 'pending_approval' | 'approved' | 'rejected' | 'sent' | 'failed'
    sent_at          timestamptz,
    error            text,
    gmail_message_id text,                                   -- Gmail API message ID after send
    created_at       timestamptz default now(),
    updated_at       timestamptz default now()
);

create index if not exists oauth_tokens_user_provider_idx on oauth_tokens (user_id, provider);
create index if not exists email_drafts_status_idx        on email_drafts (status);
create index if not exists email_drafts_from_phone_idx    on email_drafts (from_phone);
create index if not exists email_drafts_user_idx          on email_drafts (user_id);

-- RPC: find jobs not yet scored by matching agent
create or replace function get_unmatched_jobs(p_limit int default 20)
returns setof jobs language sql stable as $$
  select j.* from jobs j
  where not exists (select 1 from matches m where m.job_id = j.id)
  order by j.discovered_at desc
  limit p_limit;
$$;
