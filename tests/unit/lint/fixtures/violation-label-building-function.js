// Fixture: a label-building helper function whose body directly is a hardcoded template literal — the same
// shape as matchSetup.js's COLOUR_NOTE_COPY.suggestion, without any exemption comment. This is what proves
// the rule catches a literal one hop away from its eventual .textContent write, not only a literal written
// directly at the sink.
export const ROW_COPY = {
  suggestion: (colorName) => `Try ${colorName.toUpperCase()} for player 2.`,
};
