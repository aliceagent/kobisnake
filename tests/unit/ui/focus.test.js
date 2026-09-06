// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createFocusModel } from '../../../src/ui/focus.js';

/**
 * KS-05-04: the shared keyboard/mouse focus model (`ARCHITECTURE §8`). `focus.js` is the one file in this
 * ticket with real logic (tech-lead note C), so it is the one with a thorough unit test — every screen module
 * in `src/ui/screens/` builds its own items on top of this and is exercised end to end by
 * `tests/e2e/menus.spec.js` (KS-05-05), so this file's job is to nail down the model itself: wrap-around,
 * disabled skipping (AC2), value changes (AC3's colour-swap rule lives in `matchSetup.js`, which is *built
 * on* this), and the visible-focus-ring bookkeeping (`getIndex`) that AC4's screenshot depends on.
 */

/**
 * @param {Partial<import('../../../src/ui/focus.js').FocusableItem>} overrides
 * @returns {import('../../../src/ui/focus.js').FocusableItem}
 */
function item(overrides = {}) {
  return { ...overrides };
}

describe('createFocusModel', () => {
  it('focuses the first enabled item by default', () => {
    const model = createFocusModel({ items: [item({ disabled: true }), item(), item()] });
    expect(model.getIndex()).toBe(1);
  });

  it('KS-05-04 AC2: an all-disabled list never focuses anything', () => {
    const model = createFocusModel({
      items: [item({ disabled: true }), item({ disabled: true }), item({ disabled: true })],
    });
    expect(model.getIndex()).toBe(-1);
  });

  it('an empty list never focuses anything and every action is a no-op', () => {
    const model = createFocusModel({ items: [] });
    expect(model.getIndex()).toBe(-1);
    expect(() => model.handleAction('DOWN')).not.toThrow();
    expect(() => model.handleAction('CONFIRM')).not.toThrow();
    expect(model.getIndex()).toBe(-1);
  });

  it('moveNext/movePrev wrap around', () => {
    const model = createFocusModel({ items: [item(), item(), item()] });
    expect(model.getIndex()).toBe(0);
    model.movePrev();
    expect(model.getIndex()).toBe(2); // wrapped backward past the start
    model.moveNext();
    expect(model.getIndex()).toBe(0); // wrapped forward past the end
    model.moveNext();
    expect(model.getIndex()).toBe(1);
  });

  it('KS-05-04 AC2: moving forward skips disabled entries in both directions', () => {
    const model = createFocusModel({
      items: [item(), item({ disabled: true }), item(), item({ disabled: true })],
    });
    expect(model.getIndex()).toBe(0);
    model.moveNext();
    expect(model.getIndex()).toBe(2); // index 1 is disabled, skipped
    model.moveNext();
    expect(model.getIndex()).toBe(0); // index 3 is disabled, wraps past it back to 0
  });

  it('KS-05-04 AC2: moving backward also skips disabled entries', () => {
    const model = createFocusModel({
      items: [item(), item({ disabled: true }), item(), item({ disabled: true })],
    });
    model.setIndex(2);
    model.movePrev();
    expect(model.getIndex()).toBe(0); // index 1 is disabled, skipped
  });

  it('a single enabled item among disabled ones never moves off itself', () => {
    const model = createFocusModel({
      items: [item({ disabled: true }), item(), item({ disabled: true })],
    });
    expect(model.getIndex()).toBe(1);
    model.moveNext();
    expect(model.getIndex()).toBe(1);
    model.movePrev();
    expect(model.getIndex()).toBe(1);
  });

  it('KS-05-04 AC2: setIndex refuses a disabled or out-of-range index', () => {
    const model = createFocusModel({ items: [item(), item({ disabled: true }), item()] });
    model.setIndex(1); // disabled — refused
    expect(model.getIndex()).toBe(0);
    model.setIndex(2); // enabled — accepted
    expect(model.getIndex()).toBe(2);
    model.setIndex(99); // out of range — refused
    expect(model.getIndex()).toBe(2);
    model.setIndex(-1);
    expect(model.getIndex()).toBe(2);
  });

  it('CONFIRM (Enter) calls the focused item onSelect, and only that item', () => {
    const selectA = vi.fn();
    const selectB = vi.fn();
    const model = createFocusModel({ items: [item({ onSelect: selectA }), item({ onSelect: selectB })] });
    model.handleAction('CONFIRM');
    expect(selectA).toHaveBeenCalledTimes(1);
    expect(selectB).not.toHaveBeenCalled();
  });

  it('select() (a mouse click) is equivalent to CONFIRM', () => {
    const onSelect = vi.fn();
    const model = createFocusModel({ items: [item({ onSelect })] });
    model.select();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('an item with no onSelect ignores CONFIRM without throwing', () => {
    const model = createFocusModel({ items: [item()] });
    expect(() => model.handleAction('CONFIRM')).not.toThrow();
  });

  it('LEFT/RIGHT call the focused item onChange with -1/1', () => {
    const onChange = vi.fn();
    const model = createFocusModel({ items: [item({ onChange })] });
    model.handleAction('LEFT');
    expect(onChange).toHaveBeenLastCalledWith(-1);
    model.handleAction('RIGHT');
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('LEFT/RIGHT with nothing focused (all disabled) does not throw', () => {
    const onChange = vi.fn();
    const model = createFocusModel({ items: [item({ disabled: true, onChange })] });
    expect(() => model.handleAction('LEFT')).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('BACK calls onBack, via both handleAction and back()', () => {
    const onBack = vi.fn();
    const model = createFocusModel({ items: [item()], onBack });
    model.handleAction('BACK');
    model.back();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('BACK with no onBack configured is a silent no-op (e.g. the main menu, AC3 of gameStateMachine)', () => {
    const model = createFocusModel({ items: [item()] });
    expect(() => model.handleAction('BACK')).not.toThrow();
  });

  it('UP moves backward and DOWN moves forward (not the other way round)', () => {
    const model = createFocusModel({ items: [item(), item(), item()] });
    model.handleAction('DOWN');
    expect(model.getIndex()).toBe(1);
    model.handleAction('UP');
    expect(model.getIndex()).toBe(0);
  });

  describe('setItems (re-render without losing the cursor)', () => {
    it('keeps the current index when it is still enabled in the new list', () => {
      const model = createFocusModel({ items: [item(), item(), item()] });
      model.setIndex(2);
      model.setItems([item(), item(), item()]); // a fresh render with new callback closures
      expect(model.getIndex()).toBe(2);
    });

    it('moves off an index that became disabled in the new list', () => {
      const model = createFocusModel({ items: [item(), item(), item()] });
      model.setIndex(1);
      model.setItems([item(), item({ disabled: true }), item()]);
      expect(model.getIndex()).toBe(0);
    });

    it('moves off an index the new (shorter) list no longer has', () => {
      const model = createFocusModel({ items: [item(), item(), item()] });
      model.setIndex(2);
      model.setItems([item(), item()]);
      expect(model.getIndex()).toBe(0);
    });

    it('a re-render always calls the newest onSelect, never a stale one', () => {
      const first = vi.fn();
      const second = vi.fn();
      const model = createFocusModel({ items: [item({ onSelect: first })] });
      model.setItems([item({ onSelect: second })]);
      model.select();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  it('an unrecognised action is ignored rather than throwing', () => {
    const model = createFocusModel({ items: [item()] });
    // @ts-expect-error deliberately invalid MenuAction, to prove the `default` branch is inert
    expect(() => model.handleAction('NOPE')).not.toThrow();
  });
});
