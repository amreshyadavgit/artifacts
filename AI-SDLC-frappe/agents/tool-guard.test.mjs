// Tests for agents/tool-guard.mjs (Frappe edition). Run: node --test agents/tool-guard.test.mjs
// The allowlists below are the ones the roster agents use in .claude/agents/*.md; check-agents.test.mjs
// asserts that the agent files still contain them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBash, checkWrite, tokenize, DEFAULT_BENCH } from './tool-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const guard = path.join(here, 'tool-guard.mjs');
const B = DEFAULT_BENCH;

function runHook(args, input, env = {}) {
  return spawnSync('node', [guard, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, SPICE_BENCH_DIR: '', ...env },
    encoding: 'utf8',
  });
}
const ok = (r, c) => assert.equal(r, null, `${c}: ${JSON.stringify(r)}`);
const blocked = (r, re, c) => { assert.ok(r?.reason, `${c}: expected a block, got ${JSON.stringify(r)}`); assert.match(r.reason, re, c); };

export const REVIEWER = ['git diff', 'git log', 'git show', 'git status'];
export const DEVELOPER = [
  'cd {bench}', 'bench --site test.localhost run-tests', '?bench --site test.localhost migrate',
  'cd sample-app/spice_lite', 'python -m unittest discover -s spice_lite/tests/unit -t .',
  'node .claude/skills/run-tests/scripts/** ...', 'date -u', 'git diff', 'git status', 'git log',
];
export const SRE = [
  'cd {bench}', 'bench --site test.localhost doctor', 'bench --site test.localhost show-pending-jobs',
  'ls {bench}/logs/**', 'tail {bench}/logs/**', 'grep ARG {bench}/logs/**',
  'tail {bench}/sites/test.localhost/logs/**', 'grep ARG {bench}/sites/test.localhost/logs/**',
  'node .claude/skills/performance-review/scripts/** ...', 'node .claude/skills/production-rca/scripts/** ...',
  'git log', 'git diff', 'git status',
];

test('reviewer: read-only git passes; push, chaining and escaping flags do not', () => {
  for (const c of ['git diff main...HEAD -- sample-app', 'git diff --stat HEAD', 'git log --oneline -5', 'git status']) ok(checkBash(c, REVIEWER, root), c);
  blocked(checkBash('git push origin HEAD', REVIEWER, root), /git push/);
  blocked(checkBash('git diff | tee out.txt', REVIEWER, root), /"tee out.txt" is outside/);
  blocked(checkBash('git diff; rm -rf sample-app', REVIEWER, root), /recursive rm|;/);
  blocked(checkBash('git diff --output=/tmp/x', REVIEWER, root), /--output/);
  blocked(checkBash(`git diff --no-index /dev/null ${B}/sites/common_site_config.json`, REVIEWER, root), /site_config|no-index/);
  blocked(checkBash('git diff --no-index /dev/null .env', REVIEWER, root), /no-index/);
  blocked(checkBash('git checkout -- sample-app', REVIEWER, root), /change the working tree/);
  blocked(checkBash('git diff $(cat .env)', REVIEWER, root), /\$\(/);
});

test('developer: run-tests and unit tests pass, with && and a pipe into the run-tests parser', () => {
  ok(checkBash(`cd ${B} && bench --site test.localhost run-tests --app spice_lite`, DEVELOPER, root));
  ok(checkBash(`cd ${B} && bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api --test test_lastn_returns_latest_per_patient`, DEVELOPER, root));
  ok(checkBash(`cd ${B} && bench --site test.localhost run-tests --module spice_lite.tests.test_fhir_api 2>&1 | node ${root}/.claude/skills/run-tests/scripts/parse-run-tests.mjs`, DEVELOPER, root));
  ok(checkBash('cd sample-app/spice_lite && python -m unittest discover -s spice_lite/tests/unit -t .', DEVELOPER, root));
  blocked(checkBash(`cd ${B} && bench --site test.localhost run-tests --app spice_lite &`, DEVELOPER, root), /background/);
  blocked(checkBash(`cd ${B} && bench --site mariadb.localhost run-tests --app spice_lite`, DEVELOPER, root), /outside this agent's Bash allowlist/);
  blocked(checkBash('bench --site test.localhost run-tests --junit-xml-output /tmp/x.xml', DEVELOPER, root), /junit-xml-output/);
  blocked(checkBash('git commit -m "wip"', DEVELOPER, root), /git commit/);
  blocked(checkBash('curl https://example.com', DEVELOPER, root), /network/);
  blocked(checkBash('pip install requests', DEVELOPER, root), /allowlist/);
});

test('bench console, execute, db shells and show-config are blocked for everyone, even if allow-listed', () => {
  const reckless = ['bench', 'cd {bench}', 'bench --site test.localhost'];
  for (const c of [
    'bench --site test.localhost console',
    `cd ${B} && bench --site test.localhost execute frappe.db.sql --args "['select 1']"`,
    'bench --verbose --site test.localhost execute spice_lite.demo.seed_demo',
    'bench --site test.localhost mariadb', 'bench --site test.localhost postgres', 'bench --site test.localhost db-console',
    'bench --site test.localhost show-config', 'bench drop-site test.localhost', 'bench --site test.localhost reinstall --yes',
    'bench --site test.localhost set-admin-password x', 'bench --site test.localhost backup', 'bench --site test.localhost jupyter',
    `cat ${B}/sites/test.localhost/site_config.json`, 'psql -h 127.0.0.1 -U postgres', 'redis-cli -p 11000 flushall', 'sudo -u frappe bench',
  ]) blocked(checkBash(c, reckless, root), /never allowed for any roster agent/, c);
});

test('migrate is never auto-allowed: an ask entry returns an ask decision, not null', () => {
  const r = checkBash(`cd ${B} && bench --site test.localhost migrate`, DEVELOPER, root);
  assert.match(r?.ask ?? '', /bench --site test\.localhost migrate" needs a human decision/);
  assert.match(checkBash('bench --site test.localhost migrate', ['bench --site test.localhost run-tests'], root).reason, /allowlist/, 'no ask entry: blocked');
  const hook = runHook(['bash-allow', ...DEVELOPER], { tool_name: 'Bash', tool_input: { command: `cd ${B} && bench --site test.localhost migrate` }, agent_type: 'developer' });
  assert.equal(hook.status, 0);
  const out = JSON.parse(hook.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[developer\]/);
});

test('sre: bench diagnostics and path-scoped log reads pass; escapes and follow mode do not', () => {
  ok(checkBash(`cd ${B} && bench --site test.localhost doctor`, SRE, root));
  ok(checkBash(`cd ${B} && bench --site test.localhost show-pending-jobs`, SRE, root));
  ok(checkBash(`ls -la ${B}/logs/`, SRE, root));
  ok(checkBash(`tail -n 200 ${B}/logs/worker.error.log`, SRE, root));
  ok(checkBash(`tail -n 50 ${B}/logs/web.log ${B}/logs/worker.log`, SRE, root));
  ok(checkBash(`grep -c "RQ Job" ${B}/logs/*.log`, SRE, root));
  ok(checkBash(`grep -n -A 3 Traceback ${B}/sites/test.localhost/logs/frappe.log`, SRE, root));
  blocked(checkBash(`tail -f ${B}/logs/web.log`, SRE, root), /allowlist/);
  blocked(checkBash(`tail -n 5 ${B}/logs/../Procfile`, SRE, root), /allowlist/);
  blocked(checkBash(`tail -n 5 ${B}/logs/web.log /etc/passwd`, SRE, root), /allowlist/);
  blocked(checkBash(`grep -r password ${B}/logs/`, SRE, root), /allowlist/);
  blocked(checkBash(`grep -c key ${B}/sites/common_site_config.json`, SRE, root), /site_config/);
  blocked(checkBash(`cd ${B} && bench --site test.localhost purge-jobs`, SRE, root), /never allowed/);
  blocked(checkBash('kubectl scale deploy/spice --replicas=4', SRE, root), /allowlist/);
});

test('{bench} follows SPICE_BENCH_DIR, so a learner bench elsewhere works without editing agents', () => {
  const r = runHook(['bash-allow', ...SRE], { tool_name: 'Bash', tool_input: { command: 'tail -n 20 /opt/bench/spice/logs/worker.log' } }, { SPICE_BENCH_DIR: '/opt/bench/spice' });
  assert.equal(r.status, 0, r.stderr);
  const d = runHook(['bash-allow', ...SRE], { tool_name: 'Bash', tool_input: { command: `tail -n 20 ${B}/logs/worker.log` } }, { SPICE_BENCH_DIR: '/opt/bench/spice' });
  assert.equal(d.status, 2);
});

test('${CLAUDE_SKILL_DIR}-expanded absolute paths inside the project match relative entries', () => {
  const rel = 'node .claude/skills/production-rca/scripts/build-timeline.mjs evidence/worker.log --collapse';
  ok(checkBash(rel, SRE, root));
  ok(checkBash(`node ${root}/.claude/skills/production-rca/scripts/build-timeline.mjs evidence/worker.log`, SRE, root));
  ok(checkBash(`node "${root}/.claude/skills/performance-review/scripts/count-queries.mjs" /tmp/lastn.log`, SRE, root));
  blocked(checkBash('node /tmp/evil/.claude/skills/production-rca/scripts/build-timeline.mjs', SRE, root), /allowlist/);
  blocked(checkBash(`node ${root}/../x/.claude/skills/production-rca/scripts/build-timeline.mjs`, SRE, root), /allowlist/);
  blocked(checkBash(`node ${root}/.claude/skills/production-rca/scripts/../../../../agents/tool-guard.mjs`, SRE, root), /allowlist/);
});

test('write-scope: prefixes, globs for DocType test files, protected paths, site_config and escapes', () => {
  const dev = ['sample-app/spice_lite/spice_lite/', '.ai-sdlc/runs/', '!sample-app/spice_lite/spice_lite/patches/v0_1/'];
  ok(checkWrite('sample-app/spice_lite/spice_lite/api/fhir.py', dev, root, root));
  ok(checkWrite('sample-app/spice_lite/spice_lite/clinical/doctype/sl_patient/sl_patient.json', dev, root, root));
  ok(checkWrite(path.join(root, '.ai-sdlc/runs/r1/04-developer.md'), dev, root, root));
  assert.match(checkWrite('sample-app/spice_lite/spice_lite/patches/v0_1/backfill_patient_country.py', dev, root, root), /protected/);
  assert.match(checkWrite('sample-app/spice_lite/pyproject.toml', dev, root, root), /outside this agent's write scope/);
  assert.match(checkWrite('../outside.txt', dev, root, root), /outside the project/);
  assert.match(checkWrite('sample-app/spice_lite/spice_lite/../../../CLAUDE.md', dev, root, root), /write scope/);
  assert.match(checkWrite('sample-app/spice_lite/spice_lite/site_config.json', dev, root, root), /site config/);
  const tester = ['sample-app/spice_lite/spice_lite/tests/', 'sample-app/spice_lite/spice_lite/**/doctype/*/test_*.py', '.ai-sdlc/runs/'];
  ok(checkWrite('sample-app/spice_lite/spice_lite/tests/test_fhir_api.py', tester, root, root));
  ok(checkWrite('sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/test_sl_observation.py', tester, root, root));
  assert.match(checkWrite('sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.py', tester, root, root), /write scope/);
  assert.match(checkWrite('sample-app/spice_lite/spice_lite/clinical/doctype/sl_observation/sl_observation.json', tester, root, root), /write scope/);
});

test('hook protocol: exit 2 with stderr on block, exit 0 otherwise, other tools ignored', () => {
  const b = runHook(['bash-allow', ...REVIEWER], { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root, agent_type: 'reviewer' });
  assert.equal(b.status, 2);
  assert.match(b.stderr, /tool-guard \[reviewer\] blocked Bash/);
  assert.equal(runHook(['bash-allow', ...REVIEWER], { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: root }).status, 0);
  assert.equal(runHook(['bash-allow', ...REVIEWER], { tool_name: 'Read', tool_input: { file_path: 'x' } }).status, 0);
  const arch = runHook(['write-scope', 'docs/adr/', '.ai-sdlc/runs/'], { tool_name: 'Write', tool_input: { file_path: 'sample-app/spice_lite/spice_lite/api/fhir.py' }, cwd: root, agent_type: 'architect' });
  assert.equal(arch.status, 2);
  assert.match(arch.stderr, /outside this agent's write scope: docs\/adr\/, .ai-sdlc\/runs\//);
});

test('fails closed on malformed input, unknown mode and unbalanced quotes', () => {
  assert.equal(runHook(['bash-allow', 'git diff'], 'not json').status, 2);
  assert.equal(runHook(['mystery'], { tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 2);
  blocked(checkBash('git log --format="%h', REVIEWER, root), /unbalanced quote/);
  assert.deepEqual(tokenize(`grep -c "RQ Job" 'a b'`), ['grep', '-c', 'RQ Job', 'a b']);
});
