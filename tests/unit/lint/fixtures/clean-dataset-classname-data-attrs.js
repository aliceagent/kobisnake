// Fixture: dataset, className and data-*/aria-* attribute values — none of these are the textContent,
// innerText or label sinks this rule scopes to, so a hardcoded string here (a CSS class name, an attribute
// value) must never be flagged. Must pass.
export function build(el) {
  el.className = 'hud-powerup-tag-icon--speed';
  el.dataset.recommendedColor = 'teal';
  el.setAttribute('data-colour-note', 'true');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-label', 'Close');
}
