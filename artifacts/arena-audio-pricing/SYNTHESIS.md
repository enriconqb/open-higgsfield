# Arena synthesis — audio pricing

## Goal
Audio Generate shows USD estimate; usage_events / gallery `costUsd` get a number.

## Base
Candidate 3 (prompt/completion fields, character-first estimate, batch multiply, no generation lookup in v1).

## Why
All three candidates converged on the same path. Differences were naming and batch. Laziness Protocol: keep OpenRouter field names `prompt` / `completion`. Batch multiply matches image preview when the studio fires N speech submits.

## Cross-judge
Skipped. Strong convergence; pool is `inherit-parent` so vendor check would not run.

## Grafts
- From C1: empty prompt → null estimate; do not invent Seed Audio duration; touch-list clarity.
- From C2: none beyond batch (already in C3).

## Rejected
- C1 `promptPerChar` / `completionPerSecond` renames (extra concepts).
- Hardcoded catalog prices.
- Fetching `/audio/speech/models` for price.
- Inventing cost from speech response headers in this pass.
