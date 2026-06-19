"""Matching Agent — scores unmatched jobs against the user profile.

Uses Claude for semantic scoring + pgvector cosine similarity as a pre-filter.
Stores results in `matches` table.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from src.agents.base import BaseAgent
from src.db.client import get_db, select_rows, upsert_row
from src.llm.gemini import embed_text, score_job, precompute_resume_chunks

log = logging.getLogger(__name__)

MIN_SCORE = 60  # below this cosine similarity pre-filter score we skip immediately


class MatchingAgent(BaseAgent):
    name = "matching"

    async def run(self, profile_id: str | None = None, job_id: str | None = None, limit: int = 20) -> None:
        """Score unmatched jobs. If job_id is given, scores only that one job."""
        profile = await self._load_profile(profile_id)
        if not profile:
            log.error("No profile found — create one first via POST /profiles")
            return

        resume_text: str = profile.get("resume_text", "")
        if not resume_text:
            log.error("Profile has no resume_text")
            return

        # Embed resume once — both for pgvector storage and chunk-level retrieval cache.
        # precompute_resume_chunks() populates _CHUNK_CACHE so that every score_job()
        # call below only needs to embed the job description (not the resume chunks again).
        try:
            resume_embedding, _ = await asyncio.gather(
                embed_text(resume_text),
                precompute_resume_chunks(resume_text),
            )
        except Exception as exc:
            log.warning("[matching] Resume embedding failed (%s) — continuing without vector index", exc)
            resume_embedding = []
            await precompute_resume_chunks(resume_text)
        await self._update_profile_embedding(profile["id"], resume_embedding)

        # Fetch only the requested job, or all unmatched jobs
        if job_id:
            db = await get_db()
            resp = await db.table("jobs").select("*").eq("id", job_id).limit(1).execute()
            unmatched = resp.data or []
        else:
            unmatched = await self._fetch_unmatched_jobs(limit)

        if not unmatched:
            log.info("[matching] No unmatched jobs found")
            await self.emit("matching.idle", {})
            return

        await self.emit("matching.started", {"job_count": len(unmatched)})
        applied = skipped = 0
        profile_db_id: str | None = profile.get("id")

        for job in unmatched:
            result = await self._score_one(job, resume_text)
            if result is None:
                # Scoring failed (rate limit / error) — don't write to matches so
                # this job stays unmatched and will be retried on the next run.
                skipped += 1
                continue

            row: dict[str, Any] = {
                "job_id": job["id"],
                "score": result.score,
                "reasoning": result.reasoning,
                "decision": result.decision,
                "strengths": result.strengths or [],
                "gaps": result.gaps or [],
            }
            if profile_db_id:
                row["profile_id"] = profile_db_id
            try:
                await upsert_row("matches", row, on_conflict="job_id")
            except Exception as exc:
                log.warning("Failed to upsert match for job %s: %s", job["id"], exc)
                continue

            if result.decision == "apply":
                applied += 1
                await self.emit("match.apply", {"job_id": job["id"], "score": result.score})
            else:
                skipped += 1

            await asyncio.sleep(4.0)  # respect free-tier 15 RPM limit

        await self.emit("matching.completed", {"applied": applied, "skipped": skipped})
        log.info("[matching] applied=%d skipped=%d", applied, skipped)

    async def _score_one(self, job: dict[str, Any], resume_text: str):
        """Returns a score result object, or None if all attempts failed."""
        for attempt in range(3):
            try:
                return await score_job(resume_text, job.get("description", ""))
            except Exception as exc:
                msg = str(exc)
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    import re
                    m = re.search(r"retryDelay.*?(\d+)s", msg)
                    wait = int(m.group(1)) + 2 if m else 60
                    log.warning("Gemini rate limit hit, waiting %ds (attempt %d/3)", wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                log.warning("Gemini scoring failed for job %s: %s", job.get("id"), exc)
                break
        log.warning("[matching] All scoring attempts failed for job %s — will retry next run", job.get("id"))
        return None

    async def _load_profile(self, profile_id: str | None) -> dict[str, Any] | None:
        if profile_id:
            rows = await select_rows("profiles", filters={"id": profile_id}, limit=1)
        else:
            rows = await select_rows("profiles", limit=1)
        return rows[0] if rows else None

    async def _update_profile_embedding(self, profile_id: str, embedding: list[float]) -> None:
        try:
            db = await get_db()
            await db.table("profiles").update({"resume_embedding": embedding}).eq("id", profile_id).execute()
        except Exception as exc:
            log.warning("[matching] Could not save resume embedding (non-fatal): %s", exc)

    async def _fetch_unmatched_jobs(self, limit: int) -> list[dict[str, Any]]:
        """Jobs that exist in `jobs` but have no row in `matches`."""
        db = await get_db()
        resp = await db.rpc(
            "get_unmatched_jobs",
            {"p_limit": limit},
        ).execute()
        if resp.data:
            return resp.data

        # Fallback if RPC doesn't exist yet: fetch recent jobs then filter
        all_jobs = await select_rows("jobs", limit=limit * 5)
        matched_ids = {
            r["job_id"] for r in await select_rows("matches", limit=limit * 5)
        }
        unmatched = [j for j in all_jobs if j["id"] not in matched_ids]
        return unmatched[:limit]
