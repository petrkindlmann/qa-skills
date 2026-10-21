"""The Mailpit installer must select a pinned asset per platform and refuse anything else."""

import importlib.util
import io
import pathlib
import tempfile
import unittest
import urllib.error
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
SERVICE = HERE / "workflows" / "mailpit" / "mailpit_service.py"


def load_service():
    spec = importlib.util.spec_from_file_location("mailpit_service", SERVICE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PlatformPinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = load_service()

    def test_platform_key_normalizes_architecture_names(self):
        key = self.service.platform_key
        self.assertEqual(key("Linux", "x86_64"), "linux-amd64")
        self.assertEqual(key("Linux", "amd64"), "linux-amd64")
        self.assertEqual(key("Darwin", "arm64"), "darwin-arm64")
        self.assertEqual(key("Linux", "aarch64"), "linux-arm64")
        self.assertEqual(key("Windows", "AMD64"), "windows-amd64")

    def test_every_pinned_asset_carries_both_digests_and_a_size(self):
        assets = self.service.RELEASE["assets"]
        self.assertIn("linux-amd64", assets)
        self.assertIn("darwin-arm64", assets)
        for key, asset in assets.items():
            with self.subTest(platform=key):
                self.assertTrue(asset["archive_url"].startswith("https://github.com/axllent/mailpit/releases/download/v"))
                self.assertIn(key, asset["archive_url"])
                self.assertRegex(asset["archive_sha256"], r"^[0-9a-f]{64}$")
                self.assertRegex(asset["binary_sha256"], r"^[0-9a-f]{64}$")
                self.assertGreater(asset["archive_bytes"], 1_000_000)
                self.assertIsInstance(asset["asset_id"], int)

    def test_unpinned_platform_fails_before_any_download(self):
        with self.assertRaises(RuntimeError) as raised:
            self.service.pinned_asset("windows-amd64")
        self.assertIn("windows-amd64", str(raised.exception))
        self.assertIn("linux-amd64", str(raised.exception))

    def test_download_refuses_plain_http_and_redirects_away_from_https(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "archive"
            with self.assertRaises(RuntimeError):
                self.service.download("http://example.test/mailpit.tar.gz", target, 10)
            handler = self.service.HttpsOnlyRedirect()
            with self.assertRaises(urllib.error.URLError):
                handler.redirect_request(None, None, 302, "Found", {}, "http://example.test/elsewhere")

    def test_download_rejects_a_transfer_that_is_not_the_pinned_size(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        for body, expected in ((b"x" * 8, 10), (b"x" * 12, 10)):
            with self.subTest(received=len(body)), tempfile.TemporaryDirectory() as directory:
                target = pathlib.Path(directory) / "archive"
                opener = mock.Mock()
                opener.open.return_value = Response(body)
                with mock.patch.object(self.service.urllib.request, "build_opener", return_value=opener):
                    with self.assertRaises(RuntimeError):
                        self.service.download("https://example.test/mailpit.tar.gz", target, expected)

    def test_process_identity_is_none_for_a_pid_that_cannot_exist(self):
        self.assertIsNone(self.service.proc_identity(2 ** 22 + 7))


if __name__ == "__main__":
    unittest.main()
