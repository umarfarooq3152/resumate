"""Tracking Agent — monitors application statuses and aggregates stats."""
from __future__ import annotations

import logging
from typing import Any

from src.agents.base import BaseAgent
from src.db.client import get_db, select_rows

log = logging.getLogger(__name__)


class TrackingAgent(BaseAgent):
    name = "tracking"

    async def run(self) -> dict[str, Any]:
        """Return a summary of the current pipeline state."""
        jobs = await select_rows("jobs")
        matches = await select_rows("matches")
        applications = await select_rows("applications")

        summary = {
            "jobs_discovered": len(jobs),
            "jobs_matched": len([m for m in matches if m["decision"] == "apply"]),
            "jobs_skipped": len([m for m in matches if m["decision"] == "skip"]),
            "total_applications": len(applications),
            "applications_prepared": len([a for a in applications if a["status"] == "prepared"]),
            "applications_submitted": len([a for a in applications if a["status"] == "submitted"]),
            "applications_error": len([a for a in applications if a["status"] == "error"]),
        }
        await self.emit("tracking.snapshot", summary)
        log.info("[tracking] %s", summary)
        return summary

    async def get_pipeline(self) -> list[dict[str, Any]]:
        """Return full joined pipeline view for the dashboard."""
        db = await get_db()
        # Fetch each table and join in Python (avoids needing a custom RPC)
        jobs = {j["id"]: j for j in await select_rows("jobs")}
        matches = {m["job_id"]: m for m in await select_rows("matches")}
        applications = {a["job_id"]: a for a in await select_rows("applications")}

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
