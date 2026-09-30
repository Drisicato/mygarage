"""Responses carry no money bounds.

A response validates what the database hands it. A money field that inherits an
input bound (`le=99999.99`, `ge=0`) turns a stored value past that bound into a
500 on every read of the record, and legacy rows hold exactly such values. So no
model reachable from a route's response may bound a money field, however deep it
sits: list items, nested models, Optional and Annotated wrappers all count.

The model set comes from the router, not from class names, so a new response
model is covered without registering it. A field typed Decimal or float is money
when its name is (`_money_names.is_money_name`) or when it names a registered
money column (`MONEY_COLUMN_NAMES`). The registry is the authority, so a column
the word list misses still counts.
"""

import typing
from collections.abc import Iterable, Iterator
from decimal import Decimal
from typing import Annotated, Any, TypeAliasType

from fastapi.routing import APIRoute, iter_route_contexts
from pydantic import BaseModel, Field
from pydantic.fields import FieldInfo

from app.main import app
from app.schemas._money import OptionalMoney
from tests.unit.schemas._money_names import MONEY_COLUMN_NAMES, is_money_name

_BOUND_ATTRS = ("ge", "gt", "le", "lt")
_MONEY_TYPES = (Decimal, float)


def _bounds(metadata: Iterable[Any]) -> list[str]:
    """Every ge/gt/le/lt in a metadata list, including a nested FieldInfo's own."""
    found = []
    for item in metadata:
        for attr in _BOUND_ATTRS:
            value = getattr(item, attr, None)
            if value is not None:
                found.append(f"{attr}={value}")
        if isinstance(item, FieldInfo):
            found += _bounds(item.metadata)
    return found


def _unwrap(annotation: Any) -> tuple[bool, list[Any], list[type[BaseModel]]]:
    """What an annotation holds: whether it is a money type, its Annotated
    metadata, and the models inside it.

    Walks Optional/Union, list/dict/tuple arguments, Annotated and `type` aliases,
    since a bound can hide inside any of them.
    """
    if isinstance(annotation, TypeAliasType):
        return _unwrap(annotation.__value__)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return False, [], [annotation]
    if annotation in _MONEY_TYPES:
        return True, [], []
    is_money_type, metadata, models = False, [], []
    if typing.get_origin(annotation) is Annotated:
        metadata += annotation.__metadata__
    for arg in typing.get_args(annotation):
        inner_money, inner_metadata, inner_models = _unwrap(arg)
        is_money_type = is_money_type or inner_money
        metadata += inner_metadata
        models += inner_models
    return is_money_type, metadata, models


def _walk(roots: Iterable[Any]) -> Iterator[type[BaseModel]]:
    """Every model reachable from the root annotations, each once."""
    seen: set[type[BaseModel]] = set()
    queue = [model for root in roots for model in _unwrap(root)[2]]
    while queue:
        model = queue.pop()
        if model in seen:
            continue
        seen.add(model)
        yield model
        for info in model.model_fields.values():
            queue += _unwrap(info.annotation)[2]


def _money_fields(model: type[BaseModel], registered: frozenset[str]) -> dict[str, list[str]]:
    """Each money field of the model, with the bounds it carries.

    `registered` is the column names that count as money whatever their words.
    """
    fields = {}
    for name, info in model.model_fields.items():
        is_money_type, metadata, _models = _unwrap(info.annotation)
        if is_money_type and (is_money_name(name) or name in registered):
            fields[name] = _bounds(info.metadata) + _bounds(metadata)
    return fields


def _bounded(
    models: Iterable[type[BaseModel]], registered: frozenset[str]
) -> dict[str, dict[str, list[str]]]:
    """Model name -> {money field: its bounds}, for the models that bound one."""
    found = {}
    for model in models:
        bounded = {name: b for name, b in _money_fields(model, registered).items() if b}
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


RESPONSE_MODELS = sorted(_walk(_response_roots()), key=lambda m: m.__name__)


def test_the_walk_found_the_responses():
    # A floor on the walk itself, so a FastAPI change that hides routes or
    # nested models from it can't turn the contract into a pass over nothing.
    names = {model.__name__ for model in RESPONSE_MODELS}
    assert len(RESPONSE_MODELS) >= 200
    # Reached only through a parent's field, never as a route's own model.
    assert {"PolicyVehicleResponse", "ServiceLineItemResponse", "SupplyUsageResponse"} <= names
    money = sum(len(_money_fields(model, MONEY_COLUMN_NAMES)) for model in RESPONSE_MODELS)
    assert money >= 100


def test_no_response_bounds_a_money_field():
    assert _bounded(RESPONSE_MODELS, MONEY_COLUMN_NAMES) == {}, (
        "a response inherits an input bound on money: redeclare the field on the "
        "response without it, or move the bound off the shared base"
    )


def test_the_insurance_input_model_is_not_a_response():
    # The response has its own unbounded twin, so the input model's bounds can
    # tighten without reaching a read.
    names = {model.__name__ for model in RESPONSE_MODELS}
    assert "CoverageEntryResponse" in names
    assert "CoverageEntry" not in names


# The detector itself, on one field per way a bound can be written.

type _BoundedAlias = Annotated[Decimal, Field(ge=0)]


class _Nested(BaseModel):
    cost: Decimal | None = Field(None, ge=0)


class _Probe(BaseModel):
    amount: Decimal | None = Field(None, le=100)
    cost: Annotated[Decimal, Field(ge=0)] | None = None
    premium: OptionalMoney = None
    deductible: _BoundedAlias | None = None
    price: float = Field(0, gt=0)
    # Money with no bound, a bounded measurement, and a bounded count.
    total_cost: Decimal | None = None
    odometer_km: Decimal | None = Field(None, ge=0)
    total: int = Field(0, ge=0)
    items: list[_Nested] = []


def test_the_detector_sees_every_form():
    # On the FieldInfo, inside the Optional, through the shared alias, inside a
    # PEP 695 alias, on a float, and one model down through a list.
    assert _bounded(_walk([_Probe]), frozenset()) == {
        "_Probe": {
            "amount": ["le=100"],
            "cost": ["ge=0"],
            "premium": ["ge=0", "le=9999999999.99"],
            "deductible": ["ge=0"],
            "price": ["gt=0"],
        },
        "_Nested": {"cost": ["ge=0"]},
    }


class _Ledger(BaseModel):
    # No money word in the name, and a count that must stay out of it.
    balance: Decimal = Field(Decimal(0), ge=0)
    entries: int = Field(0, ge=0)


def test_a_registered_column_name_is_money_whatever_the_word_list_says():
    assert not is_money_name("balance")
    assert _bounded([_Ledger], frozenset()) == {}
    assert _bounded([_Ledger], frozenset({"balance", "entries"})) == {
        "_Ledger": {"balance": ["ge=0"]}
    }
