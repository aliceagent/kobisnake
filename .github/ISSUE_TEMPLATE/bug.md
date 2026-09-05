---
name: Bug
about: Something behaves differently from the design
title: '[SNN] '
labels: bug
assignees: ''
---

Build: <preview or production URL> @ <commit sha>
Seed / replay: <seed=4242, or the attached tests/sim/replays/*.json>

Steps:
1.
2.

Expected: <quote the DESIGN-DECISIONS row, the GDD section or the acceptance criterion>

Actual:

Severity: blocker | major | minor | polish

Evidence: <screenshot, video, or the name of the failing test>

<!--
Format from QA-STRATEGY §6. Add `blocker` as a second label if this must be fixed inside the current sprint.
Every fixed bug should leave a replay behind in tests/sim/replays/ so it can never come back unnoticed.
-->
