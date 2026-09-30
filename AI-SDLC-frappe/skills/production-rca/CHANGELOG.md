# Changelog: production-rca

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). SemVer: minor = new section, candidate or guard rule, patch = wording.

## [1.0.0] - 2026-09-30
### Added
- `SKILL.md` (guard first, read-only, analysis order, Frappe reasoning rules for gunicorn, RQ and Error Log), `rca-template.md` (11 sections incl. background jobs, clinical safety and PHI exposure).
- `scripts/build-timeline.mjs`: ISO, nginx, space-separated, zone-less and time-only timestamps; `--date` and per-file `--offset`; warnings for zone-less input; PHI and secret guard (exit 3, prints file:line and rule only); `--collapse` that keeps distinct counter samples.
- Evidence pack `examples/INC-2026-0922-lastn/` (9 files), fixtures `phi-leak` and `oom-variant`, golden cases rca-01 to rca-06, answer key.
### Verified (2026-09-30, Node 22)
- `node --test skills/production-rca/tests/build-timeline.test.mjs`: 7 pass. The pack merges into 128 events (125 collapsed) with exit 0; the phi-leak fixture exits 3 without printing the surname.
- Numbers in the pack are consistent with the measured cost of `lastn` on test.localhost (2 statements per subject) and with bench 5.31's supervisor template (9 sync workers, `-t 120`) and gunicorn 23.0.0's timeout and SIGKILL messages.
### Not yet verified
- Live cases rca-03 to rca-05 need a model run. Record the first pass rate here.
