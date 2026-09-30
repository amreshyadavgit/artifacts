// Tests for agents/check-agents.mjs. Run: node --test agents/check-agents.test.mjs
// Each test copies the real roster into a temp project root, breaks one thing, and checks
// that the checker reports exactly that problem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAll, parseFrontmatter, toList } from './check-agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..');
const ROSTER6 = ['architect', 'developer', 'reviewer', 'tester', 'security', 'sre'];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'check-agents-'));
  for (const n of ROSTER6) {
    cpSync(path.join(realRoot, '.claude/agents', `${n}.md`), path.join(root, '.claude/agents', `${n}.md`));
    cpSync(path.join(realRoot, 'agents', n, 'CONTRACT.md'), path.join(root, 'agents', n, 'CONTRACT.md'));
  }
  cpSync(path.join(realRoot, 'agents/tool-guard.mjs'), path.join(root, 'agents/tool-guard.mjs'));
  return root;
}
const edit = (root, rel, fn) => writeFileSync(path.join(root, rel), fn(readFileSync(path.join(root, rel), 'utf8')));
const errorsOf = (root, name) => checkAll(root).results.find((r) => r.name === name)?.errors ?? [];

test('the shipped roster passes', () => {
  const { results, missing } = checkAll(realRoot);
  assert.deepEqual(missing, []);
  for (const r of results.filter((x) => ROSTER6.includes(x.name))) assert.deepEqual(r.errors, [], r.name);
});

test('frontmatter parser handles lists, nested hooks and Agent(...) specifiers', () => {
  const { data } = parseFrontmatter(readFileSync(path.join(realRoot, '.claude/agents/tester.md'), 'utf8'));
  assert.deepEqual(data.skills, ['test-strategy', 'run-tests']);
  assert.deepEqual(data.hooks.topKeys, ['PreToolUse']);
  assert.deepEqual(toList('Agent(architect, developer), Read'), ['Agent(architect, developer)', 'Read']);
});

test('skill-style key allowed-tools is rejected with a hint', () => {
  const root = fixture();
  edit(root, '.claude/agents/reviewer.md', (s) => s.replace('tools: Read, Grep, Glob, Bash\n', 'tools: Read, Grep, Glob, Bash\nallowed-tools: Read\n'));
  assert.ok(errorsOf(root, 'reviewer').some((e) => /"allowed-tools".*subagents use `tools`/.test(e)));
  rmSync(root, { recursive: true });
});

test('Agent in a roster agent tools list is rejected', () => {
  const root = fixture();
  edit(root, '.claude/agents/reviewer.md', (s) => s.replace('tools: Read, Grep, Glob, Bash\n', 'tools: Read, Grep, Glob, Bash, Agent\n'));
  assert.ok(errorsOf(root, 'reviewer').some((e) => /must not list Agent/.test(e)));
  rmSync(root, { recursive: true });
});

test('disallowedTools with a specifier is rejected (it removes the whole tool)', () => {
  const root = fixture();
  edit(root, '.claude/agents/developer.md', (s) => s.replace(/disallowedTools: .*\n/, 'disallowedTools: Agent, Bash(git push *)\n'));
  assert.ok(errorsOf(root, 'developer').some((e) => /removes the WHOLE Bash tool/.test(e)));
  rmSync(root, { recursive: true });
});

test('memory on a read-only agent is rejected', () => {
  const root = fixture();
  edit(root, '.claude/agents/security.md', (s) => s.replace('color: red\n', 'color: red\nmemory: project\n'));
  assert.ok(errorsOf(root, 'security').some((e) => /memory auto-enables/.test(e)));
  rmSync(root, { recursive: true });
});

test('tools drift between agent file and CONTRACT.md is reported both ways', () => {
  const root = fixture();
  edit(root, '.claude/agents/security.md', (s) => s.replace('tools: Read, Grep, Glob\n', 'tools: Read, Grep, Glob, WebFetch\n').replace(/disallowedTools: .*\n/, 'disallowedTools: Agent\n'));
  edit(root, 'agents/security/CONTRACT.md', (s) => s.replace('- Glob\n', '- Glob\n- Bash (git log only)\n'));
  const errs = errorsOf(root, 'security');
  assert.ok(errs.some((e) => /in agent file but not in CONTRACT.md: WebFetch/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => /in CONTRACT.md but not in agent file: Bash/.test(e)), errs.join('\n'));
  rmSync(root, { recursive: true });
});

test('name mismatch, unknown skill, bad enum values and missing agent are reported', () => {
  const root = fixture();
  edit(root, '.claude/agents/tester.md', (s) => s.replace('name: tester', 'name: qa').replace('  - run-tests\n', '  - run-tests\n  - write-everything\n').replace('model: sonnet', 'model: gpt-4o').replace('effort: medium', 'effort: extreme'));
  const r = checkAll(root);
  const errs = r.results.find((x) => x.file.endsWith('tester.md')).errors;
  assert.ok(errs.some((e) => /does not match file name/.test(e)));
  assert.ok(errs.some((e) => /not in the roster/.test(e)));
  assert.ok(errs.some((e) => /skill "write-everything" does not exist/.test(e)));
  assert.ok(errs.some((e) => /model "gpt-4o"/.test(e)));
  assert.ok(errs.some((e) => /effort "extreme"/.test(e)));
  assert.deepEqual(r.missing, ['tester']);
  rmSync(root, { recursive: true });
});

test('a hook on a non-existent event is rejected', () => {
  const root = fixture();
  edit(root, '.claude/agents/reviewer.md', (s) => s.replace('  PreToolUse:\n', '  BeforeBash:\n'));
  assert.ok(errorsOf(root, 'reviewer').some((e) => /hook event "BeforeBash" does not exist/.test(e)));
  rmSync(root, { recursive: true });
});
