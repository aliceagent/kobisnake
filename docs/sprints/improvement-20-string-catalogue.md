# Improvement 20 — The string catalogue

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2 · **Prerequisite:** none
**Origin:** KI-10-00 and #150 — copy the design lead must approve is scattered through screen modules as literals

## Goal
Put every word the player reads in one file, so copy is reviewed as data and a sentence can be found,
approved and changed without opening a screen module. This sprint exists because of how I10 and I01 went:
the design lead approved strings in `DESIGN-DECISIONS §3`, engineers copied them verbatim into five files,
and one situation nobody anticipated (#150) had no string at all and stalled a merge waiting for one. A
catalogue makes the missing-string case a lint error and the review a diff of one file.

It also makes localisation possible later without building it now: a second catalogue is a translation.

## In scope
A catalogue module, the lint that forbids user-visible literals in `src/ui`, migration of every existing
string, and a review process that the design lead signs off on the catalogue rather than on screenshots
of text.

## Out of scope
Translating anything; runtime language switching; changing any approved string.

## Tickets

### KI-20-01 · The catalogue
Owner: Sonnet · Size: M · Depends on: —
Files: `src/ui/strings.js`, `tests/unit/ui/strings.test.js`
Spec: One module exporting a frozen object of every user-visible string, keyed by screen and purpose
(`menu.title`, `scoreboard.drawReplay`, `matchOver.tie`…), with parameterised strings as small functions
(`hud.length(n)`). The approved copy in `DESIGN-DECISIONS §3` is transcribed here character for character, and
a test asserts the two agree for every string §3 lists.
Acceptance criteria:
- [ ] AC1 Every string in `DESIGN-DECISIONS §3` is present and identical, asserted by parsing the document.
- [ ] AC2 The object is deep-frozen; a test proves a write throws.
QA: unit.

### KI-20-02 · Migrate every screen
Owner: Sonnet · Size: L · Depends on: KI-20-01
Files: `src/ui/screens/*.js`, `src/ui/hud.js`, tests
Spec: Replace every literal in `src/ui` with a catalogue reference. Visual baselines must not change — this
is a refactor, and a moved pixel means a changed string.
Acceptance criteria:
- [ ] AC1 Every visual baseline passes unchanged.
- [ ] AC2 Every e2e text assertion passes unchanged.
- [ ] AC3 `grep` for a quoted capital-letter string in `src/ui/screens` finds only catalogue keys.
QA: unit + e2e + visual.

### KI-20-03 · The lint
Owner: Sonnet · Size: S · Depends on: KI-20-02
Files: `eslint.config.js`, `scripts/lint-strings.mjs`, tests
Spec: A rule (or a script run by `npm run lint`) that flags any string literal assigned to `textContent`,
`innerText` or a `label` in `src/ui` that is not a catalogue lookup. The message says where to add it.
Acceptance criteria:
- [ ] AC1 A deliberately added literal fails lint with a message naming the catalogue.
- [ ] AC2 The current tree passes.
QA: lint.

### KI-20-04 · Review as data
Owner: Opus · Size: S · Depends on: KI-20-01
Files: `docs/process/AGENT-ROLES-AND-WORKFLOW.md`, `docs/design/DESIGN-DECISIONS.md`, `.github/pull_request_template.md`
Spec: The process changes: new copy is proposed as a catalogue diff, the design lead approves the diff, and
`§3` becomes the rationale rather than the source of truth — the catalogue is. A missing string is filed
against the catalogue, not solved in a screen.
Acceptance criteria:
- [ ] AC1 The workflow document describes the copy path in one paragraph.
- [ ] AC2 The PR template asks whether the change adds or alters a string.
QA: manual.

## QA plan
Baselines and e2e text assertions are the regression net: if any of them moves, a string changed and the
refactor is wrong.

## References
- KI-10-00, #150, `DESIGN-DECISIONS §3`; `CLAUDE.md` "never invent copy" as applied by the I01 tech lead

## Risks
- **A refactor that changes a pixel.** AC1 of KI-20-02 is the whole guarantee.
- **Over-engineering toward i18n.** No language switching, no plural rules, no runtime loading. One frozen object.

## Exit criteria
- [ ] Every user-visible string lives in one file, agrees with the approved copy, and cannot be bypassed without a lint failure.
- [ ] No baseline moved.
