"""Form Filler Agent — analyzes and submits Google Forms on behalf of the user.

How it works (no browser required):
  1. Fetch the Google Forms HTML via httpx
  2. Extract FB_PUBLIC_LOAD_DATA_ (Google's internal data structure) from the page
  3. Parse questions, types, entry IDs, and options
  4. Use Gemini to propose an answer for every question based on the profile
  5. Submit via direct HTTP POST to the formResponse endpoint (DRY_RUN gated)
  6. Log everything to form_submissions + agent_events

Security:
  - Only docs.google.com/forms and forms.gle URLs are accepted
  - Submissions are blocked when DRY_RUN=true (default)
  - Full fill payload is always logged before any action
"""
from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from src.agents.base import BaseAgent
from src.config import settings
from src.db.client import insert_row, select_rows

log = logging.getLogger(__name__)

ALLOWED_DOMAINS = {"docs.google.com", "forms.gle", "forms.google.com"}

QUESTION_TYPES = {
    0: "short_text",
    1: "paragraph",
    2: "multiple_choice",
    3: "dropdown",
    4: "checkboxes",
    5: "linear_scale",
    7: "grid",
    9: "date",
    10: "time",
}


class FormFillerAgent(BaseAgent):
    name = "form_filler"

    async def run(self, **kwargs):
        """Not used — use analyze() and submit() directly."""
        pass

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    async def analyze(self, url: str, profile_id: str | None = None) -> dict[str, Any]:
        """Fetch form structure and propose fills using the user's profile."""
        url = await self._resolve_url(url)
        self._require_google_form(url)

        profile = await self._load_profile(profile_id)
        if not profile:
            raise ValueError("No profile found — create one first via the Profile page.")

        form = await self._fetch_form_structure(url)
        fills = await self._propose_fills(form["questions"], profile)

        return {
            "url": url,
            "form_title": form["title"],
            "questions": form["questions"],
            "proposed_fills": fills,
        }

    async def submit(
        self,
        url: str,
        fills: list[dict[str, Any]],
        profile_id: str | None = None,
        job_id: str | None = None,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        """Submit the form with the given fills. Always logs the full payload."""
        url = await self._resolve_url(url)
        self._require_google_form(url)

        profile = await self._load_profile(profile_id)

        await self.emit("form_filler.attempt", {
            "url": url,
            "job_id": job_id,
            "dry_run": dry_run,
            "fields": len(fills),
        })

        # Use Playwright to actually open the form in a browser and fill every field.
        # This handles all question types, multi-page forms, and JS-driven validation.
        submitted = False
        errors: list[dict] = []
        fill_results: list[dict] = []
        screenshot_b64: str | None = None

        try:
            submitted, errors, fill_results, screenshot_bytes = await self._submit_playwright(
                url, fills, dry_run
            )
            if screenshot_bytes:
                screenshot_b64 = base64.b64encode(screenshot_bytes).decode()
        except Exception as exc:
            log.error("Playwright submit failed: %s", exc)
            errors.append({"error": str(exc)})

        # Count fields that Playwright actually filled (not just ones with a value in fills)
        actually_filled = len([r for r in fill_results if r.get("filled")])
        status = "dry_run" if dry_run else ("submitted" if submitted else "error")

        # Persist to form_submissions
        try:
            await insert_row("form_submissions", {
                "url": url,
                "job_id": job_id,
                "profile_id": profile["id"] if profile else None,
                "fills": fills,
                "filled_count": actually_filled,
                "submitted": submitted,
                "dry_run": dry_run,
                "errors": errors,
                "status": status,
            })
        except Exception as exc:
            log.warning("Failed to save form submission record: %s", exc)

        await self.emit("form_filler.completed", {
            "url": url,
            "submitted": submitted,
            "dry_run": dry_run,
            "errors": len(errors),
            "job_id": job_id,
        })

        return {
            "url": url,
            "filled_count": actually_filled,
            "fill_results": fill_results,
            "submitted": submitted,
            "dry_run": dry_run,
            "errors": errors,
            "status": status,
            "screenshot": screenshot_b64,
        }

    # -----------------------------------------------------------------------
    # Form structure extraction
    # -----------------------------------------------------------------------

    async def _fetch_form_structure(self, url: str) -> dict[str, Any]:
        """Download the form page and extract questions — four strategies in order."""
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        }
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            html = resp.text

        # Detect login redirect — form requires a Google account
        if "accounts.google.com" in str(resp.url) or "ServiceLogin" in html:
            raise ValueError(
                "This Google Form requires a Google account to access. "
                "Please make the form public (anyone with link) and try again."
            )

        title_m = re.search(r"<title>([^<]+)</title>", html)
        page_title = (
            title_m.group(1).replace(" - Google Forms", "").strip()
            if title_m else "Google Form"
        )

        # ── Strategy 1: FB_PUBLIC_LOAD_DATA_ ──────────────────────────────────
        raw = self._extract_json_var(html, "FB_PUBLIC_LOAD_DATA_")
        if raw and isinstance(raw, list):
            try:
                result = self._parse_fb_data(raw)
                if result.get("questions"):
                    result.setdefault("title", page_title)
                    return result
            except Exception as exc:
                log.warning("FB_PUBLIC_LOAD_DATA_ parse failed: %s", exc)

        # ── Strategy 2: AF_initDataCallback data arrays ────────────────────────
        for cb_data in self._extract_af_init_callbacks(html):
            if isinstance(cb_data, list):
                try:
                    result = self._parse_fb_data(cb_data)
                    if result.get("questions"):
                        result.setdefault("title", page_title)
                        log.info("[form_filler] parsed via AF_initDataCallback")
                        return result
                except Exception:
                    pass

        # ── Strategy 3: entry-ID scan + Gemini on script-tag content ──────────
        entry_stubs = self._extract_entry_ids_from_html(html)
        log.info("[form_filler] entry-ID scan found %d stubs", len(entry_stubs))
        script_content = self._extract_script_content(html)
        questions = await self._gemini_parse_html(script_content or html[:30_000], entry_stubs)
        if questions:
            return {"title": page_title, "questions": questions}

        # ── Strategy 4: Playwright rendering (handles JS-heavy / dynamically rendered forms) ─────
        try:
            pw_result = await self._playwright_fetch(url, page_title)
            pw_questions = pw_result.get("questions", [])
            # Only use Playwright result if it has labelled questions (not bare entry IDs as titles)
            labelled = [q for q in pw_questions if q.get("title") and not q["title"].startswith("entry.")]
            if labelled:
                log.info("[form_filler] Playwright returned %d labelled questions", len(labelled))
                return {"title": pw_result.get("title", page_title), "questions": labelled}
        except Exception as exc:
            log.warning("[form_filler] Playwright fallback failed: %s", exc)

        if entry_stubs:
            log.warning("[form_filler] Returning bare entry stubs — all strategies exhausted")
        return {"title": page_title, "questions": entry_stubs}

    def _parse_fb_data(self, data: list) -> dict[str, Any]:
        """Parse Google Forms internal data structure — handles multiple layout versions."""
        title = ""
        items: list = []

        try:
            inner = data[1]
            # Title: prefer index 8 (older), fall back to index 0 sub-fields
            if len(inner) > 8 and isinstance(inner[8], str) and inner[8]:
                title = inner[8]
            # Items: usually at inner[1]
            if len(inner) > 1 and isinstance(inner[1], list):
                items = inner[1]
        except (IndexError, TypeError):
            return {"title": "Google Form", "questions": []}

        questions = []
        for item in (items or []):
            try:
                if not isinstance(item, list) or len(item) < 2:
                    continue

                # Title: try index 1 first (most common), then 0
                q_title = ""
                for ti in (1, 0):
                    if len(item) > ti and isinstance(item[ti], str) and item[ti].strip():
                        q_title = item[ti].strip()
                        break
                if not q_title:
                    continue

                # item[3] is 0 for most questions and 8 for page breaks — skip breaks
                item_kind = item[3] if len(item) > 3 and isinstance(item[3], int) else 0
                if item_kind == 8:  # page/section break
                    continue

                # Field data lives at item[4][0]
                entry_id: int | None = None
                options: list[str] = []
                required = False
                q_type_raw = 0

                if len(item) > 4 and isinstance(item[4], list) and item[4]:
                    field_data = item[4][0]
                    if isinstance(field_data, list) and field_data:
                        # Entry ID at [0]
                        if isinstance(field_data[0], int):
                            entry_id = field_data[0]

                        # Options at [1]: [[label, ...], ...]
                        if len(field_data) > 1 and isinstance(field_data[1], list):
                            for opt in field_data[1]:
                                if opt and isinstance(opt, list) and opt[0] and isinstance(opt[0], str):
                                    options.append(opt[0])

                        # Required at [2]
                        required = bool(field_data[2]) if len(field_data) > 2 else False

                        # Question type: try field_data[7] first (newer layout),
                        # then fall back to item[3] (older layout)
                        for type_src in (
                            (field_data[7] if len(field_data) > 7 and isinstance(field_data[7], int) else None),
                            (item[3] if len(item) > 3 and isinstance(item[3], int) and item[3] != 0 else None),
                            (item[6] if len(item) > 6 and isinstance(item[6], int) else None),
                        ):
                            if type_src is not None:
                                q_type_raw = type_src
                                break

                if entry_id is None:
                    continue

                questions.append({
                    "entry_id": f"entry.{entry_id}",
                    "title": q_title,
                    "type": QUESTION_TYPES.get(q_type_raw, "short_text"),
                    "options": options,
                    "required": required,
                })
            except (IndexError, TypeError):
                continue

        return {"title": title or "Google Form", "questions": questions}

    # -----------------------------------------------------------------------
    # Gemini fill proposal
    # -----------------------------------------------------------------------

    async def _propose_fills(
        self, questions: list[dict], profile: dict
    ) -> list[dict[str, Any]]:
        """Ask Gemini to produce the best answer for each form question."""
        if not questions:
            return []

        client = self._gemini_client()
        if not client and not settings.groq_configured:
            return []

        # Identify narrative questions (paragraph / essay fields) — these are the only
        # ones that benefit from resume context.  Simple fields (name, email, CGPA…)
        # are answered from personal details alone.
        _NARRATIVE_KEYWORDS = (
            "why", "describe", "tell us", "about yourself", "motivation",
            "cover letter", "experience", "background", "interest", "objective",
            "summary", "profile", "statement",
        )
        narrative_qs = [
            q for q in questions
            if q.get("type") in ("paragraph",)
            or any(kw in (q.get("title") or "").lower() for kw in _NARRATIVE_KEYWORDS)
        ]

        # Retrieve only the resume sections relevant to these narrative questions.
        # This keeps the prompt small while still giving the AI the right context.
        relevant_resume = ""
        raw_resume = profile.get("resume_text") or ""
        if narrative_qs and raw_resume:
            narrative_query = " ".join(q.get("title", "") for q in narrative_qs[:5])
            try:
                from src.llm.gemini import get_relevant_resume_context
                relevant_resume = await get_relevant_resume_context(
                    raw_resume, narrative_query, top_k=3, max_chars=1_200,
                )
            except Exception:
                relevant_resume = raw_resume[:1_200]

        # Build profile context — personal details always included, resume only when needed
        extra = {k: v for k, v in (profile.get("personal_details") or {}).items() if v}
        profile_ctx = {
            "full_name":       profile.get("full_name", ""),
            "email":           profile.get("email", ""),
            "phone":           profile.get("phone", ""),
            "whatsapp_number": profile.get("whatsapp_number", "") or profile.get("phone", ""),
            "date_of_birth":   profile.get("date_of_birth", ""),
            "cnic":            profile.get("cnic", ""),
            "address":         profile.get("address", ""),
            "university":      profile.get("university", ""),
            "department":      profile.get("department", ""),
            "semester":        profile.get("semester", ""),
            "cgpa":            profile.get("cgpa", ""),
            "linkedin_url":    profile.get("linkedin_url", ""),
            "github_url":      profile.get("github_url", ""),
            "target_title":    profile.get("target_title", ""),
            "target_location": profile.get("target_location", ""),
            **({"relevant_experience": relevant_resume} if relevant_resume else {}),
            **extra,
        }
        # Strip empty values so the prompt isn't cluttered
        profile_ctx = {k: v for k, v in profile_ctx.items() if v}

        prompt = f"""You are filling a Google Form for a candidate. Use their profile to answer every question.

CANDIDATE PROFILE (use ONLY this data — never fabricate anything not listed here):
{json.dumps(profile_ctx, indent=2)}

FORM QUESTIONS:
{json.dumps(questions, indent=2)}

For each question return the best answer using the candidate's actual data.
Rules:
- Use ONLY information present in the profile — never invent facts
- If a field is missing from the profile, set value to empty string and confidence to "low"
- For "cover letter / why interested / motivation / tell us about yourself" questions: write 2-3 professional sentences from the resume and profile
- For radio/dropdown/checkboxes: pick the closest-matching option from the options array
- For scale questions (linear_scale): return the numeric value as a string
- For date/time: use profile date_of_birth or leave empty if unknown
- For WhatsApp/phone: use whatsapp_number or phone from profile
- For university/institution: use the university field
- For department/faculty: use the department field
- For semester/year of study: use the semester field
- For CGPA/GPA/marks: use the cgpa field
- Skip file upload questions (value = "")

Return a JSON array (no markdown):
[
  {{
    "entry_id": "entry.XXXXXXXX",
    "question": "<title>",
    "type": "<type>",
    "value": "<answer string>",
    "confidence": "high|medium|low"
  }},
  ...
]"""

        raw: str | None = None
        try:
            if client:
                resp = await client.aio.models.generate_content(
                    model=settings.gemini_model,
                    contents=prompt,
                )
                raw = (resp.text or "").strip()
        except Exception as exc:
            log.warning("Gemini fill proposal failed: %s — trying Groq", exc)

        if not raw and settings.groq_configured:
            try:
                from src.llm.gemini import _groq_generate
                raw = await _groq_generate(
                    "You are a form-filling assistant. Return only valid JSON arrays.",
                    prompt,
                )
                raw = (raw or "").strip()
            except Exception as exc:
                log.error("Groq fill proposal also failed: %s", exc)

        if not raw:
            return []

        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                # Merge options from original questions into fills so downstream
                # code can show available choices to the user.
                entry_to_q = {q["entry_id"]: q for q in questions}
                for fill in parsed:
                    eid = fill.get("entry_id", "")
                    src_q = entry_to_q.get(eid, {})
                    opts = src_q.get("options") or []
                    if opts:
                        fill["options"] = opts
                    # Ensure type is carried through (AI sometimes omits it)
                    if not fill.get("type") and src_q.get("type"):
                        fill["type"] = src_q["type"]
                return parsed
        except Exception as exc:
            log.error("Fill proposal JSON parse failed: %s", exc)
        return []

    # -----------------------------------------------------------------------
    # Browser-based submission (Playwright)
    # -----------------------------------------------------------------------

    async def _submit_playwright(
        self,
        url: str,
        fills: list[dict[str, Any]],
        dry_run: bool,
    ) -> tuple[bool, list[dict], list[dict], bytes | None]:
        """Open the form in a real browser, fill every field, screenshot, and optionally submit.

        Returns (submitted, errors, fill_results, screenshot_bytes).
        fill_results is a per-field list of {entry_id, filled, error?}.
        """
        from playwright.async_api import async_playwright, TimeoutError as PwTimeout

        # Only attempt fields that have a value
        fill_map = {
            f["entry_id"]: f
            for f in fills
            if f.get("entry_id") and str(f.get("value", "")).strip()
        }

        errors: list[dict] = []
        fill_results: list[dict] = []

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                page = await browser.new_page(viewport={"width": 1280, "height": 900})
                await page.goto(url, wait_until="networkidle", timeout=30_000)

                page_num = 0
                max_pages = 20

                while page_num < max_pages:
                    page_num += 1
                    try:
                        await page.wait_for_load_state("domcontentloaded", timeout=8_000)
                    except PwTimeout:
                        pass

                    # Fill every field that is visible on this page
                    for entry_id, fill in fill_map.items():
                        if any(r["entry_id"] == entry_id and r["filled"] for r in fill_results):
                            continue  # already filled on a previous page
                        result = await self._pw_fill_field(page, entry_id, fill)
                        result["entry_id"] = entry_id
                        fill_results.append(result)
                        if result.get("error"):
                            log.debug("[form_filler] %s: %s", entry_id, result["error"])

                    # Locate navigation buttons
                    submit_btn = page.locator(
                        '[jsname="M2UYVd"], [aria-label="Submit"], button[type="submit"]'
                    ).first
                    next_btn = page.locator(
                        '[jsname="OCpkoe"], [aria-label="Next section"], [aria-label="Next"]'
                    ).first

                    submit_visible = False
                    next_visible = False
                    try:
                        submit_visible = await submit_btn.is_visible(timeout=2_000)
                    except Exception:
                        pass
                    try:
                        next_visible = await next_btn.is_visible(timeout=2_000)
                    except Exception:
                        pass

                    if submit_visible:
                        screenshot = await page.screenshot(
                            full_page=True, type="jpeg", quality=75
                        )
                        if not dry_run:
                            try:
                                await submit_btn.click(timeout=5_000)
                                await page.wait_for_timeout(3_000)
                                # Detect confirmation
                                final_url = page.url
                                confirmed = (
                                    "formResponse" in final_url
                                    or "afformResponse" in final_url
                                )
                                if not confirmed:
                                    try:
                                        await page.wait_for_selector(
                                            ':text("Your response has been recorded"), '
                                            ':text("response has been recorded"), '
                                            ':text("Thanks for filling")',
                                            timeout=6_000,
                                        )
                                        confirmed = True
                                    except PwTimeout:
                                        pass
                                if confirmed:
                                    screenshot = await page.screenshot(
                                        full_page=True, type="jpeg", quality=75
                                    )
                                else:
                                    errors.append({"error": "Submit clicked but no confirmation detected"})
                                return confirmed, errors, fill_results, screenshot
                            except Exception as exc:
                                errors.append({"error": f"Submit click failed: {exc}"})
                                return False, errors, fill_results, screenshot
                        else:
                            # Dry run: screenshot the filled form, don't click submit
                            return False, errors, fill_results, screenshot

                    elif next_visible:
                        await next_btn.click(timeout=5_000)
                        await page.wait_for_timeout(1_000)
                    else:
                        # No nav button found — single-page or end of form
                        screenshot = await page.screenshot(
                            full_page=True, type="jpeg", quality=75
                        )
                        errors.append({"error": "Could not locate Submit or Next button"})
                        return False, errors, fill_results, screenshot

                screenshot = await page.screenshot(full_page=True, type="jpeg", quality=75)
                errors.append({"error": "Exceeded max page count — form may have too many sections"})
                return False, errors, fill_results, screenshot

            finally:
                await browser.close()

    async def _pw_fill_field(
        self, page, entry_id: str, fill: dict
    ) -> dict:
        """Fill one field on the current Playwright page. Returns {filled, error?}."""
        from playwright.async_api import TimeoutError as PwTimeout

        value = str(fill.get("value", "")).strip()
        q_type = fill.get("type", "short_text")
        if not value:
            return {"filled": False}

        try:
            # ── Text / paragraph ──────────────────────────────────────────
            if q_type in ("short_text", "paragraph"):
                el = page.locator(f'[name="{entry_id}"]').first
                try:
                    await el.wait_for(state="visible", timeout=3_000)
                    await el.triple_click()   # select all existing text
                    await el.fill(value)
                    return {"filled": True}
                except PwTimeout:
                    return {"filled": False}  # not on this page yet

            # ── Multiple choice (radio) ────────────────────────────────────
            elif q_type == "multiple_choice":
                # 1. aria-label exact match
                for locstr in (
                    f'[role="radio"][aria-label="{value}"]',
                    f'[role="radio"][data-value="{value}"]',
                ):
                    el = page.locator(locstr).first
                    try:
                        await el.wait_for(state="visible", timeout=1_500)
                        await el.click()
                        return {"filled": True}
                    except Exception:
                        pass
                # 2. Find radio by visible text inside the entry's container
                try:
                    container = page.locator(
                        f'[jsmodel]:has([name="{entry_id}"]), '
                        f'[data-item-id]:has([name="{entry_id}"]), '
                        f'[role="listitem"]:has([name="{entry_id}"])'
                    ).first
                    radio = container.locator(f'[role="radio"]:has-text("{value}")').first
                    await radio.wait_for(state="visible", timeout=2_000)
                    await radio.click()
                    return {"filled": True}
                except Exception:
                    pass
                return {"filled": False, "error": f"Radio option '{value}' not found"}

            # ── Checkboxes ────────────────────────────────────────────────
            elif q_type == "checkboxes":
                values = [v.strip() for v in value.split(",") if v.strip()]
                filled_any = False
                for v in values:
                    for locstr in (
                        f'[role="checkbox"][aria-label="{v}"]',
                        f'[role="checkbox"][data-value="{v}"]',
                    ):
                        el = page.locator(locstr).first
                        try:
                            await el.wait_for(state="visible", timeout=1_500)
                            # Only click if not already checked
                            checked = await el.get_attribute("aria-checked")
                            if checked != "true":
                                await el.click()
                            filled_any = True
                            break
                        except Exception:
                            pass
                return {"filled": filled_any}

            # ── Dropdown ──────────────────────────────────────────────────
            elif q_type == "dropdown":
                # Native <select>
                sel = page.locator(f'select[name="{entry_id}"]').first
                try:
                    await sel.wait_for(state="visible", timeout=1_500)
                    await sel.select_option(label=value)
                    return {"filled": True}
                except Exception:
                    pass
                # Google custom dropdown: open it, then pick option by text
                try:
                    # Find the visible dropdown opener near the entry ID
                    container = page.locator(
                        f'[jsmodel]:has([name="{entry_id}"]), '
                        f'[data-item-id]:has([name="{entry_id}"])'
                    ).first
                    opener = container.locator('[role="listbox"], [aria-haspopup="true"]').first
                    await opener.wait_for(state="visible", timeout=2_000)
                    await opener.click()
                    await page.wait_for_timeout(400)
                    option = page.locator(f'[role="option"]:has-text("{value}")').first
                    await option.wait_for(state="visible", timeout=3_000)
                    await option.click()
                    return {"filled": True}
                except Exception as exc:
                    return {"filled": False, "error": f"Dropdown failed: {exc}"}

            # ── Linear scale ──────────────────────────────────────────────
            elif q_type == "linear_scale":
                for locstr in (
                    f'[name="{entry_id}"][value="{value}"]',
                    f'[role="radio"][aria-label="{value}"]',
                    f'[role="radio"][data-value="{value}"]',
                ):
                    el = page.locator(locstr).first
                    try:
                        await el.wait_for(state="visible", timeout=1_500)
                        await el.click()
                        return {"filled": True}
                    except Exception:
                        pass
                return {"filled": False, "error": f"Scale value '{value}' not found"}

            # ── Date ─────────────────────────────────────────────────────
            elif q_type == "date":
                # Try a single date input first
                el = page.locator(f'[name="{entry_id}"]').first
                try:
                    await el.wait_for(state="visible", timeout=2_000)
                    await el.fill(value)
                    return {"filled": True}
                except Exception:
                    pass
                # Split date into parts: YYYY-MM-DD or DD/MM/YYYY
                parts = re.split(r"[-/]", value)
                if len(parts) == 3:
                    year_el = page.locator(f'[name="{entry_id}_year"]').first
                    month_el = page.locator(f'[name="{entry_id}_month"]').first
                    day_el = page.locator(f'[name="{entry_id}_day"]').first
                    try:
                        await year_el.wait_for(state="visible", timeout=2_000)
                        await year_el.fill(parts[0])
                        await month_el.fill(parts[1])
                        await day_el.fill(parts[2])
                        return {"filled": True}
                    except Exception:
                        pass
                return {"filled": False}

            # ── Fallback: generic input fill ──────────────────────────────
            else:
                el = page.locator(f'[name="{entry_id}"]').first
                try:
                    await el.wait_for(state="visible", timeout=2_000)
                    await el.fill(value)
                    return {"filled": True}
                except PwTimeout:
                    return {"filled": False}

        except Exception as exc:
            log.warning("[form_filler] Unexpected fill error on %s: %s", entry_id, exc)
            return {"filled": False, "error": str(exc)}

    # -----------------------------------------------------------------------
    # Helpers
    # -----------------------------------------------------------------------

    async def _resolve_url(self, url: str) -> str:
        """Follow redirects for shortened URLs like forms.gle."""
        if "forms.gle" in url:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(url)
                return str(resp.url)
        return url

    def _require_google_form(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.netloc not in ALLOWED_DOMAINS:
            raise ValueError(
                f"Only Google Forms URLs are supported (got: {parsed.netloc}). "
                f"Allowed: {', '.join(ALLOWED_DOMAINS)}"
            )
        if parsed.netloc != "forms.gle" and "/forms/" not in parsed.path:
            raise ValueError(f"URL does not look like a Google Forms link: {url}")

    def _gemini_client(self):
        if not settings.gemini_configured:
            log.warning("GEMINI_API_KEY not set — cannot propose fills")
            return None
        from src.llm.gemini import _get_client
        return _get_client()

    async def _load_profile(self, profile_id: str | None) -> dict[str, Any] | None:
        if profile_id:
            rows = await select_rows("profiles", filters={"id": profile_id}, limit=1)
        else:
            rows = await select_rows("profiles", limit=1)
        return rows[0] if rows else None

    def _extract_json_var(self, html: str, var_name: str):
        """Extract a JS variable's value using balanced-bracket counting (handles nested JSON)."""
        pattern = re.search(rf'(?:var\s+)?(?:window\.)?{re.escape(var_name)}\s*=\s*', html)
        if not pattern:
            return None

        start = pattern.end()
        if start >= len(html):
            return None

        first = html[start]
        if first not in ('[', '{'):
            return None

        open_c, close_c = (('[', ']') if first == '[' else ('{', '}'))
        depth = 0
        in_str = False
        escape = False

        for i in range(start, min(start + 2_000_000, len(html))):
            c = html[i]
            if escape:
                escape = False
                continue
            if c == '\\' and in_str:
                escape = True
                continue
            if c == '"' and not escape:
                in_str = not in_str
                continue
            if in_str:
                continue
            if c == open_c:
                depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(html[start:i + 1])
                    except json.JSONDecodeError:
                        return None
        return None

    def _extract_entry_ids_from_html(self, html: str) -> list[dict]:
        """Scan raw HTML for entry.XXXXXXXX patterns as a fallback."""
        # Google Forms embeds entry IDs in JSON data, data-params attrs, and name= attrs
        patterns = [
            r'entry[._](\d{5,15})',          # most common: entry.123456 or entry_123456
            r'"(\d{7,15})","sq-i\d+',        # newer format near sq-i labels
            r'name=["\']entry\.(\d{5,15})',   # input name attribute
        ]
        seen: dict[str, dict] = {}
        for pat in patterns:
            for eid in re.findall(pat, html):
                key = f"entry.{eid}"
                if key not in seen:
                    seen[key] = {
                        "entry_id": key,
                        "title": f"Field {eid}",
                        "type": "short_text",
                        "options": [],
                        "required": False,
                    }
        return list(seen.values())

    def _extract_script_content(self, html: str) -> str:
        """Extract text from all <script> tags — much more signal-dense than raw HTML."""
        chunks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
        # Keep only scripts that contain entry IDs or FB_PUBLIC_LOAD_DATA markers
        relevant = [c for c in chunks if re.search(r'entry\.\d{5,}|FB_PUBLIC_LOAD_DATA|form-id', c)]
        combined = "\n".join(relevant)
        return combined[:60_000] if combined else ""

    def _extract_af_init_callbacks(self, html: str) -> list:
        """Extract data arrays from AF_initDataCallback({..., data: [...]}) calls."""
        results: list = []
        for m in re.finditer(r'AF_initDataCallback\s*\(\s*\{', html):
            # Extract the full callback object using balanced brackets
            obj_start = m.end() - 1  # points to the opening {
            obj = self._extract_balanced_from(html, obj_start, '{', '}')
            if not obj:
                continue
            # Look for the "data" key inside it
            data_m = re.search(r'"data"\s*:\s*(\[)', obj)
            if not data_m:
                continue
            # Parse the data array
            arr_start_in_obj = data_m.start(1)
            arr_raw = self._extract_balanced_from(obj, arr_start_in_obj, '[', ']')
            if arr_raw:
                try:
                    parsed = json.loads(arr_raw)
                    if isinstance(parsed, list):
                        results.append(parsed)
                except json.JSONDecodeError:
                    pass
        return results

    def _extract_balanced_from(self, text: str, start: int, open_c: str, close_c: str) -> str | None:
        """Extract the balanced-bracket substring starting at `start`."""
        if start >= len(text) or text[start] != open_c:
            return None
        depth = 0
        in_str = False
        escape = False
        for i in range(start, min(start + 500_000, len(text))):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == '\\' and in_str:
                escape = True
                continue
            if c == '"' and not escape:
                in_str = not in_str
                continue
            if in_str:
                continue
            if c == open_c:
                depth += 1
            elif c == close_c:
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        return None

    async def _playwright_fetch(self, url: str, page_title: str) -> dict[str, Any]:
        """Render the form in a headless browser and extract full question structure."""
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                page = await browser.new_page()
                await page.goto(url, wait_until="networkidle", timeout=30000)

                # Wait a beat for React/Angular hydration
                try:
                    await page.wait_for_selector(
                        '[name^="entry."], .freebirdFormviewerComponentsQuestionBaseRoot, [data-item-id]',
                        timeout=8000,
                    )
                except Exception:
                    pass

                # ── A: FB_PUBLIC_LOAD_DATA_ after JS execution ──────────────
                raw = await page.evaluate(
                    "() => window.FB_PUBLIC_LOAD_DATA_ || null"
                )
                if raw and isinstance(raw, list):
                    result = self._parse_fb_data(raw)
                    if result.get("questions"):
                        result.setdefault("title", page_title)
                        log.info("[form_filler] Playwright: parsed via FB_PUBLIC_LOAD_DATA_")
                        return result

                # ── B: structured DOM extraction ────────────────────────────
                dom_questions = await page.evaluate("""
                    () => {
                        const questions = [];
                        const seen = new Set();

                        // Helper: clean text content
                        const text = el => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : '');

                        // Helper: find title inside a container
                        const findTitle = (root) => {
                            for (const sel of [
                                '.freebirdFormviewerComponentsQuestionBaseTitle',
                                '.freebirdFormviewerComponentsQuestionBaseStem',
                                '[role="heading"]',
                                '[data-label]',
                                'h1, h2, h3, h4',
                            ]) {
                                const el = root.querySelector(sel);
                                if (el) {
                                    const t = text(el);
                                    if (t) return t;
                                }
                            }
                            return '';
                        };

                        // Helper: find container for an input by walking up
                        const findContainer = (input) => {
                            let el = input.parentElement;
                            for (let i = 0; i < 20 && el; i++) {
                                if (
                                    el.matches('[data-item-id]') ||
                                    el.matches('.freebirdFormviewerComponentsQuestionBaseRoot') ||
                                    el.matches('[jscontroller]') ||
                                    el.matches('[role="listitem"]')
                                ) return el;
                                el = el.parentElement;
                            }
                            // Fallback: walk up until we find a heading sibling
                            el = input.parentElement;
                            for (let i = 0; i < 20 && el; i++) {
                                if (findTitle(el)) return el;
                                el = el.parentElement;
                            }
                            return null;
                        };

                        // Collect options from a container
                        const getOptions = (container) => {
                            const opts = [];
                            // Radio / checkbox via aria-label
                            for (const el of container.querySelectorAll('[role="radio"], [role="checkbox"]')) {
                                const lbl = el.getAttribute('aria-label') ||
                                            text(el.closest('label') || el.parentElement);
                                if (lbl) opts.push(lbl);
                            }
                            if (opts.length) return opts;
                            // Dropdown / listbox options
                            for (const el of container.querySelectorAll('[role="option"], option')) {
                                const t = text(el);
                                if (t) opts.push(t);
                            }
                            // data-value spans used in newer layouts
                            if (!opts.length) {
                                for (const el of container.querySelectorAll('[data-value]')) {
                                    const v = el.getAttribute('data-value') || text(el);
                                    if (v) opts.push(v);
                                }
                            }
                            return opts;
                        };

                        // Determine question type from container DOM
                        const getType = (container) => {
                            if (container.querySelector('textarea')) return 'paragraph';
                            if (container.querySelector('[role="radio"]')) return 'multiple_choice';
                            if (container.querySelector('[role="checkbox"]')) return 'checkboxes';
                            if (container.querySelector('select, [role="listbox"]')) return 'dropdown';
                            if (container.querySelector('[role="slider"]')) return 'linear_scale';
                            if (container.querySelector('input[type="date"]')) return 'date';
                            if (container.querySelector('input[type="time"]')) return 'time';
                            return 'short_text';
                        };

                        // Process all entry inputs
                        const inputs = [...document.querySelectorAll('[name^="entry."]')];
                        for (const input of inputs) {
                            const entryId = input.name;
                            if (seen.has(entryId)) continue;
                            seen.add(entryId);

                            const container = findContainer(input);
                            if (!container) continue;

                            const title = findTitle(container);
                            if (!title) continue;

                            const type = getType(container);
                            const options = (type !== 'short_text' && type !== 'paragraph')
                                ? getOptions(container) : [];
                            const required = !!container.querySelector('[aria-required="true"], [required]');

                            questions.push({ entryId, title, type, options, required });
                        }

                        return questions;
                    }
                """)

                if dom_questions:
                    questions = [
                        {
                            "entry_id": q["entryId"],
                            "title": q["title"],
                            "type": q.get("type", "short_text"),
                            "options": q.get("options", []),
                            "required": q.get("required", False),
                        }
                        for q in dom_questions
                        if q.get("entryId") and q.get("title")
                        and not q["title"].startswith("entry.")
                    ]
                    if questions:
                        log.info("[form_filler] Playwright: extracted %d questions from DOM", len(questions))
                        return {"title": page_title, "questions": questions}

                # ── C: send rendered HTML to Gemini/Groq as last resort ──────
                rendered_html = await page.content()
                entry_stubs = self._extract_entry_ids_from_html(rendered_html)
                script_content = self._extract_script_content(rendered_html)
                questions = await self._gemini_parse_html(
                    script_content or rendered_html[:30_000], entry_stubs
                )
                if questions:
                    log.info("[form_filler] Playwright: Gemini parsed %d questions from rendered HTML", len(questions))
                    return {"title": page_title, "questions": questions}

                # ── D: bare entry stubs (Gemini also found nothing) ──────────
                questions = [
                    {"entry_id": s["entry_id"], "title": s["entry_id"],
                     "type": "short_text", "options": [], "required": False}
                    for s in entry_stubs
                ]
                return {"title": page_title, "questions": questions}

            finally:
                await browser.close()

    async def _gemini_parse_html(self, content: str, entry_stubs: list[dict] | None = None) -> list[dict]:
        """Ask Gemini (or Groq) to extract form fields from page content."""
        hints = [s["entry_id"] for s in (entry_stubs or [])][:30]

        prompt = f"""Analyse this Google Forms page content and extract every form question.

Known entry IDs found in the content (match these to their question labels):
{hints if hints else "(none found — search for entry.XXXXXXXX patterns yourself)"}

PAGE CONTENT (script tags and JSON data):
{content}

Return a JSON array of questions. For each question include:
- entry_id: the "entry.XXXXXXXX" string
- title: the human-readable question text
- type: one of short_text, paragraph, multiple_choice, dropdown, checkboxes, linear_scale, date, time
- options: array of option strings (empty for open-ended)
- required: true or false

Return ONLY the JSON array. No markdown, no commentary. If nothing found return [].
"""
        # Try Gemini first, Groq as fallback
        raw: str | None = None
        try:
            client = self._gemini_client()
            if client:
                resp = await client.aio.models.generate_content(
                    model=settings.gemini_model,
                    contents=prompt,
                )
                raw = (resp.text or "").strip()
        except Exception as exc:
            log.warning("[form_filler] Gemini HTML parse failed: %s — trying Groq", exc)

        if not raw and settings.groq_configured:
            try:
                from src.llm.gemini import _groq_generate
                raw = await _groq_generate(
                    "You are a Google Forms structure extractor. Return only valid JSON arrays.",
                    prompt,
                )
            except Exception as exc:
                log.warning("[form_filler] Groq HTML parse also failed: %s", exc)

        if not raw:
            return []

        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
        return []
