# Hinglish translation brief

Output: `content/i18n/hinglish/<module-id>.json`, one per module, overlaying `content/modules/<module-id>.json`.
Worked example (imitate its tone and shape exactly): `content/i18n/hinglish/00-example.json`.

## What Hinglish means here
- Hindi grammar and connecting words written in **Latin script**, with English technical terms kept in English. The way Indian engineers actually talk in a design review: "Subagent **bina conversation history** ke start hota hai", "Rules ko testable rakho".
- Never Devanagari. Never pure Hindi vocabulary where engineers use English (say "deploy", "test", "permission", "hook", "review", not "tainaat", "pareekshan", "anumati").
- Keep every technical term, identifier, file path, command, config key, class name, severity word (`critical`, `high`…), roster agent name, and Claude Code term exactly as in English. Keep all Markdown formatting, `code spans`, **bold**, lists, links, and line breaks.
- Tone: friendly peer, second person "tum" form ("tum likhoge", "check karo"), not "aap". Short sentences.

## Overlay format (only these fields are allowed; the build rejects others)
```json
{
  "id": "<module-id>",                       // required, unchanged
  "title": "...", "summary": "...",
  "prerequisites": ["..."],                  // same length as English; keep module ids unchanged
  "concepts": [{ "heading": "...", "body_md": "..." }],       // same order and length as English
  "diagrams": [{ "title": "..." }],          // titles only; mermaid code stays English
  "comparisonTables": [{ "title": "...", "columns": ["..."], "rows": [["..."]] }],  // same shape; keep code cells as is
  "exercises": {                             // object keyed by exercise id
    "<exercise-id>": {
      "title": "...", "objective": "...",
      "testCases": [{ "name": "...", "expected": "..." }],   // same length; omit "expected" when it is a literal command output, file content or number
      "evaluationCriteria": ["..."], "improvements": ["..."]
    }
  },
  "agentContracts": [{ "purpose": "...", "inputs": [], "outputs": [], "permissions": "...", "must": [], "mustNot": [], "failureConditions": [], "validation": "...", "handoffFormat": "...", "humanGate": "..." }],
  "checklist": ["..."]
}
```
Rules:
- Arrays must have exactly the same length and order as English (the SPA merges by index). A string you leave out falls back to English, so it's fine to omit an item only inside an object; never drop array items — copy the English string when it should stay English (e.g. a list item that is only a command).
- NEVER translate: `startingFiles`, `requiredStructure`, `implementation`, `exampleInput`, `expectedOutput`, `testCases[].input`, mermaid code, `agentContracts[].agent`, `agentContracts[].tools`. These are real files, commands and outputs.
- Test case `expected` values that are literal output (a number, a file listing, a command result, JSON) stay English: omit them.
- Valid JSON only (escape `"` and `\n` correctly). Generate with a small Python script in your scratch area if that's easier (load English JSON, write translated overlay) — do not add generators to the repo.

## Verify
`node build/build.mjs 2>&1 | grep -E "i18n/hinglish/<id>|ERROR|OK"` must show no errors or warnings for your files (the "untranslated modules fall back" warning goes away as modules land). Do not edit any file outside `content/i18n/hinglish/`. Do not git commit.
