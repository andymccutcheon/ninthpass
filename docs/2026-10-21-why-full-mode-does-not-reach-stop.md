# Why full mode plateaus below STOP

**Date:** 21 October 2026. **Status:** diagnosed from three complete runs; guardrail added to Judge and Revise.
**Scope:** this explains the runs, not an aspiration. No score was manipulated and no run was edited.

## The three runs

| Run | Request | Scores | Outcome |
|---|---|---|---|
| `91f6d1d5` | "Write a prompt for a meeting-notes summarizer that returns five bullets" | 8.5, 8.5, 8.5 | paused: no improvement after two rewrites |
| `ac9a9abc` | "An agent that summarises meeting notes into five short, useful bullets…" | 8, 8, 8 | paused: no improvement after two rewrites |
| `c9a64687` | same, plus the priority "one obligation, one place" | 8.8, **8.0**, 8.4, 8.5 | capped: four rounds without STOP |

Every rewrite passed the structural contract. The artifacts were valid. They simply did not converge.

## The finding: recommendations aimed at sections already at 9 cause the regressions

Run `c9a64687` is the clearest because the first revision made the artifact **worse** by the Judge's
own measure. Section scores, pass 1 → pass 2:

| Section | Pass 1 | Pass 2 | Δ |
|---|---:|---:|---:|
| Primary Role | 9 | 9 | 0 |
| High-Level Objectives | 9 | 9 | 0 |
| Domain Expertise & Resources | 8 | 8 | 0 |
| Allowed Tools & APIs | 8 | 8 | 0 |
| **Operating Constraints** | **9** | **8** | **−1** |
| **Interaction Style & Voice** | **9** | **8** | **−1** |
| Memory & Context Handling | 8 | 9 | +1 |
| **Self-Monitoring & Reflection** | **9** | **8** | **−1** |
| **Example Exchanges (Few-Shot)** | **9** | **7** | **−2** |
| Safety & Ethics | 8 | 9 | +1 |
| **Deliverable Structure** | **9** | **8** | **−1** |

Five sections fell. **Every one of them was already at 9.** Two sections rose, and both were at 8.

Mapping each recommendation to the section it touched:

| Rec | Instruction | Section | Score |
|---|---|---|---|
| 1 | "Add the missing corrections example to the few-shot" | Few-Shot (9) | **9 → 7** |
| 2 | "Tighten the tools section" | Tools (8) | 8 → 8 |
| 3 | "Make the confidentiality rule unconditional" | Safety (8) | 8 → 9 |
| 4 | "Add the one self-check that catches the most likely defect" | Self-Monitoring (9) | **9 → 8** |
| 5 | "Reconcile the one place where the same obligation appears in two places" | Constraints & Deliverable (9, 9) | **9 → 8, 9 → 8** |

**Three of five recommendations touched a section already at 9. All three caused regressions. The one
recommendation that touched an 8 improved it.** That is the whole mechanism.

## Why it happens

The rubric defines 9–10 as "decision-ready / stop-loop caliber for that section". The Judge nonetheless
recommends *adding material* to sections in that band — a new example, a new self-check, a rewritten
rule. Additions create internal inconsistency (a new example conflicts with a constraint; a reconciled
rule changes wording another section depends on), and the next pass correctly penalises the
inconsistency. Revise must "implement ALL numbered recommendations", so it applies them, and its
permission to change a 9 section is "unless a numbered recommendation explicitly changes it" — which is
precisely the loophole: any recommendation authorises the churn it causes.

The loop therefore oscillates around 8: each round repairs the weakest band and damages the strongest,
and the overall score never clears the gate. It is not a Compose-quality problem, not a Revise-skill
problem in the mechanical sense, and not a scoring bug. It is an **incentive** problem between two
correctly executed stages.

This is the same class of defect as the structural-contract one: a model's judgment overriding a
deterministic standard. There, a recommendation overrode the output contract. Here, a recommendation
overrides the rubric's own definition of "decision-ready".

## The guardrail

Not a prompt trick to reach 9 — a rule that makes the two stages consistent with the standard they
already publish:

- **Judge:** do not recommend changes to a section scored 9 or above unless it is unsafe or contradicts
  another rule. Name the contradiction explicitly when it does. Never ask to add material to a
  decision-ready section.
- **Revise:** do not change a section scored 9 or above unless the recommendation names a contradiction
  involving it; otherwise mark the recommendation `DEFERRED` with the reason. Preserve those sections
  verbatim.

## What this does not fix

- **Compose quality** is not the limiting factor here: pass 1 opened at 8.8 with seven sections at 9.
- **Judge calibration on the lowest band** is not the problem either: it correctly identified real
  contradictions.
- **The gate is unchanged.** A run that still cannot clear it is a real result and should be published
  as one. The loop pausing or capping is the product behaving honestly, not failing to market itself.
