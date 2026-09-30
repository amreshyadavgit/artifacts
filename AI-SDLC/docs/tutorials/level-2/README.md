# Level 2 tutorial: your first agent, skill, and tools

Companion to module `02-first-agent-skill-tools`. Run every command from the `AI-SDLC/` directory
(the Claude Code project root). Claude Code formats used here are the ones listed in
`build/CLAUDE_CODE_FACTS.md` of the curriculum; nothing else is assumed.

## What you build

| File | Kind | Purpose |
|---|---|---|
| `evaluations/agent-versions/reviewer-v1.md` | subagent (v1 snapshot) | First, deliberately naive reviewer. Copied to `.claude/agents/reviewer.md` for the exercise. Module `05-agent-roster` replaces it with v2; module `09-agent-evaluation` compares the two. |
| `.claude/skills/explain-endpoint/SKILL.md` + `reference.md` | skill | `/explain-endpoint GET /fhir/Patient/{id}` traces one route from security rule to SQL. |
| `.claude/skills/run-tests/SKILL.md` + `scripts/summarize-surefire.mjs` | skill + script | `/run-tests [TestClass]` runs Maven with pre-approved commands and returns a compact summary. |
| `docs/tutorials/level-2/examples/reviewer-v1-restricted.md` | subagent (iteration) | v1 with a tool allowlist, `permissionMode`, `maxTurns` and a subagent-scoped `PreToolUse` hook. |
| `docs/tutorials/level-2/examples/reviewer-bash-guard.mjs` (+ test) | hook script | Narrows the reviewer's Bash to `git diff/log/show/status`. |
| `docs/tutorials/level-2/patches/*.patch` | exercise input | Labelled defects for the reviewer and the test runner to find. They are not part of the app. |

## Step 1: the first agent (reviewer v1)

A subagent is one Markdown file: YAML frontmatter (only `name` and `description` are required) and
a body that becomes the subagent's **entire system prompt**. The subagent does not get the Claude
Code system prompt or your conversation; it gets its body, the task message, the CLAUDE.md
hierarchy, git status and any preloaded `skills`.

Where the file goes decides who sees it. For the same `name`, the higher entry wins:

1. managed settings `.claude/agents/` (org-wide)
2. `--agents '<json>'` on the command line (this session only)
3. `.claude/agents/` in the project (closest to the working directory wins)
4. `~/.claude/agents/` (all your projects)
5. a plugin's `agents/` directory

Install v1 for the exercise:

```bash
mkdir -p .claude/agents .ai-sdlc/runs/level-2
cp evaluations/agent-versions/reviewer-v1.md .claude/agents/reviewer.md
```

If you are working in the finished reference repository, `.claude/agents/reviewer.md` already holds
module 05's v2. Keep it, and copy v1 instead to `.claude/agents/reviewer-v1.md` with its `name:` line
changed to `reviewer-v1`. The first agent in a newly created `agents` directory is only picked up
after restarting Claude Code; later edits are hot-reloaded.

Give it something to review. The patch below adds two labelled defects to `PatientService`
(PHI in a log line; patient search without criteria returns every patient):

```bash
git apply --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-review-exercise.patch
git diff --stat
```

Run it headless, two ways:

```bash
# a) Delegation: the main session decides to call the subagent
claude -p "Use the reviewer subagent to review the uncommitted changes in sample-app." \
  --permission-mode plan --max-turns 10 --output-format json > .ai-sdlc/runs/level-2/review-v1.json
jq -r '.result' .ai-sdlc/runs/level-2/review-v1.json
jq '{subtype, is_error, num_turns, total_cost_usd}' .ai-sdlc/runs/level-2/review-v1.json

# b) Main thread: the agent's body replaces the default system prompt for the whole session
claude -p "Review the uncommitted changes in sample-app." --agent reviewer \
  --permission-mode plan --max-turns 10 --output-format json | jq -r '.result'
```

`--permission-mode plan` keeps the run read-only (v1 has no `tools` line, so it inherits every tool,
including Edit and Write). `--max-turns` caps the loop; when hit, `subtype` is `error_max_turns`.

Check that delegation actually happened in (a) with the stream format, which contains the `Agent`
tool call the main session made (the `jq` path follows the Agent SDK message shape; adjust it if your
version prints a different structure):

```bash
claude -p "Use the reviewer subagent to review the uncommitted changes in sample-app." \
  --permission-mode plan --max-turns 10 --output-format stream-json --verbose \
  | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Agent") | .input.subagent_type'
# expected: reviewer
```

What to notice in the v1 output: it finds the problems, but as prose with no ids, no severities and
no `path:line`. Nothing downstream can parse it, and two runs are hard to compare. That is the
point of v1; module 05 fixes it with an Agent Contract.

Undo the patch when done: `git apply -R --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-review-exercise.patch`.

## Step 2: the first skill (explain-endpoint)

A skill is a directory with `SKILL.md`. Its `description` (plus `when_to_use`) is always in context so
Claude can load it automatically; the body loads only when the skill is invoked. Frontmatter keys
for skills are hyphenated (`argument-hint`, `allowed-tools`, `disable-model-invocation`), unlike
subagent keys (`disallowedTools`, `permissionMode`, `maxTurns`).

`explain-endpoint` shows three mechanisms:

- `$ARGUMENTS` is replaced by everything after `/explain-endpoint`. (`$0` would be the first word
  only, `$1` the second.)
- `` !`grep -rnE "@(Get|Post|Put|Delete|Request)Mapping" sample-app/src/main/java/org/example/fhir/api` ``
  runs **before** the prompt is sent, so Claude starts with the current route map instead of
  spending turns finding it. The command must be allowed by permission rules, hence
  `Bash(grep *)` in `allowed-tools`.
- `reference.md` is a supporting file: the body links to it, and Claude reads it only when the skill
  runs. It holds the repository map and the SQL each repository method produces, taken from a real
  `-Dspring.jpa.show-sql=true` run.

Try it:

```bash
claude -p '/explain-endpoint GET /fhir/Observation/$lastn' --permission-mode plan --output-format json | jq -r '.result'
```

Single quotes matter: in double quotes your shell would expand `$lastn` to an empty string.

## Step 3: giving an agent tools (run-tests)

`allowed-tools` **pre-approves** tools while the skill is active; it does not restrict them. The
run-tests skill pre-approves exactly the commands it needs:

```yaml
allowed-tools:
  - Bash(mvn -q -B test)
  - Bash(mvn -q -B test *)
  - Bash(node ${CLAUDE_SKILL_DIR}/scripts/summarize-surefire.mjs *)
  - Bash(date *)
  - Bash(git status *)
```

Use the YAML list form here: the rules themselves contain spaces. Claude Code substitutes
`${CLAUDE_SKILL_DIR}` (the directory holding this `SKILL.md`) both in the body and in `allowed-tools`
Bash rules, so the rule matches the exact command the body tells Claude to run, and the path still
works when the skill is packaged into a plugin (module 10).

Design choices worth copying:

- **Maven is not run in a `!` injection.** A non-zero exit from an injected command aborts the whole
  skill invocation, and `mvn test` exits non-zero exactly when you most need the report (a failing
  test). The injections are cheap and always succeed: the invocation time (`date`) and
  `git status --short -- sample-app`.
- **A script turns Maven's noise into a summary.** Even with `-q`, a run of the 25 tests prints
  hundreds of Spring and `AUDIT` log lines. `summarize-surefire.mjs` reads
  `sample-app/target/surefire-reports/TEST-*.xml` and prints totals, a per-suite table and each
  failure with its assertion message and failing line. It never prints `<system-out>`, so test log
  output cannot leak into the prompt.
- **`--since` drops stale reports.** Surefire does not delete reports from earlier runs. After
  `/run-tests SecurityTest`, the old `PatientApiTest` report is still on disk; the injected
  invocation time filters it out.
- **The argument is validated before it reaches the shell.** `$ARGUMENTS` becomes `-Dtest=...`, so
  the skill tells Claude to reject anything outside `^[A-Za-z0-9_#*,]+$`.

Test the script without Claude:

```bash
node --test .claude/skills/run-tests/scripts/summarize-surefire.test.mjs
(cd sample-app && mvn -q -B test > /dev/null 2>&1); node .claude/skills/run-tests/scripts/summarize-surefire.mjs
```

Then introduce a labelled regression (clinicians allowed to DELETE) and let the skill find it:

```bash
git apply --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-clinician-delete-regression.patch
claude -p "/run-tests SecurityTest" --output-format json | jq -r '.result'
git apply -R --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-clinician-delete-regression.patch
```

The developer and tester agents preload this skill with `skills: [run-tests]` (module 05). Preloading
injects the skill content at startup; the agent still needs `Bash` in its `tools`, and the commands
still need to be allowed for that agent's session.

## Step 4: restricting tools and scoping a hook to one agent

Four controls, from coarse to fine:

| Control | Where | Effect |
|---|---|---|
| `tools: Read, Grep, Glob, Bash` | subagent frontmatter | Allowlist. Omit it and the agent inherits every tool available to subagents, MCP tools included. |
| `disallowedTools: Edit, Write` | subagent frontmatter | Denylist, removed from the inherited or listed set. `Bash(git push *)` here removes the **whole** Bash tool, so it cannot scope Bash. |
| `permissionMode: dontAsk` | subagent frontmatter | Anything that would prompt is denied; tools allowed by `permissions.allow` still run. **Ignored when the parent session is in `bypassPermissions`, `acceptEdits` or `auto`.** |
| `hooks:` with `PreToolUse` | subagent frontmatter | Runs only while this subagent is active, whatever the parent's mode. Exit code 2 blocks the call. |

`examples/reviewer-v1-restricted.md` combines them. Its hook calls `reviewer-bash-guard.mjs`,
which allows `git diff`, `git log`, `git show`, `git status` and blocks everything else, including
chaining (`;`, `&&`, `|`), redirection, command substitution and `git diff --output=<file>`.

Test the hook without Claude, then with it:

```bash
node --test docs/tutorials/level-2/examples/reviewer-bash-guard.test.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"mvn -q -B test"}}' | node docs/tutorials/level-2/examples/reviewer-bash-guard.mjs; echo "exit=$?"
# reviewer-bash-guard: reviewer may only run git diff, git log, git show or git status; blocked: mvn -q -B test
# exit=2

cp docs/tutorials/level-2/examples/reviewer-v1-restricted.md .claude/agents/reviewer.md
claude -p "Use the reviewer subagent to run mvn -q -B test and then add a comment to sample-app/src/main/java/org/example/fhir/service/PatientService.java." \
  --max-turns 10 --output-format json | jq -r '.result'
git status --short -- sample-app     # must print nothing
```

Expected: the reviewer reports that `mvn -q -B test` was blocked by the hook and that it has no
tool to edit files. `git status` shows no change.

## Testing and iteration loop

Treat an agent like code. For every change to an agent or skill file:

1. Change one thing (a tool, a sentence of the body, the output format).
2. Re-run the same headless command against the same patch.
3. Compare `result`, `num_turns`, `total_cost_usd` and `subtype` from `--output-format json`.
4. Record the change and the observation in the iteration log below.

| Version | Change | Observation |
|---|---|---|
| v1 | `name`, `description`, `model: inherit`, short body | Finds the PHI log line and the unbounded search, as prose. No severities or locations. Inherits Edit and Write. |
| v1-restricted | `tools` allowlist, `permissionMode: dontAsk`, `maxTurns: 15`, Bash guard hook, findings table | Same findings in a table with `path:line`. Cannot edit; `mvn` blocked. |
| v2 | Agent Contract, preloaded `code-review` skill | See module `05-agent-roster`; compared with v1 in module `09-agent-evaluation`. |

## Clean up

```bash
git apply -R --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-review-exercise.patch 2>/dev/null || true
git apply -R --directory=$(git rev-parse --show-prefix) docs/tutorials/level-2/patches/02-clinician-delete-regression.patch 2>/dev/null || true
git status --short -- sample-app
```
