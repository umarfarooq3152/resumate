"""Remote job scrapers — free APIs / public endpoints, no ToS issues.

Sources:
  - Remotive          https://remotive.com/api/remote-jobs
  - WeWorkRemotely    https://weworkremotely.com/remote-jobs.rss
  - Jobicy            https://jobicy.com/api/v2/remote-jobs
  - Himalayas         https://himalayas.app/jobs/api
  - Rozee.pk          https://rozee.pk  (Pakistan-specific, HTML scrape)
  - LinkedIn Jobs     https://linkedin.com/jobs (guest public API, no auth)
"""
from __future__ import annotations

import asyncio
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/html, application/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
}

_EXCLUDE_REGIONS = {
    "usa only", "us only", "united states only", "canada only", "eu only",
    "europe only", "uk only", "australia only", "eea only",
}


def _is_accessible_from_pakistan(location_str: str) -> bool:
    loc = location_str.lower()
    return not any(excl in loc for excl in _EXCLUDE_REGIONS)


def _strip_html(html: str, max_chars: int = 3000) -> str:
    return BeautifulSoup(html, "lxml").get_text(" ", strip=True)[:max_chars]


def _parse_rss_date(date_str: str) -> str | None:
    """Parse RFC-2822 RSS date → ISO string, return None on failure."""
    try:
        return parsedate_to_datetime(date_str).isoformat()
    except Exception:
        return None


def _iso_or_none(val: str | None) -> str | None:
    if not val:
        return None
    try:
        datetime.fromisoformat(val.replace("Z", "+00:00"))
        return val
    except Exception:
        return None


# ─── Remotive ────────────────────────────────────────────────────────────────

async def fetch_remotive(
    keywords: str,
    max_results: int = 50,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
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
            "posted_at": _iso_or_none(j.get("publication_date")),
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
        title    = item.findtext("title", "")
        link     = item.findtext("link", "")
        region   = item.findtext("region", "Anywhere in the World")
        category = item.findtext("category", "")
        job_type = item.findtext("type", "")
        desc_html = item.findtext("description", "")
        guid     = item.findtext("guid", link)
        pub_date = item.findtext("pubDate", "")

        searchable = (title + " " + category + " " + desc_html).lower()
        if kw_tokens and not any(kw in searchable for kw in kw_tokens):
            continue
        if pakistan_only and not _is_accessible_from_pakistan(region):
            continue

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
            "posted_at": _parse_rss_date(pub_date),
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
    url = "https://jobicy.com/api/v2/remote-jobs"
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
            "posted_at": _parse_rss_date(j.get("pubDate", "")),
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
            "posted_at": _parse_rss_date(j.get("pubDate", "")),
            "salary": salary,
            "raw": j,
        })
    log.info("[himalayas] fetched %d jobs for %r", len(jobs), keywords)
    return jobs


# ─── Rozee.pk (Pakistan) ─────────────────────────────────────────────────────

async def fetch_rozee_pk(
    keywords: str,
    location: str = "Pakistan",
    max_results: int = 40,
) -> list[dict[str, Any]]:
    """Scrape Rozee.pk public search — largest Pakistani job board."""
    # Normalize location: extract city name
    city = location.split(",")[0].strip().lower()
    loc_slug = city.replace(" ", "-") if city else "pakistan"

    url = "https://rozee.pk/jobs-search/"
    params = {
        "q[]": keywords,
        "fpn": loc_slug,
        "fr": "7",   # last 7 days
    }

    headers = {**_HEADERS, "Referer": "https://rozee.pk/"}
    jobs: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            html = resp.text
        except Exception as exc:
            log.warning("Rozee.pk fetch failed: %s", exc)
            return []

    soup = BeautifulSoup(html, "lxml")

    # Job cards are in <div class="job-listing"> or similar
    cards = soup.select("div.job-listing, li.job-listing, div.srp-tuple")
    if not cards:
        # Fallback: try generic job card selectors
        cards = soup.select("[class*='job'][class*='list'], [class*='job'][class*='card'], [class*='srp']")

    seen: set[str] = set()
    for card in cards[:max_results]:
        try:
            title_el = card.select_one("h2 a, h3 a, .job-title a, [class*='title'] a")
            company_el = card.select_one(".company-name, [class*='company'], [class*='employer']")
            loc_el = card.select_one(".job-location, [class*='location'], [class*='city']")
            date_el = card.select_one(".job-date, [class*='date'], [class*='posted'], time")
            desc_el = card.select_one(".job-desc, [class*='desc'], [class*='summary']")

            title = title_el.get_text(strip=True) if title_el else ""
            company = company_el.get_text(strip=True) if company_el else ""
            job_location = loc_el.get_text(strip=True) if loc_el else location
            description = desc_el.get_text(strip=True)[:1500] if desc_el else ""

            apply_url = ""
            if title_el and title_el.get("href"):
                href = title_el["href"]
                apply_url = href if href.startswith("http") else f"https://rozee.pk{href}"

            if not title or title in seen:
                continue
            seen.add(title)

            # Parse posted date
            posted_at = None
            if date_el:
                date_text = date_el.get_text(strip=True)
                # Try to parse "X days ago", "Today", or an actual date
                if "today" in date_text.lower():
                    posted_at = datetime.now(timezone.utc).isoformat()
                elif "yesterday" in date_text.lower():
                    from datetime import timedelta
                    posted_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
                elif re.search(r"\d{1,2}\s+\w+\s+\d{4}", date_text):
                    try:
                        posted_at = datetime.strptime(
                            re.search(r"\d{1,2}\s+\w+\s+\d{4}", date_text).group(), "%d %b %Y"
                        ).replace(tzinfo=timezone.utc).isoformat()
                    except Exception:
                        pass

            jobs.append({
                "source": "rozee_pk",
                "external_id": apply_url or title,
                "title": title,
                "company": company,
                "location": job_location or location,
                "description": description,
                "apply_url": apply_url,
                "apply_method": "manual",
                "posted_at": posted_at,
                "salary": "",
                "raw": {},
            })
        except Exception as exc:
            log.debug("Rozee.pk card parse error: %s", exc)
            continue

    log.info("[rozee_pk] fetched %d jobs for %r in %r", len(jobs), keywords, location)
    return jobs


# ─── LinkedIn Jobs (public guest API) ────────────────────────────────────────

async def fetch_linkedin_jobs(
    keywords: str,
    location: str = "Pakistan",
    max_results: int = 25,
) -> list[dict[str, Any]]:
    """LinkedIn public guest jobs — no auth required, returns HTML job cards."""
    url = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
    params = {
        "keywords": keywords,
        "location": location,
        "trk": "public_jobs_jobs-search-bar_search-submit",
        "start": "0",
        "count": min(max_results, 25),
    }
    headers = {
        **_HEADERS,
        "Referer": "https://www.linkedin.com/jobs/search/",
        "X-Requested-With": "XMLHttpRequest",
    }

    async with httpx.AsyncClient(timeout=30, headers=headers, follow_redirects=True) as client:
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            html = resp.text
        except Exception as exc:
            log.warning("LinkedIn jobs fetch failed: %s", exc)
            return []

    soup = BeautifulSoup(html, "lxml")
    cards = soup.select("li")

    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()

    for card in cards[:max_results]:
        try:
            title_el   = card.select_one(".base-search-card__title, h3")
            company_el = card.select_one(".base-search-card__subtitle, h4")
            loc_el     = card.select_one(".job-search-card__location, [class*='location']")
            link_el    = card.select_one("a.base-card__full-link, a[href*='/jobs/view/']")
            date_el    = card.select_one("time")

            title   = title_el.get_text(strip=True)   if title_el   else ""
            company = company_el.get_text(strip=True) if company_el else ""
            loc     = loc_el.get_text(strip=True)     if loc_el     else location

            if not title or title in seen:
                continue
            seen.add(title)

            apply_url = ""
            if link_el:
                href = link_el.get("href", "")
                # strip tracking params
                apply_url = href.split("?")[0] if href else ""

            posted_at = None
            if date_el:
                dt_attr = date_el.get("datetime", "")
                posted_at = _iso_or_none(dt_attr)

            jobs.append({
                "source": "linkedin",
                "external_id": apply_url or title,
                "title": title,
                "company": company,
                "location": loc,
                "description": f"{title} at {company} — {loc}. Apply via LinkedIn.",
                "apply_url": apply_url,
                "apply_method": "manual",
                "posted_at": posted_at,
                "salary": "",
                "raw": {},
            })
        except Exception as exc:
            log.debug("LinkedIn card parse error: %s", exc)
            continue

    log.info("[linkedin] fetched %d jobs for %r in %r", len(jobs), keywords, location)
    return jobs


# ─── Aggregate ───────────────────────────────────────────────────────────────

async def fetch_all_remote(
    keywords: str,
    max_per_source: int = 30,
    pakistan_only: bool = False,
) -> list[dict[str, Any]]:
    """Run all remote scrapers in parallel and deduplicate by title+company."""
    results = await asyncio.gather(
        fetch_remotive(keywords, max_per_source, pakistan_only),
        fetch_weworkremotely(keywords, pakistan_only),
        fetch_jobicy(keywords, max_per_source, pakistan_only),
        fetch_himalayas(keywords, max_per_source, pakistan_only),
        return_exceptions=True,
    )

    seen: set[tuple] = set()
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


async def fetch_all_pakistan(
    keywords: str,
    location: str,
    max_per_source: int = 40,
) -> list[dict[str, Any]]:
    """Run Pakistan-specific scrapers + pakistan-accessible remote jobs in parallel."""
    results = await asyncio.gather(
        fetch_rozee_pk(keywords, location, max_per_source),
        fetch_linkedin_jobs(keywords, location, max_per_source),
        fetch_remotive(keywords, max_per_source, pakistan_only=True),
        fetch_weworkremotely(keywords, pakistan_only=True),
        fetch_jobicy(keywords, max_per_source, pakistan_only=True),
        fetch_himalayas(keywords, max_per_source, pakistan_only=True),
        return_exceptions=True,
    )

    seen: set[tuple] = set()
    all_jobs: list[dict[str, Any]] = []
    for batch in results:
        if isinstance(batch, Exception):
            log.warning("Pakistan source error: %s", batch)
            continue
        for job in batch:
            key = (job["title"].lower().strip(), job["company"].lower().strip())
            if key in seen:
                continue
            seen.add(key)
            all_jobs.append(job)

    log.info("[pakistan_sources] total unique jobs: %d", len(all_jobs))
    return all_jobs
