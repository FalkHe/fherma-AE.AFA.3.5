"""QA coverage for `app.services.ingestion.search` (step 2.11).

`test_search.py` already proves the pinned call shape, dedupe, cap and the
missing-key rule thoroughly with a pre-built client. This module fills two
specific gaps: the pinned **User-Agent** on Tavily calls when the provider
builds its own client (`client=None` — a bare
`TavilySearchProvider().search(name)` call), and a malformed (non-JSON) Tavily
response, which `test_search.py` does not exercise.
"""

import asyncio
import json
from typing import Any

import httpx2
import pytest

from app.db.models.source_document import SourceType
from app.services.ingestion import fetch, search

NAME = "Suzuki GSR 600"
API_KEY = "test-key"

PRODUCT_QUERY = f'"{NAME}" motorcycle official specifications'
TECHNICAL_QUERY = f'"{NAME}" technical data specifications'
MAGAZINE_QUERY = f'"{NAME}" review test'


class RecordingGate(fetch.PolitenessGate):
    """Politeness gate that records hosts instead of waiting for them."""

    def __init__(self) -> None:
        super().__init__(delay_seconds=0.0)
        self.hosts: list[str] = []

    async def wait(self, host: str) -> float:
        self.hosts.append(host)
        return 0.0


def _result(url: str, title: str) -> dict[str, Any]:
    return {"url": url, "title": title, "content": "…", "score": 0.9}


# --- User-Agent, via the module's own client-building path ------------------


def test_search_sends_the_pinned_user_agent_via_the_provider_own_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bare `provider.search(name)` (no injected client) must still carry it."""
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        query = json.loads(request.content)["query"]
        # A distinct URL per query, so the dedupe-by-URL rule does not collapse
        # the three templates' candidates before the assertion below can count them.
        return httpx2.Response(
            200, json={"results": [_result(f"https://x.test/{len(requests)}", query)]}
        )

    def fake_build_client(*, timeout_seconds: float | None = None) -> httpx2.AsyncClient:
        return httpx2.AsyncClient(
            transport=httpx2.MockTransport(handler),
            follow_redirects=True,
            headers={"User-Agent": fetch.USER_AGENT},
        )

    monkeypatch.setattr(fetch, "build_client", fake_build_client)

    async def call() -> search.SearchResults:
        return await search.TavilySearchProvider(api_key=API_KEY).search(NAME, gate=RecordingGate())

    results = asyncio.run(call())

    assert len(results.candidates) == 3  # one per template
    assert len(requests) == 3
    # The Authorization header the provider sets per-request must not have wiped
    # out the client-default User-Agent header.
    for request in requests:
        assert request.headers.get("user-agent") == fetch.USER_AGENT
        assert request.headers.get("authorization") == f"Bearer {API_KEY}"


# --- Malformed Tavily response ------------------------------------------------


def test_a_malformed_json_response_warns_like_a_failed_query() -> None:
    """A 200 with a body that is not JSON must not crash the provider."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        query = json.loads(request.content)["query"]
        if query == TECHNICAL_QUERY:
            return httpx2.Response(200, content=b"not json at all")
        # Distinct URLs per query so dedupe-by-URL does not collapse them.
        return httpx2.Response(
            200,
            json={"results": [_result(f"https://x.test/{hash(query) % 10_000}", query)]},
        )

    async def call() -> search.SearchResults:
        async with httpx2.AsyncClient(
            transport=httpx2.MockTransport(handler),
            headers={"User-Agent": fetch.USER_AGENT},
        ) as client:
            return await search.TavilySearchProvider(api_key=API_KEY).search(
                NAME, client=client, gate=RecordingGate()
            )

    results = asyncio.run(call())

    # The other two queries still succeed.
    assert [candidate.source_type for candidate in results.candidates] == [
        SourceType.PRODUCT,
        SourceType.MAGAZINE,
    ]
    assert len(results.warnings) == 1
    assert TECHNICAL_QUERY in results.warnings[0]
