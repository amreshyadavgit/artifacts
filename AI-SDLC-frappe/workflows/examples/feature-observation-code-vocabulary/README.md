# Example run: OBS-51, a controlled vocabulary for Observation codes

A complete `/feature` run folder for `spice_lite`, as the orchestrator leaves it in `.ai-sdlc/runs/2026-09-30-feat-observation-code-vocabulary/`. It is the reference for exercise 08-feature-workflow and for the `check-handoff.mjs` tests.

The change is a typical Frappe feature with every surface in one diff: a new DocType (`SL Observation Code`: JSON, controller, tests), a changed DocType (`SL Observation.code` from `Data` to `Link`, `code_display` with `fetch_from`), a controller rule, a shipped fixture file plus a `fixtures` key in `hooks.py`, and an idempotent `[post_model_sync]` patch.

| file | step | what it shows |
|---|---|---|
| `01-requirements.md` | orchestrator, `requirements` skill | ACs as exact calls and permission checks, migration as a non-functional requirement |
| `02-architect.md` | architect | core vs country app; fixtures are force-imported on every migrate; `Data` to `Link` needs no DDL but needs a backfill patch |
| `03-implementation-plan.md` | orchestrator, `implementation-plan` skill | one row per Frappe surface, security scope YES, G1 request |
| `04-developer.md` | developer | the first implementation; quotes the real migrate and `Ran 53 tests ... OK` |
| `security-scope.txt` | SubagentStop Claude Code hook | `SECURITY STEP: MANDATORY (rules 1, 3, 4, 5)` computed from the developer's diff |
| `05-tester.md` | tester (parallel with 06) | two real failures: a non-idempotent patch and a Clinician DocPerm row with create/write |
| `06-security.md` | security (parallel with 05) | the same DocPerm row from the security side (SEC-1 high) |
| `07-developer.md` | developer rework after G2 | both fixes; `Ran 56 tests ... OK` |
| `08-reviewer.md` | reviewer | Python, DocType JSON, `patches.txt`, `hooks.py` and fixture reviewed together; APPROVE with low findings |
| `09-run-report.md` | orchestrator | step table, gates, human actions (PR, migrate per country site) |
| `patches/04-developer.patch`, `05-tester.patch`, `07-developer.patch` | | the exact diffs of the three code-changing steps |
| `evidence/*.txt` | | the bench output each handoff quotes (the D-2 stack trace that frappe prints during the suite is replaced by one marker line) |

## How the outputs were produced (real, not invented)

On 2026-09-30, in the course build container (Frappe 15.121.2, PostgreSQL 16), each code-changing step was applied to `sample-app/spice_lite` with `patch -p1`, tested, and reverted in one locked shell session. Because the change adds a DocType, the migrate and tests ran on a throwaway site `f7.localhost` created on the same bench, so the shared `test.localhost` never carried the new table. In your own run the developer uses `bench --site test.localhost migrate` behind the G1b prompt, or a scratch site you provide.

## Reproduce

```bash
cd AI-SDLC-frappe
node .claude/hooks/check-handoff.mjs workflows/examples/feature-observation-code-vocabulary      # 9 x PASS
node workflows/composition/security-scope.mjs workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch

# On a bench of your own (as the bench user), on a scratch site:
bench new-site obs51.localhost --db-type postgres --db-host 127.0.0.1 --db-root-username postgres \
  --db-root-password postgres --admin-password admin --install-app spice_lite
bench --site obs51.localhost set-config allow_tests true
patch -p1 < workflows/examples/feature-observation-code-vocabulary/patches/04-developer.patch   # from AI-SDLC-frappe/
bench --site obs51.localhost migrate && bench --site obs51.localhost run-tests --app spice_lite  # Ran 53 tests, OK
patch -p1 < workflows/examples/feature-observation-code-vocabulary/patches/05-tester.patch
bench --site obs51.localhost run-tests --app spice_lite                                          # FAILED (failures=1, errors=1)
patch -p1 < workflows/examples/feature-observation-code-vocabulary/patches/07-developer.patch
bench --site obs51.localhost migrate && bench --site obs51.localhost run-tests --app spice_lite  # Ran 56 tests, OK
# revert: apply the three patches with -R in reverse order (07, 05, 04), then drop the scratch site
```

`bench run-tests` printed `FAILED` for step 05 and still exited 0: without the `CI` environment variable it does not set a failing exit code (`frappe/commands/utils.py`). That is why `check-handoff.mjs` requires the quoted `Ran N tests` / `OK` lines in a `complete` developer or tester handoff.
