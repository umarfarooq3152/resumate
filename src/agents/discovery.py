"""Discovery Agent — fetches jobs from multiple sources and stores them in `jobs` table.

Sources:
  - Adzuna API        — clean public API, country-aware
  - Remotive          — remote jobs JSON API (worldwide)
  - WeWorkRemotely    — remote jobs RSS feed
  - Jobicy            — remote jobs JSON API
  - Himalayas         — remote-first companies API
  - Rozee.pk          — Pakistan-specific job board (HTML scrape)
  - LinkedIn Jobs     — public guest API (no auth)

Location routing:
  - Pakistan/Lahore   → Rozee.pk + LinkedIn PK + all remote sources
  - India             → Adzuna IN + remote sources
  - UK/US/CA/AU/DE/FR → Adzuna local + remote sources
  - no location       → Adzuna GB + remote sources
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from src.agents.base import BaseAgent
from src.config import settings
from src.db.client import get_db, upsert_row

log = logging.getLogger(__name__)

ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs"

_ADZUNA_COUNTRY_MAP: list[tuple[tuple[str, ...], str]] = [
    (("pakistan", "lahore", "karachi", "islamabad", "rawalpindi", "peshawar", "quetta"), None),
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
    loc = location.lower()
    for keywords, code in _ADZUNA_COUNTRY_MAP:
        if any(kw in loc for kw in keywords):
            return code
    return settings.adzuna_country


def _is_pakistan(location: str) -> bool:
    loc = location.lower()
    return any(kw in loc for kw in _PAKISTAN_KEYWORDS)


def _apply_type(apply_method: str, apply_url: str) -> str:
    if apply_method in ("google_form", "greenhouse_api", "lever_api", "ashby_api"):
        return "auto"
    if apply_url:
        return "online_manual"
    return "manual_only"


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


class DiscoveryAgent(BaseAgent):
    name = "discovery"

    async def run(
        self,
        keywords: str = "software engineer",
        location: str = "",
        pages: int = 1,
        days: int = 7,
    ) -> list[dict[str, Any]]:
        await self.emit("discovery.started", {
            "keywords": keywords, "location": location,
            "pages": pages, "days": days,
        })

        pakistan = _is_pakistan(location)
        adzuna_country = _adzuna_country(location) if settings.adzuna_configured and not pakistan else None

        log.info(
            "[discovery] keywords=%r location=%r pakistan=%s adzuna_country=%s days=%d",
            keywords, location, pakistan, adzuna_country, days,
        )

        if pakistan:
            from src.scrapers.remote_sources import fetch_all_pakistan
            all_jobs = await fetch_all_pakistan(keywords, location or "Pakistan", max_per_source=40)
            adzuna_jobs, remote_jobs = [], all_jobs
        else:
            tasks: list[Any] = []
            if adzuna_country:
                tasks.append(self._fetch_adzuna(keywords, location, pages, adzuna_country))
            else:
                tasks.append(asyncio.sleep(0))

            from src.scrapers.remote_sources import fetch_all_remote
            tasks.append(fetch_all_remote(keywords, max_per_source=30))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            adzuna_jobs = results[0] if not isinstance(results[0], Exception) and isinstance(results[0], list) else []
            remote_jobs = results[1] if not isinstance(results[1], Exception) and isinstance(results[1], list) else []
            all_jobs = adzuna_jobs + remote_jobs

        log.info("[discovery] adzuna=%d remote/pk=%d total=%d",
                 len(adzuna_jobs) if not pakistan else 0,
                 len(remote_jobs), len(all_jobs))

        # Date cutoff — drop jobs older than `days`
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        fresh, stale = [], 0
        for job in all_jobs:
            pa = job.get("posted_at")
            if pa:
                try:
                    dt = datetime.fromisoformat(pa.replace("Z", "+00:00"))
                    if dt < cutoff:
                        stale += 1
                        continue
                except Exception:
                    pass
            fresh.append(job)

        if stale:
            log.info("[discovery] dropped %d jobs older than %d days", stale, days)

        saved = 0
        for job in fresh:
            row = _to_db_row(job)
            try:
                await upsert_row("jobs", row, on_conflict="source,external_id")
                saved += 1
            except Exception as exc:
                log.warning("Failed to upsert job %s/%s: %s", row.get("source"), row.get("external_id"), exc)

        sources = _active_sources(
            None if pakistan else adzuna_country,
            len(remote_jobs) > 0,
            pakistan,
        )

        await self.emit("discovery.completed", {
            "fetched": len(fresh),
            "saved": saved,
            "sources": sources,
            "stale_dropped": stale,
        })
        log.info("[discovery] fetched=%d saved=%d stale_dropped=%d", len(fresh), saved, stale)
        return fresh

    async def _fetch_adzuna(self, keywords, location, pages, country):
        jobs: list[dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for page in range(1, pages + 1):
                batch = await self._fetch_adzuna_page(client, keywords, location, page, country)
                jobs.extend(batch)
                if len(batch) < 10:
                    break
                await asyncio.sleep(settings.rate_limit_delay)
        return jobs

    async def _fetch_adzuna_page(self, client, keywords, location, page, country):
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


def _active_sources(adzuna_country, has_remote, pakistan=False):
    sources = []
    if pakistan:
        sources.extend(["rozee_pk", "linkedin"])
    elif adzuna_country:
        sources.append(f"adzuna_{adzuna_country}")
    if has_remote:
        sources.extend(["remotive", "weworkremotely", "jobicy", "himalayas"])
    return sources


def _to_db_row(job: dict[str, Any]) -> dict[str, Any]:
    # Remote / Pakistan sources already have structured rows
    known_sources = ("remotive", "weworkremotely", "jobicy", "himalayas", "rozee_pk", "linkedin")
    if job.get("source") in known_sources:
        method = job.get("apply_method", "manual")
        url = job.get("apply_url", "")
        return {
            "source":     job["source"],
            "external_id": job["external_id"],
            "title":      job.get("title", ""),
            "company":    job.get("company", ""),
            "location":   job.get("location", ""),
            "description": job.get("description", ""),
            "apply_method": method,
            "apply_type": _apply_type(method, url),
            "apply_url":  url,
            "posted_at":  job.get("posted_at"),
            "raw":        job.get("raw", {}),
        }

    # Adzuna raw API response
    redirect = job.get("redirect_url", "") or ""
    method = _detect_apply_method(redirect)

    # Adzuna returns created field as ISO datetime
    posted_raw = job.get("created", "")
    posted_at = None
    if posted_raw:
        try:
            posted_at = datetime.fromisoformat(
                posted_raw.replace("Z", "+00:00")
            ).isoformat()
        except Exception:
            pass

    return {
        "source":     "adzuna",
        "external_id": str(job.get("id", "")),
        "title":      job.get("title", ""),
        "company":    (
            (job.get("company") or {}).get("display_name", "")
            if isinstance(job.get("company"), dict)
            else str(job.get("company") or "")
        ),
        "location":   (
            (job.get("location") or {}).get("display_name", "")
            if isinstance(job.get("location"), dict)
            else str(job.get("location") or "")
        ),
        "description": job.get("description", ""),
        "apply_method": method,
        "apply_type": _apply_type(method, redirect),
        "apply_url":  redirect,
        "posted_at":  posted_at,
        "raw":        job,
    }
