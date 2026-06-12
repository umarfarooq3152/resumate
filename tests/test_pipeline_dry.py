"""
Dry-run integration tests — fully mocked, no real network/DB/Claude calls.
Run: pytest tests/test_pipeline_dry.py -v
"""
from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

JOB_ID = str(uuid.uuid4())
PROFILE_ID = str(uuid.uuid4())

# Adzuna API response shape (nested company/location)
ADZUNA_JOB = {
    "id": "adzuna-123",
    "title": "Senior Python Developer",
    "company": {"display_name": "TestCorp"},
    "location": {"display_name": "London"},
    "description": "We need a Python developer with FastAPI and Postgres experience.",
    "redirect_url": "https://docs.google.com/forms/d/test",
}

# DB row shape (flat, as stored in Supabase)
DB_JOB = {
    "id": JOB_ID,
    "source": "adzuna",
    "external_id": "adzuna-123",
    "title": "Senior Python Developer",
    "company": "TestCorp",
    "location": "London",
    "description": "We need a Python developer with FastAPI and Postgres experience.",
    "apply_method": "google_form",
    "apply_url": "https://docs.google.com/forms/d/test",
    "raw": {},
}

FAKE_PROFILE = {
    "id": PROFILE_ID,
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "resume_text": "Python developer, 5 years experience, FastAPI, Postgres, Docker.",
    "resume_embedding": None,
    "preferences": {},
}

FAKE_MATCH = {
    "id": str(uuid.uuid4()),
    "job_id": JOB_ID,
    "score": 0.85,
    "reasoning": "Strong match on Python and FastAPI.",
    "decision": "apply",
}

FAKE_APP = {
    "id": str(uuid.uuid4()),
    "job_id": JOB_ID,
    "tailored_resume": "Tailored resume text.",
    "cover_letter": "Dear TestCorp, ...",
    "status": "prepared",
    "submit_payload": {
        "company": "TestCorp",
        "title": "Senior Python Developer",
        "apply_method": "google_form",
        "apply_url": "https://docs.google.com/forms/d/test",
    },
    "submitted_at": None,
    "error": None,
}


def make_db_mock() -> MagicMock:
    """Return a MagicMock shaped like a Supabase client.

    Supabase chained calls: db.table(t).select(c).execute() where
    table/select/update/eq etc are SYNC but execute() is ASYNC.
    """
    db = MagicMock()
    execute_mock = AsyncMock(return_value=MagicMock(data=[]))
    # Wire the chain: table(...).anything(...).execute()
    db.table.return_value.select.return_value.limit.return_value.execute = execute_mock
    db.table.return_value.select.return_value.execute = execute_mock
    db.table.return_value.update.return_value.eq.return_value.execute = execute_mock
    db.table.return_value.insert.return_value.execute = execute_mock
    db.table.return_value.upsert.return_value.execute = execute_mock
    db.rpc.return_value.execute = AsyncMock(return_value=MagicMock(data=None))
    return db


@pytest.fixture(autouse=True)
def force_dry_run(monkeypatch):
    monkeypatch.setenv("DRY_RUN", "true")


@pytest.fixture(autouse=True)
def mock_log_event():
    """Prevent emit() from trying to connect to Supabase."""
    with patch("src.db.client.log_event", new_callable=AsyncMock):
        yield


@pytest.fixture(autouse=True)
def mock_bus():
    """Prevent bus.publish from looping during unit tests."""
    with patch("src.agents.base.bus.publish", new_callable=AsyncMock):
        yield


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_discovery_agent_dry():
    """DiscoveryAgent fetches from Adzuna and upserts to DB."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"results": [ADZUNA_JOB]}
    mock_resp.raise_for_status = MagicMock()

    mock_http = AsyncMock()
    mock_http.get = AsyncMock(return_value=mock_resp)
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)

    with (
        patch("src.agents.discovery.settings") as mock_settings,
        patch("src.agents.discovery.upsert_row", new_callable=AsyncMock) as mock_upsert,
        patch("httpx.AsyncClient", return_value=mock_http),
    ):
        mock_settings.adzuna_configured = True
        mock_settings.adzuna_app_id = "id"
        mock_settings.adzuna_app_key = "key"
        mock_settings.adzuna_country = "gb"
        mock_settings.adzuna_max_results = 10
        mock_settings.rate_limit_delay = 0.0
        mock_settings.dry_run = True

        from src.agents.discovery import DiscoveryAgent
        jobs = await DiscoveryAgent().run(keywords="python", pages=1)

    assert len(jobs) == 1
    mock_upsert.assert_called_once()


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_matching_agent_dry():
    """MatchingAgent scores a job and writes a match decision."""
    from src.llm.claude import ScoringResult

    fake_score = ScoringResult(
        score=0.85, reasoning="Good match", decision="apply",
        strengths=["Python"], gaps=[],
    )
    db = make_db_mock()

    async def select_side_effect(table, **kwargs):
        if table == "profiles":
            return [FAKE_PROFILE]
        if table == "matches":
            return []
        if table == "jobs":
            return [DB_JOB]
        return []

    with (
        patch("src.agents.matching.select_rows", side_effect=select_side_effect),
        patch("src.agents.matching.upsert_row", new_callable=AsyncMock),
        patch("src.agents.matching.embed_text", new_callable=AsyncMock, return_value=[0.1] * 1536),
        patch("src.agents.matching.score_job", new_callable=AsyncMock, return_value=fake_score),
        patch("src.agents.matching.get_db", new_callable=AsyncMock, return_value=db),
    ):
        from src.agents.matching import MatchingAgent
        await MatchingAgent().run()


# ---------------------------------------------------------------------------
# Application (dry run)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_application_agent_dry_run():
    """ApplicationAgent in DRY_RUN mode logs but never calls Playwright."""
    db = make_db_mock()

    async def select_side_effect(table, **kwargs):
        if table == "applications":
            return [FAKE_APP]
        if table == "profiles":
            return [FAKE_PROFILE]
        return []

    with (
        patch("src.agents.application.settings") as mock_settings,
        patch("src.agents.application.select_rows", side_effect=select_side_effect),
        patch("src.agents.application.get_db", new_callable=AsyncMock, return_value=db),
    ):
        mock_settings.dry_run = True
        mock_settings.rate_limit_delay = 0.0

        from src.agents.application import ApplicationAgent
        await ApplicationAgent().submit_application(JOB_ID)

    # In dry_run, status should be updated to 'submitted' (via db.table.update)
    db.table.assert_called()


# ---------------------------------------------------------------------------
# Tracking
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tracking_agent():
    """TrackingAgent aggregates pipeline stats via 7 parallel COUNT queries."""
    # 7 queries in gather order: jobs, matches-apply, matches-skip,
    # apps-total, apps-prepared, apps-submitted, apps-error
    counts = [1, 1, 0, 1, 1, 0, 0]
    responses = [MagicMock(count=c) for c in counts]
    execute_mock = AsyncMock(side_effect=responses)

    chain = MagicMock()
    chain.execute = execute_mock
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.limit.return_value = chain

    db = MagicMock()
    db.table.return_value = chain

    with patch("src.agents.tracking.get_db", new_callable=AsyncMock, return_value=db):
        from src.agents.tracking import TrackingAgent
        summary = await TrackingAgent().run()

    assert summary["jobs_discovered"] == 1
    assert summary["jobs_matched"] == 1
    assert summary["applications_prepared"] == 1
    assert summary["applications_submitted"] == 0
