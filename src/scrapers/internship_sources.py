"""Internship & Fellowship scrapers.

Sources:
  - Internshala      — Pakistan/India's largest internship board (HTML scrape)
  - Unstop           — Competitions, fellowships, hackathons (public API)
  - Outreachy        — Open-source fellowship programme (public API)
  - LinkedIn intern  — LinkedIn guest API filtered for internships
  - Remotive intern  — Remotive filtered for internship job type
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


def _strip_html(html: str, max_chars: int = 2000) -> str:
    return BeautifulSoup(html, "lxml").get_text(" ", strip=True)[:max_chars]


# ─── Internshala ─────────────────────────────────────────────────────────────

async def fetch_internshala(
    keywords: str,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Scrape Internshala public search — largest PK/IN internship board."""
    kw_slug = keywords.strip().lower().replace(" ", "-")
    urls = [
        f"https://internshala.com/internships/{kw_slug}-internship/",
        "https://internshala.com/internships/work-from-home-internships/",
    ]

    headers = {**_HEADERS, "Referer": "https://internshala.com/"}
    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
        for url in urls:
            try:
                resp = await client.get(url)
                if resp.status_code >= 400:
                    continue
                soup = BeautifulSoup(resp.text, "lxml")
            except Exception as exc:
                log.warning("Internshala fetch failed (%s): %s", url, exc)
                continue

            cards = soup.select(
                ".individual_internship, .internship_meta, "
                "[id^='internship_'], [class*='internship-card']"
            )
            if not cards:
                cards = soup.select("div[id^='internship']")

            for card in cards[:max_results]:
                try:
                    title_el   = card.select_one("h3 a, .heading_4_5 a, [class*='title'] a, h3")
                    company_el = card.select_one("h4, .heading_6, [class*='company']")
                    loc_el     = card.select_one(
                        "[class*='location'] span, [class*='location_name'], "
                        ".item_body:nth-child(2), [class*='loc']"
                    )
                    stip_el    = card.select_one("[class*='stipend'], [class*='salary']")
                    dur_el     = card.select_one("[class*='duration']")
                    link_el    = card.select_one("a[href*='/internship/detail/'], a[href*='/internship/']")

                    title   = title_el.get_text(strip=True) if title_el else ""
                    company = company_el.get_text(strip=True) if company_el else ""
                    if not title or title in seen:
                        continue
                    seen.add(title)

                    loc     = loc_el.get_text(strip=True)  if loc_el   else "Remote / Pakistan"
                    stipend = stip_el.get_text(strip=True) if stip_el  else ""
                    duration = dur_el.get_text(strip=True) if dur_el   else ""

                    apply_url = ""
                    if link_el:
                        href = link_el.get("href", "")
                        apply_url = href if href.startswith("http") else f"https://internshala.com{href}"

                    ext_id = apply_url or f"internshala-{title}-{company}"

                    desc_parts = [f"Internship: {title} at {company}"]
                    if loc:      desc_parts.append(f"Location: {loc}")
                    if stipend:  desc_parts.append(f"Stipend: {stipend}")
                    if duration: desc_parts.append(f"Duration: {duration}")

                    jobs.append({
                        "source":          "internshala",
                        "external_id":     ext_id,
                        "opportunity_type": "internship",
                        "title":           title,
                        "company":         company,
                        "location":        loc,
                        "description":     " | ".join(desc_parts),
                        "apply_url":       apply_url,
                        "apply_method":    "manual",
                        "posted_at":       None,
                        "salary":          stipend,
                        "raw":             {},
                    })
                except Exception as exc:
                    log.debug("Internshala card parse error: %s", exc)
                    continue

            if len(jobs) >= max_results:
                break

    log.info("[internshala] fetched %d internships for %r", len(jobs), keywords)
    return jobs[:max_results]


# ─── Unstop ──────────────────────────────────────────────────────────────────

async def fetch_unstop(
    keywords: str,
    opp_types: list[str] | None = None,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Fetch from Unstop public opportunity search API.

    opp_types examples: ['fellowship', 'internship', 'hackathon', 'competition']
    """
    url = "https://unstop.com/api/public/opportunity/search-new"
    params: dict[str, Any] = {
        "search":      keywords,
        "oppstatus":   "open",
        "page":        1,
        "size":        min(max_results, 25),
    }
    if opp_types:
        for t in opp_types:
            params[f"type[]"] = t  # Unstop accepts repeated keys

    headers = {
        **_HEADERS,
        "Referer": "https://unstop.com/",
        "X-Requested-With": "XMLHttpRequest",
    }

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Unstop fetch failed: %s", exc)
            return []

    items = data.get("data", {}).get("data", []) or data.get("data", []) or []
    jobs: list[dict[str, Any]] = []

    for item in items[:max_results]:
        try:
            opp = item.get("opportunity") or item
            title   = opp.get("title") or opp.get("name", "")
            org     = (opp.get("organisation") or {}).get("name", "") or opp.get("org_name", "")
            loc     = opp.get("location") or "Online"
            opp_type = (opp.get("type") or "").lower()
            apply_url = f"https://unstop.com/o/{opp.get('public_url', '')}" if opp.get("public_url") else ""

            # Map Unstop types to our types
            if "fellowship" in opp_type:
                our_type = "fellowship"
            else:
                our_type = "internship"

            desc = opp.get("description") or opp.get("about") or ""
            if desc:
                desc = _strip_html(desc) if "<" in desc else desc[:2000]
            else:
                desc = f"{opp_type.title()}: {title} by {org}"

            ext_id = str(opp.get("id") or f"unstop-{title}-{org}")

            posted_raw = opp.get("start_date") or opp.get("created_at") or ""
            posted_at = None
            if posted_raw:
                try:
                    posted_at = datetime.fromisoformat(
                        posted_raw.replace("Z", "+00:00")
                    ).isoformat()
                except Exception:
                    pass

            jobs.append({
                "source":          "unstop",
                "external_id":     ext_id,
                "opportunity_type": our_type,
                "title":           title,
                "company":         org,
                "location":        loc,
                "description":     desc,
                "apply_url":       apply_url,
                "apply_method":    "manual",
                "posted_at":       posted_at,
                "salary":          opp.get("prize") or opp.get("stipend") or "",
                "raw":             opp,
            })
        except Exception as exc:
            log.debug("Unstop item parse error: %s", exc)
            continue

    log.info("[unstop] fetched %d items for %r", len(jobs), keywords)
    return jobs


# ─── Outreachy ───────────────────────────────────────────────────────────────

async def fetch_outreachy(max_results: int = 20) -> list[dict[str, Any]]:
    """Fetch open-source internship/fellowship rounds from Outreachy public API."""
    url = "https://www.outreachy.org/api/v1/"
    projects_url = "https://www.outreachy.org/api/v1/projects/"

    async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
        try:
            proj_resp = await client.get(projects_url)
            proj_resp.raise_for_status()
            data = proj_resp.json()
        except Exception as exc:
            log.warning("Outreachy fetch failed: %s", exc)
            return []

    items = data.get("results", []) or []
    jobs: list[dict[str, Any]] = []

    for proj in items[:max_results]:
        try:
            title   = proj.get("short_title") or proj.get("title", "")
            org     = (proj.get("community") or {}).get("name", "") or "Outreachy"
            desc    = proj.get("long_description") or proj.get("short_description") or ""
            if "<" in desc:
                desc = _strip_html(desc)
            skills  = proj.get("required_skills") or []
            if skills:
                skill_str = ", ".join(s.get("skill", "") for s in skills if s.get("skill"))
                desc = f"{desc}\n\nRequired skills: {skill_str}" if desc else f"Skills: {skill_str}"

            apply_url = proj.get("url") or f"https://www.outreachy.org/apply/project-selection/"
            ext_id = proj.get("slug") or f"outreachy-{title}-{org}"

            jobs.append({
                "source":          "outreachy",
                "external_id":     ext_id,
                "opportunity_type": "fellowship",
                "title":           title,
                "company":         org,
                "location":        "Remote — Worldwide",
                "description":     desc[:2000],
                "apply_url":       apply_url,
                "apply_method":    "manual",
                "posted_at":       None,
                "salary":          "USD 7,000 stipend",
                "raw":             proj,
            })
        except Exception as exc:
            log.debug("Outreachy project parse error: %s", exc)
            continue

    log.info("[outreachy] fetched %d projects", len(jobs))
    return jobs


# ─── LinkedIn internships (reused scraper with intern keywords) ───────────────

async def fetch_linkedin_internships(
    keywords: str,
    location: str = "Pakistan",
    max_results: int = 25,
) -> list[dict[str, Any]]:
    """LinkedIn guest jobs API filtered to internship postings."""
    from src.scrapers.remote_sources import fetch_linkedin_jobs

    intern_kw = f"{keywords} internship"
    jobs = await fetch_linkedin_jobs(intern_kw, location, max_results)

    # Tag them as internships and filter out non-intern results
    result = []
    for j in jobs:
        title_lower = j.get("title", "").lower()
        if any(w in title_lower for w in ("intern", "trainee", "graduate", "co-op", "coop")):
            j["opportunity_type"] = "internship"
            result.append(j)

    return result


# ─── Remotive internships ─────────────────────────────────────────────────────

async def fetch_remotive_internships(
    keywords: str,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Remotive filtered to internship-type postings."""
    from src.scrapers.remote_sources import fetch_remotive

    jobs = await fetch_remotive(keywords, max_results)
    result = []
    for j in jobs:
        title_lower = j.get("title", "").lower()
        if any(w in title_lower for w in ("intern", "trainee", "graduate", "entry level", "junior")):
            j["opportunity_type"] = "internship"
            result.append(j)

    return result


# ─── Aggregate ───────────────────────────────────────────────────────────────

async def fetch_all_internships(
    keywords: str,
    location: str = "",
    max_per_source: int = 25,
) -> list[dict[str, Any]]:
    """Run all internship scrapers in parallel and deduplicate by title+company."""
    location_for_li = location or "Pakistan"

    results = await asyncio.gather(
        fetch_internshala(keywords, max_per_source),
        fetch_unstop(keywords, opp_types=["internship"], max_results=max_per_source),
        fetch_linkedin_internships(keywords, location_for_li, max_per_source),
        fetch_remotive_internships(keywords, max_per_source),
        return_exceptions=True,
    )

    seen: set[tuple] = set()
    all_jobs: list[dict[str, Any]] = []
    for batch in results:
        if isinstance(batch, Exception):
            log.warning("Internship source error: %s", batch)
            continue
        for job in batch:
            key = (job["title"].lower().strip(), job["company"].lower().strip())
            if key in seen:
                continue
            seen.add(key)
            if "opportunity_type" not in job:
                job["opportunity_type"] = "internship"
            all_jobs.append(job)

    log.info("[internship_sources] total unique internships: %d", len(all_jobs))
    return all_jobs


async def fetch_all_fellowships(
    keywords: str,
    location: str = "",
    max_per_source: int = 20,
) -> list[dict[str, Any]]:
    """Run fellowship scrapers in parallel and deduplicate."""
    location_for_li = location or "Pakistan"

    fellowship_kw = f"{keywords} fellowship"
    results = await asyncio.gather(
        fetch_outreachy(max_per_source),
        fetch_unstop(keywords, opp_types=["fellowship"], max_results=max_per_source),
        fetch_linkedin_internships(fellowship_kw, location_for_li, max_per_source),
        return_exceptions=True,
    )

    seen: set[tuple] = set()
    all_jobs: list[dict[str, Any]] = []
    for batch in results:
        if isinstance(batch, Exception):
            log.warning("Fellowship source error: %s", batch)
            continue
        for job in batch:
            key = (job["title"].lower().strip(), job["company"].lower().strip())
            if key in seen:
                continue
            seen.add(key)
            job["opportunity_type"] = "fellowship"
            all_jobs.append(job)

    log.info("[fellowship_sources] total unique fellowships: %d", len(all_jobs))
    return all_jobs
