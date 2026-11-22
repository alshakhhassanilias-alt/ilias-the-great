import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def fresh_db(tmp_path, monkeypatch):
    from app import db, service
    from app.ai import providers
    db.reset_for_tests(str(tmp_path / "test.db"))
    service._cache.clear()
    monkeypatch.setenv("IH_AI_PROVIDER", "offline")
    providers.DEFAULTS["provider"] = "offline"
    yield


@pytest.fixture
def world_1936():
    from app.sim.engine import create_world, set_player
    s = create_world("1936", 42, {"pause_on_decision": False})
    set_player(s, "GER")
    return s


@pytest.fixture
def campaign():
    from app import service
    return service.create_campaign("1936", "GER", settings={"pause_on_decision": False}, seed=5)
