# Task 29 Report: Add Staleness Check to Subdomain Graph Merge

## Objective

When `merge-subdomain-graphs.py` combines subdomain graphs into the main graph, warn if any subdomain graph was built at a different git commit than the others. The merged result should use the oldest (most conservative) commit hash, not the latest-by-timestamp.

## Changes Made

### 1. Modified `grasp-it-plugin/skills/grasp/merge-subdomain-graphs.py`

**Added `subprocess` import** (line 22) for git ancestry checking.

**Added `_find_oldest_common_ancestor_hash()` function** (lines 37-85):
- Takes a list of `(hash, analyzedAt)` tuples and the project root path
- Returns `(oldest_hash, was_ambiguous)` where `was_ambiguous` indicates if a warning should be emitted
- Uses `git merge-base --is-ancestor` to check if a commit is an ancestor of all others
- Falls back to oldest by `analyzedAt` if no single common ancestor exists
- Handles git failures gracefully (exceptions don't crash the merge)

**Updated `merge_graphs()` function signature** (line 104):
- Added `project_root: Path` parameter to enable git operations

**Rewrote project metadata merge section** (lines 210-256):
- Collects all distinct non-empty `gitCommitHash` values with their `analyzedAt` timestamps
- Calls `_find_oldest_common_ancestor_hash()` to determine the canonical hash
- Emits a multi-line warning to stderr when subdomain graphs have different commits:
  ```
  Warning: subdomain graphs were built at different commits:
    - abc123 (2024-01-01T10:00:00Z)
    - def456 (2024-01-02T10:00:00Z)
    The merged graph will use the oldest commit (abc123) as the canonical hash.
    Re-run /grasp on all subdomains at the same commit for a consistent merge.
  ```

**Updated merged output** (line 299):
- Uses `resolved_hash` (from the ancestry check) instead of `latest_hash` (latest by timestamp)

### 2. Updated `grasp-it-plugin/src/__tests__/merge-subdomain-graphs.test.mjs`

**Modified Test 13** (existing test):
- Updated expectations to reflect the new behavior: when subdomain graphs have different commits, the oldest hash (by `analyzedAt`) is used instead of the latest
- Expected `gitCommitHash` changed from `"def456"` to `"abc123"`

**Added Test 14** (`emits warning and uses oldest hash when subdomain graphs have different git commits`):
- Creates three graphs with different commit hashes and timestamps
- Verifies the staleness warning is emitted to stderr
- Verifies the canonical hash is the oldest by `analyzedAt`
- Verifies `analyzedAt` is still the latest timestamp

**Added Test 15** (`does not emit warning when all subdomain graphs have the same git commit hash`):
- Creates two graphs with the same commit hash
- Verifies no staleness warning is emitted
- Verifies the hash is correctly propagated

## Behavior Summary

| Scenario | Old Behavior | New Behavior |
|----------|-------------|--------------|
| All subdomains same commit | Uses that hash | Same — no change |
| Different commits, one is ancestor of all | Uses latest-by-timestamp hash | Uses the ancestor hash |
| Different commits, no ancestry relationship | Uses latest-by-timestamp hash | Falls back to oldest-by-analyzedAt + emits warning |

## Testing

All 223 tests pass:
```
Test Files  12 passed (12)
     Tests  223 passed (223)
```

The new tests verify:
1. Warning emission when commits differ
2. Correct hash selection (oldest or ancestor-based)
3. No warning when commits are identical
