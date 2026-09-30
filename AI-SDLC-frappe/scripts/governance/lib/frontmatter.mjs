// Minimal YAML front matter reader for agent and skill Markdown files (zero dependencies).
// Supports what Claude Code agent/skill files use at the top level: `key: scalar`, quoted
// scalars, inline lists `[a, b]`, block lists (`key:` followed by `  - item`), and folded
// or literal blocks (`key: >` / `key: |`). Nested maps such as `hooks:` are kept as raw text.

export function splitFrontmatter(text) {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!src.startsWith("---\n")) return { frontmatter: null, body: src, raw: "" };
  const end = src.indexOf("\n---", 4);
  if (end < 0) return { frontmatter: null, body: src, raw: "", error: "unterminated front matter" };
  const raw = src.slice(4, end);
  const after = src.indexOf("\n", end + 4);
  const body = after < 0 ? "" : src.slice(after + 1);
  return { frontmatter: parse(raw), body, raw };
}

function unquote(v) {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function scalar(v) {
  const t = unquote(v);
  if (/^\[.*\]$/.test(v.trim())) {
    return v.trim().slice(1, -1).split(",").map((s) => unquote(s)).filter(Boolean);
  }
  if (/^(true|yes|on)$/i.test(t) && t === v.trim()) return true;
  if (/^(false|no|off)$/i.test(t) && t === v.trim()) return false;
  if (/^-?\d+$/.test(t) && t === v.trim()) return Number(t);
  return t;
}

export function parse(raw) {
  const out = {};
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const [, key, rest = ""] = m;
    const value = rest.replace(/\s+#.*$/, "");
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      out[key] = value.startsWith(">") ? block.join(" ").trim() : block.join("\n").trim();
    } else if (value === "") {
      const items = [];
      const nested = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) {
        const l = lines[++i];
        nested.push(l);
        const li = /^\s+-\s+(.*)$/.exec(l);
        if (li && /^\s{0,4}-/.test(l)) items.push(scalar(li[1]));
      }
      const isList = nested.filter((l) => l.trim()).every((l) => /^\s{0,4}-\s/.test(l) || /^\s{4,}/.test(l)) && items.length;
      out[key] = isList ? items : nested.join("\n");
    } else {
      out[key] = scalar(value);
    }
  }
  return out;
}

// "Read, Grep, Bash(git diff *)" or a YAML list -> ["Read", "Grep", "Bash(git diff *)"]
export function toolList(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String);
  const s = String(v);
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "," || ch === " ") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
