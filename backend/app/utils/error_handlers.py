"""Error handling utilities for secure error responses."""

import logging
import math

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, SQLAlchemyError

from app.utils.logging_utils import sanitize_for_log

logger = logging.getLogger(__name__)


class SecureErrorResponse:
    """Generate secure error responses that don't leak internal details."""

    @staticmethod
    def generic_error(
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        message: str = "An internal error occurred",
        request_id: str | None = None,
    ) -> JSONResponse:
        """Return a generic error response.

        Args:
            status_code: HTTP status code
            message: User-friendly error message
            request_id: Request ID for tracking

        Returns:
            JSONResponse with sanitized error
        """
        content = {
            "error": True,
            "message": message,
        }

        if request_id:
            content["request_id"] = request_id
            content["support_message"] = f"Please contact support with request ID: {request_id}"

        return JSONResponse(
            status_code=status_code,
            content=content,
        )

    @staticmethod
    def validation_error(
        errors: list,
        request_id: str | None = None,
    ) -> JSONResponse:
        """Return a validation error response.

        Args:
            errors: List of validation errors
            request_id: Request ID for tracking

        Returns:
            JSONResponse with validation errors
        """
        content = {
            "error": True,
            "message": "Validation error",
            "details": errors,
        }

        if request_id:
            content["request_id"] = request_id

        return JSONResponse(
            # Renamed upstream: starlette 1.6.0 deprecated
            # HTTP_422_UNPROCESSABLE_ENTITY in favour of the RFC 9110 spelling.
            # Same 422 on the wire.
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=content,
        )


async def handle_generic_exception(request: Request, exc: Exception) -> JSONResponse:
    """Handle generic exceptions securely.

    Logs the full error but returns a sanitized response to the client.

    Args:
        request: The request that caused the exception
        exc: The exception that was raised

    Returns:
        Secure error response
    """
    request_id = getattr(request.state, "request_id", None)

    # Log the full error with stack trace
    logger.error(
        f"Unhandled exception (request_id={request_id}): {type(exc).__name__}: {str(exc)}",
        exc_info=True,
    )

    # Return sanitized error to client
    return SecureErrorResponse.generic_error(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        message="An internal error occurred. Please try again later.",
        request_id=request_id,
    )


async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handle validation errors.

    Args:
        request: The request that caused the exception
        exc: The validation exception

    Returns:
        Validation error response
    """
    request_id = getattr(request.state, "request_id", None)

    # Convert validation errors to JSON-serializable format
    errors = []
    for error in exc.errors():
        # Convert each error dict, ensuring all values are JSON-serializable
        json_error = {}
        for key, value in error.items():
            # Convert any non-serializable objects to strings. NaN and
            # infinity are floats JSON has no spelling for: echoed back as
            # the rejected input, they turned this 422 into a 500.
            if isinstance(value, float) and not math.isfinite(value):
                json_error[key] = str(value)
            elif isinstance(value, (str, int, float, bool, type(None))):
                json_error[key] = value
            elif isinstance(value, (list, tuple)):
                json_error[key] = [str(v) for v in value]
            else:
                json_error[key] = str(value)
        errors.append(json_error)

    # Log validation errors
    logger.warning(
        f"Validation error (request_id={request_id}): {errors}",
    )

    # Return validation errors (these are safe to expose)
    return SecureErrorResponse.validation_error(
        errors=errors,
        request_id=request_id,
    )


async def handle_database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    """Handle database errors securely.

    Args:
        request: The request that caused the exception
        exc: The database exception

    Returns:
        Secure error response
    """
    request_id = getattr(request.state, "request_id", None)

    # Log the full database error
    logger.error(
        f"Database error (request_id={request_id}): {type(exc).__name__}: {str(exc)}",
        exc_info=True,
    )

    # Return sanitized error to client
    return SecureErrorResponse.generic_error(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        message="A database error occurred. Please try again later.",
        request_id=request_id,
    )


# PostgreSQL's "numeric value out of range": a number past its column.
_NUMERIC_OVERFLOW = "22003"
NUMERIC_OVERFLOW_DETAIL = "Amount too large for storage"


def is_numeric_overflow(exc: DBAPIError) -> bool:
    """Whether the database refused a number too wide for its column.

    asyncpg's adapter sets `sqlstate` (and wraps the error as a plain
    DBAPIError, not a DataError); psycopg2 sets `pgcode`. SQLite never
    raises it: it ignores a column's declared precision.
    """
    orig = exc.orig
    code = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return code == _NUMERIC_OVERFLOW


def _numeric_overflow_response(request: Request, exc: DBAPIError) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    # The input fence missed this path, so it's worth a look, but it's the
    # client's number, not a server fault.
    logger.warning(
        "Numeric overflow (request_id=%s) on %s %s: %s",
        request_id,
        request.method,
        sanitize_for_log(request.url.path),
        type(exc.orig).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": NUMERIC_OVERFLOW_DETAIL},
    )


async def handle_dbapi_error(request: Request, exc: DBAPIError) -> JSONResponse:
    """Production: a numeric overflow is a 422, any other DBAPI error a 500."""
    if is_numeric_overflow(exc):
        return _numeric_overflow_response(request, exc)
    return await handle_database_error(request, exc)


async def handle_dbapi_error_debug(request: Request, exc: DBAPIError) -> JSONResponse:
    """Debug: a numeric overflow is a 422 here too. Anything else propagates to
    the debug traceback, exactly as it did with no handler."""
    if is_numeric_overflow(exc):
        return _numeric_overflow_response(request, exc)
    raise exc


def register_error_handlers(app: FastAPI, *, debug: bool) -> None:
    """Register the app's exception handlers.

    Production gets the sanitized handlers. The numeric-overflow mapping applies
    in debug too: an overflow is the client's number, so it's a 422 either way.
    Validation stays the fence; this is the backstop for a path it missed.
    """
    if debug:
        app.add_exception_handler(DBAPIError, handle_dbapi_error_debug)  # type: ignore[arg-type]
    else:
        app.add_exception_handler(Exception, handle_generic_exception)  # type: ignore[arg-type]
        app.add_exception_handler(SQLAlchemyError, handle_database_error)  # type: ignore[arg-type]
        # More specific than SQLAlchemyError, so a DBAPI error lands here first.
        app.add_exception_handler(DBAPIError, handle_dbapi_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, handle_validation_error)  # type: ignore[arg-type]


def safe_error_detail(exc: Exception, development_mode: bool = False) -> str:
    """Get a safe error detail message.

    In production, returns a generic message.
    In development, returns the actual error.

    Args:
        exc: The exception
        development_mode: Whether in development mode

    Returns:
        Safe error message
    """
    if development_mode:
        return str(exc)
    return "An error occurred. Please contact support."
