// @ts-check

import { DIRECTIONS } from '../../core/grid.js';

/**
 * KI-12-01 — the play-policy interface, in `src/`.
 *
 * A **policy** decides one steering input for one player from the public round snapshot. Before this ticket
 * the same two policies existed twice — `tests/sim/bots/*` drove the headless statistics and
 * `tests/agent/policies/*` (KI-03-02, PR #174) drove the browser harness — so the bots the design is
 * measured on and the bots that will play a child were two different pieces of code. Improvement 12 needs
 * one: the CPU opponent must be the opponent the numbers describe.
 *
 * This module holds the vocabulary. The policies themselves are one file each ({@link
 * import('./greedy.js').greedy}, {@link import('./survivor.js').survivor}).
 *
 * ## Three constraints shape everything here
 *
 * 1. **A policy sees only the public snapshot.** `RoundSimulation.getState()` and nothing else — never the
 *    round's `rng`, never a live internal field. `docs/sprints/improvement-12-cpu-opponent.md`'s risk
 *    register calls a policy that reads the RNG "superhuman", and it would be.
 * 2. **A policy is a single self-contained function.** `tests/agent/driver.js` ships policies into the page
 *    as source text (`Function.prototype.toString()`), so a policy body may not reference a module-level
 *    constant, an import, or a captured variable — every helper is nested inside the function. That rules
 *    out the obvious factory (`createSurvivor(options)`): its `.toString()` would carry free variables and
 *    the driver would break. Configuration therefore arrives **on the view**, as {@link PolicyRules}.
 * 3. **A policy may not mutate what it is given.** Proved rather than promised, in
 *    `tests/unit/game/bots/purity.test.js`.
 *
 * ## Why {@link PolicyRules} exists at all
 *
 * The two pre-existing implementations were not one algorithm written twice. They differed in three ruled
 * ways, and KI-12-01 AC1 requires **every existing statistic to reproduce to the number** on both sides of
 * the move — `tests/sim/tuningMatrix.test.js` asserts the freshly computed matrix against the committed
 * `docs/qa/playtests/gate1-bot-matrix.md` to one decimal place, so a behavioural change to either bot fails
 * a test against a committed document. Collapsing the two into one behaviour would have moved one of the two
 * number sets. Naming the differences instead keeps both exact:
 *
 * | Knob | {@link PLAY_RULES} (the default) | {@link MEASUREMENT_RULES} (`tests/sim`) | Ruled by |
 * |---|---|---|---|
 * | `laserAware` | `true` — greedy refuses dead-zone cells | `false` — greedy checks only the walls | KI-03-02 made the browser greedy dead-zone aware; `greedyBot` never was |
 * | `straightBonus` | `0.5` — greedy's deterministic tie-break | `0` — the stream broke greedy's ties | the same KI-03-02 change that removed the stream |
 * | `contested` | `'exclude'` — survivor refuses every cell the opponent's head could also reach | `'penalise'` — a −`contestedPenalty` term in the score | ruling 5 on #122: two mirrored penalty-only survivors drive into each other off the spawn line |
 * | `jitter` | `null` — ties broken by `straightBonus`, deterministically | the bot's own seeded stream | `harness.js` gives each bot a stream derived from `(seed, index)`; the browser has none |
 *
 * **The defaults are the CPU's rules.** A policy called with no `rules` at all behaves exactly as the
 * KI-03-02 browser policy did, which is why `tests/agent/driver.js` needs no change whatsoever — it builds a
 * view with no `rules` field and gets the behaviour it has always had. `tests/sim` is the side that opts in,
 * explicitly, to the older measurement behaviour it recorded its matrix with.
 *
 * The knobs are duplicated as inline `??` defaults inside each policy (constraint 2 forbids reading
 * {@link PLAY_RULES} from module scope). `tests/unit/game/bots/rules.test.js` pins that duplication: it
 * asserts that passing no rules and passing {@link PLAY_RULES} agree on every board it tries.
 */

/** @typedef {import('../../core/grid.js').Cell} Cell */
/** @typedef {import('../../core/grid.js').Direction} Direction */
/** @typedef {import('../../core/grid.js').GridSize} GridSize */

/**
 * A steering input, named rather than a `{dx, dy}` pair.
 *
 * Names, because a policy's answer crosses two boundaries that a vector does not survive: the driver ships
 * it out of the page as JSON, and `replay.schema.json` records a direction by name. {@link MOVE_VECTORS}
 * converts one back for `applyInput`. `null` means "press nothing".
 *
 * @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | null} PolicyMove
 */

/**
 * One snake as a policy may see it — the subset of a `getState()` snake that a policy is allowed to read.
 *
 * `pendingGrowth` is on this list with a caveat that no type can express: `getState()` publishes it for
 * *every* snake, but a policy may read only **its own**. The opponent's pending growth is not something a
 * human player can see, and a policy that consulted it would be reading through the table.
 * `tests/unit/game/bots/purity.test.js` asserts the rule directly, by making the field throw on every snake
 * but the policy's own and running a full round.
 *
 * @typedef {object} PolicySnake
 * @property {boolean} alive
 * @property {Cell[]} segments - `segments[0]` is the head.
 * @property {Direction} direction - the last committed direction.
 * @property {number} pendingGrowth - **own snake only**; see above.
 */

/**
 * The public round snapshot, as far as a policy is concerned: exactly the fields the two policies read out
 * of `RoundSimulation.getState()`, and no others.
 *
 * Two shapes here have cost more than one scratch run (`driver.js`'s own `PolicyView` note): `powerUps` is
 * `{pickups: [...]}` and **not** an array, and `lasers` carries no bounds of its own — the safe square is
 * `[inset, width - 1 - inset]` on both axes.
 *
 * @typedef {object} PolicySnapshot
 * @property {PolicySnake[]} snakes - player order; `playerIndex` indexes into this.
 * @property {Cell[]} apples
 * @property {{pickups: {cell: Cell}[]}} powerUps
 * @property {{phase: string, inset: number}} lasers
 */

/**
 * The behaviour a call site pins. Every field is optional; an absent field takes its {@link PLAY_RULES}
 * value, so a caller that passes no rules at all gets the CPU's behaviour. See the module doc's table for
 * why each knob exists and which ruling created it.
 *
 * @typedef {object} PolicyRules
 * @property {boolean} [laserAware] - greedy only: whether a dead-zone cell is refused, or only a wall.
 * @property {number} [straightBonus] - greedy only: the score bonus for continuing straight. This is the
 *   deterministic tie-break KI-03-02 introduced when it removed the seeded stream; `greedyBot` never had
 *   one, so `MEASUREMENT_RULES` sets it to 0. Survivor's own straight bonus is 3 under both rule sets and is
 *   therefore not a knob.
 * @property {'exclude' | 'penalise'} [contested] - survivor only: how a cell the opponent's head could also
 *   reach is treated.
 * @property {number} [contestedPenalty] - survivor only, and only under `'penalise'`: the score penalty.
 * @property {(() => number) | null} [jitter] - a tie-breaking term added to each *evaluated* candidate's
 *   score, called once per candidate that clears the safety guards, in candidate order. `null` (the default)
 *   means no randomness at all. A policy given a `jitter` is no longer a pure function of the snapshot,
 *   which is why the CPU never gets one — see the module doc.
 */

/**
 * What a policy is handed. `tests/agent/driver.js` builds this in the page; `tests/sim/bots/*` builds it
 * from the live simulation; `src/game/cpuPlayer.js` (KI-12-02) builds it from `sim.getState()`.
 *
 * This is `docs/sprints/improvement-12-cpu-opponent.md`'s `(snapshot, playerIndex, settings)` as one object
 * rather than three positional parameters, because that is the shape the driver already ships and KI-12-01
 * may not change it (see constraint 2 in the module doc). `grid` is passed in rather than read off the
 * snapshot because `getState()` does not carry it.
 *
 * @typedef {object} PolicyView
 * @property {PolicySnapshot} snapshot
 * @property {number} playerIndex - 0 for player 1, 1 for player 2; the index into `snapshot.snakes`.
 * @property {GridSize} grid
 * @property {number} [decisionIndex] - how many decisions this policy has been asked for this round, from 0.
 * @property {PolicyRules} [rules] - absent means {@link PLAY_RULES}.
 */

/**
 * A policy: one steering decision from one snapshot.
 *
 * @callback Policy
 * @param {PolicyView} view
 * @returns {PolicyMove}
 */

/**
 * The rules the CPU plays by, and the rules every policy falls back to when a view carries none: dead-zone
 * aware, contested cells excluded outright, and **no randomness** — a policy under these rules is a pure
 * function of the snapshot, which is what makes a CPU match replay identically (KI-12-02 AC1).
 *
 * Exported for callers and for the test that pins it against the policies' own inline defaults; a policy
 * body may not read it (module doc, constraint 2).
 *
 * @type {Required<PolicyRules>}
 */
export const PLAY_RULES = Object.freeze({
  laserAware: true,
  straightBonus: 0.5,
  contested: /** @type {'exclude'} */ ('exclude'),
  contestedPenalty: 25,
  jitter: null,
});

/**
 * The rules `tests/sim/bots/*` pins, reproducing the behaviour those two files had when
 * `docs/qa/playtests/gate1-bot-matrix.md` was recorded. Nothing but that document's continued accuracy
 * depends on these values; they are frozen history, not a design position.
 *
 * `jitter` is deliberately absent — it is the *only* knob a call site must supply itself, because the stream
 * belongs to the caller (`harness.js` derives one per bot from `(seed, index)`), not to a shared constant.
 *
 * @type {PolicyRules}
 */
export const MEASUREMENT_RULES = Object.freeze({
  laserAware: false,
  straightBonus: 0,
  contested: /** @type {'penalise'} */ ('penalise'),
  contestedPenalty: 25,
});

/**
 * A {@link PolicyMove} back to the `{dx, dy}` `applyInput` takes. The values are `core/grid.js`'s own frozen
 * `DIRECTIONS` singletons, imported rather than re-declared so a caller cannot end up comparing two
 * structurally equal but distinct direction objects.
 *
 * Not used by the policies — they return names — so importing `grid.js` here costs them nothing and keeps
 * them self-contained.
 *
 * @type {Readonly<Record<Exclude<PolicyMove, null>, Direction>>}
 */
export const MOVE_VECTORS = Object.freeze({
  UP: DIRECTIONS.UP,
  DOWN: DIRECTIONS.DOWN,
  LEFT: DIRECTIONS.LEFT,
  RIGHT: DIRECTIONS.RIGHT,
});
