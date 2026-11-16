#!/bin/sh
# usage: tolerant.sh <fix sha> <module> <name> <test files...>
# Runs the fix commit's tests at its first parent with the import of the helper made tolerant.
set -e
ROOT=$(cd "${REAL_RUNS_DIR:-real-runs}" && pwd)   # holds repos/, venvs/ and out/
sha=$1; module=$2; name=$3; shift 3
W="$ROOT/work-tolerant"
git -C "$ROOT/repos/pytest" worktree remove --force "$W" 2>/dev/null || true
git -C "$ROOT/repos/pytest" worktree add -f --detach "$W" "${sha}^1" >/dev/null 2>&1
cd "$W"
cp "$ROOT/repos/pytest/src/_pytest/_version.py" src/_pytest/_version.py
for f in "$@"; do
  git show "${sha}:$f" > "$f"
  python3 - "$f" "$module" "$name" <<'PY'
import sys, re
path, module, name = sys.argv[1:]
source = open(path).read()
line = f"from {module} import {name}\n"
if line in source:
    source = source.replace(line, f"try:\n    from {module} import {name}\nexcept ImportError:\n    {name} = None\n", 1)
    open(path, "w").write(source)
    print(f"  patched {path}")
PY
done
PYTHONPATH="$W/src" "$ROOT/venvs/pytest/bin/python" -m pytest -q -p no:cacheprovider -o junit_family=xunit1 --junitxml="$ROOT/out/tolerant-${sha}.xml" "$@" 2>&1 | tail -3
cd "$ROOT"
git -C "$ROOT/repos/pytest" worktree remove --force "$W"
