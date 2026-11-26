import hmac
import os

from fastapi import Header, HTTPException, status

MIN_KEY_LENGTH = 32


def configured_integration_key() -> str:
    return (os.getenv("ACCOUNTING_SYNC_API_KEY") or "").strip()


def require_accounting_sync_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> str:
    expected = configured_integration_key()
    supplied = (x_api_key or "").strip()
    if len(expected) < MIN_KEY_LENGTH or not supplied:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Integrasi ditolak")
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Integrasi ditolak")
    return "accounting-sync"
