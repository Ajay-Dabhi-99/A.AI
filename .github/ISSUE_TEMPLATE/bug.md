---
name: Defect
about: A bug with severity, so phase gates can account for it (blueprint §22.5)
title: 'BUG: <what is wrong>'
labels: bug
---

## Severity

- [ ] P0: data loss, security exposure, or the product is unusable
- [ ] P1: a core flow is broken with no workaround
- [ ] P2: a flow is wrong or degraded, a workaround exists
- [ ] P3: cosmetic or minor

P0/P1 block phase completion. P2 blocks it when it affects acceptance criteria or data integrity.

## What happened

## What should happen

## Steps to reproduce

1.

## Evidence

Request ID (`x-request-id` response header), logs, screenshots.

## Affected task / phase

MODEL-XXX · P?
