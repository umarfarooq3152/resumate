#!/usr/bin/env python3
"""
Run once to apply schema.sql to Supabase.

Usage:
    cd job-agent
    cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_KEY
    python bootstrap.py
"""
import asyncio
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
SCHEMA_FILE = Path(__file__).parent / "src" / "db" / "schema.sql"


async def run_sql(client: httpx.AsyncClient, sql: str, label: str) -> None:
    """Execute a single SQL statement via Supabase REST RPC or Management API."""
    resp = await client.post(
        f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
        json={"query": sql},
    )
    if resp.status_code not in (200, 201, 204):
        # Fallback: Supabase Management API (requires service key)
        project_ref = SUPABASE_URL.split("//")[1].split(".")[0]
        mgmt_resp = await client.post(
            f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
            headers={
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json",
            },
            json={"query": sql},
        )
        if mgmt_resp.status_code not in (200, 201, 204):
            print(f"  [WARN] {label}: {mgmt_resp.status_code} — {mgmt_resp.text[:200]}")
            return
    print(f"  [OK]  {label}")


def split_statements(sql: str) -> list[str]:
    """Split SQL file into individual statements (naïve but sufficient)."""
    stmts = []
    current: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        current.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(current).strip()
            if stmt:
                stmts.append(stmt)
            current = []
    return stmts


async def main() -> None:
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env")
        sys.exit(1)

    sql = SCHEMA_FILE.read_text()
    statements = split_statements(sql)

    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }

    print(f"Applying {len(statements)} SQL statements to {SUPABASE_URL} ...")
    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        for i, stmt in enumerate(statements, 1):
            label = stmt.split("\n")[0][:70].strip()
            await run_sql(client, stmt, label)

    print("\nDone. Verify via Supabase Dashboard → Table Editor.")
    print("If you see WARN messages, paste src/db/schema.sql into the SQL editor manually.")


if __name__ == "__main__":
    asyncio.run(main())
