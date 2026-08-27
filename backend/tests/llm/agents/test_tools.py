"""`app/llm/agents/tools/` — the convention and the four tools of steps 3.11–3.12.

A tool is a thin mapping between the model and a service, so these tests stub the
services (`catalogue_search_service`, `product_service`; the fit-check and cost
services run for real on top of the stubbed catalogue read, because their own
modules own their arithmetic) and assert the things only the tool layer owns:

* **the frozen result shapes** — camelCase keys, the comparison covering every
  comparable specification field with explicit `null`s, the shortlist cap next to
  the true `totalCount`. The chat UI's renderers are written against these exact
  keys, so a rename must fail here;
* **name resolution failure** — `{"unknownBike": …}` instead of an exception;
* **args-schema validation** — a call the schema rejects never reaches a service
  and is not recorded, because it never executed;
* **capture** — the wrapper records every executed call in the pinned
  `tool_calls[]` shape, failures included, and hands the model a JSON string.

No test opens a database or reaches OpenRouter: the "session" is an inert marker
(the tools issue no statement of their own).
"""

import asyncio
import json
from typing import Any

import pytest
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import ValidationError
from pydantic.alias_generators import to_camel

from app.api.schemas.chat_messages import ToolCall
from app.db.models.motorbike import MotorbikeStatus
from app.llm.agents import tools
from app.llm.agents.tools import (
    catalogue_search,
    cost_estimator,
    licence_fit_check,
    spec_comparison,
)
from app.llm.query_translation import SpecFilters
from app.services import catalogue_search_service, cost_data, product_service
from app.services.catalogue_search_service import COMPARISON_SPEC_FIELDS, VerifiedSpecs

BIKE_A = "01J0BIKE0000000000000000AA"
BIKE_B = "01J0BIKE0000000000000000BB"


class _Session:
    """Marker object: every statement is a stubbed service call away."""


class _Motorbike:
    """The three attributes the tool layer reads off a catalogue entry."""

    def __init__(self, motorbike_id: str, name: str, status: Any) -> None:
        self.id = motorbike_id
        self.name = name
        self.status = status


def _specs(motorbike_id: str, name: str, **values: Any) -> VerifiedSpecs:
    """One `get_verified_specs` entry: every comparable field, mostly unknown."""
    return VerifiedSpecs(
        motorbike_id=motorbike_id,
        name=name,
        values={field: values.get(field) for field in COMPARISON_SPEC_FIELDS},
    )


@pytest.fixture
def ctx() -> tools.ToolContext:
    """A tool context with a fresh collector and no chat (like the CLI harness)."""
    return tools.ToolContext(session=_Session())


@pytest.fixture
def catalogue(monkeypatch: pytest.MonkeyPatch) -> Any:
    """Replace the three service entry points the two tools use.

    Returns the recorder so a test can assert what the tool asked the service for
    — the filter object above all, since "the tool reuses the 3.8 filter surface"
    is only true if a `SpecFilters` arrives.
    """

    class _Recorder:
        def __init__(self) -> None:
            self.filters: list[SpecFilters] = []
            self.requested_ids: list[list[str]] = []
            self.matches: list[str] = []
            self.specs: list[VerifiedSpecs] = []
            self.by_name: dict[str, _Motorbike] = {}
            self.by_id: dict[str, _Motorbike] = {}

    recorder = _Recorder()

    async def find_motorbike_ids(session: Any, filters: SpecFilters) -> list[str]:
        recorder.filters.append(filters)
        return list(recorder.matches)

    async def get_verified_specs(session: Any, motorbike_ids: Any) -> list[VerifiedSpecs]:
        recorder.requested_ids.append(list(motorbike_ids))
        wanted = set(motorbike_ids)
        return [entry for entry in recorder.specs if entry.motorbike_id in wanted]

    async def resolve_name(session: Any, name: str) -> _Motorbike | None:
        return recorder.by_name.get(name)

    async def get_motorbike(session: Any, motorbike_id: str) -> _Motorbike | None:
        return recorder.by_id.get(motorbike_id)

    monkeypatch.setattr(catalogue_search_service, "find_motorbike_ids", find_motorbike_ids)
    monkeypatch.setattr(catalogue_search_service, "get_verified_specs", get_verified_specs)
    monkeypatch.setattr(catalogue_search_service, "resolve_name", resolve_name)
    monkeypatch.setattr(product_service, "get_motorbike", get_motorbike)
    return recorder


def _execute(name: str, ctx: tools.ToolContext, arguments: dict[str, Any]) -> dict[str, Any]:
    """Run one registered tool the way the loop and the CLI both run it."""
    return asyncio.run(tools.execute(tools.get_tool_spec(name), ctx, arguments))


# --- the convention -----------------------------------------------------------


def test_the_registry_holds_this_step_s_tools_and_rejects_an_unknown_name() -> None:
    """`tool_names` is what the CLI lists and what the loop binds, in order."""
    assert tools.tool_names() == [
        catalogue_search.NAME,
        spec_comparison.NAME,
        licence_fit_check.NAME,
        cost_estimator.NAME,
    ]
    with pytest.raises(KeyError):
        tools.get_tool_spec("present_recommendations")


def test_every_registered_tool_has_a_described_camel_aliased_args_schema() -> None:
    """The convention itself: a schema the model can be shown, camelCase keys.

    `populate_by_name` is what lets the CLI harness pass snake_case while the
    model sends camelCase, and the description is what the model decides on.
    """
    for spec in tools.tool_specs():
        assert spec.description.strip(), spec.name
        assert spec.args_schema.model_config.get("populate_by_name") is True, spec.name
        properties = spec.args_schema.model_json_schema()["properties"]
        assert properties, spec.name
        for key in properties:
            assert key == to_camel(key), f"{spec.name}.{key} is not camelCase"


def test_what_the_model_is_shown_carries_the_camel_case_arguments(
    ctx: tools.ToolContext,
) -> None:
    """The function schema the provider receives, not just the class's aliases.

    Handed a Pydantic `args_schema`, LangChain rebuilds a subset model and loses
    the aliases — so the tool is built from the schema *dict* instead, and this is
    the test that would catch a regression to the class.
    """
    schemas = {
        tool.name: convert_to_openai_tool(tool)["function"]
        for tool in tools.build_advisor_tools(ctx)
    }

    assert set(schemas) == set(tools.tool_names())
    for name, schema in schemas.items():
        assert schema["description"], name
        for key in schema["parameters"]["properties"]:
            assert key == to_camel(key), f"{name}.{key} reached the provider snake_case"
    assert "a2Eligible" in schemas[catalogue_search.NAME]["parameters"]["properties"]
    assert set(schemas[spec_comparison.NAME]["parameters"]["properties"]) == {
        "motorbikeIds",
        "names",
    }


def test_a_langchain_tool_returns_the_result_as_json_and_records_it(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """What the agent loop sees: a JSON string, plus the pinned collector entry."""
    catalogue.matches = [BIKE_A]
    catalogue.specs = [_specs(BIKE_A, "Honda CB500F", category="naked", power_kw=35.0)]

    search = next(
        tool for tool in tools.build_advisor_tools(ctx) if tool.name == catalogue_search.NAME
    )
    answer = asyncio.run(search.ainvoke({"a2Eligible": True}))

    assert json.loads(answer) == {
        "results": [
            {
                "motorbikeId": BIKE_A,
                "name": "Honda CB500F",
                "category": "naked",
                "powerKw": 35.0,
                "wetWeightKg": None,
                "seatHeightMm": None,
                "priceBand": None,
            }
        ],
        "totalCount": 1,
    }
    (entry,) = ctx.collector.tool_calls
    assert entry["tool"] == catalogue_search.NAME
    assert entry["status"] == "succeeded"
    assert entry["error"] is None
    assert len(entry["id"]) == 26
    # Arguments are recorded camelCase, as the persisted shape pins them.
    assert entry["arguments"]["a2Eligible"] is True
    assert entry["result"] == json.loads(answer)


def test_a_failing_tool_is_recorded_as_failed_and_reraised(
    ctx: tools.ToolContext, catalogue: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A tool that raises must still be visible in the turn — and still raise.

    The loop needs the exception to tell the model what went wrong; the customer
    needs the entry to see that something was attempted.
    """

    async def explode(session: Any, filters: SpecFilters) -> list[str]:
        raise RuntimeError("connection lost")

    monkeypatch.setattr(catalogue_search_service, "find_motorbike_ids", explode)

    with pytest.raises(RuntimeError):
        _execute(catalogue_search.NAME, ctx, {})

    (entry,) = ctx.collector.tool_calls
    assert entry["status"] == "failed"
    assert entry["result"] == {}
    assert entry["error"] == "RuntimeError: connection lost"


# --- catalogue_search ---------------------------------------------------------


def test_catalogue_search_hands_the_service_the_frozen_filter_surface(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The args schema *is* `SpecFilters` (3.8), normalizers included."""
    _execute(catalogue_search.NAME, ctx, {"seatHeightMmMax": "80 cm", "priceBands": ["Mid"]})

    (filters,) = catalogue.filters
    assert isinstance(filters, SpecFilters)
    assert filters.seat_height_mm_max == 800
    assert filters.values()["price_bands"] == ["mid"]


def test_catalogue_search_caps_the_shortlist_and_still_reports_every_match(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The cap is a display cap: `totalCount` never shrinks with it."""
    ids = [f"01J0BIKE{index:018d}" for index in range(catalogue_search.MAX_RESULTS + 3)]
    catalogue.matches = ids
    catalogue.specs = [_specs(motorbike_id, f"Bike {motorbike_id}") for motorbike_id in ids]

    payload = _execute(catalogue_search.NAME, ctx, {})

    assert len(payload["results"]) == catalogue_search.MAX_RESULTS
    assert payload["totalCount"] == len(ids)
    # Only the visible ids were loaded — the cap is applied before the read.
    assert catalogue.requested_ids == [ids[: catalogue_search.MAX_RESULTS]]


# --- spec_comparison ----------------------------------------------------------


def test_spec_comparison_covers_every_comparable_field_with_aligned_values(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The frozen table: one row per comparable field, values aligned to `bikes`.

    The second bike has no verified power at all, which is the case the project
    cares about — the cell is an explicit `null`, never a copy of the neighbour
    and never a guess.
    """
    catalogue.by_name = {
        "Honda CB500F": _Motorbike(BIKE_A, "Honda CB500F", MotorbikeStatus.APPROVED),
        "Suzuki GSR600": _Motorbike(BIKE_B, "Suzuki GSR600", MotorbikeStatus.APPROVED),
    }
    catalogue.specs = [
        _specs(BIKE_A, "Honda CB500F", category="naked", power_kw=35.0, a2_eligible=True),
        _specs(BIKE_B, "Suzuki GSR600", category="naked"),
    ]

    payload = _execute(spec_comparison.NAME, ctx, {"names": ["Honda CB500F", "Suzuki GSR600"]})

    assert payload["bikes"] == [
        {"motorbikeId": BIKE_A, "name": "Honda CB500F"},
        {"motorbikeId": BIKE_B, "name": "Suzuki GSR600"},
    ]
    fields = [row["field"] for row in payload["rows"]]
    assert fields == [to_camel(field) for field in COMPARISON_SPEC_FIELDS]
    # The camelCase spelling the client maps to a label, pinned explicitly.
    assert {"powerKw", "seatHeightMm", "a2Eligible", "priceBand"} <= set(fields)
    rows = {row["field"]: row["values"] for row in payload["rows"]}
    assert rows["category"] == ["naked", "naked"]
    assert rows["powerKw"] == [35.0, None]
    assert rows["a2Eligible"] == [True, None]
    assert rows["seatHeightMm"] == [None, None]
    assert all(len(values) == len(payload["bikes"]) for values in rows.values())


def test_spec_comparison_answers_unknown_bike_for_a_name_it_cannot_resolve(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The shared resolution-failure result — and no half-built comparison."""
    catalogue.by_name = {
        "Honda CB500F": _Motorbike(BIKE_A, "Honda CB500F", MotorbikeStatus.APPROVED)
    }

    payload = _execute(spec_comparison.NAME, ctx, {"names": ["Honda CB500F", "Bikeley 999"]})

    assert payload == {"unknownBike": "Bikeley 999"}
    # Nothing was loaded: the call stops at the unresolvable reference.
    assert catalogue.requested_ids == []
    # It is a normal, recorded outcome, not a failure.
    assert ctx.collector.tool_calls[0]["status"] == "succeeded"


def test_spec_comparison_answers_unknown_bike_for_an_unapproved_id(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """An id is a reference like any other: unapproved entries are not showable."""
    catalogue.by_id = {
        BIKE_A: _Motorbike(BIKE_A, "Honda CB500F", MotorbikeStatus.APPROVED),
        BIKE_B: _Motorbike(BIKE_B, "Backlog Bike", MotorbikeStatus.BACKLOG),
    }

    payload = _execute(spec_comparison.NAME, ctx, {"motorbikeIds": [BIKE_A, BIKE_B]})

    assert payload == {"unknownBike": BIKE_B}


@pytest.mark.parametrize(
    "arguments",
    [
        {},
        {"names": ["Honda CB500F"]},
        {"names": ["A", "B", "C"], "motorbikeIds": [BIKE_A, BIKE_B]},
    ],
    ids=["nothing", "one-bike", "five-bikes"],
)
def test_spec_comparison_rejects_a_call_that_cannot_be_a_comparison(
    ctx: tools.ToolContext, catalogue: Any, arguments: dict[str, Any]
) -> None:
    """Args-schema validation: fewer than two or more than four bikes.

    The call never runs, so it is not recorded — a rejected argument list is not
    an executed tool call.
    """
    with pytest.raises(ValidationError):
        _execute(spec_comparison.NAME, ctx, arguments)

    assert ctx.collector.tool_calls == []
    assert catalogue.requested_ids == []


# --- licence_fit_check --------------------------------------------------------


def _approved(catalogue: Any, name: str = "Honda CB500F", **values: Any) -> None:
    """Put one approved model with the given verified specs in the stubbed catalogue."""
    catalogue.by_name[name] = _Motorbike(BIKE_A, name, MotorbikeStatus.APPROVED)
    catalogue.by_id[BIKE_A] = catalogue.by_name[name]
    catalogue.specs = [_specs(BIKE_A, name, **values)]


def test_licence_fit_check_returns_the_frozen_rule_shape(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The pinned result: the bike, then one rule object per check.

    The verdicts and the evidence strings belong to `fit_check_service` (tested
    there); what this asserts is the shape the chat UI's renderer reads and the
    fact that the evidence carries the verified figures at all.
    """
    _approved(catalogue, power_kw=35.0, wet_weight_kg=189.0, seat_height_mm=789)

    payload = _execute(
        licence_fit_check.NAME,
        ctx,
        {"motorbikeName": "Honda CB500F", "licence": "A2", "riderHeightCm": 165},
    )

    assert set(payload) == {"motorbikeId", "name", "rules"}
    assert payload["motorbikeId"] == BIKE_A
    assert payload["name"] == "Honda CB500F"
    for rule in payload["rules"]:
        assert set(rule) == {"rule", "label", "verdict", "evidence"}
        assert rule["verdict"] in {"pass", "fail", "unknown"}
        assert rule["label"]
    rules = {rule["rule"]: rule for rule in payload["rules"]}
    assert rules["a2_power"]["verdict"] == "pass"
    # The numbers used are in the evidence, not only in the verdict.
    assert "35.0 kW" in rules["a2_power"]["evidence"]
    assert "189 kg" in rules["a2_power_to_weight"]["evidence"]
    assert "789 mm" in rules["seat_height_fit"]["evidence"]


def test_licence_fit_check_records_a_read_path_valid_entry(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """What is persisted must survive `GET /api/chat-messages`' validation.

    The read path validates every stored `tool_calls[]` entry against the frozen
    `ToolCall` model, where a missing key is a 500 rather than a silent gap — so
    the recorded entry is validated here, at the only place that produces it.
    """
    _approved(catalogue, power_kw=35.0, wet_weight_kg=189.0, seat_height_mm=789)

    _execute(licence_fit_check.NAME, ctx, {"motorbikeName": "Honda CB500F", "insideLegMm": 780})

    (entry,) = ctx.collector.tool_calls
    validated = ToolCall.model_validate(entry)
    assert validated.tool == licence_fit_check.NAME
    assert validated.status.value == "succeeded"
    assert validated.result == entry["result"]
    # Arguments are recorded camelCase, defaults included, as the shape pins them.
    assert entry["arguments"] == {
        "motorbikeId": None,
        "motorbikeName": "Honda CB500F",
        "licence": "A2",
        "riderHeightCm": None,
        "insideLegMm": 780,
        "experience": None,
    }


def test_licence_fit_check_answers_unknown_bike_for_a_name_it_cannot_resolve(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The shared resolution failure, and no rules invented around it."""
    payload = _execute(licence_fit_check.NAME, ctx, {"motorbikeName": "Bikeley 999"})

    assert payload == {"unknownBike": "Bikeley 999"}
    assert ctx.collector.tool_calls[0]["status"] == "succeeded"


@pytest.mark.parametrize(
    "arguments",
    [
        {"licence": "A2"},
        {"motorbikeName": "Honda CB500F", "riderHeightCm": 17},
        {"motorbikeName": "Honda CB500F", "insideLegMm": 78},
        {"motorbikeName": "Honda CB500F", "licence": "A1"},
    ],
    ids=["no-bike", "metres-for-centimetres", "centimetres-for-millimetres", "unsupported-licence"],
)
def test_licence_fit_check_rejects_arguments_it_cannot_answer_honestly(
    ctx: tools.ToolContext, catalogue: Any, arguments: dict[str, Any]
) -> None:
    """A unit slip or an unsupported licence must fail loudly, not produce a verdict."""
    with pytest.raises(ValidationError):
        _execute(licence_fit_check.NAME, ctx, arguments)

    assert ctx.collector.tool_calls == []


# --- cost_estimator -----------------------------------------------------------


def test_cost_estimator_returns_the_frozen_estimate_shape(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """The pinned estimate: EUR line items, their total, assumptions, table version."""
    _approved(catalogue, category="naked", engine_cc=471, power_kw=35.0, price_band="mid")

    payload = _execute(
        cost_estimator.NAME, ctx, {"motorbikeName": "Honda CB500F", "annualKm": 8000}
    )

    assert set(payload) == {
        "motorbikeId",
        "name",
        "currency",
        "lineItems",
        "total",
        "assumptions",
        "coefficientsVersion",
    }
    assert payload["currency"] == "EUR"
    assert payload["coefficientsVersion"] == cost_data.COEFFICIENTS_VERSION
    assert payload["lineItems"]
    for line in payload["lineItems"]:
        assert set(line) == {"label", "amount"}
        assert isinstance(line["amount"], int)
    assert payload["total"] == sum(line["amount"] for line in payload["lineItems"])
    # The estimate has to say what it rests on — this is the field that makes it
    # an estimate rather than a price.
    assert payload["assumptions"]
    assert ToolCall.model_validate(ctx.collector.tool_calls[0]).result == payload


def test_cost_estimator_is_deterministic_through_the_tool(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """Same bike, same mileage, same euros — twice in one conversation."""
    _approved(catalogue, category="naked", engine_cc=471, power_kw=35.0, price_band="mid")
    arguments = {"motorbikeName": "Honda CB500F", "annualKm": 11000}

    assert _execute(cost_estimator.NAME, ctx, arguments) == _execute(
        cost_estimator.NAME, ctx, arguments
    )


def test_cost_estimator_answers_unknown_bike_for_an_unapproved_id(
    ctx: tools.ToolContext, catalogue: Any
) -> None:
    """An id is a reference like any other: an unreviewed entry has no price to quote."""
    catalogue.by_id = {BIKE_B: _Motorbike(BIKE_B, "Backlog Bike", MotorbikeStatus.BACKLOG)}

    payload = _execute(cost_estimator.NAME, ctx, {"motorbikeId": BIKE_B})

    assert payload == {"unknownBike": BIKE_B}


@pytest.mark.parametrize(
    "arguments",
    [{}, {"motorbikeName": "Honda CB500F", "annualKm": -1}, {"annualKm": 8000}],
    ids=["nothing", "negative-mileage", "no-bike"],
)
def test_cost_estimator_rejects_a_call_it_cannot_cost(
    ctx: tools.ToolContext, catalogue: Any, arguments: dict[str, Any]
) -> None:
    """No bike named, or a mileage that is not a mileage: nothing runs, nothing is recorded."""
    with pytest.raises(ValidationError):
        _execute(cost_estimator.NAME, ctx, arguments)

    assert ctx.collector.tool_calls == []
