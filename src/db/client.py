"""Supabase client — single shared instance."""
from __future__ import annotations

from typing import Any

from supabase import AsyncClient, acreate_client

from src.config import settings


_client: AsyncClient | None = None


async def get_db() -> AsyncClient:
    """Return the shared async Supabase client, creating it on first call."""
    global _client
    if _client is None:
        _client = await acreate_client(settings.supabase_url, settings.supabase_service_key)
    return _client


async def insert_row(table: str, data: dict[str, Any]) -> dict[str, Any]:
    """Insert a row and return it. Raises on error."""
    db = await get_db()
    resp = await db.table(table).insert(data).execute()
    if not resp.data:
        raise RuntimeError(f"Insert into {table!r} returned no data — check RLS policies")
    return resp.data[0]


async def upsert_row(table: str, data: dict[str, Any], on_conflict: str = "id") -> dict[str, Any]:
    """Upsert a row using the given conflict column(s)."""
    db = await get_db()
    resp = await db.table(table).upsert(data, on_conflict=on_conflict).execute()
    if not resp.data:
        raise RuntimeError(f"Upsert into {table!r} returned no data — check RLS policies")
    return resp.data[0]


async def select_rows(
    table: str,
    filters: dict[str, Any] | None = None,
    columns: str = "*",
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Simple select with optional equality filters."""
    db = await get_db()
    query = db.table(table).select(columns)
    if filters:
        for col, val in filters.items():
            query = query.eq(col, val)
    if limit:
        query = query.limit(limit)
    resp = await query.execute()
    return resp.data or []


async def update_row(table: str, row_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Update a row by id and return it."""
    db = await get_db()
    resp = await db.table(table).update(data).eq("id", row_id).execute()
    if not resp.data:
        raise RuntimeError(f"Update in {table!r} returned no data")
    return resp.data[0]


async def log_event(agent: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Write a row to agent_events for audit/debug purposes."""
    db = await get_db()
    await db.table("agent_events").insert({
        "agent": agent,
        "event_type": event_type,
        "payload": payload or {},
    }).execute()
