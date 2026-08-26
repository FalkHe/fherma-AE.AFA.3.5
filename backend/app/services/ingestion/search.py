"""Finding the web pages worth fetching for one motorbike.

Ingestion is search-then-fetch: a provider returns candidate URLs, we fetch them
ourselves (for provenance and raw retention), which is why no provider's own page
content is ever consumed — only `url` and `title`.

Three pinned queries run per model, and the **template decides the
`source_type`** of everything it returns: the official-specifications query
yields `product` documents, the technical-data query `technical`, the review
query `magazine`. That is how the pipeline gets a labelled source mix without an
LLM classifying pages. Top 2 per template, deduped by URL, capped at
`INGESTION_MAX_WEB_DOCUMENTS`.

Search is the **optional** half of ingestion: without `TAVILY_API_KEY` the run
proceeds Wikipedia-only with a warning. So a provider never raises for an
expected outcome — it returns candidates plus warnings, and the ingestion job
decides what to do with the warnings (they are appended to the operation
message).

`SearchProvider` is a protocol so a second provider is a new class and a config
value, not a change to the job.
"""

import logging
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx2

from app.core.config import get_settings
from app.db.models.source_document import SourceType
from app.services.ingestion import fetch

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Pinned Tavily call shape: cheapest useful depth, two results per query, and
# never `include_raw_content` — we fetch the pages ourselves.
TAVILY_SEARCH_DEPTH = "basic"
RESULTS_PER_TEMPLATE = 2


@dataclass(frozen=True, slots=True)
class QueryTemplate:
    """One pinned query and the `source_type` its results are labelled with."""

    source_type: SourceType
    template: str

    def render(self, name: str) -> str:
        """Return the query for one model name."""
        return self.template.format(name=name)


# Pinned templates, in the order they run — `product` first, so the cap favours
# manufacturer data over reviews.
QUERY_TEMPLATES: tuple[QueryTemplate, ...] = (
    QueryTemplate(SourceType.PRODUCT, '"{name}" motorcycle official specifications'),
    QueryTemplate(SourceType.TECHNICAL, '"{name}" technical data specifications'),
    QueryTemplate(SourceType.MAGAZINE, '"{name}" review test'),
)


@dataclass(frozen=True, slots=True)
class SearchCandidate:
    """A page worth fetching, already labelled with the type of source it is."""

    url: str
    title: str
    """Falls back to the URL: `source_documents.source_title` is NOT NULL."""

    source_type: SourceType


@dataclass(frozen=True, slots=True)
class SearchResults:
    """What one provider run yielded, plus what went wrong while yielding it."""

    candidates: tuple[SearchCandidate, ...] = ()
    warnings: tuple[str, ...] = ()
    """Human-readable, appended to the operation message — never a failure."""


class SearchProvider(Protocol):
    """A web search backend. One method, no state the job needs to know about."""

    async def search(
        self,
        name: str,
        *,
        client: httpx2.AsyncClient | None = None,
        gate: fetch.PolitenessGate | None = None,
    ) -> SearchResults:
        """Return the candidate pages for `name`, labelled by source type."""
        ...


class TavilySearchProvider:
    """The default provider: `POST https://api.tavily.com/search`, no SDK."""

    name = "tavily"

    def __init__(self, *, api_key: str | None = None, url: str = TAVILY_SEARCH_URL) -> None:
        """Args: api_key: overrides `TAVILY_API_KEY` (tests, one-off tooling)."""
        self._api_key = api_key
        self._url = url

    async def search(
        self,
        name: str,
        *,
        client: httpx2.AsyncClient | None = None,
        gate: fetch.PolitenessGate | None = None,
    ) -> SearchResults:
        """Run the three pinned queries and collect their candidates.

        A query whose request fails costs its two candidates and adds a warning;
        the other queries still run. No key at all costs the whole web half of
        the ingestion run — also only a warning.
        """
        settings = get_settings()
        api_key = self._api_key if self._api_key is not None else settings.tavily_api_key
        if not api_key:
            warning = "Web search skipped: TAVILY_API_KEY is not configured."
            logger.warning("%s Ingestion continues with Wikipedia only.", warning)
            return SearchResults(warnings=(warning,))

        if client is None:
            async with fetch.build_client() as owned_client:
                return await self.search(name, client=owned_client, gate=gate)

        limit = settings.ingestion_max_web_documents
        candidates: list[SearchCandidate] = []
        warnings: list[str] = []
        seen: set[str] = set()

        for query_template in QUERY_TEMPLATES:
            if len(candidates) >= limit:
                break

            query = query_template.render(name)
            payload = await self._post(query, api_key=api_key, client=client, gate=gate)
            if payload is None:
                warnings.append(f"Web search for {query} failed.")
                continue

            for url, title in _tavily_results(payload):
                if len(candidates) >= limit:
                    break
                if url in seen:
                    continue
                seen.add(url)
                candidates.append(
                    SearchCandidate(
                        url=url,
                        title=title or url,
                        source_type=query_template.source_type,
                    )
                )

        logger.info("Web search for %r yielded %d candidate(s).", name, len(candidates))
        return SearchResults(candidates=tuple(candidates), warnings=tuple(warnings))

    async def _post(
        self,
        query: str,
        *,
        api_key: str,
        client: httpx2.AsyncClient,
        gate: fetch.PolitenessGate | None,
    ) -> Any | None:
        """POST one query, or return `None` with one logged warning.

        The politeness gate applies to the API host too, so three queries in a
        row do not arrive as a burst. The key lives in the `Authorization`
        header (the legacy body form is deprecated) and is never logged.
        """
        await (gate or fetch.politeness).wait((urlsplit(self._url).hostname or "").lower())

        try:
            response = await client.post(
                self._url,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "query": query,
                    "max_results": RESULTS_PER_TEMPLATE,
                    "search_depth": TAVILY_SEARCH_DEPTH,
                },
            )
        except httpx2.TimeoutException:
            logger.warning("Web search timed out for query %s.", query)
            return None
        except httpx2.HTTPError as error:
            logger.warning("Web search unreachable for query %s (%s).", query, type(error).__name__)
            return None

        if response.status_code >= 400:
            logger.warning("Web search answered HTTP %d for query %s.", response.status_code, query)
            return None

        try:
            return response.json()
        except ValueError:
            logger.warning("Web search returned no usable JSON for query %s.", query)
            return None


def get_search_provider() -> SearchProvider:
    """Return the provider configured in `SEARCH_PROVIDER`.

    `SearchProviderName` has exactly one member today and pydantic rejects
    anything else while loading the settings, so there is nothing to branch on
    yet — a second provider adds the branch here and nowhere else.
    """
    logger.debug("Using search provider %r.", get_settings().search_provider)
    return TavilySearchProvider()


def _tavily_results(payload: Any) -> Iterator[tuple[str, str | None]]:
    """Yield `(url, title)` of the top results, ignoring everything else.

    `content`/`score`/`raw_content` are deliberately dropped: the pages are
    fetched by us, so a provider's copy of them would be provenance we cannot
    stand behind.
    """
    results = payload.get("results") if isinstance(payload, Mapping) else None
    if not isinstance(results, list):
        return

    yielded = 0
    for result in results:
        if yielded >= RESULTS_PER_TEMPLATE:
            return
        if not isinstance(result, Mapping):
            continue
        url = result.get("url")
        if not isinstance(url, str) or not url.strip():
            continue
        title = result.get("title")
        yield url.strip(), title.strip() if isinstance(title, str) and title.strip() else None
        yielded += 1
