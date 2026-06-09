"""FastAPI backend — dashboard, pipeline control, human-in-the-loop reviews.

Run with:  uvicorn src.api.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Query, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field
from typing import Literal

from src.config import settings
from src.db.client import get_db, insert_row, select_rows, upsert_row

log = logging.getLogger(__name__)
app = FastAPI(title="Job Agent", version="0.3.0")


@app.get("/health")
def health():
    return {"status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Runtime overrides (not persisted — restart to reset to .env defaults)
_overrides: dict[str, Any] = {}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ProfileCreate(BaseModel):
    user_id: str = ""
    full_name: str = ""
    email: str = ""
    phone: str = ""
    resume_text: str = ""
    target_title: str = ""
    target_location: str = ""
    keywords: list[str] = []
    preferences: dict[str, Any] = {}
    whatsapp_number: str = ""
    university: str = ""
    department: str = ""
    semester: str = ""
    cgpa: str = ""
    cnic: str = ""
    date_of_birth: str = ""
    address: str = ""
    linkedin_url: str = ""
    github_url: str = ""
    personal_details: dict[str, Any] = {}


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    target_title: str | None = None
    target_location: str | None = None
    keywords: list[str] | None = None
    preferences: dict[str, Any] | None = None
    whatsapp_number: str | None = None
    university: str | None = None
    department: str | None = None
    semester: str | None = None
    cgpa: str | None = None
    cnic: str | None = None
    date_of_birth: str | None = None
    address: str | None = None
    linkedin_url: str | None = None
    github_url: str | None = None
    personal_details: dict[str, Any] | None = None


class RunRequest(BaseModel):
    keywords: list[str] | str = "software engineer"
    location: str = ""
    pages: int = Field(default=1, ge=1, le=100)
    days: int = Field(default=7, ge=1, le=90)
    profile_id: str | None = None
    job_id: str | None = None


class ReviewDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    notes: str = ""
    cover_letter: str | None = None
    tailored_resume: str | None = None


class EmailDraftUpdate(BaseModel):
    hr_email: str | None = None
    hr_name: str | None = None
    subject: str | None = None
    email_body: str | None = None
    tailored_resume: str | None = None


class GmailScanRequest(BaseModel):
    user_id: str
    max_results: int = Field(default=20, ge=1, le=100)


class SettingsPatch(BaseModel):
    dry_run: bool | None = None


class FormAnalyzeRequest(BaseModel):
    url: str
    profile_id: str | None = None
    job_id: str | None = None


class FormFillItem(BaseModel):
    entry_id: str
    question: str = ""
    type: str = "short_text"
    value: str = ""
    confidence: str = "medium"


class FormSubmitRequest(BaseModel):
    url: str
    fills: list[FormFillItem]
    profile_id: str | None = None
    job_id: str | None = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "dry_run": _overrides.get("dry_run", settings.dry_run),
        "model": settings.gemini_model,
        "adzuna_configured": settings.adzuna_configured,
        "supabase_configured": settings.supabase_configured,
        "gemini_configured": settings.gemini_configured,
        "groq_configured": settings.groq_configured,
        "groq_model": settings.groq_model if settings.groq_configured else None,
        "whatsapp_configured": settings.whatsapp_configured,
        "gmail_configured": settings.gmail_configured,
    }


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@app.get("/settings")
async def get_settings() -> dict[str, Any]:
    return {
        "dry_run": _overrides.get("dry_run", settings.dry_run),
        "gemini_model": settings.gemini_model,
        "adzuna_country": settings.adzuna_country,
        "adzuna_max_results": settings.adzuna_max_results,
        "rate_limit_delay": settings.rate_limit_delay,
        "supabase_configured": settings.supabase_configured,
        "gemini_configured": settings.gemini_configured,
        "adzuna_configured": settings.adzuna_configured,
    }


@app.patch("/settings")
async def patch_settings(body: SettingsPatch) -> dict[str, Any]:
    if body.dry_run is not None:
        _overrides["dry_run"] = body.dry_run
    return await get_settings()


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

@app.post("/profiles", status_code=201)
async def create_profile(body: ProfileCreate) -> dict[str, Any]:
    data = {k: v for k, v in body.model_dump().items() if v != "" and v is not None and v != []}
    if body.user_id:
        # Upsert on user_id to avoid duplicates when re-creating after login
        return await upsert_row("profiles", data, on_conflict="user_id")
    return await insert_row("profiles", data)


@app.get("/profiles")
async def list_profiles(user_id: str | None = None) -> list[dict[str, Any]]:
    filters = {"user_id": user_id} if user_id else None
    return await select_rows("profiles", filters=filters)


@app.get("/profiles/{profile_id}")
async def get_profile(profile_id: str) -> dict[str, Any]:
    rows = await select_rows("profiles", filters={"id": profile_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Profile not found")
    return rows[0]


@app.put("/profiles/{profile_id}")
async def update_profile(profile_id: str, body: ProfileUpdate) -> dict[str, Any]:
    db = await get_db()
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update")
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    resp = await db.table("profiles").update(data).eq("id", profile_id).execute()
    if not resp.data:
        raise HTTPException(404, "Profile not found")
    return resp.data[0]


# ---------------------------------------------------------------------------
# Resume upload  (multipart form → Supabase Storage → Gemini parse → profile)
# ---------------------------------------------------------------------------

@app.post("/profiles/{profile_id}/resume")
async def upload_resume(
    profile_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload a PDF/TXT resume, parse text via Gemini, store on profile."""
    allowed_mime = {
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    }
    allowed_ext = {".pdf", ".txt", ".doc", ".docx"}
    fname = file.filename or ""
    ext = "." + fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    if file.content_type not in allowed_mime and ext not in allowed_ext:
        raise HTTPException(400, "Only PDF, Word (.doc/.docx) and plain-text files are supported")

    content = await file.read()
    mime = file.content_type or "application/octet-stream"

    try:
        from src.llm.gemini import parse_resume_file
        resume_text = await parse_resume_file(content, mime, filename=fname)
    except Exception as exc:
        log.warning("Gemini parse failed, falling back to raw text: %s", exc)
        resume_text = content.decode("utf-8", errors="ignore")

    # PostgreSQL rejects \x00 (null bytes present in raw PDF binary fallback)
    resume_text = resume_text.replace('\x00', '')

    if not resume_text.strip():
        raise HTTPException(422, "Could not extract text from file. Try a plain-text or Word (.docx) version of your resume.")

    # Store in Supabase Storage (best-effort)
    storage_path: str | None = None
    try:
        db = await get_db()
        path = f"resumes/{profile_id}/{file.filename}"
        await db.storage.from_("resumes").upload(
            path=path,
            file=content,
            file_options={"content-type": mime, "upsert": "true"},
        )
        storage_path = path
    except Exception as exc:
        log.warning("Storage upload failed (bucket may not exist): %s", exc)

    db = await get_db()
    update_data: dict[str, Any] = {
        "resume_text": resume_text,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if storage_path:
        pref = (await select_rows("profiles", filters={"id": profile_id}, limit=1) or [{}])[0]
        prefs = pref.get("preferences") or {}
        prefs["resume_file_path"] = storage_path
        update_data["preferences"] = prefs

    resp = await db.table("profiles").update(update_data).eq("id", profile_id).execute()
    if not resp.data:
        raise HTTPException(404, "Profile not found")

    return {
        "resume_text": resume_text[:500] + ("…" if len(resume_text) > 500 else ""),
        "chars": len(resume_text),
        "storage_path": storage_path,
    }


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

@app.get("/jobs")
async def list_jobs(
    tab: str = "all",
    days: int = 7,
    location: str = "",
    keywords: str = "",
    limit: int = 10,
    offset: int = 0,
) -> dict[str, Any]:
    """List jobs with pagination, tab, date, location and keyword filters."""
    from datetime import timedelta
    db = await get_db()

    # Include match score if available
    query = db.table("jobs").select(
        "id,source,title,company,location,apply_url,apply_method,apply_type,"
        "posted_at,discovered_at,description,"
        "matches(score,decision,strengths,gaps,reasoning)",
        count="exact",
    )

    # Tab → apply_type filter
    type_map = {"auto": "auto", "online": "online_manual", "manual": "manual_only"}
    if tab in type_map:
        query = query.eq("apply_type", type_map[tab])

    # Date filter
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    query = query.gte("discovered_at", cutoff)

    # Location filter
    if location:
        query = query.ilike("location", f"%{location.strip()}%")

    # Keyword filter
    if keywords:
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()][:8]
        if kw_list:
            parts = [f"title.ilike.%{kw}%,company.ilike.%{kw}%" for kw in kw_list]
            query = query.or_(",".join(parts))

    resp = await query.order("discovered_at", desc=True).range(offset, offset + limit - 1).execute()
    jobs = resp.data or []
    total = resp.count or 0

    # Flatten nested match into top-level score fields
    for j in jobs:
        raw = j.pop("matches", None)
        if isinstance(raw, dict):
            match_list = [raw] if raw else []
        else:
            match_list = raw or []
        m = match_list[0] if match_list else {}
        j["score"]     = m.get("score")
        j["decision"]  = m.get("decision")
        j["strengths"] = m.get("strengths") or []
        j["gaps"]      = m.get("gaps") or []
        j["reasoning"] = m.get("reasoning")
        j["matched"]   = bool(m)

    return {"jobs": jobs, "total": total, "offset": offset, "limit": limit}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    rows = await select_rows("jobs", filters={"id": job_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Job not found")
    return rows[0]


# ---------------------------------------------------------------------------
# Matches (AI scored + human review status)
# ---------------------------------------------------------------------------

@app.get("/matches")
async def list_matches(status: str | None = None) -> list[dict[str, Any]]:
    """AI-scored matches with job details and human review status."""
    db = await get_db()
    resp = await db.table("matches").select(
        "id,job_id,score,reasoning,decision,strengths,gaps,created_at,"
        "jobs(id,title,company,location,description,apply_url,apply_method)"
    ).order("score", desc=True).execute()
    matches = resp.data or []

    # Flatten nested job fields into top-level keys
    for m in matches:
        job = m.pop("jobs", None) or {}
        m.setdefault("title", job.get("title"))
        m.setdefault("company", job.get("company"))
        m.setdefault("location", job.get("location"))
        m.setdefault("description", job.get("description"))
        m.setdefault("apply_url", job.get("apply_url"))
        m.setdefault("apply_method", job.get("apply_method"))

    all_reviews = await select_rows("reviews", filters={"review_type": "match"})
    review_map = {r["job_id"]: r["status"] for r in all_reviews if r.get("job_id")}
    for m in matches:
        m["review_status"] = review_map.get(m["job_id"], "pending")

    if status == "pending":
        matches = [m for m in matches if m["review_status"] == "pending" and m["decision"] == "apply"]
    elif status in ("approved", "rejected"):
        matches = [m for m in matches if m["review_status"] == status]

    return matches


# ---------------------------------------------------------------------------
# Dashboard / pipeline view
# ---------------------------------------------------------------------------

@app.get("/dashboard")
async def dashboard() -> dict[str, Any]:
    from src.agents.tracking import TrackingAgent
    stats = await TrackingAgent().run()
    counts = await _review_counts()
    stats.update(counts)
    stats["dry_run"] = _overrides.get("dry_run", settings.dry_run)
    return stats


@app.get("/pipeline")
async def pipeline_view() -> list[dict[str, Any]]:
    from src.agents.tracking import TrackingAgent
    return await TrackingAgent().get_pipeline()


# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------

@app.get("/applications")
async def list_applications(status: str | None = None) -> list[dict[str, Any]]:
    db = await get_db()
    resp = await db.table("applications").select(
        "*, jobs(id,title,company,location,apply_url,apply_method,description)"
    ).order("created_at", desc=True).execute()
    apps = resp.data or []

    all_reviews = await select_rows("reviews", filters={"review_type": "application"})
    review_map = {r["job_id"]: r["status"] for r in all_reviews if r.get("job_id")}
    for a in apps:
        a["review_status"] = review_map.get(a["job_id"], "pending")

    if status == "pending":
        apps = [a for a in apps if a["status"] == "prepared" and a["review_status"] == "pending"]
    elif status == "approved":
        # approved = user approved the review OR application already submitted
        apps = [a for a in apps if a["review_status"] == "approved" or a["status"] == "submitted"]
    elif status == "rejected":
        apps = [a for a in apps if a["review_status"] == "rejected"]
    elif status:
        apps = [a for a in apps if a["status"] == status]

    return apps


@app.post("/applications/{job_id}/submit")
async def manual_submit(job_id: str, background_tasks: BackgroundTasks) -> dict[str, str]:
    rows = await select_rows("applications", filters={"job_id": job_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Application not found")
    if rows[0]["status"] not in ("manual_pending", "prepared", "error"):
        raise HTTPException(400, f"Cannot resubmit with status '{rows[0]['status']}'")
    from src.agents.application import ApplicationAgent
    background_tasks.add_task(ApplicationAgent().submit_application, job_id)
    return {"message": "Submission queued", "job_id": job_id}


# ---------------------------------------------------------------------------
# Human-in-the-loop Reviews
# ---------------------------------------------------------------------------

@app.get("/reviews/counts")
async def get_review_counts() -> dict[str, int]:
    return await _review_counts()


@app.get("/reviews")
async def list_reviews(review_type: str | None = None, status: str = "pending") -> list[dict[str, Any]]:
    db = await get_db()
    query = db.table("reviews").select("*, jobs(id,title,company,location,apply_url)")
    if review_type:
        query = query.eq("review_type", review_type)
    if status != "all":
        query = query.eq("status", status)
    resp = await query.order("created_at", desc=True).execute()
    return resp.data or []


@app.post("/reviews/{job_id}/match")
async def review_match(
    job_id: str,
    body: ReviewDecision,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    db = await get_db()

    review_row = {
        "job_id": job_id,
        "review_type": "match",
        "status": body.decision,
        "notes": body.notes,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    await upsert_row("reviews", review_row, on_conflict="job_id,review_type")

    decision_map = {"approved": "apply", "rejected": "skip"}
    await db.table("matches").update({
        "decision": decision_map.get(body.decision, "skip"),
    }).eq("job_id", job_id).execute()

    if body.decision == "approved":
        from src.agents.tailoring import TailoringAgent
        background_tasks.add_task(TailoringAgent().tailor_for_job, job_id)
        return {"message": "Match approved — tailoring queued", "job_id": job_id}

    return {"message": "Match rejected", "job_id": job_id}


@app.post("/reviews/{job_id}/application")
async def review_application(
    job_id: str,
    body: ReviewDecision,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    db = await get_db()

    review_row = {
        "job_id": job_id,
        "review_type": "application",
        "status": body.decision,
        "notes": body.notes,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    await upsert_row("reviews", review_row, on_conflict="job_id,review_type")

    if body.decision == "approved":
        update: dict[str, Any] = {"status": "prepared"}
        if body.cover_letter:
            update["cover_letter"] = body.cover_letter
        if body.tailored_resume:
            update["tailored_resume"] = body.tailored_resume
        await db.table("applications").update(update).eq("job_id", job_id).execute()

        from src.agents.application import ApplicationAgent
        background_tasks.add_task(ApplicationAgent().submit_application, job_id)
        return {"message": "Application approved — submission queued", "job_id": job_id}

    await db.table("applications").update({"status": "rejected"}).eq("job_id", job_id).execute()
    return {"message": "Application rejected", "job_id": job_id}


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@app.get("/events")
async def list_events(limit: int = 60) -> list[dict[str, Any]]:
    db = await get_db()
    resp = (
        await db.table("agent_events")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


# ---------------------------------------------------------------------------
# Orchestration triggers
# ---------------------------------------------------------------------------

@app.post("/run/discovery")
async def run_discovery(body: RunRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    from src.agents.discovery import DiscoveryAgent, _is_pakistan, _adzuna_country
    raw_kw = body.keywords if isinstance(body.keywords, str) else ", ".join(body.keywords)
    keywords = raw_kw.strip() or "software engineer"
    location = body.location or ""
    background_tasks.add_task(DiscoveryAgent().run, keywords=keywords, location=location, pages=body.pages, days=body.days)

    pakistan = _is_pakistan(location)
    adzuna = _adzuna_country(location) if not pakistan else None
    sources = []
    if adzuna:
        sources.append(f"Adzuna ({adzuna.upper()})")
    sources.extend(["Remotive", "WeWorkRemotely", "Jobicy", "Himalayas"])
    note = "Remote-only sources used (no local Pakistan board accessible)" if pakistan else ""
    return {
        "message": f"Discovery started — searching {', '.join(sources)}",
        "sources": sources,
        "note": note,
    }


@app.post("/run/matching")
async def run_matching(body: RunRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    from src.agents.matching import MatchingAgent
    background_tasks.add_task(MatchingAgent().run, profile_id=body.profile_id, job_id=body.job_id)
    return {"message": "Matching started"}


@app.post("/run/tailoring")
async def run_tailoring(background_tasks: BackgroundTasks) -> dict[str, str]:
    from src.agents.tailoring import TailoringAgent
    background_tasks.add_task(TailoringAgent().run)
    return {"message": "Tailoring started"}


@app.post("/run/application")
async def run_application(background_tasks: BackgroundTasks) -> dict[str, str]:
    from src.agents.application import ApplicationAgent
    background_tasks.add_task(ApplicationAgent().run)
    dry = _overrides.get("dry_run", settings.dry_run)
    return {"message": f"Application run started (dry_run={dry})"}


@app.post("/run/all")
async def run_all(body: RunRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    background_tasks.add_task(_run_pipeline, body)
    return {"message": "Full pipeline started", "dry_run": str(_overrides.get("dry_run", settings.dry_run))}


# ---------------------------------------------------------------------------
# Google Forms filler
# ---------------------------------------------------------------------------

@app.post("/forms/analyze")
async def forms_analyze(body: FormAnalyzeRequest) -> dict[str, Any]:
    """Fetch a Google Form, extract questions, and propose fills from the user's profile."""
    from src.agents.form_filler import FormFillerAgent
    try:
        return await FormFillerAgent().analyze(body.url, profile_id=body.profile_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        log.error("Form analyze error: %s", exc)
        raise HTTPException(500, f"Analysis failed: {exc}")


@app.post("/forms/submit")
async def forms_submit(body: FormSubmitRequest) -> dict[str, Any]:
    """Submit a Google Form with the provided fills (DRY_RUN gated)."""
    from src.agents.form_filler import FormFillerAgent
    dry_run = _overrides.get("dry_run", settings.dry_run)
    fills = [f.model_dump() for f in body.fills]
    try:
        return await FormFillerAgent().submit(
            url=body.url,
            fills=fills,
            profile_id=body.profile_id,
            job_id=body.job_id,
            dry_run=dry_run,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        log.error("Form submit error: %s", exc)
        raise HTTPException(500, f"Submission failed: {exc}")


@app.get("/forms/submissions")
async def list_form_submissions(limit: int = 50) -> list[dict[str, Any]]:
    db = await get_db()
    resp = await db.table("form_submissions").select("*").order("created_at", desc=True).limit(limit).execute()
    return resp.data or []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _review_counts() -> dict[str, int]:
    db = await get_db()

    # Count approved/rejected match reviews directly in DB (no Python-side filtering)
    reviewed_match_resp = await db.table("reviews").select("job_id").eq("review_type", "match").in_("status", ["approved", "rejected"]).execute()
    reviewed_match_ids = {r["job_id"] for r in (reviewed_match_resp.data or [])}

    reviewed_app_resp = await db.table("reviews").select("job_id").eq("review_type", "application").in_("status", ["approved", "rejected"]).execute()
    reviewed_app_ids = {r["job_id"] for r in (reviewed_app_resp.data or [])}

    all_matches = await select_rows("matches", filters={"decision": "apply"})
    match_pending = len([m for m in all_matches if m["job_id"] not in reviewed_match_ids])

    all_apps = await select_rows("applications", filters={"status": "prepared"})
    app_pending = len([a for a in all_apps if a["job_id"] not in reviewed_app_ids])

    return {
        "match_pending": match_pending,
        "application_pending": app_pending,
        "pending_reviews": match_pending + app_pending,
    }


async def _run_pipeline(body: RunRequest) -> None:
    from src.agents.discovery import DiscoveryAgent
    from src.agents.matching import MatchingAgent
    from src.agents.tailoring import TailoringAgent
    from src.agents.application import ApplicationAgent
    from src.agents.tracking import TrackingAgent
    from src.messaging import bus

    raw_kw = body.keywords if isinstance(body.keywords, str) else ", ".join(body.keywords)
    keywords = raw_kw.strip() or "software engineer"
    await DiscoveryAgent().run(keywords=keywords, location=body.location, pages=body.pages)
    await bus.drain()
    await MatchingAgent().run(profile_id=body.profile_id)
    await bus.drain()
    await TailoringAgent().run()
    await bus.drain()
    await ApplicationAgent().run()
    await bus.drain()
    summary = await TrackingAgent().run()
    log.info("Pipeline complete: %s", summary)


# ---------------------------------------------------------------------------
# WhatsApp webhook
# ---------------------------------------------------------------------------

class WhatsAppMessage(BaseModel):
    from_: str = Field(alias="from")
    body: str
    hr_email: str | None = None
    is_self: bool = False
    session_id: str | None = None  # Supabase user_id — set by multi-user sidecar

    model_config = {"populate_by_name": True}


@app.post("/webhooks/whatsapp-local")
async def whatsapp_local_webhook(msg: WhatsAppMessage) -> dict[str, str]:
    """
    Called by the local whatsapp-web.js sidecar for every relevant message.
    Returns {reply: "..."} synchronously — the sidecar sends it back on WhatsApp.
    Never raises — always returns a reply so the sidecar never gets a 500.
    """
    from src.integrations.whatsapp import process_incoming

    try:
        reply = await process_incoming(
            from_chat_id=msg.from_,
            body=msg.body,
            hr_email=msg.hr_email,
            is_self=msg.is_self,
            db_get=get_db,
            insert_row=insert_row,
            select_rows=select_rows,
            upsert_row=upsert_row,
            session_id=msg.session_id,
        )
    except Exception as exc:
        log.error("WhatsApp webhook unhandled error: %s", exc, exc_info=True)
        reply = (
            "⚠️ *Something went wrong on my end.*\n\n"
            "Please try sending the message again. If it keeps failing, "
            "check the dashboard for more details."
        )
    return {"reply": reply}


class WhatsAppVoiceMessage(BaseModel):
    from_: str = Field(alias="from")
    audio_data: str  # base64-encoded audio bytes
    mimetype: str = "audio/ogg; codecs=opus"
    is_self: bool = False
    session_id: str | None = None  # Supabase user_id — set by multi-user sidecar

    model_config = {"populate_by_name": True}


# Module-level Whisper model cache — loaded once on first voice note
_whisper_model = None


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # "base" is ~2× more accurate than "tiny" with only modest CPU overhead.
        # Still fast enough for short voice notes (10–30 s) on a single core.
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model


@app.post("/webhooks/whatsapp-voice")
async def whatsapp_voice_webhook(msg: WhatsAppVoiceMessage) -> dict[str, str]:
    """
    Receive a base64-encoded voice note from the sidecar, transcribe it locally
    with faster-whisper, then process the transcribed text through the same
    WhatsApp state machine as a regular text message.
    """
    import base64
    import os
    import tempfile

    from src.integrations.whatsapp import process_incoming

    try:
        audio_bytes = base64.b64decode(msg.audio_data)
    except Exception:
        return {"reply": "⚠️ Couldn't decode audio. Please type your message instead."}

    ext = ".ogg"
    if "mp4" in msg.mimetype or "m4a" in msg.mimetype:
        ext = ".mp4"
    elif "wav" in msg.mimetype:
        ext = ".wav"
    elif "mp3" in msg.mimetype:
        ext = ".mp3"

    transcribed_text = ""
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(audio_bytes)
            tmp_path = f.name

        model = _get_whisper_model()
        segments, _ = model.transcribe(
            tmp_path,
            language=None,       # auto-detect (handles Urdu/English/mixed)
            beam_size=5,         # better accuracy vs greedy default
            vad_filter=True,     # strip silence — prevents hallucination on quiet audio
            vad_parameters={"min_silence_duration_ms": 500},
        )
        transcribed_text = " ".join(seg.text.strip() for seg in segments).strip()
    except ImportError:
        return {"reply": "⚠️ Voice transcription unavailable (faster-whisper not installed). Type your message instead."}
    except Exception as exc:
        log.error("Voice transcription failed: %s", exc)
        return {"reply": "⚠️ Couldn't transcribe the voice note. Please type your message instead."}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if not transcribed_text:
        return {"reply": "⚠️ Couldn't understand the voice note. Please try again or type your message."}

    try:
        reply = await process_incoming(
            from_chat_id=msg.from_,
            body=transcribed_text,
            hr_email=None,
            is_self=msg.is_self,
            db_get=get_db,
            insert_row=insert_row,
            select_rows=select_rows,
            upsert_row=upsert_row,
            session_id=msg.session_id,
        )
    except Exception as exc:
        log.error("Voice webhook process_incoming error: %s", exc, exc_info=True)
        reply = "⚠️ Processing error. Please try again."

    preview = transcribed_text[:120] + ("…" if len(transcribed_text) > 120 else "")
    return {"reply": f"🎤 _{preview}_\n\n{reply}"}


# ---------------------------------------------------------------------------
# WhatsApp sidecar status / QR proxy
# (frontend calls these — avoids CORS issues with direct :3001 calls)
# ---------------------------------------------------------------------------

@app.get("/whatsapp/status")
async def whatsapp_status(user_id: str) -> dict[str, Any]:
    from src.integrations.whatsapp import get_sidecar_status
    return await get_sidecar_status(session_id=user_id)


@app.get("/whatsapp/qr")
async def whatsapp_qr(user_id: str) -> dict[str, Any]:
    from src.integrations.whatsapp import get_qr_code
    return await get_qr_code(session_id=user_id)


@app.post("/whatsapp/logout")
async def whatsapp_logout(user_id: str) -> dict[str, Any]:
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10) as c:
            resp = await c.post(
                f"{settings.whatsapp_service_url}/logout",
                params={"session_id": user_id},
            )
            return resp.json()
    except Exception as exc:
        raise HTTPException(503, f"Sidecar unreachable: {exc}")


# ---------------------------------------------------------------------------
# Gmail OAuth2
# ---------------------------------------------------------------------------

def _api_base(request: Request) -> str:
    """Resolve this API service's own public URL from Railway's forwarded headers."""
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto", "https")
    if forwarded_host:
        return f"{forwarded_proto}://{forwarded_host}"
    # Fall back to explicitly configured API URL
    return settings.api_base_url


@app.get("/auth/gmail/connect")
async def gmail_connect(request: Request, user_id: str) -> dict[str, str]:
    """Return Google OAuth2 consent URL for the user to visit."""
    if not settings.gmail_configured:
        raise HTTPException(503, "Gmail OAuth not configured — set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET")
    from src.integrations.gmail import get_auth_url
    redirect_uri = f"{_api_base(request)}/auth/gmail/callback"
    return {"auth_url": get_auth_url(user_id, redirect_uri=redirect_uri)}


@app.get("/auth/gmail/callback")
async def gmail_callback(request: Request, code: str, state: str, error: str | None = None) -> RedirectResponse:
    """Google redirects here after user grants access. Stores token, redirects to frontend."""
    # Frontend lives on a different Railway service — use APP_BASE_URL env var.
    # API's own public URL is resolved from Railway's x-forwarded-host header.
    frontend = settings.app_base_url
    api_self = _api_base(request)
    if error:
        return RedirectResponse(f"{frontend}/integrations?error={error}")
    try:
        from src.integrations.gmail import exchange_code
        result = await exchange_code(
            code=code, user_id=state, db_get=get_db, upsert_row=upsert_row,
            redirect_uri=f"{api_self}/auth/gmail/callback",
        )
        gmail_email = result.get("gmail_email", "")
        return RedirectResponse(
            f"{frontend}/integrations?gmail_connected=1&email={gmail_email}"
        )
    except Exception as exc:
        log.error("Gmail OAuth callback error: %s", exc)
        return RedirectResponse(f"{frontend}/integrations?error=oauth_failed")


@app.delete("/auth/gmail/disconnect")
async def gmail_disconnect(user_id: str) -> dict[str, str]:
    """Remove stored Gmail OAuth token for the user."""
    from src.integrations.gmail import disconnect_gmail
    await disconnect_gmail(user_id, get_db)
    return {"message": "Gmail disconnected"}


@app.get("/auth/gmail/status")
async def gmail_status(user_id: str) -> dict[str, Any]:
    """Check whether the user has connected their Gmail."""
    rows = await select_rows("oauth_tokens", filters={"user_id": user_id, "provider": "gmail"})
    if rows:
        return {"connected": True, "email": rows[0].get("email"), "scope": rows[0].get("scope")}
    return {"connected": False}


# ---------------------------------------------------------------------------
# Gmail inbox scan
# ---------------------------------------------------------------------------

@app.post("/gmail/scan")
async def gmail_scan(body: GmailScanRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    Start a Gmail inbox scan in the background.
    Returns immediately — results appear as email drafts (check /email-drafts).
    Each email may need a Gemini call; 20 emails can take ~60s total.
    """
    rows = await select_rows("oauth_tokens", filters={"user_id": body.user_id, "provider": "gmail"})
    if not rows:
        raise HTTPException(400, "Gmail not connected for this user")

    from src.integrations.gmail import scan_inbox

    async def _do_scan():
        try:
            await scan_inbox(
                user_id=body.user_id,
                select_rows=select_rows,
                insert_row=insert_row,
                max_results=body.max_results,
            )
        except Exception as exc:
            log.error("Background Gmail scan failed for user %s: %s", body.user_id, exc)

    background_tasks.add_task(_do_scan)
    return {
        "message": f"Scanning up to {body.max_results} emails in the background — drafts will appear in Email Drafts shortly",
        "user_id": body.user_id,
    }


# ---------------------------------------------------------------------------
# Email drafts CRUD + approval flow
# ---------------------------------------------------------------------------

@app.get("/email-drafts")
async def list_email_drafts(
    user_id: str | None = None,
    status: str | None = None,
    source: str | None = None,
    exclude_leads: bool = False,
) -> list[dict[str, Any]]:
    db = await get_db()
    query = db.table("email_drafts").select("*").order("created_at", desc=True)
    if user_id:
        query = query.eq("user_id", user_id)
    if status:
        query = query.eq("status", status)
    if source == "all":
        pass
    elif source:
        query = query.eq("source", source)
    else:
        query = query.neq("source", "whatsapp_form")
    if exclude_leads:
        query = query.neq("status", "lead").neq("status", "generating")
    resp = await query.execute()
    return resp.data or []


@app.get("/email-drafts/{draft_id}")
async def get_email_draft(draft_id: str) -> dict[str, Any]:
    rows = await select_rows("email_drafts", filters={"id": draft_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Draft not found")
    return rows[0]


@app.patch("/email-drafts/{draft_id}")
async def update_email_draft(draft_id: str, body: EmailDraftUpdate) -> dict[str, Any]:
    """Edit a pending draft — HR email, subject, email body, etc."""
    db = await get_db()
    rows = await select_rows("email_drafts", filters={"id": draft_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Draft not found")
    if rows[0]["status"] not in ("pending_approval", "failed"):
        raise HTTPException(400, "Only pending or failed drafts can be edited")

    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update")
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    resp = await db.table("email_drafts").update(data).eq("id", draft_id).execute()
    if not resp.data:
        raise HTTPException(404, "Draft not found or already deleted")
    return resp.data[0]


@app.post("/email-drafts/{draft_id}/generate")
async def generate_email_draft(draft_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    Generate an AI email draft for a Gmail lead chosen by the user.
    Runs in the background; status changes lead → pending_approval when done.
    """
    rows = await select_rows("email_drafts", filters={"id": draft_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Lead not found")
    lead = rows[0]
    if lead["status"] != "lead":
        raise HTTPException(400, f"Expected status 'lead', got '{lead['status']}'")

    db = await get_db()
    # Mark as generating immediately so UI can show a spinner
    await db.table("email_drafts").update({
        "status": "generating",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", draft_id).execute()

    from src.integrations.gmail import generate_draft_from_lead
    from src.db.client import update_row

    async def _run():
        try:
            await generate_draft_from_lead(lead, select_rows, update_row)
        except Exception as exc:
            log.error("Draft generation failed for %s: %s", draft_id, exc)
            await db.table("email_drafts").update({
                "status": "failed",
                "error": str(exc),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", draft_id).execute()

    background_tasks.add_task(_run)
    return {"message": "Generating draft…", "draft_id": draft_id, "status": "generating"}


@app.post("/email-drafts/{draft_id}/approve")
async def approve_email_draft(draft_id: str) -> dict[str, Any]:
    """Send the draft email via Gmail and mark as sent."""
    rows = await select_rows("email_drafts", filters={"id": draft_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Draft not found")
    draft = rows[0]
    if draft["status"] not in ("pending_approval", "failed"):
        raise HTTPException(400, f"Draft status is '{draft['status']}' — cannot approve")
    if not draft.get("hr_email"):
        raise HTTPException(400, "HR email is required before sending")
    if not draft.get("user_id"):
        raise HTTPException(400, "Draft has no user_id — connect Gmail first")

    db = await get_db()

    # Check Gmail connected
    tokens = await select_rows("oauth_tokens", filters={"user_id": draft["user_id"], "provider": "gmail"})
    if not tokens:
        raise HTTPException(400, "Gmail not connected — go to Settings > Integrations to connect")

    try:
        from src.integrations.gmail import send_email_draft
        msg_id = await send_email_draft(draft)
    except Exception as exc:
        log.error("Email send failed for draft %s: %s", draft_id, exc)
        await db.table("email_drafts").update({
            "status": "failed",
            "error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft_id).execute()
        raise HTTPException(502, f"Send failed: {exc}")

    await db.table("email_drafts").update({
        "status": "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "gmail_message_id": msg_id,
        "error": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", draft_id).execute()

    return {
        "message": f"Email sent to {draft['hr_email']}",
        "gmail_message_id": msg_id,
        "draft_id": draft_id,
    }


@app.post("/email-drafts/{draft_id}/reject")
async def reject_email_draft(draft_id: str) -> dict[str, str]:
    """Discard a draft without sending."""
    db = await get_db()
    rows = await select_rows("email_drafts", filters={"id": draft_id}, limit=1)
    if not rows:
        raise HTTPException(404, "Draft not found")
    await db.table("email_drafts").update({
        "status": "rejected",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", draft_id).execute()
    return {"message": "Draft rejected"}


@app.post("/email-drafts/from-url")
async def create_draft_from_url(
    url: str,
    user_id: str,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """
    Manually create an email draft by pasting a job URL.
    Extracts job details, tailors resume, finds HR email — all async.
    """
    profiles = await select_rows("profiles", filters={"user_id": user_id})
    if not profiles or not profiles[0].get("resume_text"):
        raise HTTPException(400, "No resume found — upload your CV first")

    # Create a placeholder draft immediately
    draft = await insert_row("email_drafts", {
        "user_id": user_id,
        "source": "manual",
        "source_url": url,
        "status": "pending_approval",
        "job_title": "Processing…",
        "company": "",
    })
    draft_id = draft["id"]

    async def _process():
        from src.agents.job_extractor import JobExtractorAgent
        from src.llm.gemini import (
            write_application_email,
            tailor_resume,
            get_relevant_resume_context,
        )

        db = await get_db()
        profile = profiles[0]
        try:
            extractor = JobExtractorAgent()
            job = await extractor.extract_from_url(url)

            hr_email = job.get("hr_email") or await extractor.find_hr_email(
                company=job.get("company", ""),
                domain=job.get("source_domain"),
                hr_name=job.get("hr_name"),
            )
            jd = job.get("description", "")

            # Use embeddings to pull the most relevant resume sections for this JD
            relevant_resume = await get_relevant_resume_context(profile["resume_text"], jd)
            profile_ctx = {**profile, "resume_text": relevant_resume}
            job_ctx = {**job, "description": jd}

            tailored, email_body_content = await asyncio.gather(
                tailor_resume(relevant_resume, jd),
                write_application_email(profile_ctx, job_ctx),
            )

            name     = profile.get("full_name", "Candidate")
            email_   = profile.get("email", "")
            phone_   = profile.get("phone", "")
            contact  = " | ".join(filter(None, [email_, phone_]))
            hr_name  = job.get("hr_name") or "Hiring Manager"
            subject  = f"Application – {job.get('job_title', 'Role')} at {job.get('company', 'Your Company')}"
            email_body = (
                f"Dear {hr_name},\n\n"
                f"{email_body_content}\n\n"
                f"Best regards,\n{name}\n{contact}"
            )
            await db.table("email_drafts").update({
                "job_title": job.get("job_title"),
                "company": job.get("company"),
                "job_description": jd[:4_000],
                "hr_email": hr_email or "",
                "hr_name": job.get("hr_name"),
                "subject": subject,
                "email_body": email_body,
                "tailored_resume": tailored,
                "status": "pending_approval",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", draft_id).execute()
        except Exception as exc:
            log.error("Draft-from-URL processing failed: %s", exc)
            err_msg = str(exc)
            if "rate_limit_both_keys" in err_msg:
                err_msg = "AI rate limit reached — please try again in ~1 hour"
            await db.table("email_drafts").update({
                "status": "failed",
                "error": err_msg,
                "job_title": "Processing failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", draft_id).execute()

    background_tasks.add_task(_process)
    return {"draft_id": draft_id, "message": "Processing started — refresh in ~30 seconds"}


# ---------------------------------------------------------------------------
# Integrations status endpoint (combined for frontend)
# ---------------------------------------------------------------------------

@app.get("/integrations/status")
async def integrations_status(user_id: str) -> dict[str, Any]:
    """Return connection status for all integrations for a given user."""
    from src.integrations.whatsapp import get_sidecar_status

    gmail_rows = await select_rows("oauth_tokens", filters={"user_id": user_id, "provider": "gmail"})
    pending_drafts = await select_rows("email_drafts", filters={"user_id": user_id, "status": "pending_approval"})
    db = await get_db()
    sent_count_resp = await db.table("email_drafts").select("id", count="exact").eq("user_id", user_id).eq("status", "sent").execute()
    wa_status = await get_sidecar_status(session_id=user_id)

    return {
        "whatsapp": {
            "sidecar_url": settings.whatsapp_service_url,
            "connected": wa_status.get("connected", False),
            "phone": wa_status.get("phone"),
            "name": wa_status.get("name"),
            "has_qr": wa_status.get("has_qr", False),
            "error": wa_status.get("error"),
        },
        "gmail": {
            "configured": settings.gmail_configured,
            "connected": bool(gmail_rows),
            "email": gmail_rows[0].get("email") if gmail_rows else None,
        },
        "hunter_io": {
            "configured": bool(settings.hunter_api_key),
        },
        "stats": {
            "pending_drafts": len(pending_drafts),
            "sent_emails": sent_count_resp.count or 0,
        },
    }
