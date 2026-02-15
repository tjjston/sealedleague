import fcntl
from contextlib import contextmanager

from alembic.config import Config

from alembic import command
from bracket.utils.logging import logger

_MIGRATION_LOCK_PATH = "/tmp/bracket-alembic.lock"


@contextmanager
def _migration_lock() -> None:
    with open(_MIGRATION_LOCK_PATH, "w", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)


def get_alembic_config() -> Config:
    return Config("alembic.ini")


def alembic_run_migrations() -> None:
    with _migration_lock():
        logger.info("Running migrations")
        command.upgrade(get_alembic_config(), "head")


def alembic_stamp_head() -> None:
    logger.info("Overwriting current version to be the latest revision (head)")
    command.stamp(get_alembic_config(), "head")
