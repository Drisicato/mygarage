"""Migration 128: 'Repair' joins the service_category CHECK on both tables (SQLite path)."""

import importlib

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

migration = importlib.import_module("app.migrations.128_add_repair_service_category")

_OLD = "'Maintenance', 'Inspection', 'Collision', 'Upgrades', 'Detailing'"


@pytest.fixture
def engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'm128.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE vehicles (vin VARCHAR(17) PRIMARY KEY)"))
        conn.execute(
            text(
                f"""
                CREATE TABLE service_visits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    vin VARCHAR(17) NOT NULL REFERENCES vehicles(vin) ON DELETE CASCADE,
                    service_category VARCHAR(30),
                    CONSTRAINT check_service_visit_category
                        CHECK (service_category IN ({_OLD}))
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX idx_service_visits_vin ON service_visits (vin)"))
        conn.execute(
            text(
                """
                CREATE TABLE service_line_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visit_id INTEGER NOT NULL REFERENCES service_visits(id) ON DELETE CASCADE
                )
                """
            )
        )
        conn.execute(
            text(
                f"""
                CREATE TABLE planned_repairs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    service_category VARCHAR(30),
                    CONSTRAINT check_planned_repairs_category
                        CHECK (service_category IN ({_OLD}))
                )
                """
            )
        )
        conn.execute(text("INSERT INTO vehicles VALUES ('V1')"))
        conn.execute(
            text("INSERT INTO service_visits (vin, service_category) VALUES ('V1', 'Collision')")
        )
        conn.execute(text("INSERT INTO service_line_items (visit_id) VALUES (1)"))
    return engine


def _insert_repair(engine):
    with engine.begin() as conn:
        conn.execute(
            text("INSERT INTO service_visits (vin, service_category) VALUES ('V1', 'Repair')")
        )
        conn.execute(text("INSERT INTO planned_repairs (service_category) VALUES ('Repair')"))


def test_repair_is_rejected_before_and_accepted_after(engine):
    with pytest.raises(IntegrityError):
        _insert_repair(engine)

    migration.upgrade(engine)
    _insert_repair(engine)


def test_rows_children_and_indexes_survive_the_rebuild(engine):
    migration.upgrade(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT service_category FROM service_visits")).scalar() == (
            "Collision"
        )
        assert conn.execute(text("SELECT COUNT(*) FROM service_line_items")).scalar() == 1
        indexes = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='service_visits'")
        ).scalars()
        assert "idx_service_visits_vin" in set(indexes)


def test_second_run_is_a_noop(engine):
    migration.upgrade(engine)
    migration.upgrade(engine)
    _insert_repair(engine)
