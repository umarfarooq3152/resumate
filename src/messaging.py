"""In-process async message bus.

Agents publish events; other agents subscribe by event_type.
All events are also written to the `agent_events` DB table for audit.
Swappable for Redis pub/sub by replacing _bus internals.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

log = logging.getLogger(__name__)

Handler = Callable[[str, dict[str, Any]], Awaitable[None]]


@dataclass
class Message:
    source: str
    event_type: str
    payload: dict[str, Any] = field(default_factory=dict)


class MessageBus:
    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)
        self._queue: asyncio.Queue[Message] = asyncio.Queue()
        self._running = False

    def subscribe(self, event_type: str, handler: Handler) -> None:
        self._handlers[event_type].append(handler)

    async def publish(self, source: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
        msg = Message(source=source, event_type=event_type, payload=payload or {})
        await self._queue.put(msg)

    async def run(self) -> None:
        """Process messages until stop() is called."""
        self._running = True
        while self._running:
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            await self._dispatch(msg)
            self._queue.task_done()

    async def drain(self) -> None:
        """Process all queued messages without blocking."""
        while not self._queue.empty():
            try:
                msg = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            await self._dispatch(msg)
            self._queue.task_done()

    async def _dispatch(self, msg: Message) -> None:
        handlers = self._handlers.get(msg.event_type, []) + self._handlers.get("*", [])
        for handler in handlers:
            try:
                await handler(msg.event_type, msg.payload)
            except Exception as exc:
                log.exception("Handler error for event %s: %s", msg.event_type, exc)

    def stop(self) -> None:
        self._running = False


# Singleton bus shared across agents in this process
bus = MessageBus()
