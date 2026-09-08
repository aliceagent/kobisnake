// Fixture: a template literal assigned to .textContent whose static text is pure glue (punctuation/
// whitespace only) — every word in it comes from an interpolated catalogue lookup, not from the template's
// own quasis. Must pass, mirroring matchSetup.js's real
// `colourNote.textContent = \`${COLOUR_NOTE_COPY.note} ${COLOUR_NOTE_COPY.suggestion(recommendedColor)}\`;`.
import { matchSetup } from '../strings.js';

export function render(colourNote, recommendedColor) {
  colourNote.textContent = `${matchSetup.colourNote.note} ${matchSetup.playerColourValue(recommendedColor)}`;
}
