import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import Mock, patch

from agent_runner.app import AgentRunnerServer, filter_skill_references, normalize_skill_decision, parse_json_object_payload
from agent_runner.providers.base import ProviderRequest, ProviderResponse
from agent_runner.providers.openai_compatible import OpenAICompatibleProvider, _parse_chat_completion_response


class _ProviderHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []
    reject_json_mode = False

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length))
        self.requests.append(payload)
        if self.reject_json_mode and "response_format" in payload:
            raw = b'{"error":"response_format is not supported"}'
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
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
        _ProviderHandler.reject_json_mode = False
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

    def test_status_card_requests_json_object_mode(self) -> None:
        provider = self.build_provider()

        provider.generate(self.status_card_request())

        self.assertEqual(
            {"type": "json_object"},
            _ProviderHandler.requests[0]["response_format"],
        )

    def test_unsupported_json_object_mode_falls_back_once(self) -> None:
        _ProviderHandler.reject_json_mode = True
        provider = self.build_provider()

        response = provider.generate(self.status_card_request())

        self.assertEqual("OK", response.draft)
        self.assertEqual(2, len(_ProviderHandler.requests))
        self.assertIn("response_format", _ProviderHandler.requests[0])
        self.assertNotIn("response_format", _ProviderHandler.requests[1])

    def test_json_object_is_extracted_from_mixed_model_output(self) -> None:
        payload = parse_json_object_payload(
            'analysis first\n{"current_stage":"已破冰","customer_types":["高意向"]}\nfinished'
        )

        self.assertEqual("已破冰", payload["current_stage"])
        self.assertEqual(["高意向"], payload["customer_types"])

    def test_skill_decision_is_normalized_for_routing(self) -> None:
        decision = normalize_skill_decision(
            {
                "need_skill": "是",
                "intent": "售后",
                "skill_tags": ["售后", "退款", "售后"],
                "risk": "中",
            }
        )

        self.assertTrue(decision["need_skill"])
        self.assertEqual(["售后", "退款"], decision["skill_tags"])
        self.assertEqual("中", decision["risk"])

    def test_skill_decision_can_gate_knowledge_without_changing_request_contract(self) -> None:
        server = object.__new__(AgentRunnerServer)
        context = {
            "provider_request": ProviderRequest(
                rule_name="reply",
                prompt_template="Return JSON.",
                knowledge_summary="售后规则",
                knowledge_references=["[skill:after-sales]\n退款话术"],
            )
        }

        skipped = server._apply_skill_decision(context, normalize_skill_decision({"need_skill": False}))
        self.assertIsNone(skipped["provider_request"].knowledge_summary)
        self.assertEqual([], skipped["provider_request"].knowledge_references)
        self.assertEqual("skipped", skipped["provider_request"].metadata["skill_lookup"])

        used = server._apply_skill_decision(context, normalize_skill_decision({"need_skill": True, "intent": "售后"}))
        self.assertEqual("售后规则", used["provider_request"].knowledge_summary)
        self.assertEqual(["[skill:after-sales]\n退款话术"], used["provider_request"].knowledge_references)
        self.assertEqual("used", used["provider_request"].metadata["skill_lookup"])

    def test_skill_tags_filter_labeled_references(self) -> None:
        references, status = filter_skill_references(
            [
                "[skill:售后]\n退款规则",
                "[skill:售前]\n价格话术",
            ],
            ["售后"],
        )

        self.assertEqual("matched_skill_references", status)
        self.assertEqual(["[skill:售后]\n退款规则"], references)

    def test_unlabeled_references_are_kept_for_compatibility(self) -> None:
        references, status = filter_skill_references(["旧版参考资料"], ["售后"])

        self.assertEqual("unlabeled_references_fallback_all_bound_references", status)
        self.assertEqual(["旧版参考资料"], references)

    @patch("agent_runner.app.build_provider")
    def test_invalid_status_card_output_is_repaired_once(self, build_provider: Mock) -> None:
        provider = Mock()
        provider.generate.side_effect = [
            ProviderResponse(provider="test", model="test-model", draft="analysis without json"),
            ProviderResponse(
                provider="test",
                model="test-model",
                draft=(
                    '{"current_stage":"已破冰","customer_types":["高意向"],'
                    '"current_risk":"低","summary":"客户已回复。","evidence":["客户表达了兴趣"],'
                    '"next_action":"继续沟通需求。","confidence":"高"}'
                ),
            ),
        ]
        build_provider.return_value = provider
        server = object.__new__(AgentRunnerServer)
        server.config = SimpleNamespace(default_provider="mock")

        response = server.handle_status_card(
            {
                "account_id": "account-1",
                "chat_id": "chat-1",
                "provider": {"type": "openai_compatible"},
                "recent_messages": [{"role": "customer", "content": "hello"}],
            }
        )

        self.assertEqual("已破冰", response["current_stage"])
        self.assertEqual(2, provider.generate.call_count)
        self.assertEqual(
            "status_card_repair",
            provider.generate.call_args_list[1].args[0].metadata["task"],
        )

    def build_provider(self) -> OpenAICompatibleProvider:
        return OpenAICompatibleProvider(
            {
                "base_url": f"http://127.0.0.1:{self.server.server_port}",
                "api_key": "test-key",
                "model": "test-model",
            }
        )

    @staticmethod
    def status_card_request() -> ProviderRequest:
        return ProviderRequest(
            rule_name="status-card",
            prompt_template="Return JSON.",
            knowledge_summary=None,
            customer_message="hello",
            metadata={"task": "status_card"},
        )


if __name__ == "__main__":
    unittest.main()
