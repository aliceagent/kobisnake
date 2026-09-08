// Fixture: an aria-* attribute set via setAttribute — same reasoning as clean-dataset-classname-data-attrs.js,
// kept separate because the tech lead named it as its own expected false-positive category.
export function build(el) {
  el.setAttribute('aria-hidden', 'true');
}
