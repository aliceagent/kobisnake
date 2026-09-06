// @ts-check

/**
 * The keyboard/mouse navigation model shared by every grey-box menu screen (`ARCHITECTURE §8`, ticket
 * KS-05-04). A plain list of focusables plus a cursor into it — no DOM, no `document`, nothing browser-only,
 * so it is provable in Node and reusable from any screen in `src/ui/screens/`.
 *
 * The model owns exactly four things, matching `ARCHITECTURE §8`'s one-sentence spec:
 *   - ↑/↓ (here: `moveNext`/`movePrev`, or `handleAction('UP'|'DOWN')`) move the cursor with wrap-around,
 *     skipping disabled entries.
 *   - ←/→ (`handleAction('LEFT'|'RIGHT')`) call the focused item's own `onChange(direction)`.
 *   - Enter (`select`) calls the focused item's own `onSelect()`.
 *   - Esc (`back`) calls the model's own `onBack()` — not per-item, since "go back" is a property of the
 *     screen, not of whichever row happens to be focused.
 *
 * A screen builds its DOM once, builds one `FocusableItem` per interactive row/button, constructs the model
 * once, and on every `render(props)` call replaces the model's `items` (`setItems`) with fresh closures over
 * the new props — the callbacks change identity every render (new `matchSettings`, new `onChange`), but the
 * *cursor position* must not reset just because `session.js` re-rendered the same screen with new props
 * (the countdown label changes four times a round; matchSetup re-renders on every row change) — `setItems`
 * keeps the current index when it is still a valid, enabled slot in the new list, and only refinds a home for
 * it when it is not (the list shrank, or that slot just became disabled).
 *
 * Disabled entries can never become focused (KS-05-04 AC2): `firstFocusableIndex` never lands on one, and
 * `move` skips over them in both directions. A list whose entries are *all* disabled resolves to index `-1`
 * (no focusable) rather than spinning forever looking for one that does not exist — `move` visits at most
 * `items.length` slots before giving up, not an unbounded `while`.
 */

/**
 * @typedef {object} FocusableItem
 * @property {boolean} [disabled] - true if this item can never be focused or activated. Defaults to false.
 * @property {(direction: 1 | -1) => void} [onChange] - called on ←/→ (`-1`/`1`) while this item is focused.
 * @property {() => void} [onSelect] - called on Enter, or a mouse click, while this item is focused.
 */

/**
 * @typedef {object} CreateFocusModelOptions
 * @property {FocusableItem[]} [items] - the focusable list, in on-screen order.
 * @property {() => void} [onBack] - called on Esc. Not per-item: "back" belongs to the screen.
 */

/** @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CONFIRM' | 'BACK'} MenuAction */

/**
 * @typedef {object} FocusModel
 * @property {() => number} getIndex - the focused index, or `-1` when nothing is focusable.
 * @property {(index: number) => void} setIndex - focus `index` directly (mouse hover); a no-op if `index` is
 *   out of range or disabled, so a screen can call this from every row's `mouseenter` without guarding itself.
 * @property {(items: FocusableItem[]) => void} setItems - replace the list (see the module doc comment above
 *   for why this preserves the cursor instead of resetting it).
 * @property {() => void} moveNext - move focus forward one enabled slot, wrapping around.
 * @property {() => void} movePrev - move focus backward one enabled slot, wrapping around.
 * @property {() => void} select - call the focused item's `onSelect`, if any.
 * @property {() => void} back - call the model's `onBack`, if any.
 * @property {(action: MenuAction) => void} handleAction - route one `input.js` `MenuAction` into the model.
 */

/**
 * The first index in `items` that is not disabled, or `-1` when every item is (or the list is empty).
 *
 * @param {FocusableItem[]} items
 * @returns {number}
 */
function firstFocusableIndex(items) {
  return items.findIndex((item) => !item.disabled);
}

/**
 * Build a focus model.
 *
 * @param {CreateFocusModelOptions} [options]
 * @returns {FocusModel}
 */
export function createFocusModel({ items = [], onBack } = {}) {
  /** @type {FocusableItem[]} */
  let list = items;
  /** @type {number} */
  let index = firstFocusableIndex(list);

  /**
   * Moves the cursor by `delta` (`1` forward, `-1` backward), skipping disabled entries and wrapping around.
   * Bounded to `list.length` steps so a list with no enabled entry at all cannot loop forever — it simply
   * leaves `index` at `-1` (or wherever it already was, if the list somehow has no enabled slot to land on).
   *
   * @param {1 | -1} delta
   */
  function move(delta) {
    if (list.length === 0) return;
    if (index === -1) {
      index = firstFocusableIndex(list);
      return;
    }
    let candidate = index;
    for (let step = 0; step < list.length; step += 1) {
      candidate = (candidate + delta + list.length) % list.length;
      if (!list[candidate]?.disabled) {
        index = candidate;
        return;
      }
    }
    // Every slot is disabled (including the one we started from, on a later re-render) — nothing to land on.
    index = -1;
  }

  return {
    getIndex: () => index,
    setIndex(nextIndex) {
      if (nextIndex < 0 || nextIndex >= list.length) return;
      if (list[nextIndex]?.disabled) return;
      index = nextIndex;
    },
    setItems(nextItems) {
      list = nextItems;
      if (index < 0 || index >= list.length || list[index]?.disabled) {
        index = firstFocusableIndex(list);
      }
    },
    moveNext() {
      move(1);
    },
    movePrev() {
      move(-1);
    },
    select() {
      if (index === -1) return;
      list[index]?.onSelect?.();
    },
    back() {
      onBack?.();
    },
    handleAction(action) {
      switch (action) {
        case 'UP':
          move(-1);
          break;
        case 'DOWN':
          move(1);
          break;
        case 'LEFT':
          if (index !== -1) list[index]?.onChange?.(-1);
          break;
        case 'RIGHT':
          if (index !== -1) list[index]?.onChange?.(1);
          break;
        case 'CONFIRM':
          if (index !== -1) list[index]?.onSelect?.();
          break;
        case 'BACK':
          onBack?.();
          break;
        default:
        // Exhaustive per `MenuAction`; an unrecognised action is simply ignored rather than thrown, since
        // `input.js` is the only source of these and is fully typed.
      }
    },
  };
}
