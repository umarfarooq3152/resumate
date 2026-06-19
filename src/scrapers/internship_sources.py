"""Internship & Fellowship scrapers.

Sources:
  - Internshala      — Pakistan/India's largest internship board (HTML scrape)
  - Unstop           — Competitions, fellowships, hackathons (public API)
  - Outreachy        — Open-source fellowship programme (scrape apply page)
  - LinkedIn intern  — LinkedIn guest API with intern keywords
  - Remotive intern  — Remotive searched with internship keyword
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
    """Scrape Internshala — largest PK/IN internship board."""
    # Use only the first keyword for the slug (multi-keyword slugs 404)
    first_kw = keywords.strip().split(",")[0].strip().lower().replace(" ", "-")
    urls = [
        f"https://internshala.com/internships/{first_kw}-internship/",
        "https://internshala.com/internships/",
        "https://internshala.com/internships/work-from-home-internships/",
    ]

    headers = {
        **_HEADERS,
        "Referer": "https://internshala.com/",
        "Accept": "text/html,application/xhtml+xml,*/*",
    }
    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()

    async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
        for url in urls:
            if len(jobs) >= max_results:
                break
            try:
                resp = await client.get(url)
                if resp.status_code >= 400:
                    log.warning("Internshala %s → %d", url, resp.status_code)
                    continue
                soup = BeautifulSoup(resp.text, "lxml")
            except Exception as exc:
                log.warning("Internshala fetch failed (%s): %s", url, exc)
                continue

            # Try multiple selector strategies
            cards = (
                soup.select("div.individual_internship") or
                soup.select("[id^='internship_']") or
                soup.select(".internship_meta") or
                soup.select("[class*='internship'][class*='card']")
            )

            log.info("[internshala] %s → %d cards", url, len(cards))

            for card in cards:
                if len(jobs) >= max_results:
                    break
                try:
                    # Title: try multiple patterns
                    title_el = (
                        card.select_one(".heading_4_5 a") or
                        card.select_one(".profile a") or
                        card.select_one("h3 a") or
                        card.select_one("h3") or
                        card.select_one("[class*='title'] a")
                    )
                    # Company
                    company_el = (
                        card.select_one(".company_name a") or
                        card.select_one(".company_name") or
                        card.select_one("h4") or
                        card.select_one(".heading_6")
                    )
                    # Link
                    link_el = card.select_one("a[href*='/internship/detail/']") or title_el

                    title   = title_el.get_text(strip=True) if title_el else ""
                    company = company_el.get_text(strip=True) if company_el else ""

                    if not title or title in seen:
                        continue
                    seen.add(title)

                    apply_url = ""
                    if link_el and link_el.name == "a":
                        href = link_el.get("href", "")
                        apply_url = href if href.startswith("http") else f"https://internshala.com{href}"

                    # Location / stipend / duration from item_body spans
                    item_bodies = card.select(".item_body")
                    loc     = item_bodies[0].get_text(strip=True) if len(item_bodies) > 0 else "India/Pakistan"
                    stipend = item_bodies[1].get_text(strip=True) if len(item_bodies) > 1 else ""
                    duration = item_bodies[2].get_text(strip=True) if len(item_bodies) > 2 else ""

                    desc_parts = [f"Internship: {title} at {company}"]
                    if loc:      desc_parts.append(f"Location: {loc}")
                    if stipend:  desc_parts.append(f"Stipend: {stipend}")
                    if duration: desc_parts.append(f"Duration: {duration}")

                    jobs.append({
                        "source":           "internshala",
                        "external_id":      apply_url or f"internshala-{title}-{company}",
                        "opportunity_type": "internship",
                        "title":            title,
                        "company":          company,
                        "location":         loc or "India/Pakistan",
                        "description":      " | ".join(desc_parts),
                        "apply_url":        apply_url,
                        "apply_method":     "manual",
                        "posted_at":        None,
                        "salary":           stipend,
                        "raw":              {},
                    })
                except Exception as exc:
                    log.debug("Internshala card parse error: %s", exc)

    log.info("[internshala] fetched %d internships for %r", len(jobs), keywords)
    return jobs


# ─── Unstop ──────────────────────────────────────────────────────────────────

async def fetch_unstop(
    keywords: str,
    opp_types: list[str] | None = None,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Fetch from Unstop public opportunity search API."""
    # Use only the first keyword — Unstop searches degrade with long comma-lists
    first_kw = keywords.strip().split(",")[0].strip()

    url = "https://unstop.com/api/public/opportunity/search-new"

    # Build params — pass type as multiple values using a list of tuples
    param_list: list[tuple[str, str]] = [
        ("search",     first_kw),
        ("oppstatus",  "open"),
        ("page",       "1"),
        ("size",       str(min(max_results, 25))),
        ("deadline",   "upcoming"),
    ]
    for t in (opp_types or ["internship", "fellowship"]):
        param_list.append(("type[]", t))

    headers = {
        **_HEADERS,
        "Referer":         "https://unstop.com/",
        "X-Requested-With": "XMLHttpRequest",
        "Accept":          "application/json",
    }

    async with httpx.AsyncClient(timeout=20, headers=headers) as client:
        try:
            resp = await client.get(url, params=param_list)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            log.warning("Unstop fetch failed: %s", exc)
            return []

    # Response structure: data.data.data[] or data.data[]
    raw = data.get("data", {})
    items = (raw.get("data") if isinstance(raw, dict) else None) or (raw if isinstance(raw, list) else [])

    jobs: list[dict[str, Any]] = []

    for item in items[:max_results]:
        try:
            opp = item.get("opportunity") or item
            title    = opp.get("title") or opp.get("name", "")
            org_data = opp.get("organisation") or {}
            org      = org_data.get("name", "") if isinstance(org_data, dict) else str(org_data)
            loc      = opp.get("location") or opp.get("city") or "Online"
            opp_type = (opp.get("type") or "").lower()

            our_type = "fellowship" if "fellowship" in opp_type else "internship"

            desc = opp.get("description") or opp.get("about") or ""
            if desc and "<" in desc:
                desc = _strip_html(desc)
            desc = (desc or f"{opp_type.title()}: {title} by {org}")[:2000]

            slug = opp.get("public_url") or opp.get("slug") or ""
            apply_url = f"https://unstop.com/o/{slug}" if slug else "https://unstop.com/"

            posted_raw = opp.get("start_date") or opp.get("created_at") or ""
            posted_at = None
            if posted_raw:
                try:
                    posted_at = datetime.fromisoformat(posted_raw.replace("Z", "+00:00")).isoformat()
                except Exception:
                    pass

            jobs.append({
                "source":           "unstop",
                "external_id":      str(opp.get("id") or f"unstop-{title}-{org}"),
                "opportunity_type": our_type,
                "title":            title,
                "company":          org,
                "location":         loc,
                "description":      desc,
                "apply_url":        apply_url,
                "apply_method":     "manual",
                "posted_at":        posted_at,
                "salary":           str(opp.get("prize") or opp.get("stipend") or ""),
                "raw":              {},
            })
        except Exception as exc:
            log.debug("Unstop item parse error: %s", exc)

    log.info("[unstop] fetched %d items for %r", len(jobs), first_kw)
    return jobs


# ─── Outreachy ───────────────────────────────────────────────────────────────

async def fetch_outreachy(max_results: int = 20) -> list[dict[str, Any]]:
    """Scrape Outreachy's current internship listings from their apply page."""
    # The /api/v1/projects/ endpoint no longer exists; scrape the apply page instead
    url = "https://www.outreachy.org/apply/project-selection/"

    async with httpx.AsyncClient(timeout=20, headers=_HEADERS, follow_redirects=True) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")
        except Exception as exc:
            log.warning("Outreachy fetch failed: %s", exc)
            return []

    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()

    # Projects are in <div class="community-container"> or similar
    project_cards = (
        soup.select(".project-container, .community-project") or
        soup.select("[class*='project']") or
        soup.select("h3 a, h4 a")
    )

    for card in project_cards[:max_results]:
        try:
            if card.name in ("h3", "h4"):
                title_el = card.find("a") or card
                title = title_el.get_text(strip=True)
                apply_url = title_el.get("href", url) if title_el.name == "a" else url
            else:
                title_el  = card.select_one("h3, h4, [class*='title']")
                title     = title_el.get_text(strip=True) if title_el else ""
                link_el   = card.select_one("a[href]")
                apply_url = link_el.get("href", url) if link_el else url

            org_el  = card.select_one("[class*='community'], [class*='org'], p strong")
            org     = org_el.get_text(strip=True) if org_el else "Outreachy"
            desc_el = card.select_one("p, [class*='desc']")
            desc    = desc_el.get_text(strip=True)[:500] if desc_el else ""

            if not title or title in seen:
                continue
            seen.add(title)

            if not apply_url.startswith("http"):
                apply_url = f"https://www.outreachy.org{apply_url}"

            jobs.append({
                "source":           "outreachy",
                "external_id":      apply_url,
                "opportunity_type": "fellowship",
                "title":            title,
                "company":          org,
                "location":         "Remote — Worldwide",
                "description":      desc or f"Open-source fellowship: {title} — Outreachy pays a $7,000 stipend.",
                "apply_url":        apply_url,
                "apply_method":     "manual",
                "posted_at":        None,
                "salary":           "USD 7,000 stipend",
                "raw":              {},
            })
        except Exception as exc:
            log.debug("Outreachy card parse: %s", exc)

    # If scrape failed to find structured cards, add a fallback entry
    if not jobs:
        jobs.append({
            "source":           "outreachy",
            "external_id":      "outreachy-general",
            "opportunity_type": "fellowship",
            "title":            "Outreachy Open-Source Fellowship",
            "company":          "Outreachy",
            "location":         "Remote — Worldwide",
            "description":      "Outreachy provides internships in open source and open science. Stipend: USD 7,000. Apply at outreachy.org.",
            "apply_url":        "https://www.outreachy.org/apply/",
            "apply_method":     "manual",
            "posted_at":        None,
            "salary":           "USD 7,000 stipend",
            "raw":              {},
        })

    log.info("[outreachy] fetched %d projects", len(jobs))
    return jobs


# ─── LinkedIn internships ─────────────────────────────────────────────────────

async def fetch_linkedin_internships(
    keywords: str,
    location: str = "Pakistan",
    max_results: int = 25,
) -> list[dict[str, Any]]:
    """LinkedIn guest jobs API with 'intern' appended to keywords."""
    from src.scrapers.remote_sources import fetch_linkedin_jobs

    first_kw = keywords.strip().split(",")[0].strip()
    intern_kw = f"{first_kw} intern"
    jobs = await fetch_linkedin_jobs(intern_kw, location, max_results)

    for j in jobs:
        j["opportunity_type"] = "internship"

    log.info("[linkedin_intern] fetched %d for %r", len(jobs), intern_kw)
    return jobs


# ─── Remotive internships ─────────────────────────────────────────────────────

async def fetch_remotive_internships(
    keywords: str,
    max_results: int = 30,
) -> list[dict[str, Any]]:
    """Remotive searched directly with 'internship' keyword."""
    from src.scrapers.remote_sources import fetch_remotive

    first_kw = keywords.strip().split(",")[0].strip()
    intern_kw = f"{first_kw} internship"
    jobs = await fetch_remotive(intern_kw, max_results)

    for j in jobs:
        j["opportunity_type"] = "internship"

    log.info("[remotive_intern] fetched %d for %r", len(jobs), intern_kw)
    return jobs


# ─── Aggregate ───────────────────────────────────────────────────────────────

async def fetch_all_internships(
    keywords: str,
    location: str = "",
    max_per_source: int = 25,
) -> list[dict[str, Any]]:
    """Run all internship scrapers in parallel and deduplicate."""
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
            job.setdefault("opportunity_type", "internship")
            all_jobs.append(job)

    log.info("[internship_sources] total unique: %d", len(all_jobs))
    return all_jobs


async def fetch_all_fellowships(
    keywords: str,
    location: str = "",
    max_per_source: int = 20,
) -> list[dict[str, Any]]:
    """Run fellowship scrapers in parallel and deduplicate."""
    location_for_li = location or "Pakistan"
    first_kw = keywords.strip().split(",")[0].strip()

    results = await asyncio.gather(
        fetch_outreachy(max_per_source),
        fetch_unstop(keywords, opp_types=["fellowship"], max_results=max_per_source),
        fetch_linkedin_internships(f"{first_kw} fellowship", location_for_li, max_per_source),
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

    log.info("[fellowship_sources] total unique: %d", len(all_jobs))
    return all_jobs
