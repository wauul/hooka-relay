import base64
import io
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from urllib.error import HTTPError
from hooka_relay import HookaRelay, HookaError, verify_webhook
from standardwebhooks.webhooks import Webhook


class Response(io.BytesIO):
    def __init__(self, body, status=202):
        super().__init__(json.dumps(body).encode())
        self.status = status
        self.headers = {"Retry-After": "12"}


class ClientTests(unittest.TestCase):
    def test_send(self):
        client = HookaRelay("test-key")
        event = {"id": "evt_1", "type": "test", "payload": None}
        client._opener = Mock()
        client._opener.open.return_value = Response(event)
        request = {"customerId": "cus_123", "type": "test", "payload": None, "idempotencyKey": "stable"}
        self.assertEqual(client.send_event(request), event)
        sent = client._opener.open.call_args.args[0]
        self.assertEqual(sent.full_url, "https://hooka-relay.vercel.app/api/v1/events")
        self.assertEqual(json.loads(sent.data), request)
        self.assertEqual(sent.get_header("Authorization"), "Bearer test-key")
        client._opener.open.assert_called_once()

    def test_errors_no_retries(self):
        for status in (400, 401, 403, 413, 429, 503):
            client = HookaRelay("secret-key")
            client._opener = Mock()
            client._opener.open.side_effect = HTTPError(client._url, status, "test", {"Retry-After": "12"}, io.BytesIO(b'{"error":"test"}'))
            with self.assertRaises(HookaError) as caught:
                client.send_event({"customerId": "cus_123", "type": "test", "payload": None})
            self.assertEqual(caught.exception.status, status)
            self.assertEqual(caught.exception.retry_after, "12")
            self.assertNotIn("secret-key", str(caught.exception))
            client._opener.open.assert_called_once()

    def test_invalid_urls_and_redirect(self):
        for url in ("http://example.com", "https://user:pass@example.com", "file:///test"):
            with self.assertRaises(ValueError):
                HookaRelay("key", base_url=url)
        client = HookaRelay("key")
        redirect = next(h for h in client._opener.handlers if hasattr(h, "redirect_request"))
        self.assertIsNone(redirect.redirect_request(None, None, 302, "", {}, "https://other.example"))

    def test_reference_verification(self):
        keys = ["whsec_" + base64.b64encode(bytes([n]) * 32).decode() for n in (1, 2)]
        now = datetime.now(timezone.utc)
        raw, event_id = '{"hello":"world"}', "evt_stable"
        headers = {"webhook-id": event_id, "webhook-timestamp": str(int(now.timestamp())), "webhook-signature": " ".join(Webhook(k).sign(event_id, now, raw) for k in keys)}
        for key in keys:
            self.assertEqual(verify_webhook(raw, headers, key), {"hello": "world"})
        for altered, body in (({**headers, "webhook-id": "forged"}, raw), (headers, raw + " ")):
            with self.assertRaises(Exception):
                verify_webhook(body, altered, keys[0])
        old = now - timedelta(minutes=10)
        with self.assertRaises(Exception):
            verify_webhook(raw, {**headers, "webhook-timestamp": str(int(old.timestamp())), "webhook-signature": Webhook(keys[0]).sign(event_id, old, raw)}, keys[0])


if __name__ == "__main__":
    unittest.main()
