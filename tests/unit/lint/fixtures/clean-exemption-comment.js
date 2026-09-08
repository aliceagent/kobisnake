// Fixture: the exemption shape matchSetup.js's COLOUR_NOTE_COPY.suggestion needed while it still held a
// hardcoded literal (tracked on #214, resolved on main by #328 before this rule shipped — see
// tests/unit/lint/lint-strings.test.js's AC2 describe block). Disable comment included — must pass. See
// violation-exemption-comment-removed.js for the same code with the comment stripped, which must fail; that
// pairing is what proves the exemption mechanism is narrow (one line) rather than a way to quiet the whole
// file.
export const COLOUR_NOTE_COPY = {
  // #214 exception: left exactly as this screen once rendered it, until the design lead ruled on it.
  // eslint-disable-next-line kobi-strings/catalogue-only-copy -- #214, see comment above
  suggestion: (colorName) => `Try ${colorName.toUpperCase()} for player 2.`,
};
