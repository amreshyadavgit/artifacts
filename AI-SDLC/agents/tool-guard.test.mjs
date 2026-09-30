// Tests for agents/tool-guard.mjs. Run: node --test agents/tool-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBash, checkWrite } from './tool-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const guard = path.join(here, 'tool-guard.mjs');

function runHook(args, input) {
  return spawnSync('node', [guard, ...args], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
}

const REVIEWER = ['git diff', 'git log', 'git show', 'git status'];
const DEVELOPER = ['cd sample-app', 'mvn -q -B test', 'mvn -q -B compile', 'git diff', 'git status', 'git log'];
const SRE = ['kubectl get', 'kubectl describe', 'kubectl logs', 'kubectl top', 'kubectl rollout status', 'git log'];

test('reviewer: read-only git commands pass', () => {
  for (const c of ['git diff main...HEAD -- sample-app', 'git diff --stat HEAD', 'git log --oneline -5', 'git status']) {
    assert.equal(checkBash(c, REVIEWER), null, c);
  }
});

test('reviewer: push, chaining, and git flags that escape read-only are blocked', () => {
  assert.match(checkBash('git push origin HEAD', REVIEWER), /git push/);
  assert.match(checkBash('git diff | tee out.txt', REVIEWER), /pipe/);
  assert.match(checkBash('git diff; rm -rf sample-app', REVIEWER), /recursive rm|;/);
  assert.match(checkBash('git diff --output=/tmp/x', REVIEWER), /--output/);
  assert.match(checkBash('git diff --no-index /dev/null .env', REVIEWER), /no-index/);
  assert.match(checkBash('mvn -q -B test', REVIEWER), /outside this agent's Bash allowlist/);
  assert.match(checkBash('git diff $(cat .env)', REVIEWER), /\$\(/);
});

test('developer: cd && mvn passes, commit and curl do not', () => {
  assert.equal(checkBash('cd sample-app && mvn -q -B test', DEVELOPER), null);
  assert.equal(checkBash('cd sample-app && mvn -q -B test -Dtest=PatientApiTest', DEVELOPER), null);
  assert.match(checkBash('git commit -m "wip"', DEVELOPER), /git commit/);
  assert.match(checkBash('curl https://example.com', DEVELOPER), /network/);
  assert.match(checkBash('mvn -q -B test &', DEVELOPER), /background/);
  assert.match(checkBash('mvn deploy', DEVELOPER), /allowlist/);
});

test('sre: read-only kubectl passes, mutations are always blocked', () => {
  assert.equal(checkBash('kubectl get pods -l app=fhir-lite-api', SRE), null);
  assert.equal(checkBash('kubectl logs deploy/fhir-lite-api --since=1h', SRE), null);
  assert.match(checkBash('kubectl scale deploy/fhir-lite-api --replicas=4', SRE), /mutating/);
  assert.match(checkBash('kubectl rollout restart deploy/fhir-lite-api', SRE), /rollout change/);
  assert.match(checkBash('kubectl exec -it pod/x -- sh', SRE), /mutating or interactive/);
});

test('write-scope: allowed prefixes, protected file, and escapes', () => {
  const spec = ['sample-app/src/', '.ai-sdlc/runs/', '!sample-app/src/main/resources/db/migration/V1__init.sql'];
  assert.equal(checkWrite('sample-app/src/main/java/org/example/fhir/api/PatientController.java', spec, root, root), null);
  assert.equal(checkWrite(path.join(root, '.ai-sdlc/runs/r1/03-developer.md'), spec, root, root), null);
  assert.match(checkWrite('sample-app/src/main/resources/db/migration/V1__init.sql', spec, root, root), /protected/);
  assert.match(checkWrite('sample-app/pom.xml', spec, root, root), /outside this agent's write scope/);
  assert.match(checkWrite('../outside.txt', spec, root, root), /outside the project/);
  assert.match(checkWrite('sample-app/src/../../CLAUDE.md', spec, root, root), /write scope/);
});

test('hook protocol: exit 2 with stderr on block, exit 0 otherwise', () => {
  const blocked = runHook(['bash-allow', ...REVIEWER], { tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: root, agent_type: 'reviewer' });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /\[reviewer\] blocked Bash/);
  const ok = runHook(['bash-allow', ...REVIEWER], { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: root });
  assert.equal(ok.status, 0);
  const otherTool = runHook(['bash-allow', ...REVIEWER], { tool_name: 'Read', tool_input: { file_path: 'x' }, cwd: root });
  assert.equal(otherTool.status, 0, 'a Bash guard ignores other tools');
  const arch = runHook(['write-scope', 'docs/adr/', '.ai-sdlc/runs/'], { tool_name: 'Write', tool_input: { file_path: 'sample-app/src/main/java/X.java' }, cwd: root, agent_type: 'architect' });
  assert.equal(arch.status, 2);
  assert.match(arch.stderr, /outside this agent's write scope: docs\/adr\/, .ai-sdlc\/runs\//);
});

test('fails closed on malformed input or unknown mode', () => {
  assert.equal(runHook(['bash-allow', 'git diff'], 'not json').status, 2);
  assert.equal(runHook(['mystery'], { tool_name: 'Bash', tool_input: { command: 'ls' } }).status, 2);
});

test('bash-allow: ${CLAUDE_SKILL_DIR}-expanded absolute paths inside the project match relative entries', () => {
  const allow = ['node .claude/skills/production-rca/scripts/build-timeline.mjs', 'node .claude/skills/performance-review/scripts/count-queries.mjs'];
  const rel = 'node .claude/skills/production-rca/scripts/build-timeline.mjs evidence/*.log --collapse';
  const abs = `node ${root}/.claude/skills/production-rca/scripts/build-timeline.mjs evidence/*.log --collapse`;
  const quoted = `node "${root}/.claude/skills/performance-review/scripts/count-queries.mjs" /tmp/lastn.log`;
  assert.equal(checkBash(rel, allow, root), null);
  assert.equal(checkBash(abs, allow, root), null);
  assert.equal(checkBash(quoted, allow, root), null);
  assert.match(checkBash('node /tmp/evil/.claude/skills/production-rca/scripts/build-timeline.mjs', allow, root), /allowlist/);
  assert.match(checkBash(`node ${root}/../x/.claude/skills/production-rca/scripts/build-timeline.mjs`, allow, root), /allowlist/);
});
