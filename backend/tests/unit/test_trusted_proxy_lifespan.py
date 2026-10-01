"""The app says at startup which proxies it trusts.

The integration ``client`` never runs the lifespan, so this drives it through
``TestClient`` and stops startup at ``init_db``: no database, scheduler, MQTT or
Telegram. Sync on purpose, since ``TestClient`` runs the app on its own loop.
"""

import logging
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from app import main as app_main
from app.config import parse_trusted_proxies, settings

LOGGER = "app.middleware"


class _StopStartupError(Exception):
    """Raised in place of init_db, so startup ends there."""


async def _stop() -> None:
    raise _StopStartupError


def test_lifespan_logs_the_proxy_settings(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "trusted_proxies", parse_trusted_proxies("10.0.0.0/8"))
    monkeypatch.setattr(settings, "client_ip_header", "")
    # The lifespan makes these before init_db, so keep them off the real /data.
    for name in ("data_dir", "attachments_dir", "photos_dir", "documents_dir"):
        monkeypatch.setattr(settings, name, tmp_path / name)
    monkeypatch.setattr(app_main, "init_db", _stop)
    caplog.set_level(logging.INFO, logger=LOGGER)

    with pytest.raises(_StopStartupError):
        with TestClient(app_main.app):
            pass

    infos = [
        r.getMessage() for r in caplog.records if r.name == LOGGER and r.levelno == logging.INFO
    ]
    assert len(infos) == 1, infos
    assert "Trusting proxy headers from 10.0.0.0/8" in infos[0]
