"""Root Typer application, exposed as the `app` console script."""

import typer

from app import __version__
from app.cli import openapi

app = typer.Typer(
    name="app",
    help="Motorcycle Buying Advisor administration CLI.",
    no_args_is_help=True,
    add_completion=False,
)

app.add_typer(openapi.app, name="openapi")


@app.callback()
def root() -> None:
    """Keep sub-commands addressable by name, even when only one exists."""


@app.command()
def version() -> None:
    """Print the application version."""
    typer.echo(__version__)


if __name__ == "__main__":  # pragma: no cover
    app()
