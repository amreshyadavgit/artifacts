// Pure scoring functions for the AI-SDLC eval harness (zero dependencies, Node 22).
// Everything here is deterministic: same inputs, same scores. run-evals.mjs does the I/O.

export const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const SEV_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, SEVERITIES.length - i])); // critical=5 ... info=1
export const STATUSES = ["complete", "blocked", "needs-human"];
export const FINDING_COLUMNS = ["id", "severity", "category", "location", "evidence", "recommendation"];

// Keys the `--agents` JSON accepts (build/CLAUDE_CODE_FACTS.md section 1). `color` and `experimental`
// are ignored there, so they are dropped with a note.
const AGENTS_JSON_KEYS = ["description", "tools", "disallowedTools", "model", "permissionMode", "mcpServers",
  "hooks", "maxTurns", "skills", "initialPrompt", "memory", "effort", "background", "omitClaudeMd", "isolation"];
const LIST_KEYS = new Set(["tools", "disallowedTools", "skills", "mcpServers"]);

// ---------------------------------------------------------------------------------------------
// Frontmatter (subset of YAML: scalars, inline [a, b] lists, block "- item" lists). Nested maps
// (hooks, inline mcpServers definitions) are reported as unsupported instead of being guessed.
// ---------------------------------------------------------------------------------------------
function scalar(raw) {
  const v = raw.trim();
  if (v === "") return "";
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (/^(true|yes|on)$/i.test(v)) return true;
  if (/^(false|no|off)$/i.test(v)) return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map((s) => scalar(s)).filter((s) => s !== "");
  return v;
}

export function parseFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: null, body: text, unsupported: [] };
  const data = {};
  const unsupported = [];
  let current = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && current) {
      if (!Array.isArray(data[current])) data[current] = [];
      if (/^[\w-]+:\s/.test(item[1])) { unsupported.push(current); continue; }
      data[current].push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      current = kv[1];
      data[current] = kv[2].trim() === "" ? [] : scalar(kv[2]);
      continue;
    }
    if (/^\s+\S/.test(line) && current) { unsupported.push(current); continue; }
  }
  return { data, body: text.slice(m[0].length), unsupported: [...new Set(unsupported)] };
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [String(v)];
}

/** Agent markdown file -> { name, definition, notes } for the `--agents` CLI flag. */
export function agentDefinitionFromMarkdown(text) {
  const { data, body, unsupported } = parseFrontmatter(text);
  if (!data) throw new Error("agent file has no YAML frontmatter");
  if (!data.name || !data.description) throw new Error("agent frontmatter needs name and description");
  const definition = { description: String(data.description), prompt: body.trim() };
  const notes = [];
  for (const key of AGENTS_JSON_KEYS) {
    if (!(key in data)) continue;
    if (unsupported.includes(key)) { notes.push(`${key}: nested YAML not supported by this parser, omitted`); continue; }
    if (key === "description") continue;
    definition[key] = LIST_KEYS.has(key) ? toList(data[key]) : data[key];
  }
  for (const key of Object.keys(data)) {
    if (key === "name" || key === "description" || AGENTS_JSON_KEYS.includes(key)) continue;
    notes.push(`${key}: not accepted by --agents, omitted`);
  }
  return { name: String(data.name), definition, notes };
}

// ---------------------------------------------------------------------------------------------
// Handoff parsing
// ---------------------------------------------------------------------------------------------
export function parseHandoff(text) {
  let t = (text ?? "").trim();
  const fence = /^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/.exec(t);
  if (fence) t = fence[1].trim();
  const fm = parseFrontmatter(t);
  const sections = {};
  const re = /^##\s+(.+?)\s*$/gm;
  const heads = [...fm.body.matchAll(re)];
  heads.forEach((h, i) => {
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : fm.body.length;
    sections[h[1].trim().toLowerCase()] = fm.body.slice(start, end).trim();
  });
  return { frontmatter: fm.data, sections, findings: parseFindingsTable(sections["findings"] ?? ""), text: t, body: fm.body };
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}

export function parseFindingsTable(sectionText) {
  const lines = sectionText.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { hasTable: false, rows: [] };
  const header = cells(lines[0]).map((c) => c.toLowerCase().replace(/[`*]/g, ""));
  const hasTable = FINDING_COLUMNS.every((c, i) => header[i] === c);
  if (!hasTable) return { hasTable: false, rows: [] };
  const rows = lines.slice(2).map((l) => {
    const c = cells(l);
    const row = Object.fromEntries(FINDING_COLUMNS.map((k, i) => [k, (c[i] ?? "").replace(/`/g, "")]));
    row.severity = row.severity.toLowerCase();
    row.raw = l;
    return row;
  });
  return { hasTable, rows };
}

// ---------------------------------------------------------------------------------------------
// Keyword and claim matching
// ---------------------------------------------------------------------------------------------
const rx = (p) => new RegExp(p, "i");
export const matchesAny = (text, alternatives) => alternatives.some((p) => rx(p).test(text));
export const matchesAll = (text, groups) => groups.every((g) => matchesAny(text, g));

const NEGATION = /\b(not|no|never|without|instead of|rather than|avoid|avoids|nor|none)\b|n't\b|\bdo(es)? not\b/i;
export function sentences(text) {
  return text.split(/(?<=[.!?])\s+|\r?\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * A forbidden claim fires when one of its patterns matches a sentence that is not negated.
 * Negated means a negation cue ("not", "no", "never", "instead of", ...) appears in the sentence
 * outside the matched text, or inside it when the pattern itself contains no negation
 * ("Spring Batch is not on the classpath" is negated; a pattern "is not thread-safe" is not).
 * This is a heuristic: it keeps "we do not use HAPI FHIR" from counting as a hallucination.
 */
export function isNegated(sentence, pattern) {
  const m = rx(pattern).exec(sentence);
  if (!m) return false;
  const outside = sentence.slice(0, m.index) + " " + sentence.slice(m.index + m[0].length);
  return NEGATION.test(outside) || (NEGATION.test(m[0]) && !NEGATION.test(pattern.replace(/\\[a-z]/gi, " ")));
}

export function findForbidden(text, claims) {
  const hits = [];
  const negated = [];
  const sents = sentences(text);
  for (const claim of claims) {
    for (const s of sents) {
      const p = claim.patterns.find((q) => rx(q).test(s));
      if (!p) continue;
      (isNegated(s, p) ? negated : hits).push({ id: claim.id, claim: claim.claim, sentence: s.slice(0, 240) });
    }
  }
  const dedupe = (list) => list.filter((h, i) => list.findIndex((o) => o.id === h.id && o.sentence === h.sentence) === i);
  return { hits: dedupe(hits), negated: dedupe(negated) };
}

// ---------------------------------------------------------------------------------------------
// Case scoring
// ---------------------------------------------------------------------------------------------
function rowsFor(finding, rows) {
  const full = rows.filter((r) => matchesAll(r.raw, finding.match));
  return full.length ? full : rows.filter((r) => matchesAny(r.raw, finding.match[0]));
}

/**
 * Score one recorded (or live) `claude -p --output-format json` result against a golden case.
 * @param {object} c       golden case (defaults already merged)
 * @param {object} out     parsed CLI JSON: result, is_error, subtype, num_turns, total_cost_usd, duration_ms, permission_denials
 * @param {object} suite   { requiredSections, globalForbiddenClaims }
 */
export function scoreCase(c, out, suite) {
  const assertions = [];
  const add = (name, pass, detail = "") => assertions.push({ name, pass: Boolean(pass), detail });
  const h = parseHandoff(typeof out.result === "string" ? out.result : "");
  const text = h.body; // front matter is excluded: its `inputs:` list would match keywords for free
  const rows = h.findings.rows;

  add("run succeeded", !out.is_error && (out.subtype ?? "success") === "success", `subtype=${out.subtype ?? "success"} is_error=${Boolean(out.is_error)}`);

  // Format checks
  const fm = h.frontmatter;
  add("format: handoff front matter", fm && fm.run_id && fm.agent && fm.status, fm ? `keys=${Object.keys(fm).join(",")}` : "no front matter");
  const missingSections = (suite.requiredSections ?? []).filter((s) => !(s.toLowerCase() in h.sections));
  add("format: required sections", missingSections.length === 0, missingSections.length ? `missing: ${missingSections.join(", ")}` : "");
  const saysNoFindings = /\bno findings\b/i.test(h.sections["findings"] ?? "");
  add("format: findings table", h.findings.hasTable || saysNoFindings, h.findings.hasTable ? `${rows.length} rows` : saysNoFindings ? "explicit no findings" : "no canonical table");
  const badSev = rows.filter((r) => !SEVERITIES.includes(r.severity));
  add("format: severity scale", badSev.length === 0, badSev.map((r) => `${r.id}:${r.severity}`).join(" "));

  // Status
  const status = fm?.status;
  add("status matches expectation", c.expectedStatus.includes(status), `got ${status ?? "none"}, expected ${c.expectedStatus.join("|")}`);

  // Verdict line (reviewer): BLOCK on any critical/high, NEEDS-DECISION on medium, else APPROVE
  const verdict = /Verdict:\s*\**\s*(BLOCK|NEEDS-DECISION|APPROVE)\b/.exec(h.sections["summary"] ?? "");
  if (suite.verdictRule && verdict) {
    const worst = Math.max(0, ...rows.map((r) => SEV_RANK[r.severity] ?? 0));
    const want = worst >= SEV_RANK.high ? "BLOCK" : worst === SEV_RANK.medium ? "NEEDS-DECISION" : "APPROVE";
    add("format: verdict consistent with findings", verdict[1] === want, `verdict ${verdict[1]}, findings imply ${want}`);
  }

  // Must-mention (recall)
  const coverage = c.expectedFindings.map((f) => ({ id: f.id, concept: f.concept, covered: matchesAll(text, f.match) }));
  const covered = coverage.filter((x) => x.covered).length;
  const recall = c.expectedFindings.length ? covered / c.expectedFindings.length : 1;
  const missed = coverage.filter((x) => !x.covered);
  add(`must-mention: recall >= ${c.minRecall}`, recall >= c.minRecall, missed.length ? `missed ${missed.map((m) => `${m.id} (${m.concept})`).join("; ")}` : "all covered");

  // Must-not-mention (hallucination traps)
  const claims = [...(suite.globalForbiddenClaims ?? []), ...(c.forbiddenClaims ?? [])];
  const forbidden = findForbidden(text, claims);
  add("must-not-mention: no forbidden claims", forbidden.hits.length === 0, forbidden.hits.map((x) => `${x.id}: "${x.sentence}"`).join(" | "));

  // Severity expectations
  const severity = [];
  for (const f of c.expectedFindings) {
    if (!f.severity) continue;
    const cand = rowsFor(f, rows);
    if (!cand.length) continue; // concept not in the table: recall already covers it
    const got = cand[0].severity;
    if (!f.severity.includes(got)) severity.push(`${f.id}: ${cand[0].id} is ${got}, expected ${f.severity.join("|")}`);
  }
  if (c.maxSeverity) {
    for (const r of rows) {
      if ((SEV_RANK[r.severity] ?? 0) > SEV_RANK[c.maxSeverity]) severity.push(`${r.id} is ${r.severity}, case max is ${c.maxSeverity}`);
    }
  }
  add("severity expectations", severity.length === 0, severity.join("; "));

  // Precision: table rows that correspond to an expected finding
  const matchedRows = rows.filter((r) => c.expectedFindings.some((f) => matchesAny(r.raw, f.match[0]))).length;
  const precision = rows.length ? matchedRows / rows.length : null;

  // Tool use and permissions
  const denials = Array.isArray(out.permission_denials) ? out.permission_denials : [];
  add("permissions: no permission_denials", denials.length === 0, denials.map((d) => `${d.tool_name}(${JSON.stringify(d.tool_input ?? {}).slice(0, 80)})`).join("; "));

  // Budgets
  add(`budget: turns <= ${c.budget.maxTurns}`, (out.num_turns ?? 0) <= c.budget.maxTurns, `num_turns=${out.num_turns}`);
  add(`budget: cost <= $${c.budget.maxCostUsd.toFixed(2)}`, (out.total_cost_usd ?? 0) <= c.budget.maxCostUsd, `total_cost_usd=${(out.total_cost_usd ?? 0).toFixed(4)}`);

  return {
    id: c.id,
    title: c.title,
    critical: Boolean(c.critical),
    evalTypes: c.evalTypes ?? [],
    pass: assertions.every((a) => a.pass),
    assertions,
    metrics: {
      expected: c.expectedFindings.length,
      covered,
      recall,
      rows: rows.length,
      matchedRows,
      precision,
      hallucinations: forbidden.hits.length,
      negatedMentions: forbidden.negated.length,
      severityMismatches: severity.length,
      toolViolations: denials.length,
      turns: out.num_turns ?? 0,
      costUsd: out.total_cost_usd ?? 0,
      durationMs: out.duration_ms ?? 0,
    },
    coverage,
    forbiddenHits: forbidden.hits,
    status: status ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Aggregation, gates, comparison
// ---------------------------------------------------------------------------------------------
function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function aggregate(results, judges = []) {
  const n = results.length;
  const sum = (f) => results.reduce((a, r) => a + f(r), 0);
  const rows = sum((r) => r.metrics.rows);
  const m = {
    cases: n,
    passed: results.filter((r) => r.pass).length,
    passRate: round(n ? results.filter((r) => r.pass).length / n : 0),
    recall: round(sum((r) => r.metrics.expected) ? sum((r) => r.metrics.covered) / sum((r) => r.metrics.expected) : 1),
    precision: round(rows ? sum((r) => r.metrics.matchedRows) / rows : 1),
    hallucinationRate: round(n ? results.filter((r) => r.metrics.hallucinations > 0).length / n : 0),
    hallucinations: sum((r) => r.metrics.hallucinations),
    severityMismatches: sum((r) => r.metrics.severityMismatches),
    toolViolations: sum((r) => r.metrics.toolViolations),
    formatFailures: results.filter((r) => r.assertions.some((a) => a.name.startsWith("format:") && !a.pass)).length,
    criticalFailures: results.filter((r) => r.critical && !r.pass).map((r) => r.id),
    totalCostUsd: round(sum((r) => r.metrics.costUsd), 4),
    meanCostUsd: round(n ? sum((r) => r.metrics.costUsd) / n : 0, 4),
    meanTurns: round(n ? sum((r) => r.metrics.turns) / n : 0, 2),
    p50LatencyMs: percentile(results.map((r) => r.metrics.durationMs), 50),
    p95LatencyMs: percentile(results.map((r) => r.metrics.durationMs), 95),
  };
  const scored = judges.filter((j) => j && j.scores);
  if (scored.length) {
    const dims = Object.keys(scored[0].scores);
    m.judge = {
      cases: scored.length,
      meanScores: Object.fromEntries(dims.map((d) => [d, round(scored.reduce((a, j) => a + j.scores[d], 0) / scored.length, 2)])),
      meanOverall: round(scored.reduce((a, j) => a + Object.values(j.scores).reduce((x, y) => x + y, 0) / dims.length, 0) / scored.length, 2),
      passRate: round(scored.filter((j) => j.verdict === "pass").length / scored.length),
      agreementWithScripted: round(scored.filter((j) => (j.verdict === "pass") === results.find((r) => r.id === j.caseId)?.pass).length / scored.length),
    };
  }
  return m;
}

export function checkGates(m, gates) {
  const g = [];
  const add = (name, pass, actual) => g.push({ name, pass, actual });
  if (gates.minPassRate != null) add(`pass rate >= ${gates.minPassRate}`, m.passRate >= gates.minPassRate, m.passRate);
  if (gates.minRecall != null) add(`recall >= ${gates.minRecall}`, m.recall >= gates.minRecall, m.recall);
  if (gates.minPrecision != null) add(`precision >= ${gates.minPrecision}`, m.precision >= gates.minPrecision, m.precision);
  if (gates.maxHallucinationRate != null) add(`hallucination rate <= ${gates.maxHallucinationRate}`, m.hallucinationRate <= gates.maxHallucinationRate, m.hallucinationRate);
  if (gates.maxToolViolations != null) add(`tool violations <= ${gates.maxToolViolations}`, m.toolViolations <= gates.maxToolViolations, m.toolViolations);
  if (gates.criticalCasesMustPass) add("critical cases pass", m.criticalFailures.length === 0, m.criticalFailures.join(",") || "none failed");
  return { pass: g.every((x) => x.pass), gates: g };
}

/** Per-case diff between a baseline run (a) and a candidate run (b) of the same suite. */
export function compareRuns(a, b) {
  const byId = new Map(a.results.map((r) => [r.id, r]));
  const cases = b.results.map((rb) => {
    const ra = byId.get(rb.id);
    let change = "unchanged";
    if (ra && !ra.pass && rb.pass) change = "fixed";
    else if (ra && ra.pass && !rb.pass) change = "regressed";
    else if (ra && rb.metrics.recall > ra.metrics.recall) change = "improved";
    else if (ra && rb.metrics.recall < ra.metrics.recall) change = "worse";
    const failing = (r) => (r ? r.assertions.filter((x) => !x.pass).map((x) => `${x.name}${x.detail ? ` (${x.detail})` : ""}`) : []);
    return {
      id: rb.id, title: rb.title, critical: rb.critical, change,
      a: ra ? { pass: ra.pass, recall: ra.metrics.recall, hallucinations: ra.metrics.hallucinations, turns: ra.metrics.turns, costUsd: ra.metrics.costUsd } : null,
      b: { pass: rb.pass, recall: rb.metrics.recall, hallucinations: rb.metrics.hallucinations, turns: rb.metrics.turns, costUsd: rb.metrics.costUsd },
      failingA: failing(ra), failingB: failing(rb),
      judgeB: rb.judge ? { verdict: rb.judge.verdict, scores: rb.judge.scores } : null,
    };
  });
  const metricKeys = ["passRate", "recall", "precision", "hallucinationRate", "severityMismatches", "toolViolations", "formatFailures", "meanCostUsd", "meanTurns", "p95LatencyMs"];
  const deltas = Object.fromEntries(metricKeys.map((k) => [k, { a: a.metrics[k], b: b.metrics[k], delta: round(b.metrics[k] - a.metrics[k], 4) }]));
  if (a.metrics.judge && b.metrics.judge) {
    for (const [k, src] of [["judgeMeanScore", "meanOverall"], ["judgePassRate", "passRate"], ["judgeAgreement", "agreementWithScripted"]]) {
      deltas[k] = { a: a.metrics.judge[src], b: b.metrics.judge[src], delta: round(b.metrics.judge[src] - a.metrics.judge[src], 4) };
    }
  }
  const regressed = cases.filter((c) => c.change === "regressed");
  let verdict = "promote";
  if (!b.gates.pass || regressed.some((c) => c.critical)) verdict = "block";
  else if (regressed.length) verdict = "review";
  return { verdict, deltas, cases, regressed: regressed.map((c) => c.id), fixed: cases.filter((c) => c.change === "fixed").map((c) => c.id) };
}
