// Fixture: KI-20-03 AC1 — the deliberately added literal that must fail lint. A screen module handing a raw
// English sentence straight to .textContent, exactly the shape KI-20-02 removed everywhere else.
export function render(titleEl) {
  titleEl.textContent = 'This is a brand new hardcoded sentence a player would read.';
}
