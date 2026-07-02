def classify_error(parsed_data):
    error_type = str(parsed_data.get("type", "") or "")
    raw = parsed_data.get("raw") or {}
    logs = str(raw.get("logs", "") or "")
    stack_trace = str(raw.get("stackTrace", "") or "")

    haystack = f"{error_type}\n{logs}\n{stack_trace}".lower()
    error_type_lower = error_type.lower()

    if any(
        k in haystack
        for k in [
            "econnrefused",
            "econnreset",
            "etimedout",
            "enotfound",
            "eai_again",
            "socket hang up",
            "network error",
            "fetch failed",
            "getaddrinfo",
            "dns",
            "timeout",
            "connection refused",
        ]
    ):
        return "NETWORK_ERROR"

    if any(
        k in haystack
        for k in [
            "unauthorized",
            "forbidden",
            "invalid token",
            "jwt",
            "token expired",
            "access denied",
            "permission denied",
            "401",
            "403",
        ]
    ):
        return "AUTH_ERROR"

    if any(
        k in haystack
        for k in [
            "sqlstate",
            "deadlock",
            "duplicate key",
            "unique constraint",
            "foreign key",
            "relation does not exist",
            "no such table",
            "database is locked",
            "mongoerror",
            "mongoservererror",
            "postgres",
            "mysql",
            "sqlite",
            "sql",
        ]
    ):
        return "DATABASE_ERROR"

    if any(
        k in error_type_lower
        for k in [
            "typeerror",
            "referenceerror",
            "syntaxerror",
            "rangeerror",
            "valueerror",
            "keyerror",
            "indexerror",
            "attributeerror",
            "nullpointerexception",
        ]
    ) or "exception" in error_type_lower:
        return "RUNTIME_ERROR"

    return "UNKNOWN"
