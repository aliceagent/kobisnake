// Fixture: the same shape as violation-label-building-function.js, but linted under the
// src/ui/screens/playtestPrompt.js filename — proves the rule's message points at strings.playtest.js
// instead of strings.js when the offending file is the dynamic-import playtest screen (KI-20-06, #317).
export const PLAYTEST_ROW_COPY = {
  hint: (player) => `Player ${player}, choose an answer now.`,
};
