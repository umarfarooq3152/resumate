"""Tracking Agent — monitors application statuses and aggregates stats."""
from __future__ import annotations

import logging
from typing import Any

from src.agents.base import BaseAgent
from src.db.client import get_db

log = logging.getLogger(__name__)


class TrackingAgent(BaseAgent):
    name = "tracking"

    async def run(self) -> dict[str, Any]:
        """Return a summary of the current pipeline state using COUNT queries."""
        import asyncio as _asyncio
        db = await get_db()

        (
            jobs_r, match_apply_r, match_skip_r,
            apps_r, prep_r, sub_r, err_r,
        ) = await _asyncio.gather(
            db.table("jobs").select("id", count="exact").limit(1).execute(),
            db.table("matches").select("id", count="exact").eq("decision", "apply").limit(1).execute(),
            db.table("matches").select("id", count="exact").eq("decision", "skip").limit(1).execute(),
            db.table("applications").select("id", count="exact").limit(1).execute(),
            db.table("applications").select("id", count="exact").eq("status", "prepared").limit(1).execute(),
            db.table("applications").select("id", count="exact").eq("status", "submitted").limit(1).execute(),
            db.table("applications").select("id", count="exact").eq("status", "error").limit(1).execute(),
        )

        summary = {
            "jobs_discovered":        jobs_r.count or 0,
            "jobs_matched":           match_apply_r.count or 0,
            "jobs_skipped":           match_skip_r.count or 0,
            "total_applications":     apps_r.count or 0,
            "applications_prepared":  prep_r.count or 0,
            "applications_submitted": sub_r.count or 0,
            "applications_error":     err_r.count or 0,
        }
        await self.emit("tracking.snapshot", summary)
        log.info("[tracking] %s", summary)
        return summary

    async def get_pipeline(self) -> list[dict[str, Any]]:
        """Return joined pipeline view for the dashboard (most recent 500 jobs)."""
        import asyncio as _asyncio
        db = await get_db()
        # Limit to 500 most-recently discovered jobs to avoid loading the entire table
        recent_jobs_resp = await db.table("jobs").select("*").order("discovered_at", desc=True).limit(500).execute()
        job_ids = [j["id"] for j in (recent_jobs_resp.data or [])]

        if job_ids:
            matches_resp, apps_resp = await _asyncio.gather(
                db.table("matches").select("*").in_("job_id", job_ids).execute(),
                db.table("applications").select("*").in_("job_id", job_ids).execute(),
            )
            match_rows = matches_resp.data or []
            app_rows = apps_resp.data or []
        else:
            match_rows, app_rows = [], []

        jobs = {j["id"]: j for j in (recent_jobs_resp.data or [])}
        matches = {m["job_id"]: m for m in match_rows}
        applications = {a["job_id"]: a for a in app_rows}

        rows = []
        for job_id, job in jobs.items():
            match = matches.get(job_id, {})
            app = applications.get(job_id, {})
            raw_score = match.get("score")
            rows.append({
                "job_id": job_id,
                "title": job.get("title"),
                "company": job.get("company"),
                "location": job.get("location"),
                "apply_method": job.get("apply_method"),
                "apply_url": job.get("apply_url"),
                "match_score": raw_score,
                "match_decision": match.get("decision"),
                "application_status": app.get("status"),
                "submitted_at": app.get("submitted_at"),
                "error": app.get("error"),
            })
        return rows
