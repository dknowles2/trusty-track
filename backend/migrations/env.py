"""Alembic environment.

Both the CLI (``alembic revision --autogenerate``, ``alembic upgrade``) and the
programmatic runner in ``backend.db.database`` load this file. It deliberately
takes its database URL from the application rather than from ``alembic.ini`` so
the two can never disagree.
"""

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
    with context.begin_transaction():
        context.run_migrations()


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
