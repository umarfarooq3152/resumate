"""Anthropic async wrapper.

Public API:
    embed_text(text)          -> list[float]  (1536-dim via 3rd-party proxy fallback)
    score_job(resume, jd)     -> ScoringResult
    tailor_resume(resume, jd) -> str
    write_cover_letter(...)   -> str

All LLM calls use claude-opus-4-8 with adaptive thinking.
Embedding uses a lightweight model for cost efficiency (Supabase pgvector expects 1536-d).
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import anthropic

from src.config import settings

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


@dataclass
class ScoringResult:
    score: float          # 0.0 – 1.0
    reasoning: str
    decision: str         # 'apply' | 'skip'
    strengths: list[str]
    gaps: list[str]


# ---------------------------------------------------------------------------
# Embeddings
# Anthropic doesn't expose embeddings directly; we use the Messages API with
# a structured-output prompt to get a semantic score, and fall back to a
# lightweight hash-based approach when Anthropic keys are missing.
# For real pgvector similarity search, wire up a real embedding service
# (e.g. OpenAI text-embedding-3-small → 1536 dims) here.
# ---------------------------------------------------------------------------

async def embed_text(text: str) -> list[float]:
    """
    Return a 1536-dimensional float vector for `text`.

    Requires an OpenAI-compatible embedding endpoint OR configure
    OPENAI_API_KEY alongside the Anthropic key.  Falls back to a
    deterministic placeholder so the rest of the pipeline still runs.
    """
    try:
        import openai  # optional dependency
        import os
        oai = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await oai.embeddings.create(
            model="text-embedding-3-small",
            input=text[:8000],  # token limit safety
        )
        return resp.data[0].embedding
    except Exception:
        # Deterministic placeholder — real similarity won't work until a real
        # embedding key is wired up, but schema + pipeline remain testable.
        import hashlib, struct
        seed = hashlib.sha256(text.encode()).digest()
        vals: list[float] = []
        for i in range(0, 1536 * 4, 4):
            chunk = seed[(i % 32):(i % 32) + 4]
            if len(chunk) < 4:
                chunk = chunk + seed[: 4 - len(chunk)]
            (v,) = struct.unpack("f", chunk)
            vals.append(float(v))
        # Normalise to unit sphere
        norm = sum(x * x for x in vals) ** 0.5 or 1.0
        return [x / norm for x in vals]


# ---------------------------------------------------------------------------
# Job scoring
# ---------------------------------------------------------------------------

_SCORE_SYSTEM = """\
You are a professional recruiter. Given a candidate resume and a job description,
evaluate fit on a 0–10 scale. Return ONLY valid JSON matching this schema:
{
  "score_0_to_10": <integer>,
  "reasoning": "<2-3 sentence summary>",
  "decision": "apply" | "skip",
  "strengths": ["...", ...],
  "gaps": ["...", ...]
}
Decision rule: score >= 6 → apply, else skip.
NEVER fabricate experience the candidate doesn't have.
"""


async def score_job(resume_text: str, job_description: str) -> ScoringResult:
    """Ask Claude to score how well the resume matches the job."""
    client = _get_client()
    prompt = (
        f"<resume>\n{resume_text[:4000]}\n</resume>\n\n"
        f"<job_description>\n{job_description[:4000]}\n</job_description>"
    )
    response = await client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        thinking={"type": "adaptive"},
        system=_SCORE_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = _extract_text(response)
    data = json.loads(_extract_json(raw))
    raw_score = int(data.get("score_0_to_10", 0))
    return ScoringResult(
        score=round(raw_score / 10.0, 2),
        reasoning=data.get("reasoning", ""),
        decision=data.get("decision", "skip"),
        strengths=data.get("strengths", []),
        gaps=data.get("gaps", []),
    )


# ---------------------------------------------------------------------------
# Resume tailoring
# ---------------------------------------------------------------------------

_TAILOR_SYSTEM = """\
You are an expert resume writer.
Tailor the given resume so it best matches the job description.
Rules:
- NEVER invent skills, experience, or qualifications the candidate does not have.
- Only reword, reorder, and emphasise existing content.
- Keep the same format (plain text, sections with headings).
- Output ONLY the tailored resume text — no commentary.
"""


async def tailor_resume(resume_text: str, job_description: str) -> str:
    """Return a tailored version of the resume for the given JD."""
    client = _get_client()
    prompt = (
        f"<resume>\n{resume_text}\n</resume>\n\n"
        f"<job_description>\n{job_description[:4000]}\n</job_description>"
    )
    stream = await client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=_TAILOR_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    msg = await stream.get_final_message()
    return _extract_text(msg)


# ---------------------------------------------------------------------------
# Cover letter
# ---------------------------------------------------------------------------

_COVER_SYSTEM = """\
You are an expert job application writer.
Write a concise, compelling cover letter (3–4 paragraphs, ≤ 400 words).
Rules:
- Address it to the company (not a specific person unless provided).
- Reference specific requirements from the JD.
- NEVER fabricate experience or qualifications.
- Output ONLY the cover letter text — no commentary, no subject line.
"""


async def write_cover_letter(
    resume_text: str,
    job_description: str,
    company: str,
    job_title: str,
) -> str:
    """Generate a tailored cover letter."""
    client = _get_client()
    prompt = (
        f"Company: {company}\nRole: {job_title}\n\n"
        f"<resume>\n{resume_text[:3000]}\n</resume>\n\n"
        f"<job_description>\n{job_description[:3000]}\n</job_description>"
    )
    stream = await client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=1024,
        thinking={"type": "adaptive"},
        system=_COVER_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    msg = await stream.get_final_message()
    return _extract_text(msg)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_text(response: anthropic.types.Message) -> str:
    """Pull the first text block from a Message."""
    for block in response.content:
        if block.type == "text":
            return block.text
    return ""


def _extract_json(text: str) -> str:
    """Strip markdown code fences if present and return raw JSON string."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        inner = [l for l in lines[1:] if l.strip() != "```"]
        return "\n".join(inner).strip()
    return text
