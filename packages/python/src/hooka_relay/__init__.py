"""Server-side event client. API keys must never be shipped to a browser."""
import json
import math
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
from standardwebhooks.webhooks import Webhook
from .generated import EventInput, EventResponse, ErrorResponse, JsonValue

__all__ = ["HookaRelay", "HookaError", "verify_webhook", "EventInput", "EventResponse", "ErrorResponse", "JsonValue"]


class HookaError(Exception):
    def __init__(self, status: int, body: object, retry_after: str | None):
        super().__init__(f"Hooka Relay returned HTTP {status}")
        self.status = status
        self.body = body
        self.retry_after = retry_after


class _NoRedirect(HTTPRedirectHandler):
    # Never forward a publishing credential to a redirected origin.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HookaRelay:
    def __init__(self, api_key: str, *, base_url: str = "https://hooka-relay.vercel.app", timeout: float = 30):
        if not api_key or "\r" in api_key or "\n" in api_key:
            raise ValueError("An API key is required")
        url = urlparse(base_url)
        if url.scheme not in ("https", "http") or not url.hostname or url.username or url.password:
            raise ValueError("Invalid base URL")
        if url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Use HTTPS outside localhost")
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError("Invalid timeout")
        self._url = f"{url.scheme}://{url.netloc}/api/v1/events"
        self._api_key = api_key
        self._timeout = timeout
        self._opener = build_opener(_NoRedirect())

    def send_event(self, event: EventInput) -> EventResponse:
        """Send once. For retries, reuse an explicit idempotencyKey."""
        request = Request(self._url, data=json.dumps(event, allow_nan=False).encode(), method="POST", headers={
            "Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json",
        })
        try:
            response = self._opener.open(request, timeout=self._timeout)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except ValueError:
                body = raw
            if response.status != 202:
                raise HookaError(response.status, body, response.headers.get("Retry-After"))
            if not isinstance(body, dict) or not isinstance(body.get("id"), str):
                raise ValueError("Invalid Hooka Relay event response")
            return body


def verify_webhook(raw_body: str | bytes, headers: dict[str, str], secret: str) -> object:
    """Verify exact raw bytes, signed event ID and the reference library's clock window."""
    return Webhook(secret).verify(raw_body, headers)
