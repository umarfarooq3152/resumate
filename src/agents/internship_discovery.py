"""Internship & Fellowship Discovery Agent.

Finds internship and fellowship opportunities from dedicated sources
(Internshala, Unstop, Outreachy, LinkedIn, Remotive) and stores them
in the `jobs` table with opportunity_type = 'internship' or 'fellowship'.
"""
from __future__ import annotations

import logging
from typing import Any

from src.agents.base import BaseAgent
from src.db.client import upsert_row

log = logging.getLogger(__name__)


class InternshipDiscoveryAgent(BaseAgent):
    name = "internship_discovery"

    async def run(
        self,
        keywords: str = "software",
        location: str = "",
        mode: str = "both",  # "internships" | "fellowships" | "both"
    ) -> dict[str, Any]:
        """Discover internships and/or fellowships and upsert into jobs table.

        Args:
            keywords: Search keywords (e.g. "software engineer", "data science")
            location: Preferred location (blank = default to Pakistan for local + remote)
            mode:     Which types to search — "internships", "fellowships", or "both"
        """
        from src.scrapers.internship_sources import fetch_all_internships, fetch_all_fellowships

        await self.emit("internship_discovery.started", {
            "keywords": keywords, "location": location, "mode": mode,
        })

        all_opps: list[dict[str, Any]] = []

        if mode in ("internships", "both"):
            internships = await fetch_all_internships(keywords, location, max_per_source=25)
            all_opps.extend(internships)

        if mode in ("fellowships", "both"):
            fellowships = await fetch_all_fellowships(keywords, location, max_per_source=20)
            all_opps.extend(fellowships)

        saved = 0
        for opp in all_opps:
            row = self._to_db_row(opp)
            try:
                await upsert_row("jobs", row, on_conflict="source,external_id")
                saved += 1
            except Exception as exc:
                log.warning(
                    "Failed to upsert %s/%s: %s",
                    row.get("source"), row.get("external_id"), exc,
                )

        summary = {
            "fetched": len(all_opps),
            "saved":   saved,
            "internships": sum(1 for o in all_opps if o.get("opportunity_type") == "internship"),
            "fellowships":  sum(1 for o in all_opps if o.get("opportunity_type") == "fellowship"),
        }
        await self.emit("internship_discovery.completed", summary)
        log.info("[internship_discovery] %s", summary)
        return summary

    def _to_db_row(self, opp: dict[str, Any]) -> dict[str, Any]:
        method = opp.get("apply_method", "manual")
        url    = opp.get("apply_url", "")
        apply_type = "online_manual" if url else "manual_only"

        return {
            "source":           opp["source"],
            "external_id":      opp["external_id"],
            "opportunity_type": opp.get("opportunity_type", "internship"),
            "title":            opp.get("title", ""),
            "company":          opp.get("company", ""),
            "location":         opp.get("location", ""),
            "description":      opp.get("description", ""),
            "apply_method":     method,
            "apply_type":       apply_type,
            "apply_url":        url,
            "posted_at":        opp.get("posted_at"),
            "raw":              opp.get("raw", {}),
        }
