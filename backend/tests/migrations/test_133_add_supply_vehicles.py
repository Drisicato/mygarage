import importlib.util
from pathlib import Path

from sqlalchemy import inspect, text

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "app" / "migrations"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, MIGRATIONS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_supplies(engine):
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(
            text(
                "CREATE TABLE supplies (id INTEGER PRIMARY KEY, name VARCHAR(120), "
                "vin VARCHAR(17) REFERENCES vehicles(vin) ON DELETE CASCADE)"
            )
        )
        conn.execute(text("INSERT INTO vehicles (vin) VALUES ('1HGBH41JXMN109186')"))
        conn.execute(
            text(
                "INSERT INTO supplies (id, name, vin) VALUES "
                "(1, 'Oil', '1HGBH41JXMN109186'), (2, 'Wiper Fluid', NULL)"
            )
        )


def _links(engine):
    with engine.connect() as conn:
        return conn.execute(text("SELECT supply_id, vin FROM supply_vehicles")).all()


def test_133_moves_pinned_vins_into_links(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_supplies(engine)
    _load("133_add_supply_vehicles").upgrade(engine)

    assert _links(engine) == [(1, "1HGBH41JXMN109186")]
    with engine.connect() as conn:
        # Cleared, so deleting the vehicle no longer cascades the supply away.
        assert conn.execute(text("SELECT COUNT(*) FROM supplies WHERE vin IS NOT NULL")).scalar() == 0


def test_133_idempotent(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _make_supplies(engine)
    mod = _load("133_add_supply_vehicles")
    mod.upgrade(engine)
    mod.upgrade(engine)  # must not raise or duplicate
    assert _links(engine) == [(1, "1HGBH41JXMN109186")]


def test_133_skips_when_table_missing(engine_for_migration):
    _dialect, engine, _url = engine_for_migration
    _load("133_add_supply_vehicles").upgrade(engine)  # must not raise
    assert not inspect(engine).has_table("supply_vehicles")
