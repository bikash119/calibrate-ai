"""Program lifecycle — create, update, list, delete (with project-count checks)."""

import logging

from db_models import (
    AuditLogRepository,
    Program,
    ProgramRepository,
    ProjectRepository,
)

logger = logging.getLogger("scoring_ai.services.program")


class ProgramService:
    """Orchestrates program lifecycle."""

    def __init__(self):
        self.repo = ProgramRepository()
        self.project_repo = ProjectRepository()
        self.audit = AuditLogRepository()

    def list_with_counts(self) -> list[dict]:
        """Return programs annotated with project_count (server-derived)."""
        programs = self.repo.get_all()
        # One query for counts: {program_id: count}
        counts: dict[int, int] = {}
        for p in self.project_repo.get_all():
            counts[p.program_id] = counts.get(p.program_id, 0) + 1
        return [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "project_count": counts.get(p.id, 0),
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            }
            for p in programs
        ]

    def create(self, name: str, description: str | None, user_id: int) -> int:
        if not name or not name.strip():
            raise ValueError("Program name is required")
        if self.repo.get_by_name(name):
            raise ValueError(f"A program named '{name}' already exists")
        program_id = self.repo.create(
            Program(name=name, description=description, created_by=user_id)
        )
        self.audit.log("program", program_id, "created", user_id=user_id, details={"name": name})
        logger.info("Created program %d '%s' (user %d)", program_id, name, user_id)
        return program_id

    def update(self, program_id: int, name: str, description: str | None, user_id: int) -> None:
        program = self.repo.get_by_id(program_id)
        if not program:
            raise ValueError(f"Program {program_id} not found")
        if not name or not name.strip():
            raise ValueError("Program name is required")
        # Reject rename collision unless it's a no-op
        clash = self.repo.get_by_name(name)
        if clash and clash.id != program_id:
            raise ValueError(f"A program named '{name}' already exists")
        self.repo.update(program_id, name, description)
        self.audit.log("program", program_id, "updated", user_id=user_id, details={"name": name})
        logger.info("Updated program %d (user %d)", program_id, user_id)

    def delete(self, program_id: int, user_id: int) -> None:
        program = self.repo.get_by_id(program_id)
        if not program:
            raise ValueError(f"Program {program_id} not found")
        # ON DELETE RESTRICT enforces this at the DB level too, but check
        # explicitly to give a clean error message.
        active = self.project_repo.get_all(program_id=program_id)
        if active:
            raise ValueError(
                f"Cannot delete program with {len(active)} project(s). "
                "Delete or archive them first."
            )
        self.repo.delete(program_id)
        self.audit.log("program", program_id, "deleted", user_id=user_id)
        logger.info("Deleted program %d (user %d)", program_id, user_id)
