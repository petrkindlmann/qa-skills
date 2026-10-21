from pathlib import Path
import json
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
source = root / 'quote.mjs'
fixed = source.read_text()
needle = 'subtotal >= 5000'
assert fixed.count(needle) == 1, 'Expected the verified boundary fix exactly once'
try:
    source.write_text(fixed.replace(needle, 'subtotal > 5000'))
    result = subprocess.run([
        sys.executable, 'evidence/run-command.py', 'regression-reverted',
        'node', '--test', '--test-reporter=tap',
        '--test-name-pattern=standard shipping', 'quote.test.mjs'
    ], cwd=root)
    assert result.returncode == 1, 'Removing the fix must produce a failed assertion'
finally:
    source.write_text(fixed)
    (root / 'evidence' / 'revert-restoration.json').write_text(json.dumps({
        'fixRestored': source.read_text() == fixed,
        'file': 'quote.mjs',
        'scope': 'Temporarily changed only the shipping threshold comparator',
    }, indent=2) + '\n')
print('Boundary assertion failed without the fix; fixed source restored.')
