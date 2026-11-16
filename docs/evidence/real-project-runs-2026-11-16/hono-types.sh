#!/bin/zsh
# For a hono fix commit: type-check the fix commit's test files against the parent and against the fix.
repo=$1; sha=$2; W=$(mktemp -d)
files=($(git -C $repo diff --no-renames --name-only --diff-filter=AM $sha^1 $sha | grep -E '\.test\.tsx?$'))
for side in base fix; do
  rev=$sha; [ $side = base ] && rev=$sha^1
  git -C $repo worktree add -q --detach $W/$side $rev
  for f in $files; do git -C $repo show $sha:$f > $W/$side/$f; done
  ln -s $repo/node_modules $W/$side/node_modules
  out=$(cd $W/$side && ./node_modules/.bin/tsc -p tsconfig.spec.json --noEmit 2>&1)
  n=0; for f in $files; do n=$((n + $(echo "$out" | grep -c "^$f"))); done
  echo "$sha[1,10] $side: $n type error(s) in ${files[*]}; $(echo "$out" | grep -c 'error TS') in the project"
  [ $side = base ] && for f in $files; do echo "$out" | grep "^$f" | head -2 | cut -c1-230; done
  git -C $repo worktree remove --force $W/$side
done
