# Recordings (SYNTHETIC)

Every file in `architect-v1/`, `architect-v2/`, `reviewer-v1/` and `reviewer-v2/` is a
**hand-authored synthetic recording** (`"_synthetic": true`). Each one has the shape of the JSON that
`claude -p --output-format json` prints (`result`, `num_turns`, `total_cost_usd`, `duration_ms`,
`permission_denials`, ...), and `<case>.judge.json` has the shape of a `--json-schema` judge run
(`structured_output`). They exist so that `--mode replay`, the unit tests and the committed reports run
offline without an API key. They are not model output and prove nothing about any model or prompt.

Real runs recorded with `--mode live --record <agent>-<version>-live` are written with
`"_synthetic": false`, the agent file path and its sha. Keep synthetic and real recordings in
separate folders.
