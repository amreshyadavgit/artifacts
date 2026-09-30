#!/usr/bin/env python3
"""Summarise `bench --site <site> run-tests` output into a short Markdown block for an agent.

Usage (bench output on stdin, or a file path):
	bench --site test.localhost run-tests --app spice_lite 2>&1 | python3 parse_bench_tests.py
	python3 parse_bench_tests.py saved-output.txt [--app spice_lite]

Why it exists (all observed on Frappe 15.121.2, see fixtures/):
- `bench run-tests` exits 0 even when tests fail or error, unless the environment has CI set
  (`frappe/commands/utils.py` only calls sys.exit when CI is set). The exit code is not a verdict.
- `--test <name>` that matches nothing prints "Ran 0 tests ... OK" and exits 0.
- A bad `--module` crashes before unittest starts (ModuleNotFoundError, exit 1, no "Ran" line).
- On Postgres, Frappe prints a full stack (`traceback.print_stack()` in
  `frappe/database/database.py`) plus an "Error in query" line for every failed query, including
  the ones a test provokes on purpose (the D-2 pinning test). That noise is not a test failure.
- `bench --verbose` adds "Message: ..." lines (frappe.msgprint text, which can echo document
  data) and `tb_locals` variable dumps inside tracebacks. None of these are ever printed here.

Exit codes: 0 PASS; 1 FAIL (failures or errors); 2 NO TESTS, CRASHED or no input.
Zero dependencies: Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import re
import sys

MAX_MESSAGE = 300
SEP_EQ = "=" * 70
SEP_DASH = "-" * 70

RAN_RE = re.compile(r"^Ran (\d+) tests? in ([\d.]+)s$")
RESULT_RE = re.compile(r"^(OK|FAILED)(?: \((.*)\))?$")
BLOCK_HEAD_RE = re.compile(r"^(FAIL|ERROR|UNEXPECTED SUCCESS): (\S+) \((\S+)\)$")
FRAME_RE = re.compile(r'^  File "([^"]+)", line (\d+), in (\S+)')
EXC_LINE_RE = re.compile(r"^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning)|AssertionError)(:.*)?$")


def one_line(text: str, limit: int = MAX_MESSAGE) -> str:
	flat = re.sub(r"\s+", " ", text).strip()
	return flat if len(flat) <= limit else flat[: limit - 3] + "..."


def short_path(path: str, app: str) -> str:
	"""Repo-relative when the app lives in this repo, else app-relative."""
	if "sample-app/" in path:
		return path[path.index("sample-app/") :]
	marker = f"/{app}/{app}/"
	if marker in path:
		return path[path.index(marker) + 1 :]
	return path


def is_app_frame(path: str, app: str) -> bool:
	if "/apps/frappe/" in path or "site-packages" in path or path.startswith(("/usr/", "<")):
		return False
	return f"/{app}/" in path


def parse_block(kind: str, name: str, test_id: str, body: list[str], app: str) -> dict:
	frames = []
	last_frame = -1
	for idx, line in enumerate(body):
		m = FRAME_RE.match(line)
		if m:
			frames.append((m.group(1), int(m.group(2)), m.group(3)))
			last_frame = idx
	# The exception text starts at column 0 after the last frame. Indented lines are source code
	# or `tb_locals` variable dumps (bench --verbose) and are never copied.
	exc_lines = [l for l in body[last_frame + 1 :] if l.strip() and not l.startswith(" ")]
	exc = " ".join(exc_lines)
	app_frames = [f for f in frames if is_app_frame(f[0], app)]
	test_frames = [f for f in app_frames if f[0].rsplit("/", 1)[-1].startswith("test_")]
	parts = test_id.split(".")
	case = parts[-2] if len(parts) >= 2 else ""
	module = ".".join(parts[:-2]) if len(parts) > 2 else ""
	result = {
		"kind": kind,
		"test": name,
		"case": case,
		"module": module,
		"message": one_line(exc) if exc else "(no exception line found)",
		"test_at": f"{short_path(test_frames[-1][0], app)}:{test_frames[-1][1]}" if test_frames else None,
		"raised_at": f"{short_path(app_frames[-1][0], app)}:{app_frames[-1][1]}" if app_frames else None,
		"app_frames": [f"{short_path(p, app)}:{n}" for p, n, _ in app_frames],
	}
	return result


def parse(text: str, app: str = "spice_lite") -> dict:
	lines = text.splitlines()
	out = {
		"status": None,
		"ran": None,
		"seconds": None,
		"failures": 0,
		"errors": 0,
		"skipped": 0,
		"expected_failures": 0,
		"unexpected_successes": 0,
		"problems": [],
		"noise": {
			"error_in_query": text.count("Error in query"),
			"stack_dumps": sum(1 for i, l in enumerate(lines) if l.startswith("  File ") and (i == 0 or not lines[i - 1].startswith(("  File ", "    ", "Traceback")))),
			"messages": sum(1 for l in lines if l.startswith("Message: ")),
		},
		"crash": None,
		"notes": [],
	}

	# FAIL/ERROR blocks: "=====" / "KIND: name (id)" / "-----" / traceback ... until next "=====" or "-----"
	i = 0
	while i < len(lines):
		if lines[i] == SEP_EQ and i + 1 < len(lines):
			m = BLOCK_HEAD_RE.match(lines[i + 1])
			if m:
				j = i + 2
				if j < len(lines) and lines[j] == SEP_DASH:
					j += 1
				body = []
				while j < len(lines) and lines[j] not in (SEP_EQ, SEP_DASH):
					body.append(lines[j])
					j += 1
				out["problems"].append(parse_block(m.group(1), m.group(2), m.group(3), body, app))
				i = j
				continue
		i += 1

	for idx, line in enumerate(lines):
		m = RAN_RE.match(line.strip())
		if m:
			out["ran"], out["seconds"] = int(m.group(1)), float(m.group(2))
			for later in lines[idx + 1 : idx + 4]:
				r = RESULT_RE.match(later.strip())
				if r:
					out["status"] = r.group(1)
					for key, val in re.findall(r"([a-z ]+)=(\d+)", r.group(2) or ""):
						key = key.strip().replace(" ", "_")
						if key in out:
							out[key] = int(val)
					break

	if "Testing is disabled for the site!" in text:
		out["crash"] = "Testing is disabled for the site (set allow_tests: bench --site <site> set-config allow_tests true)"
	elif out["ran"] is None:
		exc_lines = [l for l in lines if l and not l.startswith(" ") and EXC_LINE_RE.match(l)]
		out["crash"] = one_line(exc_lines[-1]) if exc_lines else "no unittest summary line ('Ran N tests') in the output"

	if out["crash"]:
		out["verdict"] = "CRASHED"
	elif out["ran"] == 0:
		out["verdict"] = "NO TESTS"
	elif out["status"] == "FAILED" or out["failures"] or out["errors"] or out["unexpected_successes"]:
		out["verdict"] = "FAIL"
	elif out["status"] == "OK":
		out["verdict"] = "PASS"
	else:
		out["verdict"] = "CRASHED"
		out["crash"] = "found 'Ran N tests' but no OK/FAILED result line"
	return out


def render(r: dict) -> str:
	lines = [f"## Test summary: {r['verdict']}", ""]
	if r["verdict"] == "CRASHED":
		lines.append(f"bench did not run the tests: {r['crash']}")
		lines.append("Check the selection (module path, DocType name), that the site exists and that allow_tests is set.")
	elif r["verdict"] == "NO TESTS":
		lines.append("Ran 0 tests. bench still printed OK and exited 0: the selection matched nothing (check --module/--test/--doctype).")
	else:
		passed = r["ran"] - r["failures"] - r["errors"] - r["skipped"] - r["expected_failures"] - r["unexpected_successes"]
		lines.append(
			f"{r['ran']} test{'' if r['ran'] == 1 else 's'}: {passed} passed, {r['failures']} failed, {r['errors']} errors, {r['skipped']} skipped ({r['seconds']:.1f} s)"
		)
	noise = r["noise"]
	hidden = []
	if noise["error_in_query"]:
		hidden.append(f"{noise['error_in_query']} 'Error in query' line(s) with {noise['stack_dumps']} stack dump(s)")
	if noise["messages"]:
		hidden.append(f"{noise['messages']} 'Message:' line(s)")
	if hidden:
		lines.append("Not shown: " + ", ".join(hidden) + ".")
	if noise["error_in_query"]:
		lines.append("On Postgres one query error is expected: test_framework_defect_is_set_filter_on_datetime pins D-2.")
	if r["problems"]:
		lines += ["", "### Problems"]
		for n, p in enumerate(r["problems"], 1):
			where = f"{p['case']}, {p['module']}" if p["module"] else p["case"]
			lines.append(f"{n}. {p['kind']} {p['test']} ({where})")
			lines.append(f"   message: {p['message']}")
			if p["test_at"]:
				lines.append(f"   test at: {p['test_at']}")
			if p["raised_at"] and p["raised_at"] != p["test_at"]:
				lines.append(f"   raised at: {p['raised_at']}")
			if len(p["app_frames"]) > 2:
				lines.append(f"   app frames: {' -> '.join(p['app_frames'])}")
	elif r["verdict"] == "FAIL":
		lines += ["", "FAILED was reported but no FAIL/ERROR blocks were found (output truncated?)."]
	return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
	ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
	ap.add_argument("file", nargs="?", help="saved bench output; default: stdin")
	ap.add_argument("--app", default="spice_lite", help="app whose frames are shown (default spice_lite)")
	args = ap.parse_args(argv)
	if args.file:
		try:
			with open(args.file, encoding="utf-8", errors="replace") as fh:
				text = fh.read()
		except OSError as e:
			print(f"## Test summary: CRASHED\n\ncannot read {args.file}: {e.strerror}")
			return 2
	else:
		text = sys.stdin.read()
	if not text.strip():
		print("## Test summary: CRASHED\n\nno input: pipe the bench output in with 2>&1 |")
		return 2
	result = parse(text, args.app)
	sys.stdout.write(render(result))
	return {"PASS": 0, "FAIL": 1}.get(result["verdict"], 2)


if __name__ == "__main__":
	sys.exit(main())
