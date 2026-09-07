## Ticket
Closes #<issue>  ·  Ticket: KS-NN-TT  ·  Sprint: NN  ·  Owner model: Opus / Sonnet

## What changed
<!-- Two to five sentences. Reference GDD sections / DESIGN-DECISIONS rows / reference images by filename. -->

## Player-visible?
<!-- Delete the line that does not apply. A change is player-visible if it alters what is on screen, what the
     game does, what a key press causes, or what the game says. Tests, CI, tooling and refactors are not,
     however large. If yes: add the `player-visible` label AND a line to CHANGELOG.md under [Unreleased] —
     .github/workflows/changelog.yml checks the two go together. -->
- **Yes** — labelled `player-visible`, and CHANGELOG.md has the entry.
- **No** — nothing a player could notice changed.

## Acceptance criteria
<!-- Copy the ticket's checkboxes and tick each one, naming the test that proves it. -->
- [ ] AC1 — `tests/...`
- [ ] AC2 — `tests/...`

## Fast checks (paste output)
```
npm run lint && npm run typecheck && npm run test:unit && npm run build
```

## Visual evidence (required for `needs-design-review`)
| Preview screenshot | Reference image crop |
|---|---|
| | |

## Out-of-scope findings
<!-- Filed as issues: #... -->

## Checklist
- [ ] Only files listed in the ticket were changed (or deviations are explained above)
- [ ] No tunable values changed without a `tuning-proposal`
- [ ] No new dependencies without Opus approval
- [ ] No network requests added; no CDN URLs
- [ ] Console is clean on the Vercel preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
