"""`app catalogue` — deterministic corrections to an existing catalogue entry.

No LLM, no network: every command here does exactly what its arguments say, so
it is safe to run against the live catalogue.

- `app catalogue set-manufacturer` (step 2b.2) assigns a brand to one model,
  creating the `manufacturers` row when the brand is new. It is the backfill
  tool for entries that were ingested before extraction filled the brand, and
  the only manual correction path until an admin surface exists. Nothing else is
  touched — in particular no documents, chunks or embeddings, which is why the
  backfill goes through this command instead of a re-ingestion.
- `app catalogue render-name` (step 6.11) is a debugging aid for
  `naming_service.render_name`: no write, no LLM, no network. It prints the
  same row's name at both `MODEL` and `YEAR_RANGE` min-levels, using any
  `--context` ids supplied as the ambiguity set.

Follows the CLI async pattern of `app.cli.ingest`: the Typer command body stays
synchronous and calls `asyncio.run(...)`.
"""

import asyncio
from typing import Annotated, NoReturn

import typer

from app.db.models.manufacturer import Manufacturer
from app.db.session import get_sessionmaker
from app.services import manufacturer_service, naming_service, product_service

app = typer.Typer(
    help="Correct one catalogue entry, deterministically.",
    no_args_is_help=True,
    add_completion=False,
)


@app.callback()
def root() -> None:
    """Keep sub-commands addressable by name, even when only one exists."""


@app.command("set-manufacturer")
def set_manufacturer(
    slug: Annotated[
        str,
        typer.Argument(help='Slug of an existing catalogue entry, e.g. "suzuki-gsr600".'),
    ],
    name: Annotated[str, typer.Argument(help='Brand name only, e.g. "Suzuki".')],
) -> None:
    """Assign a manufacturer to one catalogue entry, creating the brand if new.

    The brand's identity is its slug, so `"BMW"`, `"bmw"` and `"  BMW "` all
    reuse the same row; the display name stays the one first stored. Running the
    command again with the same brand changes nothing but the announcement.
    """
    manufacturer = asyncio.run(_set_manufacturer(slug, name))
    typer.echo(f"{slug} now belongs to manufacturer {manufacturer.name!r} ({manufacturer.id}).")


async def _set_manufacturer(slug: str, name: str) -> Manufacturer:
    """Async half of `set-manufacturer`: one session, two service calls.

    The catalogue entry is resolved first, so an unknown slug reports itself
    before a manufacturer row is created for nothing.
    """
    async with get_sessionmaker()() as session:
        motorbike = await product_service.get_by_slug(session, slug)
        if motorbike is None:
            _fail(f"No catalogue entry with slug {slug!r}.")
        try:
            manufacturer = await manufacturer_service.get_or_create(session, name)
        except ValueError as error:
            _fail(str(error))
        await product_service.assign_manufacturer(session, motorbike, manufacturer.id)
        return manufacturer


@app.command("render-name")
def render_name(
    motorbike_id: Annotated[str, typer.Argument(help="Id of the catalogue entry to render.")],
    context: Annotated[
        list[str] | None,
        typer.Option(
            "--context", help="Additional id(s) to render alongside, as the ambiguity set."
        ),
    ] = None,
) -> None:
    """Print `motorbike_id`'s name at both the `MODEL` and `YEAR_RANGE` levels.

    `--context` supplies the other rows to check for a collision against, the
    way a real caller's `context` set would (data-model doc §5's per-caller
    table). An unknown `motorbike_id` reports itself and exits non-zero;
    unknown `--context` ids are silently absent, exactly as
    `naming_service.load_name_parts` documents.
    """
    for line in asyncio.run(_render_name(motorbike_id, context or [])):
        typer.echo(line)


async def _render_name(motorbike_id: str, context_ids: list[str]) -> list[str]:
    async with get_sessionmaker()() as session:
        parts = await naming_service.load_name_parts(session, [motorbike_id, *context_ids])
        target = parts.get(motorbike_id)
        if target is None:
            _fail(f"No catalogue entry with id {motorbike_id!r}.")
        context = [p for id_, p in parts.items() if id_ != motorbike_id]
        model = naming_service.render_name(
            target, context=context, min_level=naming_service.NameLevel.MODEL
        )
        year_range = naming_service.render_name(
            target, context=context, min_level=naming_service.NameLevel.YEAR_RANGE
        )
        return [f"MODEL: {model}", f"YEAR_RANGE: {year_range}"]


def _fail(message: str) -> NoReturn:
    """Report why nothing was changed on stderr and exit non-zero."""
    typer.echo(message, err=True)
    raise typer.Exit(code=1)


if __name__ == "__main__":  # pragma: no cover
    app()
