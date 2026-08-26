"""Tests for `app.services.ingestion.search`.

The Tavily API is answered by an `httpx2.MockTransport` built from a per-query
script, so the pinned call shape (Bearer auth, body members, two results per
query) and the pinned result handling (source-type labelling, dedupe, cap,
missing-key warning) are provable without a network and without a key.
"""

import asyncio
import json
from collections.abc import Callable
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


class FakeTavily:
    """Answers each query with a scripted result list; records every request."""

    def __init__(self, script: dict[str, Any] | None = None) -> None:
        self.script = script if script is not None else _default_script()
        self.status: dict[str, int] = {}
        self.requests: list[httpx2.Request] = []

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        """Return the scripted response for the posted query."""
        self.requests.append(request)
        body = json.loads(request.content)
        query = body["query"]

        status = self.status.get(query, 200)
        if status != 200:
            return httpx2.Response(status, json={"detail": "nope"})

        results = self.script.get(query)
        if results is None:
            raise AssertionError(f"unexpected query: {query}")
        return httpx2.Response(200, json={"query": query, "results": results})

    @property
    def queries(self) -> list[str]:
        """The queries that were actually sent, in order."""
        return [json.loads(request.content)["query"] for request in self.requests]


def _result(url: str, title: str) -> dict[str, Any]:
    """One Tavily result, including the members we deliberately ignore."""
    return {
        "url": url,
        "title": title,
        "content": "Snippet we never store — we fetch the page ourselves.",
        "score": 0.9,
    }


def _default_script() -> dict[str, list[dict[str, Any]]]:
    """Two distinct results per pinned query."""
    return {
        PRODUCT_QUERY: [
            _result("https://suzuki.test/gsr600", "GSR600 | Suzuki"),
            _result("https://suzuki.test/gsr600/specs", "GSR600 specifications"),
        ],
        TECHNICAL_QUERY: [
            _result("https://bikez.test/gsr600", "Suzuki GSR600 technical data"),
            _result("https://motodata.test/gsr600", "GSR600 data sheet"),
        ],
        MAGAZINE_QUERY: [
            _result("https://mcn.test/gsr600-review", "Suzuki GSR600 review"),
            _result("https://visordown.test/gsr600", "GSR600 road test"),
        ],
    }


def run(
    provider: search.TavilySearchProvider,
    server: FakeTavily,
    *,
    gate: RecordingGate | None = None,
) -> search.SearchResults:
    """Run one provider search against the scripted API."""

    async def call() -> search.SearchResults:
        async with httpx2.AsyncClient(
            transport=httpx2.MockTransport(server.handle),
            headers={"User-Agent": fetch.USER_AGENT},
        ) as client:
            return await provider.search(NAME, client=client, gate=gate or RecordingGate())

    return asyncio.run(call())


@pytest.fixture
def provider() -> search.TavilySearchProvider:
    """A provider with an explicit key, so no test depends on the environment."""
    return search.TavilySearchProvider(api_key=API_KEY)


def test_runs_the_three_pinned_queries_and_labels_their_results(
    provider: search.TavilySearchProvider,
) -> None:
    server = FakeTavily()

    results = run(provider, server)

    assert server.queries == [PRODUCT_QUERY, TECHNICAL_QUERY, MAGAZINE_QUERY]
    assert [candidate.source_type for candidate in results.candidates] == [
        SourceType.PRODUCT,
        SourceType.PRODUCT,
        SourceType.TECHNICAL,
        SourceType.TECHNICAL,
        SourceType.MAGAZINE,
        SourceType.MAGAZINE,
    ]
    assert results.candidates[0].url == "https://suzuki.test/gsr600"
    assert results.candidates[0].title == "GSR600 | Suzuki"
    assert results.warnings == ()


def test_sends_the_pinned_tavily_call_shape(provider: search.TavilySearchProvider) -> None:
    server = FakeTavily()

    run(provider, server)

    request = server.requests[0]
    assert (request.method, str(request.url)) == ("POST", "https://api.tavily.com/search")
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(request.content)
    # Exactly these three members: raw content is never requested.
    assert body == {
        "query": PRODUCT_QUERY,
        "max_results": 2,
        "search_depth": "basic",
    }


def test_takes_only_the_top_two_results_of_a_query(
    provider: search.TavilySearchProvider,
) -> None:
    script = _default_script()
    script[PRODUCT_QUERY] = [
        _result(f"https://suzuki.test/page-{index}", f"Page {index}") for index in range(5)
    ]
    server = FakeTavily(script)

    results = run(provider, server)

    product_urls = [
        candidate.url
        for candidate in results.candidates
        if candidate.source_type is SourceType.PRODUCT
    ]
    assert product_urls == ["https://suzuki.test/page-0", "https://suzuki.test/page-1"]


def test_dedupes_candidates_by_url_keeping_the_first_label(
    provider: search.TavilySearchProvider,
) -> None:
    script = _default_script()
    script[TECHNICAL_QUERY][0] = _result("https://suzuki.test/gsr600", "Same page again")
    server = FakeTavily(script)

    results = run(provider, server)

    urls = [candidate.url for candidate in results.candidates]
    assert len(urls) == len(set(urls)) == 5
    duplicate = next(c for c in results.candidates if c.url == "https://suzuki.test/gsr600")
    assert duplicate.source_type is SourceType.PRODUCT


def test_caps_the_candidates_at_the_configured_maximum(
    provider: search.TavilySearchProvider,
    settings_override: Callable[..., None],
) -> None:
    settings_override(INGESTION_MAX_WEB_DOCUMENTS=3)
    server = FakeTavily()

    results = run(provider, server)

    assert len(results.candidates) == 3
    # The cap is reached before the third query, so that credit is not spent.
    assert server.queries == [PRODUCT_QUERY, TECHNICAL_QUERY]


def test_a_failed_query_warns_and_the_others_still_run(
    provider: search.TavilySearchProvider,
) -> None:
    server = FakeTavily()
    server.status[TECHNICAL_QUERY] = 500

    results = run(provider, server)

    assert len(results.candidates) == 4
    assert [candidate.source_type for candidate in results.candidates] == [
        SourceType.PRODUCT,
        SourceType.PRODUCT,
        SourceType.MAGAZINE,
        SourceType.MAGAZINE,
    ]
    assert len(results.warnings) == 1
    assert TECHNICAL_QUERY in results.warnings[0]


def test_a_missing_api_key_warns_and_makes_no_request(
    settings_override: Callable[..., None],
) -> None:
    settings_override(TAVILY_API_KEY="")

    def handle(request: httpx2.Request) -> httpx2.Response:  # pragma: no cover
        raise AssertionError("no request may be made without a key")

    async def call() -> search.SearchResults:
        async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as client:
            return await search.TavilySearchProvider().search(
                NAME, client=client, gate=RecordingGate()
            )

    results = asyncio.run(call())

    assert results.candidates == ()
    assert results.warnings == ("Web search skipped: TAVILY_API_KEY is not configured.",)


def test_uses_the_configured_key_when_none_is_injected(
    settings_override: Callable[..., None],
) -> None:
    settings_override(TAVILY_API_KEY="from-settings")
    server = FakeTavily()

    run(search.TavilySearchProvider(), server)

    assert server.requests[0].headers["authorization"] == "Bearer from-settings"


def test_ignores_results_without_a_url_and_falls_back_to_the_url_as_title(
    provider: search.TavilySearchProvider,
) -> None:
    script = _default_script()
    script[PRODUCT_QUERY] = [
        {"title": "No URL here", "content": "…"},
        {"url": "https://suzuki.test/untitled"},
    ]
    server = FakeTavily(script)

    results = run(provider, server)

    untitled = results.candidates[0]
    assert untitled.url == "https://suzuki.test/untitled"
    assert untitled.title == "https://suzuki.test/untitled"


def test_a_response_without_results_yields_no_candidates(
    provider: search.TavilySearchProvider,
) -> None:
    script = _default_script()
    script[PRODUCT_QUERY] = []
    server = FakeTavily(script)

    results = run(provider, server)

    assert len(results.candidates) == 4
    assert results.warnings == ()


def test_every_query_passes_through_the_politeness_gate(
    provider: search.TavilySearchProvider,
) -> None:
    gate = RecordingGate()

    run(provider, FakeTavily(), gate=gate)

    assert gate.hosts == ["api.tavily.com"] * 3


def test_get_search_provider_returns_the_configured_provider() -> None:
    provider = search.get_search_provider()

    assert isinstance(provider, search.TavilySearchProvider)
    assert provider.name == "tavily"


def test_pinned_call_shape_and_templates_match_the_phase_contract() -> None:
    assert search.TAVILY_SEARCH_URL == "https://api.tavily.com/search"
    assert search.TAVILY_SEARCH_DEPTH == "basic"
    assert search.RESULTS_PER_TEMPLATE == 2
    assert [(template.source_type, template.template) for template in search.QUERY_TEMPLATES] == [
        (SourceType.PRODUCT, '"{name}" motorcycle official specifications'),
        (SourceType.TECHNICAL, '"{name}" technical data specifications'),
        (SourceType.MAGAZINE, '"{name}" review test'),
    ]
