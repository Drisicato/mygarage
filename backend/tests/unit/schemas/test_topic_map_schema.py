"""The topic map create schema keeps the rules its response can't share.

A rule on the shared base runs on every stored row a response reads, so one a
legacy row breaks lives on the create instead. The PATCH revalidates the merged
row through the create, so it keeps them too.
"""

import pytest
from pydantic import ValidationError

from app.schemas.livelink_topic_map import TopicMapCreate


def test_create_refuses_a_wildcard_topic():
    """A guard: true today.

    Mutant: delete the base's validator without adding it to the create.
    """
    with pytest.raises(ValidationError, match="must be exact"):
        TopicMapCreate(device_id="gw01", topic="wican/+/level", param_key="LEVEL")


def test_create_refuses_telemetry_without_a_param_key():
    """A guard: true today.

    Mutant: delete the base's validator without adding it to the create.
    """
    with pytest.raises(ValidationError, match="param_key is required"):
        TopicMapCreate(device_id="gw01", topic="wican/gw01/level", role="telemetry")
