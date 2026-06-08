"""Discovery Agent — fetches jobs from multiple sources and stores them in `jobs` table.

Sources:
  - Adzuna API        — clean public API, country-aware
  - Remotive          — remote jobs JSON API (worldwide)
  - WeWorkRemotely    — remote jobs RSS feed
  - Jobicy            — remote jobs JSON API
  - Himalayas         — remote-first companies API

Location routing:
  - Pakistan/Lahore   → remote sources only (Adzuna PK has zero listings)
  - India             → Adzuna IN + remote sources
  - UK/US/CA/AU/DE/FR → Adzuna local + remote sources
  - no location       → Adzuna GB + remote sources
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from src.agents.base import BaseAgent
from src.config import settings
from src.db.client import get_db, upsert_row

log = logging.getLogger(__name__)

ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"

# Countries with active Adzuna coverage
_ADZUNA_COUNTRY_MAP: list[tuple[tuple[str, ...], str]] = [
    (("pakistan", "lahore", "karachi", "islamabad", "rawalpindi", "peshawar", "quetta"), None),  # no Adzuna PK data
    (("india", "delhi", "mumbai", "bangalore", "bengaluru", "hyderabad", "chennai", "pune", "kolkata"), "in"),
    (("usa", "united states", "new york", "san francisco", "los angeles", "chicago", "seattle", "austin", "boston"), "us"),
    (("uk", "united kingdom", "london", "manchester", "birmingham", "edinburgh", "leeds", "bristol"), "gb"),
    (("canada", "toronto", "vancouver", "montreal", "calgary", "ottawa"), "ca"),
    (("australia", "sydney", "melbourne", "brisbane", "perth", "adelaide"), "au"),
    (("germany", "berlin", "munich", "hamburg", "cologne", "frankfurt", "stuttgart"), "de"),
    (("france", "paris", "lyon", "marseille", "bordeaux", "toulouse"), "fr"),
    (("netherlands", "amsterdam", "rotterdam", "the hague", "utrecht"), "nl"),
    (("brazil", "sao paulo", "rio de janeiro", "brasilia"), "br"),
    (("singapore",), "sg"),
    (("poland", "warsaw", "krakow", "wroclaw"), "pl"),
]

_PAKISTAN_KEYWORDS = frozenset({
    "pakistan", "lahore", "karachi", "islamabad", "rawalpindi",
    "peshawar", "quetta", "faisalabad", "multan", "gujranwala",
})


def _adzuna_country(location: str) -> str | None:
    """Map a human location string to an Adzuna country code, or None to skip."""
    loc = location.lower()
    for keywords, code in _ADZUNA_COUNTRY_MAP:
        if any(kw in loc for kw in keywords):
            return code
    # Default to GB for unrecognised locations
    return settings.adzuna_country  # fallback from .env


def _is_pakistan(location: str) -> bool:
    loc = location.lower()
    return any(kw in loc for kw in _PAKISTAN_KEYWORDS)


class DiscoveryAgent(BaseAgent):
    name = "discovery"

    async def run(
        self,
        keywords: str = "software engineer",
        location: str = "",
        pages: int = 1,
    ) -> list[dict[str, Any]]:
        await self.emit("discovery.started", {"keywords": keywords, "location": location, "pages": pages})

        pakistan = _is_pakistan(location)
        adzuna_country = _adzuna_country(location) if settings.adzuna_configured and not pakistan else None

        log.info(
            "[discovery] keywords=%r location=%r pakistan=%s adzuna_country=%s",
            keywords, location, pakistan, adzuna_country,
        )

        # Run Adzuna + remote sources in parallel
        tasks: list[Any] = []
        if adzuna_country:
            tasks.append(self._fetch_adzuna(keywords, location, pages, adzuna_country))
        else:
            tasks.append(asyncio.sleep(0))  # placeholder

        from src.scrapers.remote_sources import fetch_all_remote
        tasks.append(fetch_all_remote(keywords, max_per_source=30, pakistan_only=pakistan))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        adzuna_jobs: list[dict] = []
        remote_jobs: list[dict] = []

        if not isinstance(results[0], Exception) and isinstance(results[0], list):
            adzuna_jobs = results[0]
        if not isinstance(results[1], Exception) and isinstance(results[1], list):
            remote_jobs = results[1]

        all_jobs = adzuna_jobs + remote_jobs
        log.info(
            "[discovery] adzuna=%d remote=%d total=%d",
            len(adzuna_jobs), len(remote_jobs), len(all_jobs),
        )

        saved = 0
        for job in all_jobs:
            row = _to_db_row(job)
            try:
                await upsert_row("jobs", row, on_conflict="source,external_id")
                saved += 1
            except Exception as exc:
                log.warning("Failed to upsert job %s/%s: %s", row.get("source"), row.get("external_id"), exc)

        await self.emit("discovery.completed", {
            "fetched": len(all_jobs),
            "saved": saved,
            "adzuna": len(adzuna_jobs),
            "remote": len(remote_jobs),
            "sources": _active_sources(adzuna_country, len(remote_jobs) > 0),
        })
        log.info("[discovery] fetched=%d saved=%d", len(all_jobs), saved)
        return all_jobs

    async def _fetch_adzuna(
        self,
        keywords: str,
        location: str,
        pages: int,
        country: str,
    ) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for page in range(1, pages + 1):
                batch = await self._fetch_adzuna_page(client, keywords, location, page, country)
                jobs.extend(batch)
                if len(batch) < 10:
                    break
                await asyncio.sleep(settings.rate_limit_delay)
        return jobs

    async def _fetch_adzuna_page(
        self,
        client: httpx.AsyncClient,
        keywords: str,
        location: str,
        page: int,
        country: str,
    ) -> list[dict[str, Any]]:
        url = f"{ADZUNA_BASE}/{country}/search/{page}"
        params: dict[str, Any] = {
            "app_id": settings.adzuna_app_id,
            "app_key": settings.adzuna_app_key,
            "results_per_page": min(settings.adzuna_max_results, 50),
            "what": keywords,
            "content-type": "application/json",
        }
        if location:
            params["where"] = location
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json().get("results", [])
        except httpx.HTTPStatusError as exc:
            log.error("Adzuna HTTP error %s: %s", exc.response.status_code, exc.response.text[:200])
            return []
        except Exception as exc:
            log.error("Adzuna fetch error: %s", exc)
            return []


def _active_sources(adzuna_country: str | None, has_remote: bool) -> list[str]:
    sources = []
    if adzuna_country:
        sources.append(f"adzuna_{adzuna_country}")
    if has_remote:
        sources.extend(["remotive", "weworkremotely", "jobicy", "himalayas"])
    return sources


def _detect_apply_method(redirect_url: str) -> str:
    if not redirect_url:
        return "manual"
    url_lower = redirect_url.lower()
    if "docs.google.com/forms" in url_lower or "forms.gle" in url_lower:
        return "google_form"
    if "boards.greenhouse.io" in url_lower:
        return "greenhouse_api"
    if "jobs.lever.co" in url_lower:
        return "lever_api"
    if "ashbyhq.com" in url_lower:
        return "ashby_api"
    return "manual"


def _to_db_row(job: dict[str, Any]) -> dict[str, Any]:
    # Remote sources already have structured rows
    if job.get("source") in ("remotive", "weworkremotely", "jobicy", "himalayas"):
        return {
            "source": job["source"],
            "external_id": job["external_id"],
            "title": job.get("title", ""),
            "company": job.get("company", ""),
            "location": job.get("location", ""),
            "description": job.get("description", ""),
            "apply_method": _detect_apply_method(job.get("apply_url", "")),
            "apply_url": job.get("apply_url", ""),
            "raw": job.get("raw", {}),
        }

    # Adzuna raw API response
    redirect = job.get("redirect_url", "") or ""
    return {
        "source": "adzuna",
        "external_id": str(job.get("id", "")),
        "title": job.get("title", ""),
        "company": (
            (job.get("company") or {}).get("display_name", "")
            if isinstance(job.get("company"), dict)
            else str(job.get("company") or "")
        ),
        "location": (
            (job.get("location") or {}).get("display_name", "")
            if isinstance(job.get("location"), dict)
            else str(job.get("location") or "")
        ),
        "description": job.get("description", ""),
        "apply_method": _detect_apply_method(redirect),
        "apply_url": redirect,
        "raw": job,
    }
