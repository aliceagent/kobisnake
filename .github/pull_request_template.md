## Ticket
Closes #<issue>  ·  Ticket: KS-NN-TT  ·  Sprint: NN  ·  Owner model: Opus / Sonnet

## What changed
<!-- Two to five sentences. Reference GDD sections / DESIGN-DECISIONS rows / reference images by filename. -->

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

## Copy (Improvement 20)
<!-- Every user-visible string lives in `src/ui/strings.js`. Answer both. -->
- [ ] This PR **adds or alters a user-visible string**. If ticked: the change is a diff of `src/ui/strings.js`, no screen module carries a new literal, and each new key is marked approved (it is quoted in `DESIGN-DECISIONS §3`) or **unapproved** and listed below for the design lead.
- New or altered keys, and their approval state: <!-- e.g. `matchOver.tie` — approved (§3) · `stats.heading` — UNAPPROVED, ruling wanted -->

## Out-of-scope findings
<!-- Filed as issues: #... -->

## Checklist
- [ ] Only files listed in the ticket were changed (or deviations are explained above)
- [ ] No tunable values changed without a `tuning-proposal`
- [ ] No new dependencies without Opus approval
- [ ] No network requests added; no CDN URLs
- [ ] Console is clean on the Vercel preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
