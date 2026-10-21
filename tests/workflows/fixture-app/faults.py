"""Fixture-only fault switches. Never use these branches in a production service.

The default is healthy. Keep this file and the application implementation out of
black-box task packets so the checks must follow the published contract.
"""

import os

KNOWN = frozenset({
    "cross_user_order_read", "trust_client_amount", "duplicate_fulfillment",
    "receipt_before_commit", "idempotency_payload_conflict", "reusable_reset_token",
    "logout_cookie_only",
    "compensating_prices", "canonicalized_signature",
    # 2026-10-21 addon scenarios: accessibility, data at rest, hardening, resilience.
    "unlabeled_controls", "plaintext_session_tokens", "missing_idempotency_index",
    "no_login_throttle", "open_test_support", "smtp_failure_503",
    # 2026-10-21 campaign 3: monitoring and analytics.
    "slow_health", "wrong_currency_event", "reset_email_dropped",
})


class Faults:
    def __init__(self):
        self.name = os.environ.get("APP_FAULT", "").strip()
        if self.name and self.name not in KNOWN:
            raise ValueError(f"Unknown APP_FAULT: {self.name}")

    def has(self, name):
        return self.name == name
