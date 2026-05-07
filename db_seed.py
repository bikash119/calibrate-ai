#!/usr/bin/env python3
"""First-run seeding for the calibration platform.

Creates the schema, a default Program ("Default"), and an admin user. Idempotent
on the second run unless --reset is passed (which drops and rebuilds the DB).

Admin credentials come from env vars (with safe defaults for local dev):
    CALIBRATE_ADMIN_USERNAME (default: admin)
    CALIBRATE_ADMIN_PASSWORD (default: admin — change in production)
    CALIBRATE_ADMIN_DISPLAY_NAME (default: Administrator)
"""

import argparse
import logging
import os
import sys

from api.auth import hash_password
from database import get_db_path, init_db, reset_db
from db_models import Program, ProgramRepository, User, UserRepository

logger = logging.getLogger("scoring_ai.db_seed")

DEFAULT_PROGRAM_NAME = "Default"
DEFAULT_PROGRAM_DESCRIPTION = (
    "Default program — projects without explicit grouping live here. "
    "Rename or add new programs as needed."
)


def seed_default_program(created_by: int | None = None) -> int:
    """Ensure the 'Default' program exists. Return its ID."""
    repo = ProgramRepository()
    existing = repo.get_by_name(DEFAULT_PROGRAM_NAME)
    if existing:
        logger.info("Default program already exists (id=%d)", existing.id)
        return existing.id

    program_id = repo.create(Program(
        name=DEFAULT_PROGRAM_NAME,
        description=DEFAULT_PROGRAM_DESCRIPTION,
        created_by=created_by,
    ))
    logger.info("Created default program (id=%d)", program_id)
    return program_id


def seed_admin_user() -> int:
    """Ensure an admin user exists. Return its ID."""
    username = os.environ.get("CALIBRATE_ADMIN_USERNAME", "admin")
    password = os.environ.get("CALIBRATE_ADMIN_PASSWORD", "admin")
    display_name = os.environ.get("CALIBRATE_ADMIN_DISPLAY_NAME", "Administrator")

    repo = UserRepository()
    existing = repo.get_by_username(username)
    if existing:
        logger.info("Admin user '%s' already exists (id=%d)", username, existing.id)
        return existing.id

    user_id = repo.create(User(
        username=username,
        password_hash=hash_password(password),
        display_name=display_name,
        role="admin",
    ))
    logger.info("Created admin user '%s' (id=%d)", username, user_id)
    if password == "admin":
        logger.warning(
            "Admin password is the default 'admin'. Set CALIBRATE_ADMIN_PASSWORD before going to production."
        )
    return user_id


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize and seed the calibration database.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="DESTRUCTIVE: drop all tables and rebuild from scratch.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    db_path = get_db_path()

    if args.reset:
        logger.warning("Resetting database at %s", db_path)
        reset_db(db_path)
    else:
        logger.info("Initializing database at %s", db_path)
        init_db(db_path)

    admin_id = seed_admin_user()
    seed_default_program(created_by=admin_id)

    logger.info("Seed complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
