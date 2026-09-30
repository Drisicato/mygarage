"""Walking the models a route reaches, for the money contract tests.

A bound can hide anywhere a type can: inside an Optional, a list, an Annotated,
a PEP 695 alias, or one model down. These see through all of them, so the
request and the response contracts look at the same thing.
"""

import typing
from collections.abc import Iterable, Iterator
from decimal import Decimal
from typing import Annotated, Any, TypeAliasType

from pydantic import BaseModel

#: The types an amount of money can be declared as.
MONEY_TYPES = (Decimal, float)


def unwrap(annotation: Any) -> tuple[bool, list[Any], list[type[BaseModel]]]:
    """What an annotation holds: whether it is a money type, its Annotated
    metadata, and the models inside it.

    Walks Optional/Union, list/dict/tuple arguments, Annotated and `type` aliases,
    since a bound can hide inside any of them.
    """
    if isinstance(annotation, TypeAliasType):
        return unwrap(annotation.__value__)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return False, [], [annotation]
    if annotation in MONEY_TYPES:
        return True, [], []
    is_money_type, metadata, models = False, [], []
    if typing.get_origin(annotation) is Annotated:
        metadata += annotation.__metadata__
    for arg in typing.get_args(annotation):
        inner_money, inner_metadata, inner_models = unwrap(arg)
        is_money_type = is_money_type or inner_money
        metadata += inner_metadata
        models += inner_models
    return is_money_type, metadata, models


def walk(roots: Iterable[Any]) -> Iterator[type[BaseModel]]:
    """Every model reachable from the root annotations, each once."""
    seen: set[type[BaseModel]] = set()
    queue = [model for root in roots for model in unwrap(root)[2]]
    while queue:
        model = queue.pop()
        if model in seen:
            continue
        seen.add(model)
        yield model
        for info in model.model_fields.values():
            queue += unwrap(info.annotation)[2]
