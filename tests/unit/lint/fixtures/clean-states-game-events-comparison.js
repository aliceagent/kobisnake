// Fixture: STATES/GAME_EVENTS-shaped string literals used in comparisons and switch statements, not handed
// to textContent/innerText/label — control flow, not copy. Must pass.
export function handle(state, direction) {
  if (state === 'MENU') return 'skip';
  switch (direction) {
    case 'UP':
      return 1;
    case 'DOWN':
      return -1;
    default:
      return 0;
  }
}
