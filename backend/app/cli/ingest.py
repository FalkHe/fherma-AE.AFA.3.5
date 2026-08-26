"""`app ingest` — drive the ingestion building blocks from a terminal.

Both commands are manual smoke tools: they run the real integrations against the
real internet — the one thing the test suite deliberately never does.

- `app ingest fetch-url` (step 2.10) fetches and extracts one page and leaves the
  retained payload on disk so the storage layout can be inspected.
- `app ingest probe` (step 2.11) shows what ingestion *would* use for a model
  name: the Wikipedia article it matched (the disambiguation guard), its lead
  image, and the labelled search candidates.

Neither touches the database or enqueues a job.

Follows the CLI async pattern of `app.cli.users`: the Typer command body stays
synchronous and calls `asyncio.run(...)`.
"""

import asyncio
from typing import Annotated, NoReturn

import httpx2
import typer

from app.db.models.base import new_ulid
from app.services.ingestion import extract, fetch, search, storage, wikipedia

app = typer.Typer(
    help="Run ingestion building blocks against a single source.",
    no_args_is_help=True,
    add_completion=False,
)

# Stand-in for the owning catalogue entry: this command has no motorbike row, so
# its payloads land in one clearly non-model directory instead of shadowing a
# real ULID.
CLI_MOTORBIKE_ID = "cli"


@app.callback()
def root() -> None:
    """Keep sub-commands addressable by name, even when only one exists."""


@app.command("fetch-url")
def fetch_url(
    url: Annotated[str, typer.Argument(help="Absolute http(s) URL of an HTML page.")],
) -> None:
    """Fetch one page, retain the raw payload and print the extracted Markdown.

    Progress and provenance go to stderr, the Markdown to stdout, so the text
    can be piped straight into a file.
    """
    outcome = asyncio.run(fetch.fetch_html(url))
    if isinstance(outcome, fetch.FetchFailure):
        _fail(f"Fetch failed ({outcome.reason.value}): {outcome.detail}")

    raw_path = storage.save_raw_document(CLI_MOTORBIKE_ID, new_ulid(), outcome.content)
    typer.echo(
        f"Fetched {outcome.url} ({outcome.status_code}, {len(outcome.content)} bytes).",
        err=True,
    )
    typer.echo(f"Retained raw payload at {raw_path} (relative to DATA_DIR).", err=True)

    extracted = extract.extract_markdown(outcome.text, url=outcome.url)
    if isinstance(extracted, extract.ExtractFailure):
        _fail(f"Extraction failed ({extracted.reason.value}): {extracted.detail}")

    typer.echo(f"Extracted {len(extracted.markdown)} characters of Markdown.", err=True)
    typer.echo(extracted.markdown)


@app.command("probe")
def probe(
    name: Annotated[str, typer.Argument(help='Model name, e.g. "Suzuki GSR 600".')],
) -> None:
    """Show the sources ingestion would use for one model — nothing is stored.

    Prints the matched Wikipedia title and lead image plus every search
    candidate with the source type its query labelled it with. Warnings (a
    missing search key, a failed query) go to stderr.
    """
    asyncio.run(_probe(name))


async def _probe(name: str) -> None:
    """Run the Wikipedia lookup and the search provider on one shared client."""
    async with fetch.build_client() as client:
        await _probe_wikipedia(name, client)
        await _probe_search(name, client)


async def _probe_wikipedia(name: str, client: httpx2.AsyncClient) -> None:
    """Print the matched article and its lead image, or why there is neither."""
    page = await wikipedia.find_page(name, client=client)
    if isinstance(page, wikipedia.WikipediaFailure):
        typer.echo(f"Wikipedia:   no article ({page.reason.value}) — {page.detail}")
        return

    typer.echo(f"Wikipedia:   {page.title}")
    typer.echo(f"  URL:       {page.url}")
    typer.echo(f"  key:       {page.key}")

    image = await wikipedia.find_image(page, client=client)
    if image is None:
        typer.echo("  image:     none")
        return
    typer.echo(f"  image:     {image.url}")
    typer.echo(f"  credit:    {image.attribution or 'unknown attribution'}")


async def _probe_search(name: str, client: httpx2.AsyncClient) -> None:
    """Print the labelled search candidates and any warnings on stderr."""
    results = await search.get_search_provider().search(name, client=client)
    for warning in results.warnings:
        typer.echo(f"Warning: {warning}", err=True)

    if not results.candidates:
        typer.echo("Candidates:  none")
        return

    typer.echo(f"Candidates:  {len(results.candidates)}")
    for candidate in results.candidates:
        typer.echo(f"  [{candidate.source_type.value}] {candidate.title}")
        typer.echo(f"             {candidate.url}")


def _fail(message: str) -> NoReturn:
    """Report a typed ingestion failure on stderr and exit non-zero."""
    typer.echo(message, err=True)
    raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    app()
