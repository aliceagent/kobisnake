// Fixture: the same violation shape as violation-textcontent-literal.js, for .innerText instead of
// .textContent — both are named in the ticket spec.
export function render(titleEl) {
  titleEl.innerText = 'Another hardcoded sentence, via innerText this time.';
}
