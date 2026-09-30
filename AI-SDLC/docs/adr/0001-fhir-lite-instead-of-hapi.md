# ADR-0001: Implement FHIR-lite shapes instead of adopting HAPI FHIR

- Status: accepted
- Date: 2026-09-30
- Deciders: course maintainers

## Context
The sample app exists to teach agent workflows. It must build in under a minute, be readable end to end, and still look like a healthcare API (Patient, Observation, Bundle, OperationOutcome).

## Options considered
| Option | Pros | Cons | Risk |
|---|---|---|---|
| HAPI FHIR server | Conformant, real validation | Large dependency tree, slow build, hides the code agents must reason about | Learners study HAPI instead of agents |
| FHIR-lite DTOs (chosen) | Small, explicit, every rule visible | Not conformant | Learners mistake it for real FHIR |

## Decision
FHIR-lite DTOs with the FHIR JSON shapes for the four resource types used.

## Consequences
Every doc states "not a conformant FHIR server". Migrating to HAPI is a documented extension exercise.

## Verification
`mvn -q -B test` stays under 60 s on a laptop; glossary in `context/domain/fhir-lite-glossary.md` matches the DTOs.
