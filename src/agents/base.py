"""BaseAgent — all agents inherit from this."""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from src.db.client import log_event
from src.messaging import bus

log = logging.getLogger(__name__)


class BaseAgent(ABC):
    name: str = "base"

    def __init__(self) -> None:
        self._register_subscriptions()

    def _register_subscriptions(self) -> None:
        """Override to subscribe to bus events on construction."""

    async def emit(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        """Publish an event to the bus and write to agent_events audit log."""
        data = payload or {}
        log.debug("[%s] emit %s %s", self.name, event_type, data)
        await bus.publish(self.name, event_type, data)
        try:
            await log_event(self.name, event_type, data)
        except Exception as exc:
            log.warning("[%s] Failed to write agent_event: %s", self.name, exc)

    @abstractmethod
    async def run(self, **kwargs: Any) -> None:
        """Entry point for the agent's main task."""
