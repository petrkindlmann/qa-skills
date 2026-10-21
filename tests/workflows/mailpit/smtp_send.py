#!/usr/bin/env python3
"""Send only synthetic @example.test fixtures to a 127.0.0.1 SMTP capture server."""
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formatdate, make_msgid
import json
import re
import smtplib
import sys
import threading


def main():
    payload = json.load(sys.stdin)
    host, port = payload.get('host', '127.0.0.1'), int(payload['port'])
    if host != '127.0.0.1' or not 1 <= port <= 65535:
        raise ValueError('SMTP fixture is restricted to a loopback capture port')
    delay_ms = int(payload.get('delay_ms', 0))
    if not 0 <= delay_ms <= 5000:
        raise ValueError('Fixture delivery delay must be within 0..5000 ms')
    items = payload['messages']
    if not isinstance(items, list) or not 1 <= len(items) <= 200:
        raise ValueError('Expected a nonempty batch of at most 200 fixtures')
    messages = []
    for item in items:
        to = item['to']
        sender = item.get('from', 'no-reply@example.test')
        for address in (to, sender):
            if not re.fullmatch(r'[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@example\.test', address):
                raise ValueError('All fixture addresses must be synthetic @example.test addresses')
        message = EmailMessage(policy=SMTP)
        message['From'] = sender
        message['To'] = to
        message['Subject'] = item['subject']
        message['Reply-To'] = 'support@example.test'
        message['Date'] = formatdate(localtime=False)
        message['Message-ID'] = make_msgid(domain='example.test')
        message['X-Test-Run'] = item['run_id']
        message.set_content(item.get('text', 'Synthetic account password reset fixture.'))
        if item.get('html') is not None:
            message.add_alternative(item['html'], subtype='html')
        messages.append(message)
    # This is an intentionally delayed producer, not a sleep before reading the inbox.
    # Tests start recipient-filtered polling immediately while this producer waits.
    if delay_ms:
        threading.Event().wait(delay_ms / 1000)
    accepted = []
    with smtplib.SMTP(host, port, timeout=5) as client:
        client.ehlo('qa-fixture.localhost')
        for message in messages:
            failures = client.send_message(message)
            if failures:
                raise RuntimeError('SMTP rejected recipient: ' + repr(failures))
            accepted.append({'to': str(message['To']), 'message_id': str(message['Message-ID'])})
    print(json.dumps({'accepted': len(accepted), 'messages': accepted, 'delay_ms': delay_ms}))


if __name__ == '__main__':
    main()
