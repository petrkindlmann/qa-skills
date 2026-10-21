#!/usr/bin/env python3
"""Check real readiness, occupied-port refusal, and foreground SIGTERM cleanup."""
import json
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
import uuid

from mailpit_service import HERE, RUNTIME, proc_identity


def main():
    instance = 'lifecycle-' + uuid.uuid4().hex[:16]
    ready = RUNTIME / (instance + '.json')
    command = [sys.executable, str(HERE / 'mailpit_service.py'), 'serve', '--instance', instance,
               '--ttl', '30', '--ready-file', str(ready)]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    evidence = {'command': command}
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and time.monotonic() < deadline and process.poll() is None:
            threading.Event().wait(0.05)
        if not ready.exists():
            raise RuntimeError('Foreground service did not report readiness')
        state = json.loads(ready.read_text())
        evidence['ready'] = state
        if state['smtp_host'] != '127.0.0.1' or not state['http_url'].startswith('http://127.0.0.1:'):
            raise RuntimeError('Service did not bind loopback addresses')
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            attempted = subprocess.run([sys.executable, str(HERE / 'mailpit_service.py'), 'start',
                '--instance', instance + '-occupied', '--http-port', str(occupied.getsockname()[1])],
                capture_output=True, text=True, timeout=20)
            if attempted.returncode == 0 or 'Address already in use' not in attempted.stderr:
                raise RuntimeError('Occupied-port startup did not fail clearly')
            evidence['occupied_port'] = {'exit_code': attempted.returncode, 'stderr': attempted.stderr.strip()}
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=12)
        evidence.update(stdout=stdout, stderr=stderr, foreground_exit=process.returncode,
                        binary_stopped=proc_identity(state['pid']) is None,
                        supervisor_stopped=proc_identity(state['supervisor_pid']) is None,
                        ready_file_removed=not ready.exists())
        if process.returncode or not all(evidence[key] for key in ('binary_stopped', 'supervisor_stopped', 'ready_file_removed')):
            raise RuntimeError('Foreground stop left an active process or ready file')
        evidence['outcome'] = 'pass'
    finally:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=12)
        output = HERE / 'artifacts' / 'lifecycle.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({key: evidence[key] for key in ('outcome', 'foreground_exit', 'binary_stopped', 'supervisor_stopped', 'ready_file_removed')}, indent=2))


if __name__ == '__main__':
    main()
