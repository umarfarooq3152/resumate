"""Tailoring Agent — generates tailored resume + cover letter for approved matches.

Grounding rule: NEVER fabricate experience the candidate doesn't have.
Writes results to `applications` table with status='prepared'.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from src.agents.base import BaseAgent
from src.db.client import get_db, select_rows, upsert_row
from src.llm.gemini import tailor_resume, write_cover_letter, get_relevant_resume_context, precompute_resume_chunks
from src.messaging import bus

log = logging.getLogger(__name__)


class TailoringAgent(BaseAgent):
    name = "tailoring"

    def _register_subscriptions(self) -> None:
        bus.subscribe("match.apply", self._on_match_apply)

    async def _on_match_apply(self, event_type: str, payload: dict[str, Any]) -> None:
        """Triggered automatically when MatchingAgent decides to apply."""
        job_id: str = payload.get("job_id", "")
        if job_id:
            await self.tailor_for_job(job_id)

    async def run(self, job_ids: list[str] | None = None) -> None:
        """Tailor documents for all approved matches (or a specific list)."""
        if job_ids:
            for jid in job_ids:
                await self.tailor_for_job(jid)
            return

        # Find all matches with decision='apply' that have no application yet
        matches = await select_rows("matches", filters={"decision": "apply"})
        existing = {r["job_id"] for r in await select_rows("applications")}
        pending = [m for m in matches if m["job_id"] not in existing]

        if not pending:
            log.info("[tailoring] Nothing to tailor")
            await self.emit("tailoring.idle", {})
            return

        await self.emit("tailoring.started", {"count": len(pending)})
        for match in pending:
            await self.tailor_for_job(match["job_id"])
            await asyncio.sleep(6.0)  # 2 calls per job → ~10 RPM safe on free tier

        await self.emit("tailoring.completed", {"count": len(pending)})

    async def tailor_for_job(self, job_id: str) -> None:
        profile, job = await asyncio.gather(
            self._load_profile(),
            self._load_job(job_id),
        )
        if not profile or not job:
            log.warning("[tailoring] Missing profile or job for %s", job_id)
            return

        resume_text: str = profile.get("resume_text", "")
        jd: str = job.get("description", "")
        company: str = job.get("company", "")
        title: str = job.get("title", "")

        if not resume_text.strip():
            log.warning("[tailoring] Profile has no resume_text for job %s — skipping", job_id)
            return

        # Pre-warm the chunk cache so both tailor and cover letter calls share it.
        # get_relevant_resume_context() is then just a cosine-sort + concatenation.
        if len(resume_text) > 3_000:
            try:
                await precompute_resume_chunks(resume_text)
            except Exception as exc:
                log.warning("[tailoring] Chunk pre-computation failed (non-fatal): %s", exc)

        tailored, cover = await self._call_with_retry(resume_text, jd, company, title, job_id)
        if tailored is None or cover is None:
            return

        row = {
            "job_id": job_id,
            "tailored_resume": tailored,
            "cover_letter": cover,
            "status": "prepared",
            "submit_payload": {
                "company": company,
                "title": title,
                "apply_method": job.get("apply_method"),
                "apply_url": job.get("apply_url"),
            },
        }
        try:
            await upsert_row("applications", row, on_conflict="job_id")
            await self.emit("tailoring.done", {"job_id": job_id})
            log.info("[tailoring] prepared application for job %s", job_id)
        except Exception as exc:
            log.error("[tailoring] DB write failed for job %s: %s", job_id, exc)

    async def _load_profile(self) -> dict[str, Any] | None:
        rows = await select_rows("profiles", limit=1)
        return rows[0] if rows else None

    async def _load_job(self, job_id: str) -> dict[str, Any] | None:
        rows = await select_rows("jobs", filters={"id": job_id}, limit=1)
        return rows[0] if rows else None

    async def _call_with_retry(
        self, resume_text: str, jd: str, company: str, title: str, job_id: str
    ) -> tuple[str | None, str | None]:
        """Run tailor + cover letter with 3-attempt retry on 429."""
        for attempt in range(3):
            try:
                # Sequential calls to stay within free-tier RPM
                tailored = await tailor_resume(resume_text, jd)
                await asyncio.sleep(3.0)
                cover = await write_cover_letter(resume_text, jd, company, title)
                return tailored, cover
            except Exception as exc:
                msg = str(exc)
                if "rate_limit_both_keys" in msg:
                    log.warning("[tailoring] Both Groq keys exhausted for job %s — giving up", job_id)
                    await self.emit("tailoring.error", {"job_id": job_id, "error": "rate_limit_both_keys"})
                    return None, None
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    m = re.search(r"retryDelay.*?(\d+)s", msg)
                    wait = int(m.group(1)) + 2 if m else 60
                    log.warning("[tailoring] Rate limit hit job %s, waiting %ds (attempt %d/3)", job_id, wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                log.error("[tailoring] LLM error for job %s: %s", job_id, exc)
                await self.emit("tailoring.error", {"job_id": job_id, "error": str(exc)})
                return None, None
        log.warning("[tailoring] Exhausted retries for job %s — quota limit", job_id)
        await self.emit("tailoring.error", {"job_id": job_id, "error": "quota exhausted"})
        return None, None
