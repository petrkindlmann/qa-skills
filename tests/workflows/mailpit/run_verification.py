#!/usr/bin/env python3
"""Run bounded real Mailpit + SMTP + HTTP + Playwright verification, then stop Mailpit."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
SERVICE = HERE / 'mailpit_service.py'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--repeat-each', type=int, choices=range(1, 11), default=1)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--bad-subject', action='store_true', help='Intentionally fail the delayed reset content assertion')
    parser.add_argument('--run-name', default='')
    args = parser.parse_args()
    run_name = args.run_name or (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', run_name):
        parser.error('run-name must use 1-100 letters, digits, underscores or hyphens')
    output = HERE / 'artifacts' / run_name
    output.mkdir(parents=True, exist_ok=False)
    instance = 'verify-' + uuid.uuid4().hex[:16]
    evidence = {'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'instance': instance, 'negative_control': args.bad_subject,
                'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.iterdir()
                                  if p.suffix in ('.py', '.cjs', '.json') and p.is_file()}}
    state = None
    test_exit = None
    try:
        evidence['candidate_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE, text=True, timeout=5).strip()
        evidence['node_version'] = subprocess.check_output(['node', '--version'], text=True, timeout=5).strip()
        evidence['python_version'] = sys.version.split()[0]
        if os.environ.get('QA_BROWSER_EXECUTABLE'):
            browser = os.environ['QA_BROWSER_EXECUTABLE']
            evidence['browser'] = {'executable': browser, 'version': subprocess.check_output(
                [browser, '--version'], text=True, timeout=5).strip()}
        playwright = json.loads(subprocess.check_output(['node', '-e',
            'console.log(JSON.stringify({version:require("@playwright/test/package.json").version,cli:require.resolve("@playwright/test/cli")}))'],
            cwd=HERE, text=True, timeout=5))
        if playwright['version'] != '1.62.1':
            raise RuntimeError('This fixture pins Playwright Test 1.62.1; observed ' + playwright['version'])
        evidence['playwright'] = playwright
        installed = subprocess.run([sys.executable, str(SERVICE), 'install'], cwd=HERE, capture_output=True, text=True, timeout=75)
        (output / 'install.log').write_text(installed.stdout + installed.stderr)
        installed.check_returncode()
        evidence['release'] = json.loads(installed.stdout)
        launch = [sys.executable, str(SERVICE), 'start', '--instance', instance, '--ttl', '240']
        if args.verbose:
            launch.append('--verbose')
        started = subprocess.run(launch, cwd=HERE, capture_output=True, text=True, timeout=25)
        (output / 'startup.log').write_text(started.stdout + started.stderr)
        started.check_returncode()
        state = json.loads(started.stdout)
        evidence['service'] = state
        env = dict(os.environ, MAILPIT_URL=state['MAILPIT_URL'], SMTP_PORT=str(state['SMTP_PORT']),
                   MAILPIT_OUTPUT_DIR=str(output / 'test-results'), MAILPIT_JSON_REPORT=str(output / 'results.json'),
                   MAILPIT_TEST_VERBOSE='1' if args.verbose else '0',
                   MAILPIT_TEST_BAD_SUBJECT='1' if args.bad_subject else '0', FORCE_COLOR='0')
        env.pop('NO_COLOR', None)
        command = ['node', playwright['cli'], 'test', '--config', str(HERE / 'playwright.config.cjs'),
                   '--workers', str(args.workers), '--repeat-each', str(args.repeat_each)]
        if args.bad_subject:
            command.extend(['--grep', 'captures delayed reset'])
        evidence['test_command'] = command
        evidence['test_env'] = {key: env[key] for key in ('MAILPIT_URL', 'SMTP_PORT', 'MAILPIT_TEST_VERBOSE', 'MAILPIT_TEST_BAD_SUBJECT')}
        if env.get('QA_BROWSER_EXECUTABLE'):
            evidence['test_env']['QA_BROWSER_EXECUTABLE'] = env['QA_BROWSER_EXECUTABLE']
        tested = subprocess.run(command, cwd=HERE, env=env, capture_output=True, text=True, timeout=190)
        test_exit = tested.returncode
        evidence['test_exit_code'] = test_exit
        (output / 'playwright.log').write_text(tested.stdout + tested.stderr)
        print(tested.stdout + tested.stderr, flush=True)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(state['MAILPIT_URL'] + '/api/v1/info', timeout=3) as response:
            evidence['final_mailpit_info'] = json.load(response)
        if evidence['final_mailpit_info']['Messages'] != 0:
            raise RuntimeError('Owned test messages remain after per-test cleanup; inspect evidence')
        result = json.loads((output / 'results.json').read_text())
        evidence['test_stats'] = result.get('stats')
        evidence['outcome'] = 'pass' if test_exit == 0 else 'failed'
    except Exception as error:
        evidence['harness_error'] = str(error)
        evidence['outcome'] = 'harness_failed'
        print(str(error), file=sys.stderr)
        test_exit = test_exit or 1
    finally:
        if state:
            stopped = subprocess.run([sys.executable, str(SERVICE), 'stop', '--instance', instance],
                                     cwd=HERE, capture_output=True, text=True, timeout=12)
            (output / 'stop.log').write_text(stopped.stdout + stopped.stderr)
            evidence['stop_exit_code'] = stopped.returncode
            if stopped.returncode:
                test_exit = test_exit or 1
            for key in ('server_log', 'supervisor_log'):
                shutil.copyfile(state[key], output / (key + '.log'))
        evidence['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
        print('Evidence: ' + str(output / 'evidence.json'))
    return test_exit or 0


if __name__ == '__main__':
    raise SystemExit(main())
