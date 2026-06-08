"""WhatsApp integration — local sidecar (whatsapp-web.js).

Two self-trigger flows:
  A) Job email flow — send yourself a job post / HR email:
       → agent tailors resume, drafts email, asks APPROVE / EDIT / REJECT
  B) Form flow — send yourself a Google Form URL:
       → agent fetches form, proposes fills from your profile, shows preview
       → reply YES to submit / NO to cancel
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from src.config import settings

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sidecar helpers
# ---------------------------------------------------------------------------

async def send_whatsapp(to_chat_id: str, body: str) -> None:
    """Send a WhatsApp message via the local Node.js sidecar."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.whatsapp_service_url}/send",
                json={"to": to_chat_id, "body": body},
            )
            resp.raise_for_status()
    except Exception as exc:
        log.error("WhatsApp send failed (is sidecar running?): %s", exc)


async def get_sidecar_status() -> dict[str, Any]:
    """Return sidecar status: connected, phone, has_qr."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.whatsapp_service_url}/status")
            return resp.json()
    except Exception:
        return {"connected": False, "phone": None, "has_qr": False, "error": "sidecar_unreachable"}


async def get_qr_code() -> dict[str, Any]:
    """Return the current QR dataURL (None when already connected)."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.whatsapp_service_url}/qr")
            return resp.json()
    except Exception:
        return {"qr": None, "connected": False, "error": "sidecar_unreachable"}


# ---------------------------------------------------------------------------
# Incoming message processor (called by /webhooks/whatsapp-local)
# ---------------------------------------------------------------------------

_GOOGLE_FORM_RE = re.compile(
    r"https?://(?:docs\.google\.com/forms/d/[^\s]+|forms\.gle/[^\s]+|forms\.google\.com/[^\s]+)",
    re.IGNORECASE,
)

# Unicode digit-word → ASCII digit
_DIGIT_WORD_MAP = {
    "ZERO": "0", "ONE": "1", "TWO": "2", "THREE": "3", "FOUR": "4",
    "FIVE": "5", "SIX": "6", "SEVEN": "7", "EIGHT": "8", "NINE": "9",
}


def _normalize_unicode(text: str) -> str:
    """Map Unicode styled characters (bold/italic/mathematical) to plain ASCII.

    WhatsApp and LinkedIn posts often use Unicode Mathematical Alphanumeric Symbols
    for visual emphasis, e.g. 𝗵𝗶𝗿𝗶𝗻𝗴@𝘇𝗮𝗮𝗿𝗶𝗰-𝗮𝗶.𝗰𝗼𝗺 → hiring@zaaric-ai.com.
    Without this step every email regex silently misses the address.
    """
    import unicodedata as _ud
    result: list[str] = []
    for ch in text:
        cp = ord(ch)
        if 0x1D400 <= cp <= 0x1D7FF:
            try:
                name = _ud.name(ch, "")
                parts = name.split()
                last = parts[-1] if parts else ""
                if len(last) == 1 and last.isalpha():
                    result.append(last.lower() if "SMALL" in name else last.upper())
                    continue
                if "DIGIT" in name and last in _DIGIT_WORD_MAP:
                    result.append(_DIGIT_WORD_MAP[last])
                    continue
            except Exception:
                pass
        elif 0xFF01 <= cp <= 0xFF5E:
            # Fullwidth ASCII variants (ａ→a, ＠→@, ０→0, etc.)
            result.append(chr(cp - 0xFF01 + 0x21))
            continue
        result.append(ch)
    return "".join(result)


_EMAIL_SCAN_RE = re.compile(r"[\w.+'\-]+@[\w.\-]+\.[a-zA-Z]{2,}")
_JOB_BOARD_DOMAINS = {
    "linkedin.com", "indeed.com", "glassdoor.com", "monster.com", "ziprecruiter.com",
    "workable.com", "greenhouse.io", "lever.co", "ashbyhq.com", "bamboohr.com",
    "smartrecruiters.com", "icims.com", "jobvite.com", "workday.com", "taleo.net",
    "successfactors.com", "noreply.com", "no-reply.com",
}
_HR_PREFIXES = ("hr", "hiring", "careers", "career", "recruit", "talent", "jobs", "apply", "people", "work", "join")
_EMAIL_BARE_RE = re.compile(r"^[\w.+'\-]+@[\w.\-]+\.[a-zA-Z]{2,}$")


def _scan_for_email(text: str) -> str | None:
    """Scan raw text for the best candidate HR/recruiter email."""
    text = _normalize_unicode(text)
    all_emails = _EMAIL_SCAN_RE.findall(text)
    if not all_emails:
        return None
    # Filter out job-board/ATS addresses
    candidates = [
        e for e in all_emails
        if (e.split("@")[-1].lower() not in _JOB_BOARD_DOMAINS)
        and not any(e.lower().endswith("." + d) for d in _JOB_BOARD_DOMAINS)
    ]
    pool = candidates if candidates else all_emails
    # Prefer HR-like local parts
    for e in pool:
        local = e.split("@")[0].lower()
        if any(local.startswith(p) or p in local for p in _HR_PREFIXES):
            return e
    return pool[0]


async def process_incoming(
    from_chat_id: str,
    body: str,
    hr_email: str | None,
    is_self: bool,
    db_get,
    insert_row,
    select_rows,
    upsert_row,
) -> str:
    """
    Process an incoming WhatsApp message.
    Returns the reply text (sent back to the same chat by the sidecar).

    State machine:
      pending_form_confirm → YES/NO
      pending_approval     → APPROVE / EDIT / REJECT
      (none)               → detect form URL or treat as job post
    """
    text = body.strip()
    upper = text.upper()

    # Detect a "new job" signal — HR email present or a Google Form URL.
    # If either is found, any stale pending state is silently cancelled so the
    # new message is processed fresh instead of being swallowed by the old state.
    _is_new_job_message = bool(hr_email) or bool(_GOOGLE_FORM_RE.search(text))

    async def _cancel_draft(draft_id: str) -> None:
        db = await db_get()
        await db.table("email_drafts").update({
            "status": "rejected",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft_id).execute()

    # ── 0. Check for form awaiting missing field info ─────────────────────────
    open_info_drafts = await select_rows(
        "email_drafts",
        filters={"from_phone": from_chat_id, "status": "pending_form_info"},
    )
    if open_info_drafts:
        draft = open_info_drafts[0]
        if upper in ("SKIP", "SUBMIT", "S"):
            # User wants to submit with whatever we already have
            db = await db_get()
            await db.table("email_drafts").update({
                "status": "pending_form_confirm",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", draft["id"]).execute()
            draft["status"] = "pending_form_confirm"
            return _form_preview(draft)
        if upper in ("NO", "N", "CANCEL", "REJECT"):
            await _cancel_draft(draft["id"])
            return "Form submission cancelled. Send another form link any time."
        if _is_new_job_message:
            await _cancel_draft(draft["id"])
            # fall through to step 3
        else:
            return await _handle_form_info(draft, text, db_get)

    # ── 1. Check for an open form confirmation ───────────────────────────────
    open_form_drafts = await select_rows(
        "email_drafts",
        filters={"from_phone": from_chat_id, "status": "pending_form_confirm"},
    )
    if open_form_drafts:
        draft = open_form_drafts[0]
        if upper in ("YES", "Y", "SUBMIT", "CONFIRM"):
            return await _handle_form_confirm(draft, db_get)
        if upper in ("NO", "N", "CANCEL", "REJECT", "SKIP"):
            await _cancel_draft(draft["id"])
            return "Form submission cancelled. Send another form link any time."
        # New job message forwarded → silently drop the old form, process fresh
        if _is_new_job_message:
            await _cancel_draft(draft["id"])
            # fall through to step 3
        else:
            # Unrecognised reply — re-show the form preview
            return _form_preview(draft)

    # ── 2. Check for an open email draft awaiting approval ───────────────────
    open_drafts = await select_rows(
        "email_drafts",
        filters={"from_phone": from_chat_id, "status": "pending_approval"},
    )
    if open_drafts:
        draft = open_drafts[0]
        draft_id = draft["id"]

        if upper == "APPROVE":
            return await _handle_approve(draft, db_get)

        if upper.startswith("EDIT:") or upper.startswith("EDIT "):
            note = text[5:].strip()
            return await _handle_edit(draft, note, db_get)

        if upper in ("REJECT", "CANCEL", "NO", "SKIP", "DISCARD"):
            await _cancel_draft(draft_id)
            return "Draft cancelled. Forward another job message any time."

        # User replied with just an email address → set it as hr_email
        if _EMAIL_BARE_RE.match(text.strip()):
            return await _handle_edit(draft, f"hr_email = {text.strip()}", db_get)

        # New job message forwarded → silently drop the old draft, process fresh
        if _is_new_job_message:
            await _cancel_draft(draft_id)
            # fall through to step 3
        else:
            # Unrecognised reply — re-show the draft preview
            return _draft_preview(draft)

    # ── 3. No open state — detect form URL or treat as job message ───────────
    form_match = _GOOGLE_FORM_RE.search(text)
    if form_match:
        form_url = form_match.group(0).rstrip(")")  # strip trailing ) from markdown links
        return await _handle_form_url(
            from_chat_id=from_chat_id,
            form_url=form_url,
            db_get=db_get,
            insert_row=insert_row,
            select_rows=select_rows,
        )

    # Strip self-trigger prefixes so the extractor sees clean text
    clean_text = re.sub(
        r"^(?:HIRE|APPLY|EMAIL HR|EMAIL|JOB)\s+", "", text, flags=re.IGNORECASE
    ).strip()

    return await _handle_new_job(
        from_chat_id=from_chat_id,
        text=clean_text or text,
        hr_email=hr_email,
        db_get=db_get,
        insert_row=insert_row,
        select_rows=select_rows,
    )


# ---------------------------------------------------------------------------
# State handlers
# ---------------------------------------------------------------------------

async def _handle_new_job(
    from_chat_id: str,
    text: str,
    hr_email: str | None,
    db_get,
    insert_row,
    select_rows,
) -> str:
    from src.agents.job_extractor import JobExtractorAgent
    from src.llm.gemini import tailor_resume, write_application_email, get_relevant_resume_context

    # Load profile — single-user: first profile; multi-user: match by phone
    profiles = await select_rows("profiles")
    if not profiles:
        return (
            "No profile found. Set up your profile at the dashboard first, "
            "then forward a job message."
        )

    # Try to match by phone number (strip WhatsApp suffix @c.us / @g.us)
    phone_digits = re.sub(r"\D", "", from_chat_id)
    matched = [
        p for p in profiles
        if re.sub(r"\D", "", p.get("phone") or "")[-9:] == phone_digits[-9:]
    ]
    profile = matched[0] if matched else profiles[0]

    if not profile.get("resume_text"):
        return (
            "No resume found on your profile. "
            "Upload your CV at the dashboard, then try again."
        )

    # Acknowledge immediately (extraction + tailoring takes ~30s)
    # We can't send mid-processing since we return a single reply,
    # so we note that in the preview when done.

    # Extract job details
    extractor = JobExtractorAgent()
    try:
        job = await extractor.extract_from_text(text)
    except Exception as exc:
        log.error("Job extraction failed: %s", exc)
        return f"⚠️ Couldn't parse job details: {exc}"

    # HR email priority:
    #   1. AI-extracted (understands context: "apply to X", "contact Y at Z@domain")
    #   2. Sidecar regex (HR-prefix-preferred scan of the raw message body)
    #   3. Python-side regex scan of the full original text (catches what sidecar missed)
    #   4. Hunter.io domain search
    final_hr_email = (
        job.get("hr_email")
        or hr_email
        or _scan_for_email(text)
        or await extractor.find_hr_email(
            company=job.get("company", ""),
            domain=job.get("source_domain"),
            hr_name=job.get("hr_name"),
        )
        or ""
    )
    # Normalize any Unicode-styled characters the AI or sidecar passed through
    # e.g. 𝗵𝗶𝗿𝗶𝗻𝗴@𝘇𝗮𝗮𝗿𝗶𝗰-𝗮𝗶.𝗰𝗼𝗺 → hiring@zaaric-ai.com
    if final_hr_email:
        final_hr_email = _normalize_unicode(final_hr_email).strip()

    # Use embeddings to pull the most relevant resume sections for this JD
    jd = job.get("description") or text[:3_000]
    relevant_resume = await get_relevant_resume_context(profile["resume_text"], jd)
    profile_ctx = {**profile, "resume_text": relevant_resume}
    job_ctx = {**job, "description": jd}

    try:
        tailored, email_body_content = await asyncio.gather(
            tailor_resume(relevant_resume, jd),
            write_application_email(profile_ctx, job_ctx),
        )
    except Exception as exc:
        log.error("Email generation failed: %s", exc)
        if "rate_limit_both_keys" in str(exc):
            from src.llm.gemini import _friendly_rate_limit_message
            return _friendly_rate_limit_message()
        return (
            "⚠️ *Could not generate email draft*\n\n"
            f"Reason: {type(exc).__name__}\n"
            "Please try again in a few minutes."
        )

    # Build full email
    name      = profile.get("full_name", "Candidate")
    email_addr = profile.get("email", "")
    phone_str  = profile.get("phone", "")
    contact    = " | ".join(filter(None, [email_addr, phone_str]))
    hr_name    = job.get("hr_name") or "Hiring Manager"
    subject    = (
        f"Application – {job.get('job_title', 'Role')} "
        f"at {job.get('company', 'Your Company')}"
    )
    email_body = (
        f"Dear {hr_name},\n\n"
        f"{email_body_content}\n\n"
        f"Best regards,\n{name}\n{contact}"
    )

    # Persist draft
    draft = await insert_row("email_drafts", {
        "user_id": profile.get("user_id"),
        "source": "whatsapp",
        "from_phone": from_chat_id,
        "job_title": job.get("job_title"),
        "company": job.get("company"),
        "job_description": jd[:4_000],
        "hr_email": final_hr_email,
        "hr_name": job.get("hr_name"),
        "subject": subject,
        "email_body": email_body,
        "tailored_resume": tailored,
        "source_url": job.get("source_url"),
        "source_message": text[:2_000],
        "status": "pending_approval",
    })

    return _draft_preview(draft)


async def _handle_approve(draft: dict, db_get) -> str:
    if not draft.get("hr_email"):
        return (
            "⚠️ No HR email on this draft.\n"
            "Reply: EDIT: hr_email = someone@company.com"
        )

    if not draft.get("user_id"):
        return "⚠️ Draft has no user_id — can't send email. Set up your profile first."

    from src.db.client import select_rows as _select
    tokens = await _select("oauth_tokens", filters={"user_id": draft["user_id"], "provider": "gmail"})
    if not tokens:
        return (
            "⚠️ Gmail not connected.\n"
            "Go to the dashboard → Integrations and connect your Gmail account first."
        )

    db = await db_get()
    try:
        from src.integrations.gmail import send_email_draft
        msg_id = await send_email_draft(draft)
    except Exception as exc:
        log.error("Email send failed for draft %s: %s", draft["id"], exc)
        await db.table("email_drafts").update({
            "status": "failed",
            "error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft["id"]).execute()
        return f"⚠️ Send failed: {exc}\nCheck your Gmail connection in the dashboard."

    await db.table("email_drafts").update({
        "status": "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "gmail_message_id": msg_id,
        "error": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", draft["id"]).execute()

    role = draft.get("job_title") or "the role"
    company = draft.get("company") or "the company"
    return (
        f"✅ Email sent to {draft['hr_email']} for {role} @ {company}!\n\n"
        "Forward another job message any time."
    )


async def _handle_edit(draft: dict, note: str, db_get) -> str:
    """Apply an edit instruction (field override or Gemini-assisted rewrite)."""
    db = await db_get()
    update: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}

    # Simple field overrides: "hr_email = foo@bar.com"
    if "=" in note and not note.lower().startswith("rewrite"):
        key, _, val = note.partition("=")
        key = key.strip().lower().replace(" ", "_")
        val = val.strip()
        allowed = {"hr_email", "subject", "hr_name", "company", "job_title"}
        if key in allowed:
            update[key] = val
            draft[key] = val
            await db.table("email_drafts").update(update).eq("id", draft["id"]).execute()
            return _draft_preview(draft)
        # Unknown field name — tell the user what's valid instead of silently
        # passing "unknown_key = value" to Gemini as a rewrite instruction.
        return (
            f"⚠️ Unknown field: *{key}*\n"
            f"Editable fields: {', '.join(sorted(allowed))}\n\n"
            "Or send *EDIT: <instruction>* to rewrite the email body, "
            "e.g. *EDIT: make it shorter and more formal*"
        )

    # Gemini-assisted body rewrite
    from src.llm.gemini import _get_client, _groq_generate, _is_gemini_retriable
    from google.genai import types

    system = "You are a professional email editor. Follow the instruction exactly. Return only the revised email body text, nothing else."
    prompt = (
        f"Here is a job application email body:\n\n"
        f"{draft.get('email_body', '')}\n\n"
        f"Apply this change and return ONLY the revised email body:\n{note}"
    )
    new_body: str | None = None
    try:
        client = _get_client()
        resp = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system),
        )
        new_body = (resp.text or "").strip() or None
    except Exception as exc:
        if settings.groq_configured and _is_gemini_retriable(exc):
            try:
                new_body = (await _groq_generate(system, prompt)).strip() or None
            except Exception as groq_exc:
                log.warning("Email revision Groq fallback failed: %s", groq_exc)
        else:
            log.warning("Email revision failed: %s", exc)

    if not new_body:
        return (
            "⚠️ *Couldn't rewrite the email right now* — AI service is busy.\n\n"
            "Try again in a few minutes, or use a field override:\n"
            "*EDIT: hr_email = someone@company.com*"
        )

    update["email_body"] = new_body
    draft["email_body"] = new_body
    await db.table("email_drafts").update(update).eq("id", draft["id"]).execute()
    return _draft_preview(draft)


# ---------------------------------------------------------------------------
# Form flow handlers
# ---------------------------------------------------------------------------

async def _handle_form_url(
    from_chat_id: str,
    form_url: str,
    db_get,
    insert_row,
    select_rows,
) -> str:
    """
    Fetch a Google Form, propose fills from the user's profile using one AI call,
    store the result, and ask for YES/NO confirmation before submitting.
    """
    from src.agents.form_filler import FormFillerAgent

    profiles = await select_rows("profiles")
    if not profiles:
        return (
            "No profile found. Set up your profile at the dashboard first, "
            "then send the form link again."
        )
    profile = profiles[0]

    try:
        agent = FormFillerAgent()
        result = await agent.analyze(form_url, profile_id=profile.get("id"))
    except ValueError as exc:
        return f"⚠️ {exc}"
    except Exception as exc:
        log.error("Form analysis failed for %s: %s", form_url, exc)
        return (
            "⚠️ *Couldn't fetch that form.*\n\n"
            "Make sure the form is public (anyone with link) and try again."
        )

    fills = result.get("proposed_fills", [])
    form_title = result.get("form_title", "Google Form")

    import json as _json

    # Fields we couldn't fill from profile — ask user to provide them
    missing = [f for f in fills if not (f.get("value") or "").strip()]

    if len(missing) >= 2:
        # Store missing question labels separately in source_message for the info handler
        draft = await insert_row("email_drafts", {
            "user_id": profile.get("user_id"),
            "source": "whatsapp_form",
            "from_phone": from_chat_id,
            "job_title": form_title,
            "source_url": form_url,
            "job_description": _json.dumps(fills),
            "source_message": _json.dumps([f.get("question", "?") for f in missing[:8]]),
            "status": "pending_form_info",
        })
        return _form_info_request(form_title, fills, missing)
    else:
        # All (or almost all) fields filled — go straight to confirmation
        draft = await insert_row("email_drafts", {
            "user_id": profile.get("user_id"),
            "source": "whatsapp_form",
            "from_phone": from_chat_id,
            "job_title": form_title,
            "source_url": form_url,
            "job_description": _json.dumps(fills),
            "status": "pending_form_confirm",
        })
        return _form_preview(draft, fills, form_title)


async def _handle_form_confirm(draft: dict, db_get) -> str:
    """Submit the form using the stored proposed fills."""
    import json as _json
    from src.agents.form_filler import FormFillerAgent
    from src.config import settings as _settings

    form_url = draft.get("source_url", "")
    if not form_url:
        return "⚠️ Form URL missing from draft. Please send the form link again."

    try:
        fills = _json.loads(draft.get("job_description") or "[]")
    except Exception:
        fills = []

    if not fills:
        return "⚠️ No proposed fills found. Please send the form link again."

    dry_run = _settings.dry_run
    try:
        agent = FormFillerAgent()
        result = await agent.submit(
            url=form_url,
            fills=fills,
            dry_run=dry_run,
        )
    except Exception as exc:
        log.error("Form submission failed: %s", exc)
        db = await db_get()
        await db.table("email_drafts").update({
            "status": "failed",
            "error": str(exc),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft["id"]).execute()
        return f"⚠️ *Form submission failed:* {exc}"

    db = await db_get()
    await db.table("email_drafts").update({
        "status": "dry_run" if dry_run else "sent",
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", draft["id"]).execute()

    filled = result.get("filled_count", 0)
    total  = len(fills)
    errors = result.get("errors", [])

    if dry_run:
        return (
            f"🔍 *Dry-run complete — {draft.get('job_title', 'Form')}*\n\n"
            f"Would fill *{filled}/{total}* fields.\n"
            f"{'⚠️ Some fields could not be filled.' if errors else '✅ All fields ready.'}\n\n"
            "DRY_RUN is ON — no real submission was made.\n"
            "Turn it off in Dashboard → Settings to submit for real."
        )

    if result.get("submitted"):
        return (
            f"✅ *Form submitted — {draft.get('job_title', 'Form')}*\n\n"
            f"Filled *{filled}/{total}* fields successfully."
        )

    err_summary = "; ".join(e.get("error", "") for e in errors[:3])
    return (
        f"⚠️ *Submission incomplete — {draft.get('job_title', 'Form')}*\n\n"
        f"Filled {filled}/{total} fields.\n"
        f"Errors: {err_summary or 'unknown'}\n\n"
        "Check the Forms page on the dashboard for details."
    )


async def _handle_form_info(draft: dict, user_reply: str, db_get) -> str:
    """
    User has replied with info for missing form fields (or a transcribed voice note).
    Use AI to extract field values, update fills, and either ask for more or
    advance to pending_form_confirm.
    """
    import json as _json
    import re as _re
    from src.llm.gemini import _get_client, _groq_generate, _is_gemini_retriable
    from google.genai import types

    try:
        fills = _json.loads(draft.get("job_description") or "[]")
        missing_questions = _json.loads(draft.get("source_message") or "[]")
    except Exception:
        fills = []
        missing_questions = []

    if not missing_questions:
        # Shouldn't happen — just advance to confirm
        db = await db_get()
        await db.table("email_drafts").update({
            "status": "pending_form_confirm",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft["id"]).execute()
        draft["status"] = "pending_form_confirm"
        return _form_preview(draft, fills)

    # Build question list with options (for choice-type fields) so the AI
    # can map "option 2" or "Yes" back to the correct option string.
    entry_to_fill = {(f.get("question") or "").lower(): f for f in fills}
    q_lines: list[str] = []
    for q in missing_questions[:10]:
        fill = entry_to_fill.get(q.lower(), {})
        opts = fill.get("options") or []
        q_type = fill.get("type", "")
        if opts and q_type in ("multiple_choice", "dropdown", "checkboxes"):
            opts_str = " | ".join(f'"{o}"' for o in opts[:8])
            q_lines.append(f"- {q}  [options: {opts_str}]")
        else:
            q_lines.append(f"- {q}")
    q_list = "\n".join(q_lines)

    system = (
        "You extract form field values from user replies. "
        "For choice questions the user may say the option text, a number (1, 2, 3…), "
        "or a short alias — map it to the exact option string shown in brackets. "
        "Return ONLY a valid JSON object mapping each question label to the chosen value. "
        'Example: {"Full Name": "Ahmed Ali", "Current Salary": "80000 PKR", "Gender": "Male"}'
    )
    prompt = (
        f"A form has these unfilled questions (choice options shown where applicable):\n{q_list}\n\n"
        f"The user replied: {user_reply}\n\n"
        "Extract any values you can find and map them to the question labels. "
        "Return ONLY a JSON object."
    )

    extracted: dict = {}
    try:
        client = _get_client()
        resp = await client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(system_instruction=system),
        )
        raw = (resp.text or "").strip()
        m = _re.search(r'\{[^{}]+\}', raw, _re.DOTALL)
        if m:
            extracted = _json.loads(m.group(0))
    except Exception as exc:
        if settings.groq_configured and _is_gemini_retriable(exc):
            try:
                raw = await _groq_generate(system, prompt)
                m = _re.search(r'\{[^{}]+\}', raw, _re.DOTALL)
                if m:
                    extracted = _json.loads(m.group(0))
            except Exception:
                pass
        else:
            log.warning("Form info extraction failed: %s", exc)

    # Apply extracted values to fills
    updated_count = 0
    for fill in fills:
        q = (fill.get("question") or "").lower()
        for key, val in extracted.items():
            if key.lower() in q or q in key.lower():
                if val and not (fill.get("value") or "").strip():
                    fill["value"] = str(val).strip()
                    updated_count += 1
                    break

    still_missing_fills = [f for f in fills if not (f.get("value") or "").strip()]
    still_missing = [f.get("question", "?") for f in still_missing_fills]

    db = await db_get()
    if still_missing and len(still_missing) >= 2:
        await db.table("email_drafts").update({
            "job_description": _json.dumps(fills),
            "source_message": _json.dumps(still_missing[:8]),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft["id"]).execute()
        lines = [f"✅ Got {updated_count} answer(s). Still need:\n"]
        for f in still_missing_fills:
            q_text = (f.get("question") or "?")[:70]
            opts = f.get("options") or []
            q_type = f.get("type", "")
            if opts and q_type in ("multiple_choice", "dropdown", "checkboxes"):
                opt_line = "  ".join(f"*{i+1}.* {o}" for i, o in enumerate(opts))
                lines.append(f"• {q_text}")
                lines.append(f"  {opt_line}")
            else:
                lines.append(f"• {q_text}")
        lines.append("\nReply with the remaining info, or *SKIP* to submit with what I have, or *NO* to cancel.")
        return "\n".join(lines)
    else:
        # Ready — advance to confirm
        await db.table("email_drafts").update({
            "job_description": _json.dumps(fills),
            "status": "pending_form_confirm",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", draft["id"]).execute()
        draft["job_description"] = _json.dumps(fills)
        return _form_preview(draft, fills)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def _form_info_request(form_title: str, fills: list, missing: list) -> str:
    """Ask the user to provide values for fields the agent couldn't fill."""
    filled_count = len([f for f in fills if (f.get("value") or "").strip()])
    total = len(fills)
    lines = [
        f"*📋 {form_title}*\n",
        f"I filled *{filled_count}/{total}* fields from your profile.\n",
        "*I need your help with:*",
    ]
    for f in missing:
        q_text = (f.get("question") or f.get("title") or "?")[:70]
        opts = f.get("options") or []
        q_type = f.get("type", "")
        if opts and q_type in ("multiple_choice", "dropdown", "checkboxes"):
            opt_lines = "  ".join(f"*{i+1}.* {o}" for i, o in enumerate(opts))
            lines.append(f"• {q_text}")
            lines.append(f"  {opt_lines}")
        else:
            lines.append(f"• {q_text}")
    lines += [
        "",
        "Reply with the missing info (text or voice note).",
        "_Example: \"Full name: Ahmed Ali, current salary: 80k, availability: immediate\"_",
        "",
        "────────────────",
        "Reply *SKIP* to submit with only what I know ⚡",
        "Reply *NO* to cancel ❌",
    ]
    return "\n".join(lines)


def _form_preview(draft: dict, fills: list | None = None, form_title: str | None = None) -> str:
    """Show proposed form fills and ask for YES/NO confirmation."""
    import json as _json
    title = form_title or draft.get("job_title") or "Google Form"
    if fills is None:
        try:
            fills = _json.loads(draft.get("job_description") or "[]")
        except Exception:
            fills = []

    lines = [f"*📋 Form detected — {title}*\n"]
    if fills:
        lines.append("*Proposed answers:*")
        for f in fills:
            q = (f.get("question") or f.get("entry_id") or "?")[:60]
            v = (f.get("value") or "—")[:80]
            lines.append(f"• {q}\n  → _{v}_")
    else:
        lines.append("_No fields detected — the form may require a Google account to view._")

    lines += [
        "",
        "────────────────",
        "Reply *YES* to submit with these details ✅",
        "Reply *NO* to cancel ❌",
    ]
    return "\n".join(lines)


def _draft_preview(draft: dict) -> str:
    role = draft.get("job_title") or "Role"
    company = draft.get("company") or "Company"
    hr_email = draft.get("hr_email") or ""
    subject = draft.get("subject") or ""
    body = draft.get("email_body") or ""
    preview = body[:500] + ("…" if len(body) > 500 else "")

    if hr_email:
        to_line = f"To: {hr_email}"
        action_hint = (
            "────────────────\n"
            "Reply:\n"
            "• *APPROVE* — send this email now ✅\n"
            "• *EDIT: make it shorter* — revise the body\n"
            "• *EDIT: hr_email = someone@company.com* — change recipient\n"
            "• *REJECT* — cancel this draft ❌"
        )
    else:
        to_line = "To: ⚠️ *No HR email found*"
        action_hint = (
            "────────────────\n"
            "📧 *Reply with the HR/recruiter email address to send this to.*\n"
            "_Example: hiring@company.com_\n\n"
            "Or:\n"
            "• *EDIT: make it shorter* — revise the body\n"
            "• *REJECT* — cancel this draft ❌"
        )

    return (
        f"*Draft ready — {role} @ {company}*\n\n"
        f"{to_line}\n"
        f"Subject: {subject}\n\n"
        f"{preview}\n\n"
        f"{action_hint}"
    )
