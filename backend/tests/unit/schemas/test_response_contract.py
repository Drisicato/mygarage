"""Responses carry no bounds on any number.

A response validates what the database hands it. A number that inherits an
input bound (`le=100`, `ge=0`) turns a stored value past that bound into a 500
on every read of the record, and of every list it's in. Legacy rows hold such
values, and LiveLink, the webhooks and the importers write some of these columns
without the input schema. A digit rule (`decimal_places`, `max_digits`,
`multiple_of`) refuses a stored value the same way, so it counts as a bound too.
So no model reachable from a route's response may bound a number, money or not,
however deep it sits: list items, nested models, Optional and Annotated
wrappers all count.

The model set comes from the router, not from class names, so a new response
model is covered without registering it. The one way out is a CHECK constraint
that already keeps the column inside the bound (`CHECK_BACKED_BOUNDS`): then no
stored row can break it.

A response drops a bound by redeclaring the field without it (a twin). A twin
must otherwise match the field it shadows, so the read side can't drift from
the write side's type, default or description.

A validator is the same trap: one on a shared base runs on every response
built from it, so a stored value it refuses 500s the read too. Each one a
response runs has to be read-tolerant, held by a CHECK, or on an input model a
response reuses on purpose. Anything else belongs on the input schemas.
"""

import annotationlib
import typing
from collections.abc import Iterable, Iterator
from decimal import Decimal
from typing import Annotated, Any, TypeAliasType

from fastapi.routing import APIRoute, iter_route_contexts
from pydantic import BaseModel, Field
from pydantic.fields import FieldInfo
from sqlalchemy import CheckConstraint

from app.database import Base
from app.main import app
from app.schemas._money import OptionalMoney
from tests.unit.schemas._schema_walk import NUMBER_TYPES, unwrap, walk

_BOUND_ATTRS = ("ge", "gt", "le", "lt", "multiple_of", "max_digits", "decimal_places")

#: Bounds a CHECK constraint guarantees, so a stored row can't break them: (model, field) -> (table, check).
CHECK_BACKED_BOUNDS: dict[tuple[str, str], tuple[str, str]] = {
    ("ReminderPackItem", "interval_km"): ("reminder_pack_items", "check_pack_item_interval_km"),
    ("ReminderPackItem", "interval_months"): (
        "reminder_pack_items",
        "check_pack_item_interval_months",
    ),
    ("ReminderPackItem", "interval_days"): ("reminder_pack_items", "check_pack_item_interval_days"),
    ("ReminderPackItem", "interval_hours"): (
        "reminder_pack_items",
        "check_pack_item_interval_hours",
    ),
}


def _bounds(metadata: Iterable[Any]) -> list[str]:
    """Every bound or digit rule in a metadata list, including a nested FieldInfo's own."""
    found = []
    for item in metadata:
        for attr in _BOUND_ATTRS:
            value = getattr(item, attr, None)
            if value is not None:
                found.append(f"{attr}={value}")
        if isinstance(item, FieldInfo):
            found += _bounds(item.metadata)
    return found


def _number_fields(model: type[BaseModel]) -> dict[str, list[str]]:
    """Each number field of the model, with the bounds it carries."""
    fields = {}
    for name, info in model.model_fields.items():
        is_number, metadata, _models = unwrap(info.annotation, types=NUMBER_TYPES)
        if is_number:
            fields[name] = _bounds(info.metadata) + _bounds(metadata)
    return fields


def _bounded(models: Iterable[type[BaseModel]]) -> dict[str, dict[str, list[str]]]:
    """Model name -> {number field: its bounds}, for the models that bound one.

    A pair in CHECK_BACKED_BOUNDS is left out, since the database already holds it.
    """
    found = {}
    for model in models:
        bounded = {
            name: b
            for name, b in _number_fields(model).items()
            if b and (model.__name__, name) not in CHECK_BACKED_BOUNDS
        }
        if bounded:
            found[model.__name__] = bounded
    return found


def _response_roots() -> list[Any]:
    """Every response annotation the app declares, from `response_model` and `responses`."""
    roots = []
    for ctx in iter_route_contexts(app.routes):
        route = ctx.original_route
        if not isinstance(route, APIRoute):
            continue
        if route.response_model is not None:
            roots.append(route.response_model)
        for extra in route.responses.values():
            if isinstance(extra, dict) and extra.get("model") is not None:
                roots.append(extra["model"])
    return roots


RESPONSE_MODELS = sorted(walk(_response_roots()), key=lambda m: m.__name__)


def test_the_walk_found_the_responses():
    """A guard: a floor on the walk itself, so a FastAPI change that hides routes
    or nested models from it can't turn the contract into a pass over nothing.

    Mutant: call `_number_fields` with the default MONEY_TYPES, and the number
    count falls to about 361.
    """
    names = {model.__name__ for model in RESPONSE_MODELS}
    assert len(RESPONSE_MODELS) >= 200
    # Reached only through a parent's field, never as a route's own model.
    assert {"PolicyVehicleResponse", "ServiceLineItemResponse", "SupplyUsageResponse"} <= names
    numbers = sum(len(_number_fields(model)) for model in RESPONSE_MODELS)
    assert numbers >= 600


def test_no_response_bounds_a_number():
    assert _bounded(RESPONSE_MODELS) == {}, (
        "a response inherits an input bound on a number: redeclare the field on "
        "the response without it, or move the bound off the shared base"
    )


def test_a_check_backed_bound_names_a_real_check():
    """A guard: each CHECK_BACKED_BOUNDS entry names a CHECK that exists and is
    about its field, and the field still carries a bound to excuse.

    Mutants: rename a CHECK in `models/reminder_pack.py`, or drop a pair's bound.
    """
    by_name = {model.__name__: model for model in RESPONSE_MODELS}
    for (model_name, field), (table, check) in CHECK_BACKED_BOUNDS.items():
        checks = {
            constraint.name: str(constraint.sqltext)
            for constraint in Base.metadata.tables[table].constraints
            if isinstance(constraint, CheckConstraint)
        }
        assert check in checks, f"{table} has no CHECK named {check}"
        assert field in checks[check], f"{check} doesn't mention {field}: {checks[check]}"
        assert model_name in by_name, f"{model_name} isn't a response any more"
        assert _number_fields(by_name[model_name]).get(field), (
            f"{model_name}.{field} carries no bound now: drop its CHECK_BACKED_BOUNDS entry"
        )


def test_the_insurance_input_model_is_not_a_response():
    # The response has its own unbounded twin, so the input model's bounds can
    # tighten without reaching a read.
    names = {model.__name__ for model in RESPONSE_MODELS}
    assert "CoverageEntryResponse" in names
    assert "CoverageEntry" not in names


# A twin: a response redeclares a field to drop its bound, and copies the rest.

#: Twins that differ from the field they shadow on purpose: (model, field) -> why.
DELIBERATE_TWINS: dict[tuple[str, str], str] = {}


def _plain(annotation: Any) -> Any:
    """The annotation with its constraints peeled off, at any depth.

    Drops every Annotated layer and `type` alias, so `OptionalMoney` and
    `Decimal | None` come out the same.
    """
    if isinstance(annotation, TypeAliasType):
        return _plain(annotation.__value__)
    if typing.get_origin(annotation) is Annotated:
        return _plain(typing.get_args(annotation)[0])
    args = typing.get_args(annotation)
    if not args:
        return annotation
    return typing.get_origin(annotation), tuple(_plain(arg) for arg in args)


def _shadowed(model: type[BaseModel]) -> Iterator[tuple[str, FieldInfo, FieldInfo]]:
    """Each field the model redeclares over a base's: its name, its FieldInfo, the base's."""
    own = annotationlib.get_annotations(model, format=annotationlib.Format.FORWARDREF)
    for name in own:
        if name not in model.model_fields:
            continue
        for base in model.__mro__[1:]:
            if issubclass(base, BaseModel) and name in base.model_fields:
                yield name, model.model_fields[name], base.model_fields[name]
                break


def _drift(twin: FieldInfo, shadowed: FieldInfo) -> list[str]:
    """How a twin differs from the field it shadows, bounds aside."""
    drift: list[str] = []
    if _plain(twin.annotation) != _plain(shadowed.annotation):
        drift.append(f"type {twin.annotation} vs {shadowed.annotation}")
    twin_default = (twin.is_required(), twin.default, twin.default_factory)
    shadowed_default = (shadowed.is_required(), shadowed.default, shadowed.default_factory)
    if twin_default != shadowed_default:
        drift.append(f"default {twin_default} vs {shadowed_default}")
    if twin.description != shadowed.description:
        drift.append(f"description {twin.description!r} vs {shadowed.description!r}")
    return drift


def _twins(
    models: Iterable[type[BaseModel]], registry: dict[tuple[str, str], str]
) -> tuple[int, dict[str, list[str]], list[tuple[str, str]]]:
    """Every twin the models hold, checked against the field it shadows.

    Returns how many twins there were, the ones that drift outside `registry`,
    and the registry pairs that don't differ any more (stale entries).
    """
    count = 0
    drift: dict[str, list[str]] = {}
    deliberate: dict[tuple[str, str], list[str]] = {}
    for model in models:
        for name, twin, shadowed in _shadowed(model):
            count += 1
            found = _drift(twin, shadowed)
            if (model.__name__, name) in registry:
                deliberate[(model.__name__, name)] = found
            elif found:
                drift[f"{model.__name__}.{name}"] = found
    stale = [pair for pair in registry if not deliberate.get(pair)]
    return count, drift, stale


def test_a_twin_matches_the_field_it_shadows():
    """A guard: every twin copies its field's type, default and description, and
    only drops the bound. A DELIBERATE_TWINS entry must still differ.

    Mutants: make `_shadowed` yield nothing (the floor fails), or change one
    twin's description (`FuelRecordResponse.cost`, say).
    """
    count, drift, stale = _twins(RESPONSE_MODELS, DELIBERATE_TWINS)
    # 60 today. A floor, so a change in how annotations are read can't turn
    # this into a pass over nothing.
    assert count >= 50
    assert drift == {}, "a twin drifted from the field it shadows: copy it again, bound aside"
    assert stale == [], "these match their field now: drop their DELIBERATE_TWINS entries"


# Validators. One a response runs sees every stored row it reads.

#: Validators a stored row can't trip, and why.
READ_TOLERANT: dict[tuple[str, str], str] = {
    ("AddressBookEntryBase", "empty_str_to_none"): "turns an empty string into None",
    ("DTCDefinitionResponse", "_parse_json_list"): "returns None for anything it can't parse",
    ("FuelRecordBase", "_parse_obc_trip_duration_create"): (
        "an Integer column hands it an int, which passes straight through"
    ),
    ("TollTagBase", "validate_toll_system"): "only rewrites a known spelling, never raises",
    ("TopicMapBase", "canonicalize"): "uppercases, never raises",
    ("UserResponse", "discard_out_of_vocabulary_unit"): "built to drop a bad stored unit",
    ("UserResponse", "discard_out_of_vocabulary_unit_preference"): (
        "built to read a bad stored preference as imperial"
    ),
}
#: Validators a CHECK guarantees: (owner, validator) -> (table, column, (check, ...)).
#: The column is None for a model validator, which spans several.
CHECK_BACKED_VALIDATORS: dict[tuple[str, str], tuple[str, str | None, tuple[str, ...]]] = {
    ("ReminderPackItem", "fill_key_and_check_intervals"): (
        "reminder_pack_items",
        None,
        ("check_pack_item_has_interval", "check_pack_item_distance_or_hours"),
    ),
    ("ServiceLineItemBase", "validate_inspection_result"): (
        "service_line_items",
        "inspection_result",
        ("check_inspection_result",),
    ),
    ("ServiceLineItemBase", "validate_inspection_severity"): (
        "service_line_items",
        "inspection_severity",
        ("check_inspection_severity",),
    ),
    ("ServiceVisitBase", "validate_service_category"): (
        "service_visits",
        "service_category",
        ("check_service_visit_category",),
    ),
    ("TrailerDetailsBase", "validate_brake_type"): (
        "trailer_details",
        "brake_type",
        ("check_brake_type",),
    ),
    ("TrailerDetailsBase", "validate_hitch_type"): (
        "trailer_details",
        "hitch_type",
        ("check_hitch_type",),
    ),
}
#: Input models a response reuses on purpose: model -> why its own rules stay.
INPUT_MODELS_REUSED: dict[str, str] = {
    "ReminderPackItem": (
        "the pack format the apply pipeline consumes, reused as the response. Apply "
        "must fail closed on a bad type, and a saved pack copies its type from a rule "
        "that only validated schemas write"
    ),
}


def _owner(model: type[BaseModel], name: str) -> str:
    """The class in the model's MRO that declares the validator."""
    return next(cls.__name__ for cls in model.__mro__ if name in cls.__dict__)


def _validators(model: type[BaseModel]) -> dict[tuple[str, str], tuple[str, ...]]:
    """Each validator the model runs, keyed (owner, name), with the fields it
    checks. A model validator checks none by name."""
    decorators = model.__pydantic_decorators__
    found = {
        (_owner(model, name), name): decorator.info.fields
        for name, decorator in decorators.field_validators.items()
    }
    for name in decorators.model_validators:
        found[(_owner(model, name), name)] = ()
    return found


def test_every_response_validator_is_accounted_for():
    unaccounted = sorted(
        f"{model.__name__}: {owner}.{name}"
        for model in RESPONSE_MODELS
        if model.__name__ not in INPUT_MODELS_REUSED
        for owner, name in _validators(model)
        if (owner, name) not in READ_TOLERANT and (owner, name) not in CHECK_BACKED_VALIDATORS
    )
    assert unaccounted == [], (
        "a stored row can trip these and 500 the read: move them to the input "
        "schemas, or register why no stored row can"
    )


def test_a_check_backed_validator_names_real_checks():
    """A guard: each CHECK_BACKED_VALIDATORS entry names CHECKs that exist on its
    table, about the column its validator checks.

    Mutants: rename `check_hitch_type` in `models/vehicle.py`, or give the
    ReminderPackItem entry the column `interval_km`.
    """
    seen = {key: fields for model in RESPONSE_MODELS for key, fields in _validators(model).items()}
    for (owner, name), (table, column, names) in CHECK_BACKED_VALIDATORS.items():
        checks = {
            constraint.name: str(constraint.sqltext)
            for constraint in Base.metadata.tables[table].constraints
            if isinstance(constraint, CheckConstraint)
        }
        for check in names:
            assert check in checks, f"{table} has no CHECK named {check}"
            if column is not None:
                assert column in checks[check], f"{check} doesn't mention {column}"
        assert column is None or column in seen.get((owner, name), ()), (
            f"{owner}.{name} doesn't check {column}"
        )


def test_no_stale_validator_entries():
    """A guard: every registry entry still names a validator a response runs,
    and every reused input model is still a response with validators of its own.

    Mutants: add a READ_TOLERANT entry for a validator that doesn't exist, or
    an INPUT_MODELS_REUSED entry for a model that isn't a response.
    """
    seen = {key for model in RESPONSE_MODELS for key in _validators(model)}
    validated = {model.__name__ for model in RESPONSE_MODELS if _validators(model)}
    stale = [
        f"{owner}.{name}"
        for owner, name in (*READ_TOLERANT, *CHECK_BACKED_VALIDATORS)
        if (owner, name) not in seen
    ]
    stale += [model for model in INPUT_MODELS_REUSED if model not in validated]
    assert stale == [], "no response runs these now: drop their entries"


# The detector itself, on one field per way a bound can be written.

type _BoundedAlias = Annotated[Decimal, Field(ge=0)]
type _BoundedCount = Annotated[int, Field(ge=1)]


class _Nested(BaseModel):
    cost: Decimal | None = Field(None, ge=0)


class _Probe(BaseModel):
    amount: Decimal | None = Field(None, le=100)
    cost: Annotated[Decimal, Field(ge=0)] | None = None
    premium: OptionalMoney = None
    deductible: _BoundedAlias | None = None
    price: float = Field(0, gt=0)
    rate: Decimal | None = Field(None, decimal_places=2)
    fee: Decimal | None = Field(None, max_digits=12)
    charge: Decimal | None = Field(None, multiple_of=Decimal("0.01"))
    # A number with no bound stays out. A measurement and a count aren't money,
    # but their bounds 500 a read all the same.
    total_cost: Decimal | None = None
    odometer_km: Decimal | None = Field(None, ge=0)
    total: int = Field(0, ge=0)
    count: int | None = Field(None, ge=0)
    aliased: _BoundedCount | None = None
    items: list[_Nested] = []


def test_the_detector_sees_every_form():
    # On the FieldInfo, inside the Optional, through the shared alias, inside a
    # PEP 695 alias, on a float, each digit rule, an int bare, Optional and
    # aliased, and one model down through a list.
    assert _bounded(walk([_Probe])) == {
        "_Probe": {
            "amount": ["le=100"],
            "cost": ["ge=0"],
            "premium": ["ge=0", "le=9999999999.99"],
            "deductible": ["ge=0"],
            "price": ["gt=0"],
            "rate": ["decimal_places=2"],
            "fee": ["max_digits=12"],
            "charge": ["multiple_of=0.01"],
            "odometer_km": ["ge=0"],
            "total": ["ge=0"],
            "count": ["ge=0"],
            "aliased": ["ge=1"],
        },
        "_Nested": {"cost": ["ge=0"]},
    }


# The twin check itself, on local classes and a local registry.


class _TwinBase(BaseModel):
    same: Decimal | None = Field(None, ge=0, description="Kept")
    money: OptionalMoney = Field(None, description="Paid")
    counted: _BoundedCount | None = None
    described: Decimal | None = Field(None, ge=0, description="Original")
    defaulted: Decimal | None = Field(None, ge=0)
    required: Decimal = Field(..., ge=0)
    typed: Decimal | None = Field(None, ge=0)
    registered: int | None = Field(None, ge=0, description="Bounded")
    settled: int | None = Field(None, ge=0)


class _TwinProbe(_TwinBase):
    # Bounds dropped and nothing else, through a plain field, the shared money
    # alias and a PEP 695 alias.
    same: Decimal | None = Field(None, description="Kept")
    money: Decimal | None = Field(None, description="Paid")
    counted: int | None = None
    # One drift each.
    described: Decimal | None = Field(None, description="Changed")
    defaulted: Decimal | None = Decimal(0)
    required: Decimal = Decimal(0)
    typed: float | None = None
    # Registered: one still differs, one matches now and so is stale.
    registered: int | None = None
    settled: int | None = None


_PROBE_TWINS: dict[tuple[str, str], str] = {
    ("_TwinProbe", "registered"): "drops its description on purpose",
    ("_TwinProbe", "settled"): "used to differ",
}


def test_the_twin_check_sees_each_drift():
    """A guard: true today. Each kind of drift is flagged for its own reason, a
    registered pair that still differs passes, and one that matches is stale.

    Mutant: drop the description comparison from `_drift`.
    """
    count, drift, stale = _twins([_TwinProbe], _PROBE_TWINS)
    assert count == 9
    assert {name: [d.split()[0] for d in found] for name, found in drift.items()} == {
        "_TwinProbe.described": ["description"],
        "_TwinProbe.defaulted": ["default"],
        "_TwinProbe.required": ["default"],
        "_TwinProbe.typed": ["type"],
    }
    assert stale == [("_TwinProbe", "settled")]
