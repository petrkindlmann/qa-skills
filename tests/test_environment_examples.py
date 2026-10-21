"""Execute the documented runner with command stubs; no Docker runtime is implied.

The YAML checks inspect the actual Compose fence. The Node health check runs
against a local HTTP fixture, outside a container.
"""

from __future__ import annotations

import http.server
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest

import yaml


REPOSITORY = Path(os.environ.get("QA_SKILLS_ROOT", Path(__file__).resolve().parents[1]))
REFERENCE = REPOSITORY / "skills/test-environments/references/docker-compose.md"
NODE = shutil.which("node")


def documented_block(language, marker):
    blocks = re.findall(rf"^```{language}\r?\n([\s\S]*?)^```", REFERENCE.read_text(), re.M)
    matches = [block for block in blocks if marker in block]
    if len(matches) != 1:
        raise AssertionError(f"Expected one {language} fence containing {marker!r}")
    return matches[0]


def compose_model():
    return yaml.safe_load(documented_block("yaml", "# docker-compose.test.yml"))


COMMAND_STUB = r'''
import json
import os
from pathlib import Path
import sys

command = Path(sys.argv[0]).name
args = sys.argv[1:]
action = ("up" if "up" in args else "down") if command == "docker" else "tests"
event = {
    "command": command, "args": args, "action": action,
    "environment": {key: os.environ.get(key) for key in (
        "DATABASE_URL", "REDIS_URL", "COMPOSE_PROJECT_NAME",
        "TEST_POSTGRES_PORT", "TEST_REDIS_PORT",
    )},
}
with open(os.environ["QA_ENV_COMMAND_LOG"], "a", encoding="utf-8") as stream:
    stream.write(json.dumps(event) + "\n")
exit_variable = {"up": "QA_ENV_UP_EXIT", "down": "QA_ENV_DOWN_EXIT", "tests": "QA_ENV_TEST_EXIT"}[action]
sys.exit(int(os.environ.get(exit_variable, "0")))
'''


class RunnerTests(unittest.TestCase):
    def run_example(self, **overrides):
        with tempfile.TemporaryDirectory(prefix="qa-env runner-") as directory:
            work = Path(directory)
            log = work / "commands.jsonl"
            script = work / "test-integration.sh"
            script.write_text(documented_block("bash", "# scripts/test-integration.sh"))
            for command in ("docker", "npx"):
                stub = work / command
                stub.write_text(f"#!{sys.executable}\n" + COMMAND_STUB)
                stub.chmod(0o755)
            environment = os.environ.copy()
            for key in ("TEST_POSTGRES_PORT", "TEST_REDIS_PORT"):
                environment.pop(key, None)
            environment.update({
                "PATH": str(work) + os.pathsep + environment.get("PATH", ""),
                "QA_ENV_COMMAND_LOG": str(log),
                "QA_ENV_UP_EXIT": "0", "QA_ENV_DOWN_EXIT": "0", "QA_ENV_TEST_EXIT": "0",
                "COMPOSE_PROJECT_NAME": "qa-environment-regression",
            })
            environment.update({key: str(value) for key, value in overrides.items()})
            result = subprocess.run(
                ["bash", str(script)], cwd=work, env=environment,
                text=True, capture_output=True, timeout=10,
            )
            events = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return result, events

    def assert_lifecycle(self, events, expected):
        self.assertEqual([event["action"] for event in events], expected)
        for event in events:
            self.assertEqual(event["environment"]["COMPOSE_PROJECT_NAME"], "qa-environment-regression")
            if event["command"] == "docker":
                self.assertEqual(event["args"][:3], ["compose", "-f", "docker-compose.test.yml"])
        self.assertEqual(events[-1]["args"][3:], ["down", "-v", "--remove-orphans"])

    def test_success_starts_tests_and_cleans_up_once(self):
        result, events = self.run_example()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_lifecycle(events, ["up", "tests", "down"])
        self.assertEqual(events[0]["args"][3:], ["up", "-d", "--wait", "--wait-timeout", "60"])
        self.assertEqual(events[1]["args"], ["vitest", "run", "--project=integration"])

    def test_failed_tests_keep_their_exit_status_and_clean_up(self):
        result, events = self.run_example(QA_ENV_TEST_EXIT=17)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assert_lifecycle(events, ["up", "tests", "down"])

    def test_startup_failure_skips_tests_and_still_cleans_up(self):
        result, events = self.run_example(QA_ENV_UP_EXIT=19)
        self.assertEqual(result.returncode, 19, result.stderr)
        self.assert_lifecycle(events, ["up", "down"])

    def test_cleanup_failure_does_not_replace_test_failure(self):
        result, events = self.run_example(QA_ENV_TEST_EXIT=17, QA_ENV_DOWN_EXIT=23)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assert_lifecycle(events, ["up", "tests", "down"])
        self.assertIn("teardown failed", result.stderr.lower())

    def test_cleanup_is_best_effort_after_success(self):
        result, events = self.run_example(QA_ENV_DOWN_EXIT=23)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_lifecycle(events, ["up", "tests", "down"])
        self.assertIn("teardown failed", result.stderr.lower())

    def test_cleanup_failure_does_not_replace_startup_failure(self):
        result, events = self.run_example(QA_ENV_UP_EXIT=19, QA_ENV_DOWN_EXIT=23)
        self.assertEqual(result.returncode, 19, result.stderr)
        self.assert_lifecycle(events, ["up", "down"])

    def test_host_urls_match_published_database_ports_for_defaults_and_overrides(self):
        services = compose_model()["services"]
        for overrides in ({}, {"TEST_POSTGRES_PORT": "15432", "TEST_REDIS_PORT": "16379"}):
            with self.subTest(overrides=overrides):
                result, events = self.run_example(**overrides)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assert_lifecycle(events, ["up", "tests", "down"])
                for service, variable, internal, url_variable, template in (
                    ("postgres", "TEST_POSTGRES_PORT", "5432", "DATABASE_URL", "postgres://test:test@127.0.0.1:{}/testdb"),
                    ("redis", "TEST_REDIS_PORT", "6379", "REDIS_URL", "redis://127.0.0.1:{}"),
                ):
                    expected_port = overrides.get(variable, internal)
                    # The runner must export the same value that Compose interpolates.
                    self.assertEqual(events[0]["environment"][variable], expected_port)
                    self.assertEqual(events[1]["environment"][url_variable], template.format(expected_port))
                    self.assertEqual(services[service]["ports"], [f"127.0.0.1:${{{variable}:-{internal}}}:{internal}"])


class ComposeTests(unittest.TestCase):
    def test_postgres_18_mount_targets_image_volume_parent(self):
        postgres = compose_model()["services"]["postgres"]
        self.assertEqual(postgres["image"], "postgres:18-alpine")
        self.assertEqual(postgres["volumes"], ["postgres-test-data:/var/lib/postgresql"])

    def test_published_ports_bind_loopback(self):
        services = compose_model()["services"]
        self.assertTrue(services["postgres"].get("ports"), "The host runner needs a published Postgres port")
        self.assertTrue(services["redis"].get("ports"), "The host runner needs a published Redis port")
        for service, config in services.items():
            for port in config.get("ports", []):
                with self.subTest(service=service, port=port):
                    self.assertTrue(port.startswith("127.0.0.1:"), port)


@unittest.skipUnless(NODE, "Node is needed to execute the documented health check")
class AppHealthcheckTests(unittest.TestCase):
    def run_check(self, status):
        check = compose_model()["services"]["app"]["healthcheck"]["test"]
        self.assertEqual(check[:3], ["CMD", "node", "-e"])
        observed = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                observed.append(self.path)
                self.send_response(status)
                self.end_headers()
                self.wfile.write(b"health fixture")

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        try:
            result = subprocess.run(
                [NODE, *check[2:]],
                env={**os.environ, "PORT": str(server.server_port)},
                text=True, capture_output=True, timeout=10,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        self.assertEqual(observed, ["/health"])
        return result

    def test_successful_health_response_passes(self):
        result = self.run_check(200)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unhealthy_http_response_fails(self):
        result = self.run_check(503)
        self.assertNotEqual(result.returncode, 0, result.stdout)


if __name__ == "__main__":
    unittest.main()
