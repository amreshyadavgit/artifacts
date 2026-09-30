
## R3 Completeness

Scope: schema validity, nine exercise fields, referenced files, placeholders, test suites, skill-library completeness. Scanners lived in the R3 scratch area (not in the repo).

### Fixes

| file | problem | fix |
|---|---|---|
| `build/sources/03-skills-architecture-code-test.py` | `03-architecture-review-adr` expectedOutput showed an elided command `validate-adr.mjs ... --case ...#ar-01-...` | Replaced with the full command (`docs/adr/0002-paginate-patient-search.md --repo . --status proposed --case skills/architecture-review/tests/cases.json#ar-01-patient-search-pagination`) |
| same | `03-test-strategy-lastn` expectedOutput `--case ...#ts-01-lastn-endpoint`; test case "Reference plan is valid" expected `OK  18 cases ... {...}` | Full `--case skills/test-strategy/tests/cases.json#ts-01-lastn-endpoint`; expected replaced with the real validator line (byCategory + byStatus + findings=6), checked by running it |
| same | `03-code-review-diff` expectedOutput and "False-positive control" test input used `--case ...#cr-0N` | Full `validate-findings.mjs /tmp/review.md --repo . --case skills/code-review/tests/cases.json#cr-0N-...` |
| `AI-SDLC/skills/{explain-endpoint,run-tests,ticket-intake,feature,bug-fix,incident,requirements,implementation-plan}/` (new) | Runtime-only skills had no library entry (8 validator warnings) | Added README.md (owner, version 1.0.0, consumers, purpose, files, how tested, limitations), CHANGELOG.md (`## 1.0.0 - 2026-09-30`) and `tests/cases.json` (4 cases each; every `deterministic` case run here and its expectation matches real output, including the rt-04 regression patch against SecurityTest). Validator now: 14 runtime skills, 14 library entries, 0 errors, 0 warnings |
| `AI-SDLC/skills/README.md` | Index said "runtime only" for those 8 and described them as validator warnings | Library entry column now `skills/<name>/`; sentence rewritten |
| `build/sources/10-governance.py` | `10-skill-library` expectedOutput said `run-tests@unreleased` and listed two project-relative-path WARN lines the packager no longer prints (skills now use `${CLAUDE_SKILL_DIR}`); test case "Real library has no errors" expected warnings; improvement asked to do the already-done `${CLAUDE_SKILL_DIR}` rewrite | Matched real `package-plugin.mjs` output (`run-tests@1.0.0`, only the reviewer agent WARN); expectation now 0 warnings; improvement replaced with "run package-plugin in CI" |
| `content/modules/*.json` | 21 stale embeds after parallel R1/R2 edits | Re-ran every `build/sources/*.py` generator; `node build/build.mjs` OK |

Checked and left as is: empty `startingFiles` in 17 exercises all start from the current repo state ("write X"); numeric-only test expectations (`3`, `11`, `0`) are exact command outputs; remaining `...` in expectedOutput are code elisions inside real output excerpts (`badRequest(...)`, `select ... from`), not placeholders. No TODO/TBD/FIXME/lorem outside templates (`todo` in `validate-test-plan.test.mjs` is a deliberate invalid status fixture). Missing-path scan: every unresolved path is learner-created (e.g. `docs/adr/0002-paginate-patient-search.md`, `docs/capstone/gate-log.md`, `scripts/capstone/terms.claims.json`), a test fixture, a generic placeholder (`X.java`, `NAME`), skill-relative (`scripts/validate-adr.mjs` under `.claude/skills/<name>/`), an external repo (`docs/remote-server.md` in github-mcp-server) or a run output; `SecurityConfig.ja` in `evaluations/reports/*` is the harness's own 120-char truncation of recorded tool input.

Note for R1: `.claude/agents/security.md` body output template uses `- phi-exposure: ...` style fill-ins (lines 60-64). Acceptable as a template, flagging only in case you want concrete alternatives like the `authn-authz` line.
Note: `run-evals.mjs --mode replay` rewrites `evaluations/reports/replay-v{1,2}.*` and `v1-vs-v2.json`; after today's context edits the context fingerprints changed (`0a3b68273da0` -> `5bc3744c1c6e` architect, `d9a161896054` -> `e0c7991ab4b1` reviewer) and one severity text changed (`high|critical` -> `high`). Metrics unchanged. Re-run it after the last context edit so the committed reports match.

### Test suites (run 2026-09-30)

| suite | result |
|---|---|
| `node build/build.mjs --strict` | 0 errors; exits non-zero only on the expected i18n fallback warning. `node build/build.mjs`: OK |
| 21 `*.test.mjs` files (`node --test`, each) | all pass: block-secrets 5/5, check-handoff 25/25, flag-injection 9/9, guard-outbound 11/11, validate-adr 8, validate-findings 8, summarize-surefire 6, validate-test-plan 9, check-agents 9, tool-guard 8, foundations 14, reviewer-bash-guard 6, harness 15, automation 14, stack-inventory 9/9, verify-system.test 22/22, check-agent-policy 8/8, check-ai-change-approval 10/10, cost-report 6/6, validate-skill-library 10/10, composition 11/11 |
| `node evaluations/harness/run-evals.mjs --mode replay` | PASS: architect-v2 18/20 gates PASS; reviewer-v2 7/8 gates PASS |
| `node scripts/capstone/verify-system.mjs` | 38 pass, 0 warn, 0 fail -> WIRED (sre guard fix by R1 in place) |
| `node scripts/governance/validate-skill-library.mjs` | 0 errors, 0 warnings (was 8 warnings) |
| `node mcp/fhir-readonly-server/test-client.mjs` | 23/23 checks passed |
| `cd sample-app && mvn -q -B test` | exit 0, 25 tests, 0 failures; `target/` deleted |
