"""Turning fetched HTML into the normalized Markdown the pipeline stores.

trafilatura does the hard part (dropping navigation, footers, cookie banners and
comment sections). This module pins the options it is called with and normalizes
its output, because two later steps depend on the exact shape: 2.18 chunks on
Markdown headings, and 2.17 feeds the same text to the extraction prompt.

An article we cannot extract any main text from is a **returned** failure, not
an exception: for the ingestion job it is one lost source among several, and the
job decides what that means.
"""

import logging
import re
from dataclasses import dataclass
from enum import StrEnum

import trafilatura

logger = logging.getLogger(__name__)

# Three or more consecutive newlines collapse to a paragraph break.
_EXCESS_BLANK_LINES = re.compile(r"\n{3,}")

# Trailing spaces (trafilatura leaves them on table rows) and NBSP-style spaces
# that would otherwise survive into chunks and prompts.
_TRAILING_SPACE = re.compile(r"[ \t]+$", re.MULTILINE)
_NON_BREAKING_SPACES = re.compile("[\u00a0\u2007\u202f]")


class ExtractFailureReason(StrEnum):
    """Why extraction produced no usable Markdown."""

    EMPTY = "empty"


@dataclass(frozen=True, slots=True)
class ExtractResult:
    """Extracted main text as normalized Markdown, headings preserved."""

    markdown: str


@dataclass(frozen=True, slots=True)
class ExtractFailure:
    """An extraction that produced nothing usable, with a warning-ready `detail`."""

    reason: ExtractFailureReason
    detail: str


ExtractOutcome = ExtractResult | ExtractFailure


def extract_markdown(html: str, *, url: str | None = None) -> ExtractOutcome:
    """Extract the main text of `html` as normalized Markdown.

    Args:
        html: The fetched document, decoded.
        url: The document's URL, used only for the log message when extraction
            comes back empty.
    """
    markdown = trafilatura.extract(
        html,
        output_format="markdown",
        include_tables=True,
        include_comments=False,
        with_metadata=False,
    )
    normalized = normalize(markdown or "")

    if not normalized:
        detail = f"No main text extracted from {url}." if url else "No main text extracted."
        logger.warning("Extraction produced no text: %s", detail)
        return ExtractFailure(reason=ExtractFailureReason.EMPTY, detail=detail)

    return ExtractResult(markdown=normalized)


def normalize(markdown: str) -> str:
    """Normalize whitespace so chunking and prompting see one predictable shape."""
    text = markdown.replace("\r\n", "\n").replace("\r", "\n")
    text = _NON_BREAKING_SPACES.sub(" ", text)
    text = _TRAILING_SPACE.sub("", text)
    text = _EXCESS_BLANK_LINES.sub("\n\n", text)
    return text.strip()
