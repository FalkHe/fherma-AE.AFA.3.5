"""Tests for `app.services.ingestion.extract`.

The saved fixtures stand in for the two cases that matter downstream: an article
whose headings must survive into the Markdown (step 2.18 chunks on them), and a
page with no main text at all, which must come back as a typed failure.
"""

from collections.abc import Callable

from app.services.ingestion import extract


def test_extracts_headings_prose_and_tables(html_fixture: Callable[[str], str]) -> None:
    outcome = extract.extract_markdown(html_fixture("gsr600_article.html"), url="https://x.test/a")

    assert isinstance(outcome, extract.ExtractResult)
    markdown = outcome.markdown
    assert markdown.startswith("# Suzuki GSR600")
    assert "## Design" in markdown
    assert "### Chassis and brakes" in markdown
    assert "| Displacement | 599 cm³ |" in markdown
    assert "detuned version of the GSX-R600" in markdown


def test_drops_navigation_and_footer_boilerplate(html_fixture: Callable[[str], str]) -> None:
    outcome = extract.extract_markdown(html_fixture("gsr600_article.html"))

    assert isinstance(outcome, extract.ExtractResult)
    assert "Random article" not in outcome.markdown
    assert "Privacy policy" not in outcome.markdown
    assert "Accept all cookies" not in outcome.markdown


def test_normalizes_whitespace(html_fixture: Callable[[str], str]) -> None:
    outcome = extract.extract_markdown(html_fixture("gsr600_article.html"))

    assert isinstance(outcome, extract.ExtractResult)
    markdown = outcome.markdown
    assert "\n\n\n" not in markdown
    assert "\u00a0" not in markdown
    assert markdown == markdown.strip()
    assert not any(line != line.rstrip() for line in markdown.splitlines())


def test_reports_an_empty_extraction_as_a_typed_failure(
    html_fixture: Callable[[str], str],
) -> None:
    outcome = extract.extract_markdown(
        html_fixture("no_main_text.html"), url="https://x.test/login"
    )

    assert isinstance(outcome, extract.ExtractFailure)
    assert outcome.reason is extract.ExtractFailureReason.EMPTY
    assert "https://x.test/login" in outcome.detail


def test_reports_unparseable_input_as_a_typed_failure() -> None:
    assert isinstance(extract.extract_markdown(""), extract.ExtractFailure)
    assert isinstance(extract.extract_markdown("neither html nor text"), extract.ExtractFailure)


def test_normalize_collapses_blank_lines_and_trailing_space() -> None:
    assert extract.normalize("# A  \r\n\r\n\r\n\r\ntext here \n") == "# A\n\ntext here"
