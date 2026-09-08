// Fixture: `<expr>.label = <literal>` — the assignment form of the `label` sink, as opposed to an object
// literal's `label:` property.
export function render(row) {
  row.label = 'A hardcoded row label';
}
