"""Pydantic schemas for Ask My Garage assistant."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CitationSource = Literal[
    "vehicle_spec",
    "service_visit",
    "note",
    "supply",
    "tire",
    "reminder",
    "dtc",
    "dtc_definition",
    "trailer",
]


class AssistantHistoryMessage(BaseModel):
    role: Literal["user", "assistant"] = Field(..., description="Chat turn role")
    content: str = Field(..., min_length=1, max_length=2000)


class GarageAssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500, description="User question")
    history: list[AssistantHistoryMessage] = Field(
        default_factory=list,
        max_length=6,
        description="Optional prior turns (client-held; not persisted server-side)",
    )


class AssistantCitation(BaseModel):
    source: CitationSource
    # No length rules: _coerce_citations clips both already, and a rule here
    # could only turn a long one into a 500.
    label: str
    detail: str | None = None


class GarageAssistantChatResponse(BaseModel):
    answer: str
    citations: list[AssistantCitation] = Field(default_factory=list)
    missing: list[str] = Field(
        default_factory=list,
        description="Spec fields or data the user asked about that are not in records",
    )
