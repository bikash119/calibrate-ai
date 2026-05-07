"""User management routes - admin only."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import require_admin, hash_password
from db_models import User, UserRepository

router = APIRouter(prefix="/api/users", tags=["users"])


class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str = "user"


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str | None
    role: str
    created_at: str | None


class UsersListResponse(BaseModel):
    users: list[UserResponse]


class ChangePasswordRequest(BaseModel):
    password: str


@router.get("", response_model=UsersListResponse)
async def list_users(_admin: dict = Depends(require_admin)):
    """List all users (admin only)."""
    repo = UserRepository()
    users = repo.get_all()
    return UsersListResponse(
        users=[
            UserResponse(
                id=u.id,
                username=u.username,
                display_name=u.display_name,
                role=u.role,
                created_at=str(u.created_at) if u.created_at else None,
            )
            for u in users
        ]
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(request: CreateUserRequest, _admin: dict = Depends(require_admin)):
    """Create a new user (admin only)."""
    if request.role not in ("admin", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be 'admin' or 'user'",
        )

    repo = UserRepository()

    # Check if username already exists
    existing = repo.get_by_username(request.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    user = User(
        username=request.username,
        password_hash=hash_password(request.password),
        display_name=request.display_name,
        role=request.role,
    )
    user_id = repo.create(user)
    created = repo.get_by_id(user_id)

    return UserResponse(
        id=created.id,
        username=created.username,
        display_name=created.display_name,
        role=created.role,
        created_at=str(created.created_at) if created.created_at else None,
    )


@router.put("/{user_id}/password")
async def change_password(
    user_id: int,
    request: ChangePasswordRequest,
    _admin: dict = Depends(require_admin),
):
    """Change a user's password (admin only)."""
    repo = UserRepository()
    user = repo.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    repo.update_password(user_id, hash_password(request.password))
    return {"message": "Password updated successfully"}


@router.delete("/{user_id}")
async def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    """Delete a user (admin only). Cannot delete yourself."""
    if str(user_id) == admin.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account",
        )

    repo = UserRepository()
    deleted = repo.delete(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return {"message": "User deleted successfully"}
