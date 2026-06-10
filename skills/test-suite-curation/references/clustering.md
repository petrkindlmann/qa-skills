# Near-Duplicate Clustering

AST-based similarity + coverage-profile signature, clustered at a tunable threshold.
Decision rules and the "route to human review, never auto-delete" rule in `SKILL.md` §3.

## 1. Parse and normalize the AST

Exact string / `diff` matching fails on renamed variables and reformatting. Parse each
test to an AST and normalize away the noise (identifier names, literal values) so two
copy-pasted tests with renamed variables still match.

```python
import ast

class Normalizer(ast.NodeTransformer):
    """Erase identifier names and literals; keep structure."""
    def visit_Name(self, node):
        return ast.copy_location(ast.Name(id="VAR", ctx=node.ctx), node)
    def visit_Constant(self, node):
        return ast.copy_location(ast.Constant(value="CONST"), node)

def ast_tokens(src: str) -> list[str]:
    tree = Normalizer().visit(ast.parse(src))
    ast.fix_missing_locations(tree)
    # Dump node-type sequence as the structural token stream.
    return [type(n).__name__ for n in ast.walk(tree)]
```

(For JS/TS use `@babel/parser` or `ts-morph` and the same normalize-then-walk approach.)

## 2. Similarity metrics

Use a token/tree similarity score — Jaccard over shingles, cosine over n-grams, or tree
edit distance. Never use raw line numbers as a similarity signal.

```python
def shingles(tokens, k=3):
    return {tuple(tokens[i:i+k]) for i in range(len(tokens) - k + 1)}

def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)

def ast_similarity(src_a, src_b, k=3):
    return jaccard(shingles(ast_tokens(src_a), k), shingles(ast_tokens(src_b), k))
```

Tree edit distance (Zhang-Shasha via the `zss` package) is more precise but O(n²) per
pair — reserve it for confirming pairs the cheaper Jaccard already flagged.

## 3. Combine with the coverage-profile signature

Each test already has a covered-line/branch set (its **execution profile**) from
`coverage-fingerprinting.md`. Require *both* signals — AST near-identical AND coverage
profile near-identical — so structurally similar tests that exercise different paths are
not falsely merged.

```python
def combined_score(a, b, src, cov_sets, w_ast=0.6, w_cov=0.4):
    s_ast = ast_similarity(src[a], src[b])
    s_cov = jaccard(cov_sets[a], cov_sets[b])
    return w_ast * s_ast + w_cov * s_cov
```

## 4. Cluster at a tunable threshold

```python
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform
import numpy as np

def cluster(tests, src, cov_sets, threshold=0.85):
    n = len(tests)
    dist = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            sim = combined_score(tests[i], tests[j], src, cov_sets)
            dist[i, j] = dist[j, i] = 1 - sim
    # agglomerative / hierarchical clustering; cut at the configurable cutoff
    Z = linkage(squareform(dist), method="average")
    labels = fcluster(Z, t=1 - threshold, criterion="distance")
    clusters = {}
    for test, label in zip(tests, labels):
        clusters.setdefault(label, []).append(test)
    return {k: v for k, v in clusters.items() if len(v) > 1}
```

Start the threshold around 0.85 and tune to your false-positive tolerance — lower catches
more candidates but flags more genuine differences.

## 5. Output, do not delete

For each cluster emit: members, pairwise AST similarity, coverage-profile overlap, and
the differing assertions. Route to human review. The agent never deletes a whole cluster
automatically — copy-paste tests frequently diverge in the one assertion that matters.
