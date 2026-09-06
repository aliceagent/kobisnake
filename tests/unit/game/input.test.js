// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createInput } from '../../../src/game/input.js';
import { DIRECTIONS } from '../../../src/core/grid.js';

/**
 * A minimal stand-in for a browser `KeyboardEvent`. Built on Node's real `Event`/`EventTarget` globals (both
 * available since Node 15, no dependency needed) so `preventDefault()`/`defaultPrevented` are the genuine
 * platform behaviour, not a hand-rolled flag — `cancelable: true` is what makes `preventDefault()` actually
 * flip `defaultPrevented` (KS-03-02 tech-lead note 5).
 */
const NodeEvent = globalThis.Event;
const NodeEventTarget = globalThis.EventTarget;

class FakeKeyboardEvent extends NodeEvent {
  /**
   * @param {string} code
   * @param {{ repeat?: boolean }} [options]
   */
  constructor(code, { repeat = false } = {}) {
    super('keydown', { cancelable: true });
    this.code = code;
    this.repeat = repeat;
  }
}

/** @param {EventTarget} target @param {string} code @param {{ repeat?: boolean }} [options] */
function fireKeydown(target, code, options) {
  const event = new FakeKeyboardEvent(code, options);
  target.dispatchEvent(event);
  return event;
}

describe('KS-03-02 keyboard input', () => {
  it('KS-03-02 AC1: KeyW steers player 1 up and ArrowLeft steers player 2 left', () => {
    const target = new NodeEventTarget();
    const onDirection = vi.fn();
    createInput({ onDirection, target });

    fireKeydown(target, 'KeyW');
    expect(onDirection).toHaveBeenCalledWith(1, DIRECTIONS.UP);

    fireKeydown(target, 'ArrowLeft');
    expect(onDirection).toHaveBeenCalledWith(2, DIRECTIONS.LEFT);

    expect(onDirection).toHaveBeenCalledTimes(2);
  });

  it('KS-03-02: the rest of WASD steers player 1 in the other three directions', () => {
    const target = new NodeEventTarget();
    const onDirection = vi.fn();
    createInput({ onDirection, target });

    fireKeydown(target, 'KeyS');
    fireKeydown(target, 'KeyA');
    fireKeydown(target, 'KeyD');

    expect(onDirection).toHaveBeenNthCalledWith(1, 1, DIRECTIONS.DOWN);
    expect(onDirection).toHaveBeenNthCalledWith(2, 1, DIRECTIONS.LEFT);
    expect(onDirection).toHaveBeenNthCalledWith(3, 1, DIRECTIONS.RIGHT);
  });

  it('KS-03-02: the rest of the arrow keys steer player 2 in the other three directions', () => {
    const target = new NodeEventTarget();
    const onDirection = vi.fn();
    createInput({ onDirection, target });

    fireKeydown(target, 'ArrowUp');
    fireKeydown(target, 'ArrowDown');
    fireKeydown(target, 'ArrowRight');

    expect(onDirection).toHaveBeenNthCalledWith(1, 2, DIRECTIONS.UP);
    expect(onDirection).toHaveBeenNthCalledWith(2, 2, DIRECTIONS.DOWN);
    expect(onDirection).toHaveBeenNthCalledWith(3, 2, DIRECTIONS.RIGHT);
  });

  it('KS-03-02 AC2: repeated keydown events (repeat: true) are ignored', () => {
    const target = new NodeEventTarget();
    const onDirection = vi.fn();
    createInput({ onDirection, target });

    fireKeydown(target, 'KeyW', { repeat: true });
    expect(onDirection).not.toHaveBeenCalled();

    fireKeydown(target, 'KeyW', { repeat: false });
    expect(onDirection).toHaveBeenCalledTimes(1);
  });

  it('KS-03-02 AC3: arrow keydown has defaultPrevented === true', () => {
    const target = new NodeEventTarget();
    createInput({ target });

    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      const event = fireKeydown(target, code);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('KS-03-02 AC3: space keydown also has defaultPrevented === true', () => {
    const target = new NodeEventTarget();
    createInput({ target });

    const event = fireKeydown(target, 'Space');
    expect(event.defaultPrevented).toBe(true);
  });

  it('KS-03-02: WASD keydown is NOT prevented (ordinary letter keys must stay usable)', () => {
    const target = new NodeEventTarget();
    createInput({ target });

    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      const event = fireKeydown(target, code);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('KS-03-02: an unmapped key fires neither onDirection nor onMenu and is not prevented', () => {
    const target = new NodeEventTarget();
    const onDirection = vi.fn();
    const onMenu = vi.fn();
    createInput({ onDirection, onMenu, mode: 'both', target });

    const event = fireKeydown(target, 'KeyQ');

    expect(onDirection).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  describe("setMode('game' | 'menu' | 'both')", () => {
    it("KS-03-02: mode 'game' fires only onDirection, never onMenu", () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const onMenu = vi.fn();
      createInput({ onDirection, onMenu, mode: 'game', target });

      fireKeydown(target, 'ArrowUp');
      fireKeydown(target, 'Enter');
      fireKeydown(target, 'Escape');

      expect(onDirection).toHaveBeenCalledTimes(1);
      expect(onMenu).not.toHaveBeenCalled();
    });

    it("KS-03-02: mode 'menu' fires only onMenu, never onDirection", () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const onMenu = vi.fn();
      createInput({ onDirection, onMenu, mode: 'menu', target });

      fireKeydown(target, 'ArrowUp');
      fireKeydown(target, 'KeyW');

      expect(onDirection).not.toHaveBeenCalled();
      expect(onMenu).toHaveBeenCalledTimes(2);
      expect(onMenu).toHaveBeenNthCalledWith(1, 'UP');
      expect(onMenu).toHaveBeenNthCalledWith(2, 'UP');
    });

    it("KS-03-02: mode 'both' fires onDirection and the matching onMenu action for the same key", () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const onMenu = vi.fn();
      createInput({ onDirection, onMenu, mode: 'both', target });

      fireKeydown(target, 'ArrowLeft');

      expect(onDirection).toHaveBeenCalledWith(2, DIRECTIONS.LEFT);
      expect(onMenu).toHaveBeenCalledWith('LEFT');
    });

    it('KS-03-02: setMode switches behaviour after creation', () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const onMenu = vi.fn();
      const input = createInput({ onDirection, onMenu, mode: 'game', target });

      fireKeydown(target, 'ArrowUp');
      expect(onMenu).not.toHaveBeenCalled();

      input.setMode('menu');
      fireKeydown(target, 'ArrowUp');
      expect(onMenu).toHaveBeenCalledTimes(1);
      expect(onDirection).toHaveBeenCalledTimes(1); // only the first, pre-switch call
    });

    it('KS-03-02: default mode is game (onMenu never fires without an explicit mode)', () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const onMenu = vi.fn();
      createInput({ onDirection, onMenu, target });

      fireKeydown(target, 'Enter');
      fireKeydown(target, 'ArrowUp');

      expect(onMenu).not.toHaveBeenCalled();
      expect(onDirection).toHaveBeenCalledTimes(1);
    });
  });

  describe('menu actions', () => {
    it('KS-03-02: Enter fires onMenu(CONFIRM) and Escape fires onMenu(BACK)', () => {
      const target = new NodeEventTarget();
      const onMenu = vi.fn();
      createInput({ onMenu, mode: 'menu', target });

      fireKeydown(target, 'Enter');
      fireKeydown(target, 'Escape');

      expect(onMenu).toHaveBeenNthCalledWith(1, 'CONFIRM');
      expect(onMenu).toHaveBeenNthCalledWith(2, 'BACK');
    });

    it('KS-03-02: arrows and WASD both produce the four directional menu actions', () => {
      const target = new NodeEventTarget();
      const onMenu = vi.fn();
      createInput({ onMenu, mode: 'menu', target });

      const cases = [
        ['ArrowUp', 'UP'],
        ['ArrowDown', 'DOWN'],
        ['ArrowLeft', 'LEFT'],
        ['ArrowRight', 'RIGHT'],
        ['KeyW', 'UP'],
        ['KeyS', 'DOWN'],
        ['KeyA', 'LEFT'],
        ['KeyD', 'RIGHT'],
      ];
      for (const [code] of cases) {
        fireKeydown(target, code);
      }

      expect(onMenu.mock.calls.map((call) => call[0])).toEqual(cases.map(([, action]) => action));
    });
  });

  describe('soloSteering', () => {
    it('KS-03-02: soloSteering routes both WASD and arrow keys to player 1', () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      createInput({ onDirection, soloSteering: true, target });

      fireKeydown(target, 'KeyW');
      fireKeydown(target, 'ArrowLeft');

      expect(onDirection).toHaveBeenNthCalledWith(1, 1, DIRECTIONS.UP);
      expect(onDirection).toHaveBeenNthCalledWith(2, 1, DIRECTIONS.LEFT);
    });

    it('KS-03-02: setSoloSteering(true) flips arrow-key routing after creation', () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const input = createInput({ onDirection, target });

      fireKeydown(target, 'ArrowRight');
      expect(onDirection).toHaveBeenNthCalledWith(1, 2, DIRECTIONS.RIGHT);

      input.setSoloSteering(true);
      fireKeydown(target, 'ArrowRight');
      expect(onDirection).toHaveBeenNthCalledWith(2, 1, DIRECTIONS.RIGHT);

      input.setSoloSteering(false);
      fireKeydown(target, 'ArrowRight');
      expect(onDirection).toHaveBeenNthCalledWith(3, 2, DIRECTIONS.RIGHT);
    });
  });

  describe('destroy()', () => {
    it('KS-03-02: destroy() stops further delivery of keydown events', () => {
      const target = new NodeEventTarget();
      const onDirection = vi.fn();
      const input = createInput({ onDirection, target });

      fireKeydown(target, 'KeyW');
      expect(onDirection).toHaveBeenCalledTimes(1);

      input.destroy();
      fireKeydown(target, 'KeyW');
      expect(onDirection).toHaveBeenCalledTimes(1);
    });

    it('KS-03-02: destroy() is safe to call more than once', () => {
      const target = new NodeEventTarget();
      const input = createInput({ target });

      expect(() => {
        input.destroy();
        input.destroy();
      }).not.toThrow();
    });
  });

  describe('defaults and target resolution', () => {
    it('KS-03-02: createInput throws when no window exists and no target is given', () => {
      expect(() => createInput({ target: undefined })).toThrow(/target/i);
    });

    it('KS-03-02: missing onDirection/onMenu callbacks default to no-ops rather than throwing', () => {
      const target = new NodeEventTarget();
      const input = createInput({ mode: 'both', target });

      expect(() => fireKeydown(target, 'KeyW')).not.toThrow();
      expect(() => fireKeydown(target, 'Enter')).not.toThrow();
      input.destroy();
    });

    it('KS-03-02: falls back to the global window as the target when one is not given', () => {
      // Node's test environment has no `window`; stub one just long enough to prove the fallback branch
      // resolves to it (the module must not assume `window` exists at *import* time, only when this
      // default is actually evaluated inside `createInput`).
      const fakeWindow = new NodeEventTarget();
      /** @type {typeof globalThis & { window?: EventTarget }} */ (globalThis).window = fakeWindow;
      try {
        const onDirection = vi.fn();
        const input = createInput({ onDirection });
        fireKeydown(fakeWindow, 'KeyW');
        expect(onDirection).toHaveBeenCalledWith(1, DIRECTIONS.UP);
        input.destroy();
      } finally {
        delete (/** @type {typeof globalThis & { window?: EventTarget } } */ (globalThis).window);
      }
    });
  });
});
