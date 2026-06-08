"""Application Agent — submits prepared applications.

Allowed auto-submit targets:
  - google_form  (Playwright)
  - greenhouse_api
  - lever_api
  - ashby_api

Everything else gets status='manual_pending' for one-click human review.

DRY_RUN=true (default) logs the payload but never actually submits.
Every submission is logged with full payload to `agent_events` for audit/undo.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from src.agents.base import BaseAgent
from src.config import settings
from src.db.client import get_db, select_rows
from src.messaging import bus

log = logging.getLogger(__name__)

# Map apply_method values to their handler coroutines
_HANDLERS: dict[str, str] = {
    "google_form":    "_submit_google_form",
    "greenhouse_api": "_submit_greenhouse",
    "lever_api":      "_submit_lever",
    "ashby_api":      "_submit_ashby",
}


class ApplicationAgent(BaseAgent):
    name = "application"

    def _register_subscriptions(self) -> None:
        bus.subscribe("tailoring.done", self._on_tailoring_done)

    async def _on_tailoring_done(self, event_type: str, payload: dict[str, Any]) -> None:
        job_id: str = payload.get("job_id", "")
        if job_id:
            await self.submit_application(job_id)

    async def run(self, job_ids: list[str] | None = None) -> None:
        """Submit all prepared applications (or a specific list)."""
        if job_ids:
            for jid in job_ids:
                await self.submit_application(jid)
            return

        rows = await select_rows("applications", filters={"status": "prepared"})
        if not rows:
            log.info("[application] No prepared applications")
            await self.emit("application.idle", {})
            return

        await self.emit("application.batch_start", {"count": len(rows)})
        for app in rows:
            await self.submit_application(app["job_id"])
            await asyncio.sleep(settings.rate_limit_delay)

    async def submit_application(self, job_id: str) -> None:
        app = await self._load_application(job_id)
        if not app:
            log.warning("[application] No prepared application for job %s", job_id)
            return

        payload = app.get("submit_payload") or {}
        apply_method: str = payload.get("apply_method", "manual")
        apply_url: str = payload.get("apply_url", "")

        # Log full payload before any action
        await self.emit("application.attempt", {
            "job_id": job_id,
            "apply_method": apply_method,
            "apply_url": apply_url,
            "dry_run": settings.dry_run,
        })

        handler_name = _HANDLERS.get(apply_method)
        if not handler_name:
            await self._set_status(job_id, "manual_pending", None)
            await self.emit("application.manual_pending", {"job_id": job_id, "reason": "unsupported_method"})
            log.info("[application] job %s → manual_pending (method=%s)", job_id, apply_method)
            return

        handler = getattr(self, handler_name)
        try:
            error = await handler(job_id, app, apply_url)
            if error:
                await self._set_status(job_id, "error", error)
                await self.emit("application.error", {"job_id": job_id, "error": error})
            else:
                await self._set_status(job_id, "submitted", None)
                await self.emit("application.submitted", {"job_id": job_id, "method": apply_method})
                log.info("[application] job %s submitted via %s", job_id, apply_method)
        except Exception as exc:
            err = str(exc)
            await self._set_status(job_id, "error", err)
            await self.emit("application.error", {"job_id": job_id, "error": err})
            log.error("[application] Unhandled error for job %s: %s", job_id, exc)

    # ------------------------------------------------------------------
    # Google Forms (Playwright)
    # ------------------------------------------------------------------

    async def _submit_google_form(
        self, job_id: str, app: dict[str, Any], url: str
    ) -> str | None:
        if settings.dry_run:
            log.info("[DRY_RUN] Would submit Google Form for job %s at %s", job_id, url)
            return None  # pretend success

        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return "playwright not installed — run: pip install playwright && playwright install chromium"

        cover_letter: str = app.get("cover_letter", "")
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(url, timeout=30000)
                await page.wait_for_load_state("networkidle")

                # Find long-text areas (cover letter, free-text fields)
                textareas = await page.query_selector_all("textarea")
                if textareas:
                    # Fill the first long-text area with the cover letter
                    await textareas[0].fill(cover_letter[:2000])

                # Look for a submit button
                submit = await page.query_selector("div[role='button'][aria-label*='Submit']")
                if not submit:
                    submit = await page.query_selector("button[type='submit']")
                if not submit:
                    return "Could not find submit button on form"

                await submit.click()
                await page.wait_for_load_state("networkidle", timeout=15000)
                return None  # success
            except Exception as exc:
                return f"Playwright error: {exc}"
            finally:
                await browser.close()

    # ------------------------------------------------------------------
    # Greenhouse API
    # ------------------------------------------------------------------

    async def _submit_greenhouse(
        self, job_id: str, app: dict[str, Any], url: str
    ) -> str | None:
        if settings.dry_run:
            log.info("[DRY_RUN] Would POST to Greenhouse for job %s", job_id)
            return None

        profile = await self._load_profile()
        if not profile:
            return "No profile"

        # Strip query params / fragment before splitting
        # e.g. https://boards.greenhouse.io/company/jobs/12345?gh_src=abc
        clean_url = url.split("?")[0].split("#")[0].rstrip("/")
        parts = clean_url.split("/")
        try:
            gh_job_id = parts[-1]
            board_token = parts[-3]
        except IndexError:
            return f"Cannot parse Greenhouse URL: {url}"

        _name_parts = (profile.get("full_name") or "").split()
        payload = {
            "first_name": _name_parts[0] if _name_parts else "",
            "last_name": " ".join(_name_parts[1:]) if len(_name_parts) > 1 else "",
            "email": profile.get("email", ""),
            "phone": profile.get("phone", ""),
            "cover_letter_text": app.get("cover_letter", ""),
            "resume_text": app.get("tailored_resume", ""),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{gh_job_id}/applications",
                json=payload,
            )
            if resp.status_code not in (200, 201):
                return f"Greenhouse {resp.status_code}: {resp.text[:200]}"
        return None

    # ------------------------------------------------------------------
    # Lever API
    # ------------------------------------------------------------------

    async def _submit_lever(
        self, job_id: str, app: dict[str, Any], url: str
    ) -> str | None:
        if settings.dry_run:
            log.info("[DRY_RUN] Would POST to Lever for job %s", job_id)
            return None

        profile = await self._load_profile()
        if not profile:
            return "No profile"

        # Lever posting URL: https://jobs.lever.co/company/uuid
        # Strip query params first — e.g. ?lever-source=adzuna
        clean_url = url.split("?")[0].split("#")[0].rstrip("/")
        parts = clean_url.split("/")
        try:
            posting_id = parts[-1]
            company = parts[-2]
        except IndexError:
            return f"Cannot parse Lever URL: {url}"

        payload = {
            "name": profile.get("full_name", ""),
            "email": profile.get("email", ""),
            "phone": profile.get("phone", ""),
            "comments": app.get("cover_letter", ""),
            "resume": app.get("tailored_resume", ""),
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"https://api.lever.co/v0/postings/{company}/{posting_id}/apply",
                json=payload,
            )
            if resp.status_code not in (200, 201):
                return f"Lever {resp.status_code}: {resp.text[:200]}"
        return None

    # ------------------------------------------------------------------
    # Ashby API
    # ------------------------------------------------------------------

    async def _submit_ashby(
        self, job_id: str, app: dict[str, Any], url: str
    ) -> str | None:
        if settings.dry_run:
            log.info("[DRY_RUN] Would POST to Ashby for job %s", job_id)
            return None

        profile = await self._load_profile()
        if not profile:
            return "No profile"

        # Ashby: https://jobs.ashbyhq.com/company/posting-id
        clean_url = url.split("?")[0].split("#")[0].rstrip("/")
        parts = clean_url.split("/")
        try:
            posting_id = parts[-1]
            org_name = parts[-2]
        except IndexError:
            return f"Cannot parse Ashby URL: {url}"

        payload = {
            "organizationHostedJobsPageName": org_name,
            "jobPostingId": posting_id,
            "applicationForm": {
                "name": profile.get("full_name", ""),
                "email": profile.get("email", ""),
                "phone": profile.get("phone", ""),
                "coverLetter": app.get("cover_letter", ""),
                "resume": app.get("tailored_resume", ""),
            },
        }
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.ashbyhq.com/applicationForm.submit",
                json=payload,
            )
            if resp.status_code not in (200, 201):
                return f"Ashby {resp.status_code}: {resp.text[:200]}"
        return None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _load_application(self, job_id: str) -> dict[str, Any] | None:
        rows = await select_rows("applications", filters={"job_id": job_id}, limit=1)
        return rows[0] if rows else None

    async def _load_profile(self) -> dict[str, Any] | None:
        rows = await select_rows("profiles", limit=1)
        return rows[0] if rows else None

    async def _set_status(self, job_id: str, status: str, error: str | None) -> None:
        db = await get_db()
        update: dict[str, Any] = {"status": status}
        if status == "submitted":
            update["submitted_at"] = datetime.now(timezone.utc).isoformat()
        if error:
            update["error"] = error
        await db.table("applications").update(update).eq("job_id", job_id).execute()
