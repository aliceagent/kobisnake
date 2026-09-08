import { describe, expect, it, vi } from 'vitest';
import { createContextLossWatcher } from '../../../src/render/renderer.js';

/**
 * KI-06-01 — the WebGL context-loss watcher.
 *
 * `renderer.js` is the one file `vitest.config.js` excludes from the coverage floor, because it owns
 * `THREE.WebGLRenderer` and cannot execute in Node. {@link createContextLossWatcher} is the part of this
 * ticket that can: it is a listener and a boolean over two DOM events, with no GL context anywhere in it,
 * and it is where the ticket's one irreversible mistake lives — a `webglcontextlost` that is not
 * `preventDefault`ed is a context that never comes back, and nothing downstream can tell the difference
 * between "recovery is broken" and "recovery was never offered".
 *
 * The fake canvas is a plain listener registry rather than a `jsdom` element, for the same reason
 * `rendererSizing.test.js`'s fakes are plain objects: the watcher needs `addEventListener` and
 * `removeEventListener`, and anything more elaborate would be testing the DOM.
 */

function fakeCanvas() {
  /** @type {Map<string, Set<(event: any) => void>>} */
  const listeners = new Map();
  return {
    /** @param {string} type @param {(event: any) => void} listener */
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      /** @type {Set<(event: any) => void>} */ (listeners.get(type)).add(listener);
    },
    /** @param {string} type @param {(event: any) => void} listener */
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    /** How many listeners are registered for a type — what `dispose()` has to bring back to zero. */
    /** @param {string} type */
    countFor(type) {
      return listeners.get(type)?.size ?? 0;
    },
    /**
     * Fire an event the way a canvas would, and hand back the event so a test can ask what was done to it.
     * @param {string} type
     */
    fire(type) {
      const event = { type, defaultPrevented: false, preventDefault: vi.fn() };
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
      return event;
    },
  };
}

describe('KI-06-01 createContextLossWatcher', () => {
  it('KI-06-01 AC3: calls preventDefault on the loss event, without which the context never comes back', () => {
    const canvas = fakeCanvas();
    createContextLossWatcher(canvas);

    const event = canvas.fire('webglcontextlost');

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('reports the context lost between the loss and the restore, and not before or after', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    expect(watcher.isLost()).toBe(false);

    canvas.fire('webglcontextlost');
    expect(watcher.isLost()).toBe(true);

    canvas.fire('webglcontextrestored');
    expect(watcher.isLost()).toBe(false);
  });

  it('notifies every subscriber of a loss, then of a restore, in subscription order', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    /** @type {string[]} */
    const calls = [];
    watcher.onLost(() => calls.push('lost:first'));
    watcher.onLost(() => calls.push('lost:second'));
    watcher.onRestored(() => calls.push('restored'));

    canvas.fire('webglcontextlost');
    canvas.fire('webglcontextrestored');

    // Order is load-bearing: `createGameplayRenderer` subscribes its own repair before the game subscribes
    // anything, so the renderer is fit to draw by the time the session resumes the match.
    expect(calls).toEqual(['lost:first', 'lost:second', 'restored']);
  });

  it('ignores a second loss with no restore between, so no pause is owed twice', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    const onLost = vi.fn();
    watcher.onLost(onLost);

    canvas.fire('webglcontextlost');
    canvas.fire('webglcontextlost');

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(watcher.isLost()).toBe(true);
  });

  it('ignores a restore that answers no loss', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    const onRestored = vi.fn();
    watcher.onRestored(onRestored);

    canvas.fire('webglcontextrestored');

    expect(onRestored).not.toHaveBeenCalled();
    expect(watcher.isLost()).toBe(false);
  });

  it('still prevents the default on a loss even with nobody subscribed', () => {
    // The `preventDefault` is not a subscriber's business: it has to happen whether or not anything cares
    // about the event, because it is what makes the restore possible at all.
    const canvas = fakeCanvas();
    createContextLossWatcher(canvas);

    expect(canvas.fire('webglcontextlost').preventDefault).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on demand, and a listener that unsubscribes mid-notify does not disturb the rest', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    /** @type {string[]} */
    const calls = [];
    const offSecond = watcher.onLost(() => calls.push('second'));
    watcher.onLost(() => {
      calls.push('first-removes-second');
      offSecond();
    });
    const offThird = watcher.onLost(() => calls.push('third'));
    offThird();

    canvas.fire('webglcontextlost');
    canvas.fire('webglcontextrestored');
    canvas.fire('webglcontextlost');

    // The first loss notifies both survivors — the copy the watcher iterates is taken before any of them
    // runs — and the second notifies only the one that is left.
    expect(calls).toEqual(['second', 'first-removes-second', 'first-removes-second']);
  });

  it('dispose() removes both DOM listeners and drops every subscriber', () => {
    const canvas = fakeCanvas();
    const watcher = createContextLossWatcher(canvas);
    const onLost = vi.fn();
    watcher.onLost(onLost);

    watcher.dispose();

    expect(canvas.countFor('webglcontextlost')).toBe(0);
    expect(canvas.countFor('webglcontextrestored')).toBe(0);
    canvas.fire('webglcontextlost');
    expect(onLost).not.toHaveBeenCalled();
  });
});
