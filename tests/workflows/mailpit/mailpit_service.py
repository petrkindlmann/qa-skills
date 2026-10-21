#!/usr/bin/env python3
"""Pinned localhost-only Mailpit with bounded install/start/stop and a TTL supervisor."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import signal
import smtplib
import socket
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
RUNTIME = Path('/tmp/qa-mailpit-runtime')
RELEASE = json.loads((HERE / 'release.json').read_text())
ARCHITECTURES = {'x86_64': 'amd64', 'amd64': 'amd64', 'arm64': 'arm64', 'aarch64': 'arm64'}


def platform_key(system=None, machine=None):
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    return system + '-' + ARCHITECTURES.get(machine, machine)


def pinned_asset(key):
    asset = RELEASE['assets'].get(key)
    if asset is None:
        raise RuntimeError('No pinned Mailpit asset for ' + key + '; pinned: '
                           + ', '.join(sorted(RELEASE['assets'])) + '. Pin another official asset before adapting it.')
    return asset


PLATFORM = platform_key()
INSTALL = RUNTIME / ('mailpit-' + RELEASE['version'] + '-' + PLATFORM)
BINARY = INSTALL / 'mailpit'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise urllib.error.URLError('Refusing a redirect away from HTTPS: ' + newurl)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def download(url, destination, expected_bytes, timeout=60):
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise RuntimeError('Release archive URL must use HTTPS')
    opener = urllib.request.build_opener(HttpsOnlyRedirect)
    deadline = time.monotonic() + timeout
    received = 0
    with opener.open(url, timeout=10) as response, open(destination, 'wb') as out:
        # read1 returns whatever has arrived, so the deadline is checked at least every 10 s.
        while chunk := response.read1(1 << 16):
            received += len(chunk)
            if received > expected_bytes:
                raise RuntimeError('Download exceeds the pinned archive size')
            if time.monotonic() > deadline:
                raise RuntimeError('Download exceeded ' + str(timeout) + ' seconds')
            out.write(chunk)
    if received != expected_bytes:
        raise RuntimeError('Download size ' + str(received) + ' differs from the pinned ' + str(expected_bytes))


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def install():
    asset = pinned_asset(PLATFORM)
    INSTALL.mkdir(parents=True, exist_ok=True)
    archive = INSTALL / Path(urllib.parse.urlsplit(asset['archive_url']).path).name
    if not archive.exists() or digest(archive) != asset['archive_sha256']:
        temp = INSTALL / 'download.tmp'
        try:
            download(asset['archive_url'], temp, asset['archive_bytes'])
            if digest(temp) != asset['archive_sha256']:
                raise RuntimeError('Official release archive SHA-256 mismatch')
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        temp.replace(archive)
    with tarfile.open(archive, 'r:gz') as contents:
        candidates = [m for m in contents.getmembers() if m.isfile() and Path(m.name).name == 'mailpit']
        if len(candidates) != 1:
            raise RuntimeError('Release archive must have one regular Mailpit executable')
        data = contents.extractfile(candidates[0]).read()
    # Extract only the named regular file, never arbitrary archive paths.
    if not BINARY.exists() or BINARY.read_bytes() != data:
        BINARY.write_bytes(data)
        BINARY.chmod(0o755)
    if digest(BINARY) != asset['binary_sha256']:
        raise RuntimeError('Extracted Mailpit binary SHA-256 mismatch')
    version = subprocess.check_output([str(BINARY), 'version', '--no-release-check'], text=True, timeout=5).strip()
    if not re.search(r'\bv' + re.escape(RELEASE['version']) + r'\b', version):
        raise RuntimeError('Unexpected binary version: ' + version)
    evidence = {key: value for key, value in RELEASE.items() if key != 'assets'}
    evidence.update(asset, platform=PLATFORM, binary=str(BINARY), binary_sha256=digest(BINARY), version_output=version)
    atomic_json(INSTALL / 'installed.json', evidence)
    return evidence


def proc_identity(pid):
    # A stable identity (start time) distinguishes a live supervisor from a reused PID.
    if Path('/proc').is_dir():
        try:
            value = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
            return None if value[0] == 'Z' else value[19]
        except (OSError, IndexError):
            return None
    try:
        line = subprocess.check_output(['ps', '-o', 'stat=,lstart=', '-p', str(pid)],
                                       text=True, timeout=5, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.SubprocessError):
        return None
    state, _, started = line.partition(' ')
    return None if not started.strip() or state.startswith('Z') else started.strip()


IDENTITY_MEMO_SECONDS = 2
_identity_memo = {}


def live(state):
    pid = state['supervisor_pid']
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        _identity_memo.pop(pid, None)
        return False
    except PermissionError:
        pass  # Exists but belongs to another user; the identity check below decides.
    # Without procfs every identity check spawns ps; a two-second memo keeps the 0.2 s
    # supervisor poll from forking several times per second for the whole TTL.
    cached = _identity_memo.get(pid)
    if cached and time.monotonic() - cached[0] < IDENTITY_MEMO_SECONDS:
        identity = cached[1]
    else:
        identity = proc_identity(pid)
        _identity_memo[pid] = (time.monotonic(), identity)
    return identity == state['supervisor_identity']


def instance_dir(name):
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', name):
        raise ValueError('instance must be 1-64 letters, digits, underscores or hyphens')
    path = RUNTIME / 'instances' / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_state(name):
    path = instance_dir(name) / 'state.json'
    if not path.exists():
        raise RuntimeError('No state for this instance; run start first')
    return json.loads(path.read_text())


def free_ports(http_port, smtp_port):
    # Keep reservations open together so the two selected ephemeral ports differ.
    sockets = []
    try:
        for port in (http_port, smtp_port):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sockets.append(sock)
            sock.bind(('127.0.0.1', port))
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def probe(state):
    # Ignore ambient HTTP proxy configuration for local service requests.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(state['MAILPIT_URL'] + '/api/v1/info', timeout=1) as response:
        info = json.load(response)
    if str(info.get('Version', '')).lstrip('v') != RELEASE['version']:
        raise RuntimeError('Wrong Mailpit API version: ' + repr(info))
    if info.get('Database') != state['database']:
        raise RuntimeError('HTTP port belongs to another Mailpit instance')
    with smtplib.SMTP('127.0.0.1', state['SMTP_PORT'], timeout=1) as client:
        if client.noop()[0] != 250:
            raise RuntimeError('SMTP readiness NOOP failed')
    return info


def supervise(args):
    directory = instance_dir(args.instance)
    config = json.loads((directory / 'launch.json').read_text())
    stop_event = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
    signal.signal(signal.SIGINT, lambda *_: stop_event.set())
    # Inherited MP_* options could enable forwarding/relay, webhook or a public bind.
    env = {k: v for k, v in os.environ.items() if not k.startswith('MP_')}
    cmd = [str(BINARY), '--listen', '127.0.0.1:' + str(config['HTTP_PORT']),
           '--smtp', '127.0.0.1:' + str(config['SMTP_PORT']),
           '--database', str(config['database']), '--max', '0',
           '--disable-version-check', '--smtp-disable-rdns',
           '--smtp-allowed-recipients', r'(?i)^[a-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@example\.test$',
           '--block-remote-css-and-fonts', '--hide-delete-all-button',
           '--verbose' if config['verbose'] else '--quiet']
    with open(config['server_log'], 'ab', buffering=0) as log:
        child = subprocess.Popen(cmd, stdout=log, stderr=log, stdin=subprocess.DEVNULL, env=env)
        state = dict(config, command=cmd, pid=child.pid, supervisor_pid=os.getpid(),
                     supervisor_identity=proc_identity(os.getpid()))
        atomic_json(directory / 'state.json', state)
        deadline = time.monotonic() + config['ttl_seconds']
        try:
            while child.poll() is None and time.monotonic() < deadline and not stop_event.wait(0.2):
                pass
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=2)
            atomic_json(directory / 'stopped.json', {'exit_code': child.returncode, 'stopped_at': time.time()})


def start(args):
    if not BINARY.exists():
        raise RuntimeError('Pinned binary is missing; run install first')
    installed = json.loads((INSTALL / 'installed.json').read_text())
    if digest(BINARY) != pinned_asset(PLATFORM)['binary_sha256'] or installed['version'] != RELEASE['version']:
        raise RuntimeError('Installed binary digest changed; run install to restore the verified archive')
    directory = instance_dir(args.instance)
    previous_path = directory / 'state.json'
    if previous_path.exists():
        previous = json.loads(previous_path.read_text())
        if live(previous):
            probe(previous)
            return previous
    http_port, smtp_port = free_ports(args.http_port, args.smtp_port)
    run_id = uuid.uuid4().hex
    run = directory / run_id
    run.mkdir()
    config = {'instance': args.instance, 'run_id': run_id, 'version': RELEASE['version'],
              'HTTP_PORT': http_port, 'SMTP_HOST': '127.0.0.1', 'SMTP_PORT': smtp_port,
              'MAILPIT_URL': f'http://127.0.0.1:{http_port}', 'SMTP_SECURE': 'false',
              'smtp_host': '127.0.0.1', 'smtp_port': smtp_port,
              'base_url': f'http://127.0.0.1:{http_port}', 'http_url': f'http://127.0.0.1:{http_port}',
              'database': str(run / 'mailpit.sqlite'), 'server_log': str(run / 'mailpit.log'),
              'supervisor_log': str(run / 'supervisor.log'), 'verbose': args.verbose,
              'ttl_seconds': args.ttl, 'started_at': time.time(),
              'expires_at': time.time() + args.ttl}
    atomic_json(directory / 'launch.json', config)
    with open(config['supervisor_log'], 'ab', buffering=0) as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_supervise',
                                  '--instance', args.instance], stdout=log, stderr=log,
                                 stdin=subprocess.DEVNULL, start_new_session=True)
    deadline = time.monotonic() + 15
    last_error = 'no state file'
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError('Mailpit supervisor exited; see ' + config['supervisor_log'])
        try:
            state = load_state(args.instance)
            if state.get('run_id') == run_id:
                probe(state)
                return state
        except Exception as error:
            last_error = str(error)
        threading.Event().wait(0.1)
    child.terminate()
    child.wait(timeout=7)
    raise RuntimeError('Mailpit readiness timed out: ' + last_error)


def stop(args):
    state = load_state(args.instance)
    if live(state):
        os.kill(state['supervisor_pid'], signal.SIGTERM)
        deadline = time.monotonic() + 8
        while live(state) and time.monotonic() < deadline:
            threading.Event().wait(0.1)
        if live(state):
            raise RuntimeError('Supervisor failed to stop within 8 seconds; no unrelated process was signalled')
    return {'instance': args.instance, 'stopped': True, 'server_log': state['server_log']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'start', 'serve', 'status', 'env', 'stop', '_supervise'])
    parser.add_argument('--instance', default='main')
    parser.add_argument('--http-port', type=int, default=0)
    parser.add_argument('--smtp-port', type=int, default=0)
    parser.add_argument('--ttl', type=int, choices=range(10, 3601), metavar='10..3600', default=1800)
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--ready-file', type=Path, help='Write JSON after verified API and SMTP readiness')
    args = parser.parse_args()
    if any(port < 0 or port > 65535 for port in (args.http_port, args.smtp_port)):
        parser.error('Ports must be in 0..65535; 0 selects a free port')
    if args.action == '_supervise':
        return supervise(args)
    if args.action == 'install':
        result = install()
    elif args.action in ('start', 'serve'):
        result = start(args)
    elif args.action == 'stop':
        result = stop(args)
    else:
        result = load_state(args.instance)
        if not live(result):
            raise RuntimeError('Instance is stopped or expired')
        if args.action == 'status':
            result['info'] = probe(result)
        else:
            for key in ('MAILPIT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE'):
                print('export ' + key + '=' + shlex.quote(str(result[key])))
            return
    if args.action in ('start', 'serve'):
        # Also expose the stable lowercase contract for process-launching callers.
        result.update(smtp_host=result['SMTP_HOST'], smtp_port=result['SMTP_PORT'],
                      base_url=result['MAILPIT_URL'], http_url=result['MAILPIT_URL'])
        if args.ready_file:
            args.ready_file.parent.mkdir(parents=True, exist_ok=True)
            atomic_json(args.ready_file, result)
    print(json.dumps(result, indent=2), flush=True)
    if args.action == 'serve':
        stop_event = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop_event.set())
        signal.signal(signal.SIGINT, lambda *_: stop_event.set())
        try:
            deadline = time.monotonic() + args.ttl
            while live(result) and time.monotonic() < deadline and not stop_event.wait(0.2):
                pass
        finally:
            stop(args)
            if args.ready_file:
                args.ready_file.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('mailpit_service: ' + str(error), file=sys.stderr)
        sys.exit(1)
