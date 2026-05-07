"""Auth routes — login + current user."""

from fastapi import APIRouter, Depends, HTTPException, status

from api.auth import create_access_token, get_current_user, verify_password
from api.schemas import LoginRequest, LoginResponse, UserMeResponse
from db_models import UserRepository

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    """Exchange username/password for a JWT access token."""
    user = UserRepository().get_by_username(body.username)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(user.id, user.username, user.role)
    return LoginResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
    )


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: dict = Depends(get_current_user)) -> UserMeResponse:
    """Return the authenticated user's profile."""
    user = UserRepository().get_by_id(int(current_user["sub"]))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserMeResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
    )
