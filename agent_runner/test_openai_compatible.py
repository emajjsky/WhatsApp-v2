import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from agent_runner.providers.base import ProviderRequest
from agent_runner.providers.openai_compatible import OpenAICompatibleProvider, _parse_chat_completion_response


class _ProviderHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        self.requests.append(payload)
        body = {
            "choices": [{"message": {"content": "OK"}}],
            "usage": {"total_tokens": 1},
        }
        raw = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_args) -> None:
        return


class OpenAICompatibleProviderTest(unittest.TestCase):
    def setUp(self) -> None:
        _ProviderHandler.requests = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _ProviderHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_omitted_thinking_setting_is_disabled(self) -> None:
        provider = OpenAICompatibleProvider(
            {
                "base_url": f"http://127.0.0.1:{self.server.server_port}",
                "api_key": "test-key",
                "model": "test-model",
            }
        )

        response = provider.generate(
            ProviderRequest(
                rule_name="test",
                prompt_template="Reply briefly.",
                knowledge_summary=None,
                customer_message="hello",
            )
        )

        self.assertEqual("OK", response.draft)
        self.assertEqual(False, _ProviderHandler.requests[0]["enable_thinking"])

    def test_reasoning_only_response_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "reasoning content"):
            _parse_chat_completion_response(
                {"choices": [{"message": {"reasoning_content": "internal"}}]}
            )


if __name__ == "__main__":
    unittest.main()
