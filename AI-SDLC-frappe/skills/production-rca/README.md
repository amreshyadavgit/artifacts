# Skill asset: production-rca

| | |
|---|---|
| Runtime location | `.claude/skills/production-rca/` (`SKILL.md`, `rca-template.md`, `scripts/build-timeline.mjs`, `examples/INC-2026-0922-lastn/` evidence pack of 9 files) |
| Version | 1.0.0 (see `CHANGELOG.md`) |
| Owner | Platform team (course role: `sre` agent maintainer) |
| Preloaded by | `sre` subagent (`skills: [performance-review, production-rca]`) |
| Invoked as | `/production-rca [evidence-dir] [incident-id]` |
| Output | An RCA in the handoff format (`agent: sre`, `status: needs-human`), 11 sections from `rca-template.md` |
| Golden cases | `tests/cases.json`: 3 deterministic, 3 live; answer key `tests/expected/INC-2026-0922-01-rca.md`; fixtures `tests/fixtures/{phi-leak,oom-variant}/` |

## The evidence pack
A synthetic Kenya country site (`ke.spice.example`) after Clinic KE-C-017's onboarding: a historical import on the `long` queue, a telephony-app deploy (red herring), and 20 ward tablets calling `lastn` with 100 subjects every 30 s. Files: nginx access log, gunicorn `web.error.log`, RQ `worker.log`, `redis-queue.txt` (LLEN samples), an Error Log export in site-local time (+03:00), the Postgres slow-query log, metrics, the change calendar and the brief. No PHI: subject lists and search terms are elided, tracebacks exported without locals.

Traps built in on purpose: gunicorn's `Perhaps out of memory?` on every SIGKILL, Error Log times three hours off unless `--offset` is given, an RQ backlog that is a symptom, a deploy whose rollback changes nothing, and an empty Error Log for the endpoint that caused it.

## Testing the skill
- Deterministic: `node --test skills/production-rca/tests/build-timeline.test.mjs` (rca-01), the clean-pack merge (rca-02), and the answer key's section check (rca-06).
- Live: the full RCA (rca-03), the OOM negative control (rca-04) and the PHI stop (rca-05).

## Change policy
- A new template section or candidate category is a minor version; re-run the live cases.
- Changing a guard rule in `build-timeline.mjs` needs a fixture that triggers it and one that must not.
