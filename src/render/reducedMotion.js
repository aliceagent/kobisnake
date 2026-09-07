// @ts-check

/**
 * KI-15-03: the single resolver behind every render-layer `reducedFx` default.
 *
 * Before this ticket, `?reducedFx=1` was the only way to turn `reducedFx` on, and the four render views that
 * default to it (`camera.js`, `pickupView.js`, `snakeView.js`, `laserView.js`) each carried their own
 * verbatim copy of the four-line query-string check — duplicated rather than imported because the function
 * was module-private in `camera.js` and each ticket that added a copy judged four duplicated lines cheaper
 * than widening that module's exports (see each file's own doc comment on its copy). This ticket adds a
 * second way in — `prefers-reduced-motion: reduce` — and a second place to add it would have made a fourth
 * (fifth) copy, so instead this is the one new shared module every one of those call sites imports.
 *
 * Safe to import in Node: every render view above is also imported by Vitest's `environment: 'node'` unit
 * suite (`ARCHITECTURE §2`'s render coverage floor), so this reads `location` and `matchMedia` off
 * `globalThis` defensively and answers `false` — never throws — wherever either is absent.
 *
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  const global = /** @type {any} */ (globalThis);

  // `?reducedFx=1` first, and short-circuiting: it is the path every visual baseline already runs under
  // (`ARCHITECTURE §11`), so this must answer `true` from the query string alone, with no dependency on
  // `matchMedia` existing or behaving a particular way in whatever environment reads it.
  const search = /** @type {{search?: string} | undefined} */ (global.location)?.search;
  if (typeof search === 'string' && new URLSearchParams(search).get('reducedFx') === '1') {
    return true;
  }

  // The media query is the ticket's other half: an OS/browser-level "reduce motion" preference, read the same
  // way a CSS `@media (prefers-reduced-motion: reduce)` rule would. `matchMedia` can be genuinely absent
  // (Node) or present but throw on an unsupported query in some odd embedding — both are treated as "no
  // preference expressed" rather than a crash, matching this function's own no-throw contract.
  const matchMedia = /** @type {((query: string) => {matches: boolean}) | undefined} */ (
    global.matchMedia
  );
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}
