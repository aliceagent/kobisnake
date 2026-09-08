// Fixture: the correct shape — .textContent read from an imported catalogue group, never a literal. Must
// pass, and is the pattern every real src/ui screen uses today.
import { menu } from '../strings.js';

export function render(titleEl) {
  titleEl.textContent = menu.title;
}
