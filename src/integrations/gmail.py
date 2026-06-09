"""Gmail integration — OAuth2 connect, inbox scan, and email send.

OAuth2 flow:
  1. GET  /auth/gmail/connect?user_id=X  → returns {auth_url}
  2. User visits auth_url in browser, grants access
  3. Google redirects to GET /auth/gmail/callback?code=Y&state=X
  4. Backend exchanges code → stores refresh token in oauth_tokens table
  5. All future reads/sends use stored refresh token

Reading inbox:
  GET /gmail/scan?user_id=X  → returns list of job-related email summaries

Sending:
  Called internally by whatsapp.py and the /email-drafts/{id}/send endpoint.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from src.config import settings

log = logging.getLogger(__name__)

_GMAIL_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",    # mark as read
]

# Subject-only pre-filter — must match at least one hiring/interview signal.
# Applied ONLY to the subject line so body content can't create false positives.
_JOB_SUBJECT_RE = re.compile(
    r"\b(interview|job offer|position|hiring|recruiter|opportunit"
    r"|we.{0,8}like to|interested in your|your (profile|background|experience)"
    r"|connect with you|role at|opening at|vacancy)\b",
    re.IGNORECASE,
)

# Senders that are always automated — skip without even fetching body.
_AUTOMATED_SENDER_RE = re.compile(
    r"noreply|no-reply|donotreply|do-not-reply"
    r"|notifications?@|alerts?@|mailer@|jobs-noreply|careers-noreply",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# OAuth2 helpers
# ---------------------------------------------------------------------------

def get_auth_url(user_id: str, redirect_uri: str | None = None) -> str:
    """Generate the Google OAuth2 consent URL (no PKCE — web server flow with client_secret)."""
    import urllib.parse
    params = {
        "client_id": settings.gmail_client_id,
        "redirect_uri": redirect_uri or settings.gmail_redirect_uri,
        "response_type": "code",
        "scope": " ".join(_GMAIL_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": user_id,
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)


async def exchange_code(code: str, user_id: str, db_get, upsert_row, redirect_uri: str | None = None) -> dict[str, Any]:
    """Exchange an OAuth2 code for tokens via direct HTTP (avoids PKCE mismatch)."""
    from datetime import timedelta
    import httpx

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.gmail_client_id,
                "client_secret": settings.gmail_client_secret,
                "redirect_uri": redirect_uri or settings.gmail_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        tokens = resp.json()

    access_token = tokens["access_token"]
    refresh_token = tokens.get("refresh_token", "")
    expires_in = tokens.get("expires_in", 3600)
    expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Fetch the connected Gmail address
    async with httpx.AsyncClient(timeout=10) as client:
        profile_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        profile_data = profile_resp.json()
    gmail_email = profile_data.get("email", "")

    await upsert_row("oauth_tokens", {
        "user_id": user_id,
        "provider": "gmail",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expiry.isoformat(),
        "scope": tokens.get("scope", " ".join(_GMAIL_SCOPES)),
        "email": gmail_email,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id,provider")

    return {"connected": True, "gmail_email": gmail_email}


async def disconnect_gmail(user_id: str, db_get) -> None:
    """Remove stored Gmail token."""
    db = await db_get()
    await db.table("oauth_tokens").delete().eq("user_id", user_id).eq("provider", "gmail").execute()


# ---------------------------------------------------------------------------
# Credential loader
# ---------------------------------------------------------------------------

async def _load_credentials(user_id: str, select_rows):
    """Load and refresh stored OAuth2 credentials for a user."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    rows = await select_rows("oauth_tokens", filters={"user_id": user_id, "provider": "gmail"})
    if not rows:
        raise ValueError(f"No Gmail token for user {user_id!r}. Connect Gmail first.")

    row = rows[0]

    # Reconstruct expiry so the library knows when to refresh.
    # google-auth uses timezone-naive UTC datetimes internally; always normalise.
    expiry = None
    if row.get("expires_at"):
        try:
            expiry = datetime.fromisoformat(row["expires_at"])
            if expiry.tzinfo is not None:
                expiry = expiry.astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            pass

    creds = Credentials(
        token=row["access_token"],
        refresh_token=row["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.gmail_client_id,
        client_secret=settings.gmail_client_secret,
        scopes=_GMAIL_SCOPES,
        expiry=expiry,
    )

    if not creds.valid:
        if not creds.refresh_token:
            raise ValueError("Gmail token expired and no refresh token available. Reconnect Gmail.")
        await asyncio.to_thread(creds.refresh, Request())
        # Persist the new access token so the next call won't need to refresh.
        try:
            from src.db.client import upsert_row as _upsert
            await _upsert("oauth_tokens", {
                "user_id": user_id,
                "provider": "gmail",
                "access_token": creds.token,
                "expires_at": creds.expiry.isoformat() if creds.expiry else None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, on_conflict="user_id,provider")
        except Exception as exc:
            log.warning("Could not persist refreshed Gmail token: %s", exc)

    return creds


# ---------------------------------------------------------------------------
# Inbox scan
# ---------------------------------------------------------------------------

async def scan_inbox(user_id: str, select_rows, insert_row, max_results: int = 30) -> list[dict[str, Any]]:
    """
    Scan Gmail strictly for inbound job opportunity emails (recruiter reach-outs,
    interview invites, job offers).  Filters out digests, ATS confirmations,
    newsletters, and promotional mail using both a tight Gmail query and an LLM
    classifier before creating any draft.
    """
    from googleapiclient.discovery import build

    creds = await _load_credentials(user_id, select_rows)
    service = await asyncio.to_thread(build, "gmail", "v1", credentials=creds)

    # Gmail query — catch recruiter reach-outs whether subject is specific or generic.
    # Positive: hiring signal in EITHER the subject line OR the email body.
    # Negative: strip newsletters, ATS auto-confirmations, automated senders.
    query = (
        # Positive gate — subject OR body must contain a hiring signal
        "("
        "subject:(\"interview\" OR \"job offer\" OR \"job opportunity\" OR \"career opportunity\" "
        "OR \"exciting opportunity\" OR \"we'd like to\" OR \"I came across your profile\" "
        "OR \"position at\" OR \"role at\" OR \"opening at\" OR \"hiring\" "
        "OR \"reaching out\" OR \"your profile\" OR \"your background\") "
        "OR "
        "(\"engineering team\" OR \"introductory call\" OR \"growing our team\" "
        "OR \"joining our team\" OR \"talent acquisition\" OR \"your skillset\" "
        "OR \"your experience\" OR \"fit for the role\" OR \"connect with you\" "
        "OR \"great fit for\" OR \"we are looking for\" OR \"job opportunity\" "
        "OR \"career opportunity\" OR \"I came across your\" OR \"your resume\" "
        "OR \"your background\" OR \"your portfolio\" OR \"we are hiring\" "
        "OR \"open to new opportunities\" OR \"job opening\") "
        ") "
        # Negative: exclude automated / bulk mail
        "-subject:(\"job alert\" OR \"jobs matching\" OR \"new jobs for you\" "
        "OR \"jobs you might\" OR \"daily digest\" OR \"weekly digest\" "
        "OR \"application received\" OR \"thank you for applying\" "
        "OR \"we received your application\" OR \"application submitted\" "
        "OR \"your application to\" OR \"application update\" "
        "OR \"unsubscribe\" OR \"newsletter\" OR \"job recommendations\" "
        "OR \"login alert\" OR \"security alert\" OR \"otp\" "
        "OR \"verification code\" OR \"transaction alert\" OR \"password reset\" "
        "OR \"account alert\" OR \"sign-in\" OR \"access request\" "
        "OR \"invoice\" OR \"receipt\" OR \"payment\" OR \"order confirmation\") "
        "-from:(noreply OR no-reply OR donotreply OR do-not-reply "
        "OR notifications OR alerts OR mailer OR jobs-noreply OR no_reply) "
        "is:inbox "
        "newer_than:30d"
    )
    results = await asyncio.to_thread(
        lambda: service.users().messages().list(
            userId="me", q=query, maxResults=max_results,
        ).execute()
    )
    messages = results.get("messages", [])
    summaries = []

    for msg_meta in messages:
        try:
            summary = await _parse_gmail_message(service, msg_meta["id"], user_id, select_rows, insert_row)
            if summary:
                summaries.append(summary)
        except Exception as exc:
            log.warning("Failed to parse Gmail message %s: %s", msg_meta["id"], exc)

    return summaries


async def _parse_gmail_message(
    service: Any,
    msg_id: str,
    user_id: str,
    select_rows,
    insert_row,
) -> dict[str, Any] | None:
    """
    Parse a single Gmail message and save it as a 'lead' (no AI generation yet).
    1. Automated-sender guard.
    2. Subject-only regex pre-filter.
    3. LLM classify as interview | opportunity | other.
    4. Save raw lead — user selects which leads to generate drafts for.
    """
    from src.llm.gemini import classify_and_type_email

    msg = await asyncio.to_thread(
        lambda: service.users().messages().get(userId="me", id=msg_id, format="full").execute()
    )
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    subject  = headers.get("subject", "")
    sender   = headers.get("from", "")
    date_str = headers.get("date", "")

    # ── 1. Automated-sender guard — no body needed ─────────────────────────────
    if _AUTOMATED_SENDER_RE.search(sender):
        log.debug("Skipping %s — automated sender: %s", msg_id, sender)
        return None

    body_text = _extract_body(msg.get("payload", {}))

    # ── 2. Subject pre-filter — skip only when subject is long AND has no signal.
    #       Short subjects (≤ 8 chars, e.g. "Hr", "Hi", "Hello") pass through
    #       to the LLM; they often come from personal recruiter reach-outs.
    subject_stripped = subject.strip()
    if len(subject_stripped) > 8 and not _JOB_SUBJECT_RE.search(subject_stripped):
        # Also pass through if body has strong recruiter signals
        _BODY_SIGNAL_RE = re.compile(
            r"\b(engineering team|introductory call|growing our team|joining our team"
            r"|talent acquisition|fit for the role|great fit for|we are looking"
            r"|job opportunity|career opportunity|your background|your skillset"
            r"|your experience|your resume|we are hiring|job opening)\b",
            re.IGNORECASE,
        )
        if not _BODY_SIGNAL_RE.search(body_text[:1_000]):
            log.debug("Skipping %s — subject+body failed pre-filter: %s", msg_id, subject[:80])
            return None

    # ── 3. LLM classifier ──────────────────────────────────────────────────────
    is_job, email_type = await classify_and_type_email(subject, body_text, sender)
    if not is_job:
        log.info("Skipping %s (%s) — classified as: %s", msg_id, subject[:60], email_type)
        return None

    log.info("Saving lead %s (%s) — type: %s", msg_id, subject[:60], email_type)

    # ── 4. Avoid duplicates ─────────────────────────────────────────────────────
    existing = await select_rows("email_drafts", filters={"gmail_message_id": msg_id})
    if existing:
        return {
            "gmail_message_id": msg_id,
            "subject": subject,
            "from": sender,
            "date": date_str,
            "draft_id": existing[0]["id"],
            "status": existing[0]["status"],
            "email_type": email_type,
        }

    # ── 5. Quick job metadata extract (no resume/AI draft yet) ─────────────────
    from src.agents.job_extractor import JobExtractorAgent
    extractor = JobExtractorAgent()
    try:
        job = await extractor.extract_from_text(f"Subject: {subject}\n\n{body_text[:3_000]}")
    except Exception:
        job = {}

    sender_email_m = re.search(r"<([^>]+)>", sender)
    sender_email = sender_email_m.group(1) if sender_email_m else sender
    subject_reply = f"Re: {subject}" if not subject.lower().startswith("re:") else subject

    # Save as 'lead' — draft body will be generated when the user selects this lead.
    lead = await insert_row("email_drafts", {
        "user_id": user_id,
        "source": "gmail_scan",
        "job_title": job.get("job_title") or subject,
        "company": job.get("company") or _extract_sender_name(sender),
        "job_description": (job.get("description") or body_text[:3_000])[:4_000],
        "hr_email": sender_email,
        "hr_name": job.get("hr_name"),
        "subject": subject_reply,
        "email_body": "",
        "source_message": body_text[:2_000],
        "gmail_message_id": msg_id,
        "status": "lead",
        "email_type": email_type,
    })

    return {
        "gmail_message_id": msg_id,
        "subject": subject,
        "from": sender,
        "date": date_str,
        "draft_id": lead["id"],
        "status": "lead",
        "email_type": email_type,
        "job_title": job.get("job_title"),
        "company": job.get("company"),
    }


async def generate_draft_from_lead(lead: dict[str, Any], select_rows, update_fn) -> dict[str, Any]:
    """
    Run full AI draft generation for a saved lead and upgrade it to pending_approval.
    Called when the user selects a lead to follow up on.
    """
    from src.llm.gemini import (
        get_relevant_resume_context,
        tailor_resume,
        write_application_email,
        write_interview_reply,
    )

    user_id   = lead["user_id"]
    email_type = lead.get("email_type") or "opportunity"
    body_text  = lead.get("source_message") or ""
    jd         = lead.get("job_description") or body_text[:3_000]
    subject    = lead.get("subject") or ""
    sender_email = lead.get("hr_email") or ""

    profiles = await select_rows("profiles", filters={"user_id": user_id})
    profile  = profiles[0] if profiles else None
    name     = (profile or {}).get("full_name", "Candidate")
    email_addr = (profile or {}).get("email", "")
    phone    = (profile or {}).get("phone", "")
    contact  = " | ".join(filter(None, [email_addr, phone]))
    hr_name  = lead.get("hr_name") or "Hiring Manager"

    relevant_resume = ""
    if profile and profile.get("resume_text"):
        try:
            relevant_resume = await get_relevant_resume_context(profile["resume_text"], jd)
        except Exception as exc:
            log.warning("Resume embedding failed: %s", exc)
            relevant_resume = (profile["resume_text"] or "")[:3_000]

    profile_ctx = {**(profile or {}), "resume_text": relevant_resume}
    tailored = ""
    full_email_body = ""

    if email_type == "interview":
        try:
            job = {"job_title": lead.get("job_title"), "company": lead.get("company"), "description": jd}
            email_body_content = await write_interview_reply(
                profile=profile_ctx,
                email_subject=subject,
                email_body=body_text,
                job=job,
            )
        except Exception as exc:
            log.warning("write_interview_reply failed: %s", exc)
            email_body_content = (
                f"Thank you for the interview invitation for the {lead.get('job_title') or 'role'} "
                f"at {lead.get('company') or 'your company'}. "
                "I am very excited about this opportunity and would be happy to proceed.\n\n"
                "Please share the preferred date, time, and format and I will confirm promptly."
            )
        full_email_body = f"Dear {hr_name},\n\n{email_body_content}\n\nBest regards,\n{name}\n{contact}"

    else:
        job_ctx = {"job_title": lead.get("job_title"), "company": lead.get("company"), "description": jd,
                   "hr_name": hr_name, "hr_email": sender_email}
        try:
            tailored, email_body_content = await asyncio.gather(
                tailor_resume(relevant_resume, jd) if relevant_resume else asyncio.sleep(0),
                write_application_email(profile_ctx, job_ctx),
            )
            if not isinstance(tailored, str):
                tailored = ""
        except Exception as exc:
            log.warning("Tailoring/email generation failed: %s", exc)
            email_body_content = ""

        full_email_body = (
            f"Dear {hr_name},\n\n"
            f"{email_body_content or 'Thank you for reaching out. I am very interested in this opportunity and have attached my CV for your review.'}\n\n"
            f"Best regards,\n{name}\n{contact}"
        )

    updated = await update_fn("email_drafts", lead["id"], {
        "email_body": full_email_body,
        "tailored_resume": tailored,
        "status": "pending_approval",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    return updated


# ---------------------------------------------------------------------------
# Send email
# ---------------------------------------------------------------------------

async def send_email_draft(draft: dict[str, Any]) -> str:
    """
    Send an email_draft via Gmail. Returns the Gmail message ID.
    Requires the draft to have a user_id with a connected Gmail token.
    Attaches the user's resume PDF if it exists in Supabase Storage.
    """
    from googleapiclient.discovery import build
    from src.db.client import select_rows, get_db

    user_id = draft.get("user_id")
    if not user_id:
        raise ValueError("Draft has no user_id — cannot send email")

    creds = await _load_credentials(user_id, select_rows)
    service = await asyncio.to_thread(build, "gmail", "v1", credentials=creds)

    # Try to attach the resume PDF from Supabase Storage
    attachment_bytes: bytes | None = None
    attachment_filename = "resume.pdf"

    resume_file_path = draft.get("resume_file_path")
    if not resume_file_path:
        # Fall back to looking up from profile.preferences
        profiles = await select_rows("profiles", filters={"user_id": user_id})
        if profiles:
            resume_file_path = (profiles[0].get("preferences") or {}).get("resume_file_path")

    if resume_file_path:
        try:
            db = await get_db()
            # resume_file_path is the full path WITHIN the "resumes" bucket,
            # e.g. "resumes/{profile_id}/{filename}" — do NOT strip the prefix,
            # that subfolder really exists inside the bucket.
            path = resume_file_path.lstrip("/")
            resp = await db.storage.from_("resumes").download(path)
            attachment_bytes = bytes(resp)
            attachment_filename = path.split("/")[-1] or "resume.pdf"
            log.info("Attaching resume %s (%d bytes)", attachment_filename, len(attachment_bytes))
        except Exception as exc:
            log.warning("Could not download resume for attachment: %s", exc)

    msg = _build_mime_message(
        to=draft["hr_email"],
        subject=draft["subject"],
        body=draft["email_body"],
        reply_to_msg_id=draft.get("gmail_message_id"),
        attachment_bytes=attachment_bytes,
        attachment_filename=attachment_filename,
    )

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = await asyncio.to_thread(
        lambda: service.users().messages().send(userId="me", body={"raw": raw}).execute()
    )
    return sent["id"]


async def send_email_for_user(
    user_id: str,
    to: str,
    subject: str,
    body: str,
    select_rows,
) -> str:
    """Generic send helper used by the manual send endpoint."""
    from googleapiclient.discovery import build

    creds = await _load_credentials(user_id, select_rows)
    service = await asyncio.to_thread(build, "gmail", "v1", credentials=creds)
    msg = _build_mime_message(to=to, subject=subject, body=body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = await asyncio.to_thread(
        lambda: service.users().messages().send(userId="me", body={"raw": raw}).execute()
    )
    return sent["id"]


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

_MIME_SUBTYPES = {
    ".pdf":  "pdf",
    ".doc":  "msword",
    ".docx": "vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt":  "plain",
}


def _build_mime_message(
    to: str,
    subject: str,
    body: str,
    reply_to_msg_id: str | None = None,
    attachment_bytes: bytes | None = None,
    attachment_filename: str = "resume.pdf",
) -> MIMEMultipart:
    msg = MIMEMultipart("mixed" if attachment_bytes else "alternative")
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to_msg_id:
        msg["In-Reply-To"] = reply_to_msg_id
        msg["References"] = reply_to_msg_id
    msg.attach(MIMEText(body, "plain", "utf-8"))
    if attachment_bytes:
        ext = "." + attachment_filename.rsplit(".", 1)[-1].lower() if "." in attachment_filename else ""
        subtype = _MIME_SUBTYPES.get(ext, "octet-stream")
        part = MIMEApplication(attachment_bytes, _subtype=subtype)
        part.add_header("Content-Disposition", "attachment", filename=attachment_filename)
        msg.attach(part)
    return msg


def _extract_body(payload: dict) -> str:
    """Recursively extract plain-text body from a Gmail message payload."""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if not data:
            return ""
        return base64.urlsafe_b64decode(data + "=" * ((4 - len(data) % 4) % 4)).decode("utf-8", errors="ignore")
    if mime in ("text/html",):
        data = payload.get("body", {}).get("data", "")
        if not data:
            return ""
        raw_html = base64.urlsafe_b64decode(data + "=" * ((4 - len(data) % 4) % 4)).decode("utf-8", errors="ignore")
        from bs4 import BeautifulSoup
        return BeautifulSoup(raw_html, "lxml").get_text(" ", strip=True)
    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text
    return ""


def _extract_sender_name(from_header: str) -> str:
    """Extract display name from 'Name <email>' header."""
    m = re.match(r"^(.+?)\s*<", from_header)
    return m.group(1).strip().strip('"') if m else from_header.split("@")[0]


async def _get_gmail_address(creds) -> str:
    """Fetch the email address for the connected Gmail account."""
    from googleapiclient.discovery import build
    service = await asyncio.to_thread(build, "gmail", "v1", credentials=creds)
    profile = await asyncio.to_thread(lambda: service.users().getProfile(userId="me").execute())
    return profile.get("emailAddress", "")


def _client_config() -> dict:
    return {
        "web": {
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.gmail_redirect_uri],
        }
    }
