"""Remote job scrapers — free APIs with no ToS issues.

Sources:
  - Remotive      https://remotive.com/api/remote-jobs
  - WeWorkRemotely https://weworkremotely.com/remote-jobs.rss
  - Jobicy        https://jobicy.com/api/v2/remote-jobs
  - Himalayas     https://himalayas.app/jobs/api
"""
from __future__ import annotations

import asyncio
import logging
import xml.etree.ElementTree as ET
from typing import Any

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; RESUMATE/1.0; +https://resumate.app)",
    "Accept": "application/json, text/html, application/xml",
}

# Regions that explicitly exclude Pakistan-based applicants — skip these
_EXCLUDE_REGIONS = {
    "usa only", "us only", "united states only", "canada only", "eu only",
    "europe only", "uk only", "australia only", "eea only",
}


def _is_accessible_from_pakistan(location_str: str) -> bool:
    """Return True if a remote job is likely accessible from Pakistan."""
    loc = location_str.lower()
    for excl in _EXCLUDE_REGIONS:
        if excl in loc:
            return False
    return True


def _strip_html(html: str, max_chars: int = 3000) -> str:
    return BeautifulSoup(html, "lxml").get_text(" ", strip=True)[:max_chars]


# ─── Remotive ────────────────────────────────────────────────────────────────

async def fetch_remotive(
    keywords: str,
    max_results: int = 50,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """Remotive public JSON API — worldwide remote jobs."""
    url = "https://remotive.com/api/remote-jobs"
    params = {"search": keywords, "limit": min(max_results, 100)}
    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Remotive fetch failed: %s", exc)
            return []

    jobs = []
    for j in data.get("jobs", []):
        geo = j.get("candidate_required_location") or "Worldwide"
        if pakistan_only and not _is_accessible_from_pakistan(geo):
            continue
        jobs.append({
            "source": "remotive",
            "external_id": str(j.get("id", "")),
            "title": j.get("title", ""),
            "company": j.get("company_name", ""),
            "location": f"Remote — {geo}",
            "description": _strip_html(j.get("description", "")),
            "apply_url": j.get("url", ""),
            "apply_method": "manual",
            "salary": j.get("salary") or "",
            "raw": j,
        })
    log.info("[remotive] fetched %d jobs for %r", len(jobs), keywords)
    return jobs


# ─── WeWorkRemotely ───────────────────────────────────────────────────────────

async def fetch_weworkremotely(
    keywords: str,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """WeWorkRemotely RSS — curated remote positions, keyword-filtered client-side."""
    url = "https://weworkremotely.com/remote-jobs.rss"
    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            xml_text = resp.text
        except Exception as exc:
            log.warning("WeWorkRemotely fetch failed: %s", exc)
            return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        log.warning("WeWorkRemotely XML parse error: %s", exc)
        return []

    kw_tokens = keywords.lower().split()
    jobs = []
    for item in root.findall(".//item"):
        title = item.findtext("title", "")
        link = item.findtext("link", "")
        region = item.findtext("region", "Anywhere in the World")
        category = item.findtext("category", "")
        job_type = item.findtext("type", "")
        desc_html = item.findtext("description", "")
        guid = item.findtext("guid", link)

        searchable = (title + " " + category + " " + desc_html).lower()
        if kw_tokens and not any(kw in searchable for kw in kw_tokens):
            continue

        if pakistan_only and not _is_accessible_from_pakistan(region):
            continue

        # "Company: Job Title" format
        company, clean_title = "", title
        if ": " in title:
            company, clean_title = title.split(": ", 1)

        jobs.append({
            "source": "weworkremotely",
            "external_id": guid,
            "title": clean_title,
            "company": company,
            "location": f"Remote — {region}",
            "description": _strip_html(desc_html),
            "apply_url": link,
            "apply_method": "manual",
            "salary": "",
            "raw": {"category": category, "job_type": job_type, "region": region},
        })
    log.info("[weworkremotely] fetched %d jobs for %r", len(jobs), keywords)
    return jobs


# ─── Jobicy ──────────────────────────────────────────────────────────────────

async def fetch_jobicy(
    keywords: str,
    max_results: int = 50,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """Jobicy free API — remote jobs, single-keyword tag search."""
    url = "https://jobicy.com/api/v2/remote-jobs"
    # Jobicy `tag` takes one keyword; use first meaningful word
    tag = next((w for w in keywords.split() if len(w) > 2), "developer")
    params = {"tag": tag, "count": min(max_results, 50)}
    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Jobicy fetch failed: %s", exc)
            return []

    jobs = []
    for j in data.get("jobs", []):
        geo = j.get("jobGeo") or "Worldwide"
        if pakistan_only and not _is_accessible_from_pakistan(geo):
            continue
        desc_html = j.get("jobDescription", "")
        desc = _strip_html(desc_html) if desc_html else j.get("jobExcerpt", "")[:500]
        jobs.append({
            "source": "jobicy",
            "external_id": str(j.get("id", j.get("jobSlug", ""))),
            "title": j.get("jobTitle", ""),
            "company": j.get("companyName", ""),
            "location": f"Remote — {geo}",
            "description": desc,
            "apply_url": j.get("url", ""),
            "apply_method": "manual",
            "salary": "",
            "raw": j,
        })
    log.info("[jobicy] fetched %d jobs for %r", len(jobs), keywords)
    return jobs


# ─── Himalayas ───────────────────────────────────────────────────────────────

async def fetch_himalayas(
    keywords: str,
    max_results: int = 50,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """Himalayas.app free API — remote-first companies worldwide."""
    url = "https://himalayas.app/jobs/api"
    params = {"q": keywords, "limit": min(max_results, 100)}
    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Himalayas fetch failed: %s", exc)
            return []

    jobs = []
    for j in data.get("jobs", []):
        restrictions = j.get("locationRestrictions") or []
        if pakistan_only and restrictions:
            # Skip if restrictions exist but don't include Pakistan/Worldwide
            has_pk = any(
                r.lower() in ("pakistan", "worldwide", "anywhere", "global")
                for r in restrictions
            )
            if not has_pk:
                continue

        region = ", ".join(restrictions) if restrictions else "Worldwide"
        salary = ""
        if j.get("minSalary") and j.get("maxSalary"):
            salary = f"{j['currency']} {j['minSalary']:,}–{j['maxSalary']:,}"

        jobs.append({
            "source": "himalayas",
            "external_id": j.get("guid", j.get("title", "")),
            "title": j.get("title", ""),
            "company": j.get("companyName", ""),
            "location": f"Remote — {region}",
            "description": _strip_html(j.get("description", ""))[:3000],
            "apply_url": j.get("applicationLink", ""),
            "apply_method": "manual",
            "salary": salary,
            "raw": j,
        })
    log.info("[himalayas] fetched %d jobs for %r", len(jobs), keywords)
    return jobs


# ─── Aggregate ───────────────────────────────────────────────────────────────

async def fetch_all_remote(
    keywords: str,
    max_per_source: int = 30,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """Run all four remote scrapers in parallel and deduplicate by title+company."""
    results = await asyncio.gather(
        fetch_remotive(keywords, max_per_source, pakistan_only),
        fetch_weworkremotely(keywords, pakistan_only),
        fetch_jobicy(keywords, max_per_source, pakistan_only),
        fetch_himalayas(keywords, max_per_source, pakistan_only),
        return_exceptions=True,
    )

    seen: set[str] = set()
    all_jobs: list[dict[str, Any]] = []
    for batch in results:
        if isinstance(batch, Exception):
            log.warning("Remote source error: %s", batch)
            continue
        for job in batch:
            key = (job["title"].lower().strip(), job["company"].lower().strip())
            if key in seen:
                continue
            seen.add(key)
            all_jobs.append(job)

    log.info("[remote_sources] total unique jobs: %d", len(all_jobs))
    return all_jobs
