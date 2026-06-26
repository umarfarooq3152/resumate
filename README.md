# Resumate

AI-powered job application automation. Resumate scrapes jobs from multiple sources, tailors your resume to each listing, fills out application forms, and tracks everything — with WhatsApp and Gmail notifications so you never miss a follow-up.

## What it does

- **Multi-source job discovery** — scrapes job boards and filters listings by relevance
- **Resume tailoring** — rewrites your resume per listing using an AI agent
- **Auto form filling** — fills and submits job application forms automatically
- **Pipeline tracking** — tracks every application through stages (discovered → applied → interview → offer)
- **Gmail integration** — reads replies, flags responses, drafts follow-ups
- **WhatsApp notifications** — get pinged on your phone when something needs attention
- **Internship discovery** — separate agent for internship-specific sources

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI |
| Agents | Custom multi-agent system (discovery, matching, tailoring, form filler, tracker) |
| Frontend | Next.js 15, React, Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Integrations | Gmail API, WhatsApp (whatsapp-web.js) |
| Deployment | Docker, Railway |

## Architecture

```
Next.js frontend (port 3000)
        │
        ▼
FastAPI backend (port 8080)
        │
        ├── discovery agent    ← scrapes job listings
        ├── matching agent     ← scores listings against your profile
        ├── tailoring agent    ← rewrites resume per listing
        ├── form filler agent  ← submits applications
        ├── tracking agent     ← monitors application status
        └── Gmail integration  ← reads/sends emails

WhatsApp service (port 3001) ← optional, runs via Docker profile
        │
        ▼
Supabase (PostgreSQL + Auth)
```

## Setup

### Prerequisites
- Python 3.11+
- Node.js 18+
- Docker (optional, for full stack)
- A Supabase project

### 1. Clone and configure

```bash
git clone https://github.com/umarfarooq3152/resumate.git
cd resumate
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | Or whichever LLM provider the agents use |

### 2. Apply database schema

```bash
pip install httpx python-dotenv
python bootstrap.py
```

### 3. Run with Docker

```bash
docker compose up
```

Frontend: `http://localhost:3000` | API: `http://localhost:8080`

To also run the WhatsApp service:

```bash
docker compose --profile whatsapp up
```

### 4. Run manually

```bash
# Backend
pip install -e .
uvicorn src.api.main:app --port 8080 --reload

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

## Frontend routes

| Route | Purpose |
|---|---|
| `/dashboard` | Overview stats |
| `/jobs` | Discovered job listings |
| `/internships` | Internship listings |
| `/applications` | Application pipeline |
| `/pipeline` | Kanban-style pipeline view |
| `/email-drafts` | AI-drafted follow-up emails |
| `/forms` | Form-fill queue |
| `/integrations` | Gmail / WhatsApp setup |
| `/profile` | Your resume and preferences |

## API docs

FastAPI auto-generates docs at `http://localhost:8080/docs` when running locally.
