// Fixture: `.textContent = ''` — a clear, not copy. Must pass (the one content-shape exemption the tech lead
// named by name).
export function clear(el) {
  el.textContent = '';
  el.innerText = '';
}
