# Writes the SYNTHETIC replay recordings under AI-SDLC-frappe/evaluations/recordings/.
# Run: python3 build/sources-frappe/09-agent-evaluation-data/make_recordings.py
#
# Every file is hand-authored (here, as data) in the shape of `claude -p --output-format json`
# (and `--json-schema` for <case>.judge.json) and carries "_synthetic": true. The handoffs follow the
# output formats of the agents they imitate: architect v2 = AI-SDLC-frappe/.claude/agents/architect.md,
# reviewer v2 = .claude/agents/reviewer.md, architect v1 = evaluations/agent-versions/architect-v1.md,
# reviewer v1 = evaluations/agent-versions/reviewer-v1.md (a short prompt without a handoff format of
# its own, so it follows the case prompt loosely). Line numbers cite the committed spice_lite.
import hashlib, json, pathlib, sys, uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

ROOT = pathlib.Path(__file__).resolve().parents[3]
REC = ROOT / "AI-SDLC-frappe/evaluations/recordings"
A = "sample-app/spice_lite/spice_lite/"
FHIR = A + "api/fhir.py"
HOOKS = A + "hooks.py"
PJ = A + "clinical/doctype/sl_patient/sl_patient.json"
OJ = A + "clinical/doctype/sl_observation/sl_observation.json"
EJ = A + "clinical/doctype/sl_encounter/sl_encounter.json"
PATCH = A + "patches/v0_1/backfill_patient_country.py"
NOTE = "SYNTHETIC recording, hand-authored for offline smoke tests of evaluations/harness/run-evals.mjs. It imitates the shape of `claude -p --output-format json`; it is NOT output from a real model run."
JNOTE = "SYNTHETIC judge recording, hand-authored for offline smoke tests of the --judge path. It imitates `claude -p --json-schema` output (structured_output); it is NOT output from a real model run."
NO_ARTIFACTS = "- None written (evaluation run: plan mode, no file edits)."


def table(rows):
    out = ["| id | severity | category | location | evidence | recommendation |", "|---|---|---|---|---|---|"]
    for r in rows:
        assert len(r) == 6, r
        out.append("| " + " | ".join(cell.replace("|", "\\|") for cell in r) + " |")  # escaped pipes, as Markdown needs
    return "\n".join(out)


def handoff(case, agent, step, status, inputs, nxt, summary, rows=None, decisions=(), questions=("None.",), artifacts=NO_ARTIFACTS,
            frontmatter=True, findings_text=None, sections=("Summary", "Findings", "Decisions", "Open questions", "Artifacts")):
    head = ""
    if frontmatter:
        head = f"---\nrun_id: eval-{case}\nstep: {step}\nagent: {agent}\nstatus: {status}\ninputs: [{', '.join(inputs)}]\nnext: {nxt}\n---\n"
    body = {
        "Summary": summary,
        "Findings": findings_text if findings_text is not None else table(rows or []),
        "Decisions": "\n".join(f"- {d}" for d in decisions),
        "Open questions": "\n".join(f"- {q}" for q in questions),
        "Artifacts": artifacts,
    }
    return head + "\n\n".join(f"## {sec}\n{body[sec]}" for sec in sections)


def recording(key, result, turns, cost, duration, denials=()):
    seed = hashlib.sha256(key.encode()).hexdigest()
    return {
        "_synthetic": True,
        "_note": NOTE,
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "duration_ms": duration,
        "duration_api_ms": int(duration * 0.83),
        "num_turns": turns,
        "result": result,
        "stop_reason": "end_turn",
        "session_id": str(uuid.UUID(seed[:32])),
        "total_cost_usd": cost,
        "usage": {"input_tokens": 1800 + turns * 350, "cache_creation_input_tokens": 9000 + turns * 1100,
                  "cache_read_input_tokens": 20000 + turns * 5200, "output_tokens": 350 + turns * 90},
        "permission_denials": [
            {"tool_name": t, "tool_use_id": f"toolu_01{hashlib.sha256((key + str(i)).encode()).hexdigest()[:20]}", "tool_input": inp}
            for i, (t, inp) in enumerate(denials)
        ],
    }


def judge(scores, unsupported=(), missed=(), rationale=None, verdict=None, turns=3, cost=0.041, duration=18400):
    vals = list(scores.values())
    auto = "pass" if min(vals) >= 3 and sum(vals) / len(vals) >= 3.5 else "fail"
    v = verdict or auto
    assert v == auto, (scores, verdict)
    if rationale is None:
        rationale = ("Claims check out against the cited files; the expected concepts are covered with concrete recommendations."
                     if v == "pass" else "At least one dimension is below the pass bar; see the scores.")
    return {
        "_synthetic": True, "_note": JNOTE, "type": "result", "subtype": "success", "is_error": False,
        "duration_ms": duration, "num_turns": turns, "result": "", "total_cost_usd": cost, "permission_denials": [],
        "structured_output": {"scores": scores, "unsupported_claims": list(unsupported), "missed_concepts": list(missed),
                              "verdict": v, "rationale": rationale},
    }


def S(g, c, s, a, sa):
    return {"grounding": g, "coverage": c, "severity_calibration": s, "actionability": a, "safety": sa}


RECS = {}  # (folder, case) -> (recording, judge)


def put(folder, case, rec, jdg):
    RECS[(folder, case)] = (rec, jdg)


from arch_v2 import build as build_arch_v2  # noqa: E402
from arch_v1 import build as build_arch_v1  # noqa: E402
from reviewer import build as build_reviewer  # noqa: E402

ctx = dict(table=table, handoff=handoff, recording=recording, judge=judge, S=S, put=put, NO_ARTIFACTS=NO_ARTIFACTS,
           A=A, FHIR=FHIR, HOOKS=HOOKS, PJ=PJ, OJ=OJ, EJ=EJ, PATCH=PATCH)
build_arch_v2(ctx)
build_arch_v1(ctx)
build_reviewer(ctx)

for (folder, case), (rec, jdg) in sorted(RECS.items()):
    d = REC / folder
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{case}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False) + "\n")
    (d / f"{case}.judge.json").write_text(json.dumps(jdg, indent=2, ensure_ascii=False) + "\n")
print("wrote", len(RECS), "recordings (+ judge files)")
