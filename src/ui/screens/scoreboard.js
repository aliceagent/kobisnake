// @ts-check
import { STATES } from '../../game/gameStateMachine.js';
import { scoreboard } from '../strings.js';

/**
 * The between-round scoreboard (`ROUND_OVER`, ticket KS-05-04). Renders the GDD example format verbatim:
 * "BEST OF 5 / Blue: 2 wins / Red: 1 win / Blue needs 1 more win" — P1's line first, then P2's, then a line
 * naming whichever player just won *this* round and how many more wins they need for the match (the tech-lead
 * contract's own reading of the single GDD example: the round's `result` names the winner the last line is
 * about). On a `DRAW` that last line is replaced by the exact text `DRAW — REPLAY` (em dash, per KS-05-03
 * AC2's own wording) instead of a winner line — the win tallies above it are unchanged, since a draw scores
 * nothing (`DESIGN-DECISIONS §2.5`).
 *
 * Passive display only — nothing here is focusable (the tech-lead contract's `ROUND_OVER` props carry no
 * skip/continue callback; `session.js` handles the "Enter after 1 s skips" timing itself), so `handleMenuAction`
 * is a deliberate no-op, same as `countdown.js`.
 *
 * {@link buildScoreboardLines} is exported and pure precisely so the format — especially the singular/plural
 * wording the tech-lead notes call out by name — can be unit-tested without a DOM
 * (`tests/unit/ui/scoreboard.test.js`, a deviation from this ticket's `Files:` list called out in the PR
 * description, the same way `tests/unit/ui/hud.test.js` was for KS-04-03).
 *
 * KI-01-02 adds one more draw line: `consecutiveDraws`/`maxConsecutiveDraws` let the last replay before the
 * draw cap (`DESIGN-DECISIONS §1` row 26) carry a warning — "one more and the match is called" — so the
 * player is told the rule is about to bite *before* it does, on the same DRAW screen that already exists.
 * `session.js` computes `consecutiveDraws` after `match.recordRound` has already run for this round, so by the
 * time this screen is asked to render, the count it is given already accounts for the draw just played.
 *
 * Since KI-20-02 the line-building logic reads from the catalogue's `scoreboard` group (`src/ui/strings.js`,
 * imported as `{ scoreboard }`, this screen's own group, never the `STRINGS` aggregate — see that module's
 * own doc comment on why). {@link DRAW_TEXT} and {@link DRAW_WARNING_TEXT} stay exported under their original
 * names, now re-derived from `scoreboard.drawReplay`/`scoreboard.drawWarning`, because `tests/unit/ui/scoreboard.test.js`
 * and `tests/e2e/match-flow.spec.js` both import them by this path.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} ScoreboardProps
 * @property {number} bestOf
 * @property {'P1_WIN' | 'P2_WIN' | 'DRAW'} result
 * @property {{1: number, 2: number}} wins
 * @property {{1: number, 2: number}} winsNeeded
 * @property {{1: string, 2: string}} colorNames
 * @property {number} consecutiveDraws - draws recorded since the last decisive round, *after* this round's own
 *   result — `match.consecutiveDraws` (`core/match.js`), read once `recordRound` has already run for it.
 * @property {number} maxConsecutiveDraws - the cap a draw is played against (`settings.maxConsecutiveDraws`,
 *   `DESIGN-DECISIONS §1` row 26): the third consecutive draw ends the match, so the warning belongs on the
 *   second.
 */

/**
 * @typedef {object} ScoreboardScreen
 * @property {(props: ScoreboardProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * The exact text KS-05-03 AC2 requires for a drawn round. Never invent another spelling. Re-derived from the
 * catalogue (`scoreboard.drawReplay`) since KI-20-02, kept under this name because it is imported by
 * `tests/unit/ui/scoreboard.test.js` and `tests/e2e/match-flow.spec.js`.
 */
export const DRAW_TEXT = scoreboard.drawReplay;

/**
 * The exact text for the last replay before the draw cap bites (`DESIGN-DECISIONS §1` row 26, sprint file
 * KI-01-02 spec). Shown instead of {@link DRAW_TEXT} when `consecutiveDraws === maxConsecutiveDraws - 1` — the
 * second consecutive draw, so the player is warned before the third one ends the match. Re-derived from the
 * catalogue (`scoreboard.drawWarning`) since KI-20-02, kept under this name for the same importers as
 * {@link DRAW_TEXT}.
 */
export const DRAW_WARNING_TEXT = scoreboard.drawWarning;

/**
 * Builds the four (or three, on a draw) display lines, in order. Pure and DOM-free so it is directly
 * unit-testable.
 *
 * @param {ScoreboardProps} props
 * @returns {string[]}
 */
export function buildScoreboardLines({
  bestOf,
  result,
  wins,
  winsNeeded,
  colorNames,
  consecutiveDraws,
  maxConsecutiveDraws,
}) {
  const lines = [
    scoreboard.bestOfLine(bestOf),
    scoreboard.colorWinLine(colorNames[1], wins[1]),
    scoreboard.colorWinLine(colorNames[2], wins[2]),
  ];
  if (result === 'DRAW') {
    // The warning belongs on the *second* consecutive draw — one draw away from the cap — so the player is
    // told before the rule bites, not after (`DESIGN-DECISIONS §1` row 26, KI-01-02 spec).
    //
    // KI-01-02 known gap, awaiting a design ruling (do not fix by inventing copy — the ticket's own "use
    // verbatim, invent nothing" applies here): when `consecutiveDraws === maxConsecutiveDraws`, this is the
    // *deciding* draw — the one that ends the match rather than being replayed — and this scoreboard is still
    // shown for `scoreboardSeconds` before MATCH_OVER fires. That case falls through to the plain `DRAW_TEXT`
    // below, which says "REPLAY" on a round that will not be replayed. Neither approved string
    // (`DRAW_TEXT`/`DRAW_WARNING_TEXT`) is honest here, and the ticket names no third string, so this is left
    // as is until the design lead rules on it (see the PR's "Out-of-scope findings").
    lines.push(consecutiveDraws === maxConsecutiveDraws - 1 ? DRAW_WARNING_TEXT : DRAW_TEXT);
    return lines;
  }
  const winner = result === 'P1_WIN' ? 1 : 2;
  lines.push(scoreboard.decisiveLine(colorNames[winner], winsNeeded[winner]));
  return lines;
}

/**
 * Build the scoreboard screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {ScoreboardScreen}
 */
export function createScoreboardScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--scoreboard';
  // A stable test hook on top of the (Sprint-11-restylable) class name (tech-lead note on this ticket).
  // `ROUND_OVER` is the state name — "scoreboard" is this screen's own file/class name, not the state's.
  container.dataset.screen = STATES.ROUND_OVER;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';
  container.appendChild(panel);
  root.appendChild(container);

  return {
    render(props) {
      panel.textContent = '';
      for (const text of buildScoreboardLines(props)) {
        const line = doc.createElement('div');
        line.className = 'menu-line';
        line.textContent = text;
        panel.appendChild(line);
      }
    },
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    handleMenuAction() {},
    destroy() {
      container.remove();
    },
  };
}
