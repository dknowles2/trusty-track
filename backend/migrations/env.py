"""Alembic environment.

Both the CLI (``alembic revision --autogenerate``, ``alembic upgrade``) and the
programmatic runner in ``backend.db.database`` load this file. It deliberately
takes its database URL from the application rather than from ``alembic.ini`` so
the two can never disagree.
"""

from contextlib import contextmanager
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Importing models registers every table on Base.metadata, which is what
# --autogenerate diffs against. Do not remove even though it looks unused.
from backend.db import models  # noqa: F401
from backend.db.database import SQLALCHEMY_DATABASE_URL, Base

config = context.config

# The application's URL always wins over whatever is in alembic.ini.
config.set_main_option("sqlalchemy.url", SQLALCHEMY_DATABASE_URL)

# The programmatic runner configures logging itself; only the CLI path should
# reconfigure it from the ini file.
if config.config_file_name is not None and not config.attributes.get(
    "skip_logging_config", False
):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _include_object(_object, name, type_, _reflected, _compare_to) -> bool:
    """Keep autogenerate focused on application tables."""
    return not (type_ == "table" and name == "alembic_version")


def _configure_and_run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot ALTER most things in place; batch mode rewrites the
        # table instead. Harmless on other backends.
        render_as_batch=True,
        compare_type=True,
        include_object=_include_object,
    )
    with _foreign_keys_off(connection), context.begin_transaction():
        context.run_migrations()


@contextmanager
def _foreign_keys_off(connection):
    """Suspend SQLite's foreign key enforcement for the migration run.

    Batch mode rewrites a table by creating a new one, copying the rows and
    dropping the old — and SQLite refuses to drop a table other rows still
    point at. SQLite's own documentation says to turn enforcement off around
    exactly this, because the intermediate states of a rebuild are not meant to
    be consistent.

    A no-op today, because SQLite defaults foreign keys **off** and nothing
    turns them on — see #125. It is here because turning them on without it
    breaks every migration that uses batch mode, which is not the sort of thing
    to discover while writing the change that turns them on.

    Scoped to the migration either way: it restores whatever it found.
    """
    if connection.dialect.name != "sqlite":
        yield
        return

    was_on = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        yield
    finally:
        connection.exec_driver_sql(f"PRAGMA foreign_keys={'ON' if was_on else 'OFF'}")


def run_migrations_offline() -> None:
    """Run migrations without a live connection, emitting SQL to stdout."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live connection.

    ``backend.db.database`` passes an already-open connection through
    ``config.attributes`` so migrations join the caller's transaction; the CLI
    builds its own engine.
    """
    connection = config.attributes.get("connection")
    if connection is not None:
        _configure_and_run(connection)
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as conn:
        _configure_and_run(conn)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
