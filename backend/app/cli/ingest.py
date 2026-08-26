"""`app ingest` — drive the ingestion building blocks from a terminal.

`app ingest fetch-url` is the manual smoke tool for step 2.10: it runs the real
fetch and the real extraction against a real page — the one thing the test suite
deliberately never does — and leaves the retained payload on disk so the storage
layout can be inspected. It touches no database and enqueues no job.

Follows the CLI async pattern of `app.cli.users`: the Typer command body stays
synchronous and calls `asyncio.run(...)`.
"""

import asyncio
from typing import Annotated, NoReturn

import typer

from app.db.models.base import new_ulid
from app.services.ingestion import extract, fetch, storage

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


def _fail(message: str) -> NoReturn:
    """Report a typed ingestion failure on stderr and exit non-zero."""
    typer.echo(message, err=True)
    raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    app()
