"""Job Extractor Agent — parse a job posting from a URL or raw text.

Returns a structured dict with: job_title, company, location, description,
hr_email, hr_name, apply_url, source_domain.
Also exposes find_hr_email() to probe Hunter.io for contact emails.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup
from google.genai import types

from src.agents.base import BaseAgent
from src.config import settings
from src.llm.gemini import _extract_json, _get_client

log = logging.getLogger(__name__)

_EXTRACT_SYSTEM = """\
You are an expert at parsing job postings.
Given text from a job posting (scraped web page or forwarded message), extract:
  - job_title: the exact role title
  - company: company name
  - location: city / country / "Remote"
  - description: full job description — keep key requirements and responsibilities,
                 trim boilerplate, max ~800 words
  - hr_email: Search the ENTIRE text for any email address intended for job applications.
              Look for: addresses with prefixes hr, hiring, careers, career, recruitment,
              jobs, apply, talent, people, work, join; sentences like "send your CV to X",
              "email X", "apply to X@Y", "contact X at Y@Z", "reach us at X", "send to X@Y",
              "forward your resume to X"; and mailto: links.
              Also accept generic company emails (e.g. info@company.com, hello@company.com)
              if no HR-specific one exists and the domain matches the company.
              Do NOT invent or guess an address — only return one that is literally in the text.
              Return null ONLY if the text contains zero email addresses whatsoever.
  - hr_name: recruiter/HR person name if mentioned (null otherwise)
  - apply_url: direct application URL if different from source (null otherwise)
  - source_domain: the company's website domain, e.g. "stripe.com" (null if unknown)

Return ONLY valid JSON matching this schema — no markdown fences, no prose:
{
  "job_title": "...",
  "company": "...",
  "location": "...",
  "description": "...",
  "hr_email": null,
  "hr_name": null,
  "apply_url": null,
  "source_domain": null
}
"""

# Common job-board domains — don't use their domain for Hunter.io lookup
_JOB_BOARDS = {
    "linkedin.com", "indeed.com", "glassdoor.com", "reed.co.uk", "totaljobs.com",
    "adzuna.com", "monster.com", "ziprecruiter.com", "workable.com", "greenhouse.io",
    "lever.co", "ashbyhq.com", "jobs.lever.co",
}


class JobExtractorAgent(BaseAgent):
    name = "job_extractor"

    async def run(self, **kwargs):
        pass

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def extract_from_url(self, url: str) -> dict[str, Any]:
        """Fetch a job posting URL, scrape visible text, extract structure."""
        html = await self._fetch_html(url)
        text = self._html_to_text(html)
        result = await self._extract_with_gemini(text, source_url=url)
        # Derive domain from URL if Gemini didn't get it
        if not result.get("source_domain"):
            result["source_domain"] = self._domain_from_url(url)
        result["source_url"] = url
        return result

    async def extract_from_text(self, text: str) -> dict[str, Any]:
        """Extract job details from raw text (WhatsApp forward, email body, etc.)."""
        # If there's a URL in the text, try to scrape it first
        urls = re.findall(r"https?://[^\s\)>\"']+", text)
        for url in urls:
            try:
                return await self.extract_from_url(url)
            except Exception as exc:
                log.debug("URL extraction failed for %s: %s", url, exc)

        result = await self._extract_with_gemini(text)
        result["source_url"] = None
        return result

    async def find_hr_email(
        self,
        company: str,
        domain: str | None,
        hr_name: str | None = None,
    ) -> str | None:
        """
        Find the best HR contact email.
        Priority: Hunter.io domain search → name-based lookup → educated guess.
        """
        if not domain or domain.lower() in _JOB_BOARDS:
            domain = None

        # 1. Hunter.io domain search
        if settings.hunter_api_key and domain:
            email = await self._hunter_domain_search(domain, hr_name)
            if email:
                return email

        # 2. Hunter.io name + domain lookup
        if settings.hunter_api_key and domain and hr_name:
            email = await self._hunter_email_finder(hr_name, domain)
            if email:
                return email

        # 3. Educated guess fallback
        if domain:
            return f"careers@{domain}"

        return None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _fetch_html(self, url: str) -> str:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return resp.text

    @staticmethod
    def _html_to_text(html: str) -> str:
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "nav", "header", "footer", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        # Collapse excess blank lines
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text[:10_000]

    async def _extract_with_gemini(self, text: str, source_url: str = "") -> dict[str, Any]:
        client = _get_client()
        prefix = f"Source URL: {source_url}\n\n" if source_url else ""
        prompt = prefix + text[:7_000]
        try:
            response = await client.aio.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(system_instruction=_EXTRACT_SYSTEM),
            )
            return json.loads(_extract_json(response.text))
        except Exception as exc:
            log.warning("Gemini job extraction failed: %s", exc)
            return {
                "job_title": "",
                "company": "",
                "location": "",
                "description": text[:1_500],
                "hr_email": None,
                "hr_name": None,
                "apply_url": None,
                "source_domain": None,
            }

    async def _hunter_domain_search(self, domain: str, hr_name: str | None) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.hunter.io/v2/domain-search",
                    params={"domain": domain, "api_key": settings.hunter_api_key, "limit": 10},
                )
                data = resp.json().get("data", {})
                emails: list[dict] = data.get("emails", [])

            # Prefer HR/recruiting/talent departments
            hr_keywords = ("hr", "recruit", "talent", "people", "hiring", "careers")
            for e in emails:
                dept = (e.get("department") or "").lower()
                pos = (e.get("position") or "").lower()
                if any(k in dept or k in pos for k in hr_keywords):
                    return e["value"]

            # Fall back to first result
            return emails[0]["value"] if emails else None
        except Exception as exc:
            log.debug("Hunter domain search error: %s", exc)
            return None

    async def _hunter_email_finder(self, full_name: str, domain: str) -> str | None:
        parts = full_name.strip().split()
        if len(parts) < 2:
            return None
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.hunter.io/v2/email-finder",
                    params={
                        "domain": domain,
                        "first_name": parts[0],
                        "last_name": " ".join(parts[1:]),
                        "api_key": settings.hunter_api_key,
                    },
                )
                data = resp.json().get("data", {})
                return data.get("email") or None
        except Exception as exc:
            log.debug("Hunter email finder error: %s", exc)
            return None

    @staticmethod
    def _domain_from_url(url: str) -> str | None:
        m = re.search(r"https?://(?:www\.)?([^/]+)", url)
        if not m:
            return None
        domain = m.group(1)
        # Skip job boards — use exact or subdomain match to avoid false positives
        # e.g. "notlinkedin.com".endswith("linkedin.com") is True with a bare endswith.
        if domain in _JOB_BOARDS or any(domain.endswith("." + jb) for jb in _JOB_BOARDS):
            return None
        return domain
