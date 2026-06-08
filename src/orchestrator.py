"""CLI orchestrator — run the pipeline from the terminal.

Usage:
    cd job-agent
    python -m src.orchestrator --keywords "python developer" --location "London" --pages 2
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from src.agents.application import ApplicationAgent
from src.agents.discovery import DiscoveryAgent
from src.agents.matching import MatchingAgent
from src.agents.tailoring import TailoringAgent
from src.agents.tracking import TrackingAgent
from src.config import settings
from src.messaging import bus

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


async def run(keywords: str, location: str, pages: int, profile_id: str | None) -> None:
    if settings.dry_run:
        log.info("=== DRY RUN MODE — no real submissions will be made ===")

    discovery = DiscoveryAgent()
    matching = MatchingAgent()
    tailoring = TailoringAgent()
    application = ApplicationAgent()
    tracking = TrackingAgent()

    # Step 1: discover
    log.info("Step 1/4 — Discovery (keywords=%r, location=%r, pages=%d)", keywords, location, pages)
    await discovery.run(keywords=keywords, location=location, pages=pages)
    await bus.drain()

    # Step 2: match
    log.info("Step 2/4 — Matching")
    await matching.run(profile_id=profile_id)
    await bus.drain()

    # Step 3: tailor
    log.info("Step 3/4 — Tailoring")
    await tailoring.run()
    await bus.drain()

    # Step 4: apply
    log.info("Step 4/4 — Application (dry_run=%s)", settings.dry_run)
    await application.run()
    await bus.drain()

    # Summary
    summary = await tracking.run()
    log.info("=== Pipeline complete ===")
    for k, v in summary.items():
        log.info("  %s: %s", k, v)


def main() -> None:
    parser = argparse.ArgumentParser(description="Autonomous Job Application Agent")
    parser.add_argument("--keywords", default="software engineer")
    parser.add_argument("--location", default="")
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--profile-id", default=None)
    args = parser.parse_args()

    asyncio.run(run(
        keywords=args.keywords,
        location=args.location,
        pages=args.pages,
        profile_id=args.profile_id,
    ))


if __name__ == "__main__":
    main()
