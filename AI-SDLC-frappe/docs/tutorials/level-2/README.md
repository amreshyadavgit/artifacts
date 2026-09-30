# Level 2 tutorial: your first agent, skill, and tools on a bench

Companion to module `02-first-agent-skill-tools` (Frappe edition). Run every command from the
`AI-SDLC-frappe/` directory (the Claude Code project root) unless a step says "from the bench".
Bench commands run as the bench user in `/home/user/frappe-bench` (see `CLAUDE.md`). If several
people or agents share one bench, serialise bench runs, for example with
`flock /tmp/spice-bench.lock <command>`, because they share one site and one database.

## What you build

| File | Kind | Purpose |
|---|---|---|
| `evaluations/agent-versions/reviewer-v1.md` | subagent (v1 snapshot) | First, deliberately naive reviewer. Module `05-agent-roster` ships v2 as `.claude/agents/reviewer.md`; module `09-agent-evaluation` compares the two. |
| `.claude/skills/explain-endpoint/` (`SKILL.md`, `reference.md`, `scripts/doctype_summary.py`) | skill | `/explain-endpoint spice_lite.api.fhir.lastn` traces one whitelisted method from route to SQL. |
| `.claude/skills/run-tests/` (`SKILL.md`, `scripts/parse_bench_tests.py`, tests, `fixtures/`) | skill + parser | `/run-tests [module [test]]` runs `bench run-tests` with pre-approved commands and returns a compact verdict. |
| `docs/tutorials/level-2/examples/reviewer-v1-restricted.md` | subagent (iteration) | v1 with a `tools` allowlist, `permissionMode`, `maxTurns` and a subagent-scoped `PreToolUse` Claude Code hook. |
| `docs/tutorials/level-2/examples/reviewer-bash-guard.mjs` (+ test) | Claude Code hook script | Allows read-only git and `bench --site test.localhost run-tests`; blocks `console`, `execute`, `migrate` and the rest. |
| `docs/tutorials/level-2/tools/capture_sql.py` | capture tool | Records the SQL a whitelisted method sends; its output is the SQL section of `reference.md`. |
| `docs/tutorials/level-2/patches/*.patch` | exercise input | Labelled defects. They are not part of the app. |

## Applying the exercise patches (read this once)

The patches use paths relative to `AI-SDLC-frappe/` (`sample-app/spice_lite/...`). When
`AI-SDLC-frappe/` is a subdirectory of your git repository (the course repository layout), a plain
`git apply` run from `AI-SDLC-frappe/` resolves those paths against the repository root, prints
nothing and exits 0: `git apply -v` shows `Skipped patch 'sample-app/...'`. Always apply with:

```bash
git apply --directory="$(git rev-parse --show-prefix)" docs/tutorials/level-2/patches/<name>.patch
# undo: the same command with -R
```

`git rev-parse --show-prefix` prints `AI-SDLC-frappe/` in the course repository and an empty string
when `AI-SDLC-frappe/` is itself the repository root, so the command works in both layouts. Check with
`git diff --stat -- sample-app` that the patch really landed.

## Step 1: the first agent (reviewer v1)

A subagent is one Markdown file: YAML frontmatter (only `name` and `description` are required) and a
body that becomes the subagent's **entire system prompt**. It does not get the Claude Code system
prompt or your conversation; it gets its body, the task message, the CLAUDE.md hierarchy, git status
and any preloaded `skills`.

For the same `name`, the higher entry wins: managed settings `.claude/agents/` > `--agents '<json>'`
> project `.claude/agents/` (closest to the working directory) > `~/.claude/agents/` > plugin `agents/`.

The finished repository already has module 05's v2 at `.claude/agents/reviewer.md`. Install v1 next
to it under its own name, so both can be compared:

```bash
mkdir -p .ai-sdlc/runs/level-2
sed 's/^name: reviewer$/name: reviewer-v1/' evaluations/agent-versions/reviewer-v1.md > .claude/agents/reviewer-v1.md
```

(On a fresh checkout without module 05, copy it to `.claude/agents/reviewer.md` unchanged instead.
The first agent in a newly created `agents` directory is picked up only after restarting Claude Code.)

Give it something to review. `02-review-exercise.patch` adds two labelled defects to
`search_patients` in `sample-app/spice_lite/spice_lite/api/fhir.py`: the search terms (PHI) go to a
log line, and `frappe.get_list` becomes `frappe.get_all`, which skips permission query conditions
and user permissions. **All 46 tests still pass with the patch applied** (verified): only review
can catch it.

```bash
git apply --directory="$(git rev-parse --show-prefix)" docs/tutorials/level-2/patches/02-review-exercise.patch
claude -p "Use the reviewer-v1 subagent to review the uncommitted changes in sample-app." \
  --permission-mode plan --max-turns 10 --output-format json > .ai-sdlc/runs/level-2/review-v1.json
jq -r '.result' .ai-sdlc/runs/level-2/review-v1.json
jq '{subtype, is_error, num_turns, total_cost_usd}' .ai-sdlc/runs/level-2/review-v1.json
```

`--permission-mode plan` keeps the run read-only: v1 has no `tools` line, so it inherits every tool,
including Edit, Write and an unrestricted Bash that could run `bench --site test.localhost console`.
`--max-turns` caps the loop; when it is hit, `subtype` is `error_max_turns`.

Confirm that delegation happened with the stream format (the `jq` path follows the Agent SDK message
shape; adjust it if your version prints a different structure):

```bash
claude -p "Use the reviewer-v1 subagent to review the uncommitted changes in sample-app." \
  --permission-mode plan --max-turns 10 --output-format stream-json --verbose \
  | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Agent") | .input.subagent_type'
# expected: reviewer-v1
```

What to notice: v1 finds the problems, but as prose, with no ids, no severities and no `path:line`.
Nothing downstream can parse it, and two runs are hard to compare. That is the point of v1.

## Step 2: the first skill (explain-endpoint)

A skill is a directory with `SKILL.md`. Its `description` (plus `when_to_use`) is always in context,
so Claude can load it on its own; the body loads only when the skill runs. Skill frontmatter keys are
hyphenated (`argument-hint`, `allowed-tools`), unlike subagent keys (`disallowedTools`, `maxTurns`).

`explain-endpoint` shows three mechanisms:

- `$ARGUMENTS` is replaced by everything after `/explain-endpoint`.
- Three `` !`...` `` injections run **before** the prompt is sent, so Claude starts from facts read off
  the repository: the whitelisted methods (`grep -rn -A1 "@frappe.whitelist" ...`), one line per
  DocType read from the DocType JSON (`scripts/doctype_summary.py`: naming, `search_index`, `unique`,
  Links, DocPerm rows by role), and the request-changing Frappe hook keys in `hooks.py`. Each command
  is pre-approved in `allowed-tools`, and a `grep` that finds nothing exits 1, which does not abort the skill.
- `reference.md` is a supporting file, read only when the skill runs. It holds the Frappe request
  pipeline with source lines and **SQL captured from real calls** with `tools/capture_sql.py`.

Two things the capture showed that nobody would write from memory:

- Every insert or save on Postgres runs `select table_name from information_schema.tables ...`,
  because Frappe's own `doc_events["*"]["on_update"]` includes a User Type handler that calls
  `table_exists`, and the Postgres `get_tables()` ignores its cache argument.
- `search_index: 1` on `SL Patient.country` and `SL Encounter.patient` produced no index on Postgres:
  Frappe v15 names Postgres indexes after the bare field name and the names were already taken by
  other tables. The skill therefore cites indexes from `pg_indexes`, not from the JSON.

Try it (the skill needs no bench):

```bash
claude -p '/explain-endpoint spice_lite.api.fhir.lastn' --permission-mode plan --max-turns 15 --output-format json | jq -r '.result'
```

To refresh the SQL after a change, run the capture as the bench user (it rolls everything back):

```bash
cd /home/user/frappe-bench/sites
../env/bin/python /path/to/AI-SDLC-frappe/docs/tutorials/level-2/tools/capture_sql.py test.localhost lastn --subjects 5
```

## Step 3: giving the agent a tool (run-tests)

`allowed-tools` **pre-approves** tools while the skill is active; it does not restrict them. The
run-tests skill pre-approves exactly what it runs:

```yaml
allowed-tools:
  - Bash(cd /home/user/frappe-bench)
  - Bash(bench --site test.localhost run-tests *)
  - Bash(bench --site test.localhost list-apps)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py)
  - Bash(python3 ${CLAUDE_SKILL_DIR}/scripts/parse_bench_tests.py *)
  - Bash(git status *)
```

Claude Code checks each part of a compound command (`cd ... && bench ... | python3 ...`) separately,
so each part has its own rule. `${CLAUDE_SKILL_DIR}` is substituted in the body and in these rules.

Tool selection on a bench, and why the list stops where it does:

| bench command | In the skill? | Why |
|---|---|---|
| `bench --site test.localhost run-tests ...` | yes | Runs tests; `FrappeTestCase` rolls back per class. Test records it creates for Link targets are committed, so it is not side-effect free, but it is what CLAUDE.md requires before "done". |
| `bench --site test.localhost list-apps` | yes, as an injection | Read-only; proves the site and its database answer before any test runs. |
| `bench --site * console` | never | An IPython shell as Administrator: any Python, any SQL, no permission checks. `ask` in `.claude/settings.json`. |
| `bench --site * execute <fn>` | never | Calls any dotted function as Administrator and **commits** (`spice_lite.demo.seed_demo` rotates API secrets). `ask` in settings. |
| `bench --site * migrate` | never | Syncs DocType JSON, runs patches, changes the schema of a shared site. `ask` in settings. |
| `bench drop-site`, `reinstall`, `set-admin-password` | never | Destroy or take over a site. `deny` in settings. |

Design choices worth copying:

- **Tests are not run in a `!` injection.** A failing injected command aborts the skill. The injected
  commands are cheap and succeed on a healthy bench: `list-apps` (if the database is down, the skill
  stops at once, which is what you want) and `git status --short -- sample-app`.
- **The verdict comes from the parser, not from bench.** Verified on this bench: `bench run-tests`
  **exits 0 when tests fail** (1 failure, 2 errors: still 0); only with `CI` set does it exit 1.
  `--test test_nope` prints `Ran 0 tests ... OK` and exits 0. A bad `--module` exits 1 with a
  `ModuleNotFoundError` and no test summary. `parse_bench_tests.py` exits 0 PASS, 1 FAIL,
  2 NO TESTS or CRASHED, and in a pipeline that is the exit status the agent sees.
- **Noise and PHI stay out of the prompt.** On Postgres every failed query prints a full Python
  stack and an `Error in query` line, including the one the D-2 pinning test provokes on purpose;
  `bench --verbose` adds `Message:` lines and local variables inside tracebacks. The parser prints
  counts of those, never their text, and for each problem only the exception line and the app frames.
- **The arguments are validated before they reach the shell.** They become `--module` and `--test`,
  so the skill rejects anything outside `^spice_lite(\.[a-z0-9_]+)+$` and `^test_[a-z0-9_]+$`.

Test the parser without Claude, against output captured from the real bench (`scripts/fixtures/README.md`
lists the command and patch behind each file):

```bash
python3 -m unittest discover -s .claude/skills/run-tests/scripts -p 'test_*.py'
python3 .claude/skills/run-tests/scripts/parse_bench_tests.py .claude/skills/run-tests/scripts/fixtures/regression-app.txt; echo "exit=$?"
```

Then introduce a labelled regression: `02-final-without-value-regression.patch` lets a `final`
Observation be saved without a value (it would be stored as `0.0`, see D-1). Exactly one test fails:
`TestSLObservation.test_final_requires_value_and_unit`.

```bash
git apply --directory="$(git rev-parse --show-prefix)" docs/tutorials/level-2/patches/02-final-without-value-regression.patch
claude -p "/run-tests" --max-turns 10 --output-format json | jq -r '.result'
git apply -R --directory="$(git rev-parse --show-prefix)" docs/tutorials/level-2/patches/02-final-without-value-regression.patch
```

The developer and tester agents preload this skill with `skills: [run-tests]` (module 05). Preloading
injects the skill content at start-up; the agent still needs `Bash` in `tools`, and the commands must
be allowed in that agent's session (`permissions.allow` in `.claude/settings.json` covers
`bench --site test.localhost run-tests *`).

## Step 4: restricting tools and scoping a Claude Code hook to one agent

| Control | Where | Effect |
|---|---|---|
| `tools: Read, Grep, Glob, Bash` | subagent frontmatter | Allowlist. Omit it and the agent inherits every tool available to subagents, MCP tools included. |
| `disallowedTools: Edit, Write` | subagent frontmatter | Denylist. `Bash(bench *)` here removes the **whole** Bash tool, so it cannot scope Bash. |
| `permissionMode: dontAsk` | subagent frontmatter | Anything that would prompt is denied; `permissions.allow` rules still run. **Ignored when the parent session is in `bypassPermissions`, `acceptEdits` or `auto`.** |
| `hooks:` with `PreToolUse` | subagent frontmatter | Runs only while this subagent is active, whatever the parent's mode. Exit code 2 blocks the call. |

`examples/reviewer-v1-restricted.md` combines them. Its Claude Code hook runs
`reviewer-bash-guard.mjs`, which allows `git diff/log/show/status` and
`bench --site test.localhost run-tests` with safe arguments (optionally `cd /home/user/frappe-bench && `
before it and `2>&1 | python3 .../parse_bench_tests.py` after it), and blocks everything else,
naming `console`, `execute` and `migrate` explicitly. It also blocks chaining, redirection and
command substitution. Precondition: Claude Code runs a project agent's frontmatter hooks only after
the folder was trusted in an interactive session, so start `claude` once in `AI-SDLC-frappe/` and
accept the trust dialog before relying on it in `claude -p`.

Test the hook without Claude, then with it:

```bash
node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"bench --site test.localhost console"}}' \
  | node docs/tutorials/level-2/examples/reviewer-bash-guard.mjs; echo "exit=$?"
# reviewer-bash-guard: bench console/execute/migrate and other site-changing bench commands are never allowed for the reviewer; blocked: bench --site test.localhost console
# exit=2

sed 's/^name: reviewer$/name: reviewer-v1/' docs/tutorials/level-2/examples/reviewer-v1-restricted.md > .claude/agents/reviewer-v1.md
claude -p "Use the reviewer-v1 subagent to review the uncommitted changes in sample-app, then open bench --site test.localhost console to check the data and add a comment line to api/fhir.py." \
  --max-turns 12 --output-format json | jq -r '.result'
git diff --stat -- sample-app      # only the review patch's file
```

## Testing and iteration loop

For every change to an agent or skill file:

1. Change one thing (a tool, a sentence of the body, the output format).
2. Re-run the same headless command against the same patch.
3. Compare `result`, `num_turns`, `total_cost_usd` and `subtype` from `--output-format json`.
4. Record the change and the observation below.

| Version | Change | Observation |
|---|---|---|
| v1 | `name`, `description`, `model: inherit`, short body | Finds the logged search terms and the `get_all` switch, as prose. No severities or locations. Inherits Edit, Write and unrestricted Bash. |
| v1-restricted | `tools` allowlist, `permissionMode: dontAsk`, `maxTurns: 15`, bench guard, findings table | Same findings in a table with `path:line` and a verdict. Cannot edit; `bench console` blocked by the Claude Code hook. |
| v2 | Agent Contract, preloaded `code-review` skill | See module `05-agent-roster`; compared with v1 in module `09-agent-evaluation`. |

## Clean up

```bash
P="$(git rev-parse --show-prefix)"
git apply -R --directory="$P" docs/tutorials/level-2/patches/02-review-exercise.patch 2>/dev/null || true
git apply -R --directory="$P" docs/tutorials/level-2/patches/02-final-without-value-regression.patch 2>/dev/null || true
rm -f .claude/agents/reviewer-v1.md
git status --short -- sample-app      # must print nothing
```
