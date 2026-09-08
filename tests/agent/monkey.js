// @ts-check
import { createRng } from '../../src/core/rng.js';
import { PREVIOUS, TRANSITIONS } from '../../src/game/gameStateMachine.js';
import { FRAME_SECONDS } from './driver.js';

/**
 * KI-18-01 — the monkey (Improvement 18, `docs/sprints/improvement-18-session-fuzzing.md`, tracking issue
 * #303, ticket issue #311).
 *
 * `tests/sim` has fuzzed the **simulation** with four thousand seeds since Sprint 02. The thing wrapped
 * around it — the state machine, the screens, the focus model, pause and resume, blur and refocus, the
 * scoreboard beats, and since Improvement 06 the tab-lifecycle paths — has only ever been driven by scripts
 * that do what a spec expects. This module drives it at random instead: from a seed it generates a sequence
 * of actions drawn from every key the game listens to plus `blur`, `focus`, `visibilitychange` and `resize`,
 * applies them through the real listeners, and after every one of them checks the invariants and asks
 * whether the game can still get out of the state it is in.
 *
 * ## The three rules this module is built to
 *
 * 1. **Every action reaches the game through the same listeners a person's would** (AC2). A key is a real
 *    `KeyboardEvent('keydown', {code})` dispatched at `window`, which is the target `src/game/input.js`
 *    listens on and the exact construction `src/game/testHooks.js`'s own `pressKey` uses. `blur` and `focus`
 *    are real events at `window` (`session.js` subscribes `blur` for `DESIGN-DECISIONS §2.8`'s auto-pause);
 *    `visibilitychange` is a real event at `document`, which is where `loop.js` subscribes; `resize` is a
 *    real `page.setViewportSize()`, so `window.innerWidth` genuinely moves. The monkey never calls
 *    `startMatch`, `pause`, `resume` or `machine.dispatch` — {@link MONKEY_KOBI_MEMBERS} is the whitelist,
 *    and `monkey.spec.js` asserts the shipped source obeys it.
 * 2. **The stuck check counts simulated seconds, never wall ones.** The sprint's own risk entry says why:
 *    several agent sessions share one container, and a timing check keyed to wall clock would report a
 *    loaded box as a hung game. `__kobi.advance` is the only clock this module reads.
 * 3. **A seeded run is reproducible action for action** (AC1). Everything random goes through
 *    `src/core/rng.js` with the run's seed; the page is loaded at `?seed=N` so the match seed is fixed
 *    (`session.js`'s `matchSeed = fixedSeed ?? randomSeed()`); and — see the frame pump below — the browser's
 *    own `requestAnimationFrame` is replaced before any application code runs, so wall time cannot leak into
 *    a run through a frame the monkey did not ask for.
 *
 * ## The frame pump, and why it exists
 *
 * `main.js` calls `session.start()`, so a real `requestAnimationFrame` loop is live in the page for the whole
 * of every test in this directory. `driver.js` never notices, because it plays a whole match inside **one**
 * synchronous `page.evaluate` and a real frame cannot fire while JavaScript is busy. The monkey cannot: a
 * `resize` action has to be a `page.setViewportSize()` on the Node side, so a run is several evaluates with
 * real, idle wall time between them — during which the live loop would advance the round by however long the
 * round trip happened to take. That is precisely the wall-clock leak rule 3 forbids.
 *
 * So {@link monkeyFramePumpInitScript} replaces `requestAnimationFrame`/`cancelAnimationFrame` with a queue
 * before the application loads. The game schedules frames exactly as it always does and none of them fire
 * until the monkey pumps one, with a timestamp the monkey chooses. That buys determinism, and it buys one
 * thing more: **`loop.js`'s deferred auto-pause becomes observable.** A `blur` calls `autoPause` straight from
 * the listener, but a tab coming *back* only sets `autoPausePending`, which `loop.advance` consumes on the
 * next frame — and `__kobi.advance` goes to `session.advanceSimulation`, which calls `runUpdate` directly and
 * never touches `loop.advance`. Without a pump, the return half of `visibilitychange` — one of the paths
 * Improvement 06 added and #303 names — could not fire at all. The monkey therefore pumps exactly one frame
 * after every return to visible, and that frame is zero-length by construction (`onVisibilityChange` sets
 * `lastFrameMs = null`, so `onFrame` measures it as 0 s), so it costs one render and advances nothing.
 *
 * ## A hidden tab is not advanced
 *
 * `loop.js`'s rule is that a hidden tab gets no frames at all. `__kobi.advance` does not know that, so the
 * monkey keeps that book itself: while the tab is hidden no simulated time is advanced, and the seconds that
 * would have passed are counted separately. This is fidelity, not convenience — and it is what keeps the
 * stuck check honest, since a tab nobody is looking at has not failed to make progress.
 *
 * ## Where the judgement happens
 *
 * {@link runMonkeyStepsInPage} is shipped into the page and is therefore **one self-contained function with
 * no free variables**, the same constraint `driver.js`, the policies and `invariants.js` are under and for
 * the same reason. It only *observes*: it applies steps, records what happened, and runs the invariant
 * function it is handed. Everything that needs to *judge* — is this transition one the machine's table
 * allows, which states were never reached — happens on the Node side in {@link analyseRun}, where
 * `gameStateMachine.js` can simply be imported.
 */

/** @typedef {import('./driver.js').MatchResult} MatchResult */

/**
 * Every key code the game listens to, and nothing else.
 *
 * `src/game/input.js` decodes exactly these: WASD for player one, the arrows for player two, `Enter` for
 * CONFIRM, `Escape` for BACK and `Space` for PAUSE_TOGGLE (`DESIGN-DECISIONS §2.2`, `§2.8`, issue #103). The
 * ticket says "every key the game listens to", so this list is that table read back, not a selection from it.
 *
 * @type {readonly string[]}
 */
export const MONKEY_KEY_CODES = Object.freeze([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Space',
]);

/**
 * How often each kind of action is drawn.
 *
 * **Not uniform, and the reason is a budget rather than a preference.** A uniform draw over the fifteen
 * things the ticket names (eleven keys plus four events) would make one action in fifteen a `resize`, and a
 * resize is the single most expensive action there is: `main.js`'s listener calls `session.resize()`, which
 * draws a frame, and one `renderer.render()` costs ≈ 124 ms under this container's software WebGL
 * (`driver.js` has the measurements). Thirty-three resizes a seed is four seconds of rendering a seed, which
 * is AC3's whole ten-minute budget spent on window furniture. The weights below are also the more faithful
 * model of the thing the sprint file describes — "a child mashes keys during the countdown, presses Esc twice
 * on the scoreboard, alt-tabs during READY?" is mostly keys, occasionally a focus change, and rarely a
 * window drag.
 *
 * The weight `resize` carries is the one that was measured rather than reasoned about. A resize is the only
 * action that cannot be applied from inside the page, so it costs a `page.setViewportSize`, a
 * `waitForFunction` and — because it cuts the stretch — an extra `page.evaluate`: **≈ 0.5 s each**, against
 * ≈ 0.02 ms for a key. At weight 8 the first full campaign spent 834 resizes and about four fifths of its
 * ten-minute budget on them; at 5 it is two per seed, four hundred across a 200-seed campaign, and the
 * budget has room for a slower runner.
 *
 * Each entry is a relative weight, not a percentage; {@link generateActions} normalises them.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const ACTION_WEIGHTS = Object.freeze({
  key: 880,
  blur: 40,
  focus: 30,
  visibilitychange: 20,
  resize: 5,
});

/** Every action kind, in the order {@link ACTION_WEIGHTS} lists them. */
export const ACTION_KINDS = Object.freeze(Object.keys(ACTION_WEIGHTS));

/**
 * How long the monkey waits before an action, in **simulated** seconds — the ticket's "random intervals from
 * 0 to 2 s", drawn from three bands rather than uniformly.
 *
 * Uniform over [0, 2] means a mean of one second and 500 actions of eight minutes of simulated game, which
 * is both slower than AC3 can afford and a poor model of a person: real input arrives in bursts with pauses
 * between them, and the bursts are where the interesting races are (two turns inside one grid step, a key
 * during the countdown's GO beat, Esc twice on the scoreboard). The bands keep the ticket's full range —
 * a long wait still happens one action in ten, which is what lets a round actually play out — while bringing
 * the mean to ≈ 0.19 s.
 *
 * @type {readonly {weight: number, minSeconds: number, maxSeconds: number}[]}
 */
export const WAIT_BANDS = Object.freeze([
  Object.freeze({ weight: 65, minSeconds: 0, maxSeconds: 0.05 }),
  Object.freeze({ weight: 25, minSeconds: 0.05, maxSeconds: 0.4 }),
  Object.freeze({ weight: 10, minSeconds: 0.4, maxSeconds: 2 }),
]);

/**
 * The viewport a run starts at, and the sizes a `resize` action moves between.
 *
 * 1280×720 first because it is the only size the game is designed and baselined at (`DESIGN-DECISIONS §1`
 * row 24) and therefore the honest place for a run to begin. The other four are the ones Improvement 16
 * measured the game at (`docs/qa/playtests/viewports.md`): a laptop, a small window, a tall narrow one, and a
 * wide one. This ticket does not judge what any of them look like — I16 owns that — it only cares that the
 * game survives being resized between them at an arbitrary moment.
 *
 * @type {readonly {width: number, height: number}[]}
 */
export const MONKEY_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1280, height: 720 }),
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1024, height: 640 }),
  Object.freeze({ width: 800, height: 600 }),
  Object.freeze({ width: 640, height: 900 }),
]);

/**
 * The longest a hide goes unanswered, in actions. See {@link generateActions} for the measurement that set
 * it: a plain toggle left the tab hidden — and therefore the game unadvanced — for 43 % of a run.
 */
export const MAX_HIDDEN_ACTIONS = 8;

/** Where every run starts, and what each seed is reset to so one seed's last resize cannot reach the next. */
export const DEFAULT_VIEWPORT = MONKEY_VIEWPORTS[0];

/**
 * The stuck threshold, in simulated seconds: the ticket's own number.
 *
 * What it measures is "the game has not visibly responded for this long", not "the machine has not
 * transitioned" — see {@link runMonkeyStepsInPage}'s `fingerprint` for the campaign that made the
 * difference matter and for #119 F4, which is the precedent for taking a false positive this seriously.
 *
 * Long enough that nothing healthy comes near it — the longest a state legitimately holds still while the
 * player is pressing keys is the scoreboard's 2.5 s (`settings.js`'s `scoreboardSeconds`) — and short enough
 * that 500 actions of a run (≈ 96 simulated seconds at {@link WAIT_BANDS}' mean) can still trip it.
 */
export const STUCK_SIMULATED_SECONDS = 60;

/**
 * The three states in which *time alone* changes the state, so sitting in one is progress rather than
 * paralysis: the countdown counts down, a round ends, and the warning gives way. The stuck check is silent
 * in these and armed in every other — `MAIN_MENU`, `MATCH_SETUP`, `TUTORIAL`, `PRACTICE`, `SHOP`,
 * `SETTINGS`, `ROUND_OVER`, `MATCH_OVER`, `PAUSE`, `REPLAY` — because those are the states in which the game
 * is waiting for the player, and a minute of a monkey pressing every key the game has without the state
 * moving means it cannot get out.
 *
 * This is the ticket's "with no round running", written as the list it means rather than as a snapshot test:
 * `getSnapshot()` is non-`null` in `PAUSE` and `ROUND_OVER` too, and a pause nobody can leave is exactly the
 * bug this sprint is looking for.
 *
 * @type {readonly string[]}
 */
export const ROUND_RUNNING_STATES = Object.freeze(['COUNTDOWN', 'PLAYING', 'LASER_WARNING']);

/**
 * States in which the game renders a full frame on **every update**, whether or not a frame was asked for.
 *
 * Today that is `REPLAY` alone: `session.js`'s `runUpdate` REPLAY case calls `renderReplayFrame()`, and the
 * loop then renders again — filed as **#317**, together with the more serious half (the second render draws
 * the empty arena over the replay, so a replay is invisible on a live loop frame).
 *
 * It matters here because the monkey is the only frame source and never asks for a render, so every other
 * state costs it 0.00 ms a frame while this one costs 17–33 ms. Left alone, a seed that wanders onto the
 * REPLAY screen — one Enter and two ArrowDowns from the main menu — spends the whole of AC3's budget there
 * re-finding a defect that is already filed. So a run gets {@link EXPENSIVE_STATE_BUDGET_SECONDS} of
 * simulated time in these states and, once that is spent, **stops advancing time in them while carrying on
 * with every action**: keys, `blur`, `focus` and resizes all still land, so entering the screen and leaving
 * it again are still fuzzed, and only the passing of time on it is not. The same device a hidden tab already
 * uses, for the same reason — the monkey does not pay for frames nobody asked for.
 *
 * **This list empties when #317 is fixed**, and nothing else has to change: the budget stops binding, runs
 * carry on through `REPLAY`, and the campaign's coverage of that screen comes back.
 *
 * One consequence worth stating rather than leaving to be discovered: while a run is over budget in one of
 * these states no simulated time passes, so the stuck check's clock does not run there either — a `REPLAY`
 * screen nobody could get out of would not be *reported as stuck* today. It would still be found, by the
 * campaign noticing that a seed spent its remaining actions in one state, and it becomes detectable again
 * the moment #317 lands.
 *
 * @type {readonly string[]}
 */
export const STATES_THAT_RENDER_UNASKED = Object.freeze(['REPLAY']);

/**
 * How much simulated time a run may spend in a {@link STATES_THAT_RENDER_UNASKED} state before it stops.
 *
 * One second is sixty frames — long enough for the monkey to press several keys there and, often, to leave
 * again on its own, so the screen is still fuzzed rather than merely touched; short enough that the worst a
 * seed can cost is about two seconds of software rendering.
 */
export const EXPENSIVE_STATE_BUDGET_SECONDS = 0.25;

/** Every state name the machine's table defines. A state outside this set is a failure on sight. */
export const KNOWN_STATES = Object.freeze(Object.keys(TRANSITIONS));

/**
 * The only `__kobi` members {@link runMonkeyStepsInPage} may touch, and the whole of AC2's machine-checkable
 * half. `advance` is the clock; `getState` and `getSnapshot` are reads; `stateMachine` is read to install the
 * transition recorder described in this module's header, which calls through and changes nothing. Every way
 * of *making the game do something* — `startMatch`, `pause`, `resume`, `setSettingsOverrides`, `pressKey`
 * itself — is deliberately absent: the monkey dispatches its own events at the real targets instead.
 *
 * @type {readonly string[]}
 */
export const MONKEY_KOBI_MEMBERS = Object.freeze([
  'advance',
  'getState',
  'getSnapshot',
  'stateMachine',
]);

/** How many problems a run carries in full before it only counts them; `driver.js`'s own number. */
export const MAX_REPORTED_PROBLEMS = 50;

/** How many trace entries a run keeps. Enough for a 2 000-action run, which is KI-18-02's own input size. */
const MAX_TRACE_ENTRIES = 2500;

/**
 * @typedef {object} MonkeyAction
 * @property {number} index - 0-based position in the run. Quoted by every problem, so a failure names it.
 * @property {'key' | 'blur' | 'focus' | 'visibilitychange' | 'resize'} kind
 * @property {number} waitSeconds - simulated seconds advanced **before** this action is applied.
 * @property {string} [code] - `kind: 'key'` — one of {@link MONKEY_KEY_CODES}.
 * @property {boolean} [hidden] - `kind: 'visibilitychange'` — what `document.hidden` becomes.
 * @property {{width: number, height: number}} [viewport] - `kind: 'resize'` — the size to move to.
 */

/**
 * @typedef {object} MonkeyProblem
 * @property {string} rule - which check fired, in the words a failure message should use.
 * @property {string} detail
 * @property {number} actionIndex - the action after which it was found, or `-1` before the first.
 * @property {string} state - the game state at the time.
 * @property {boolean} [fatal] - true when the run stopped here.
 */

/**
 * @typedef {object} MonkeyTransition
 * @property {string} event
 * @property {string} from
 * @property {string} to
 * @property {number} actionIndex
 * @property {number} simSeconds
 */

/**
 * @typedef {object} MonkeyResult
 * @property {number} seed
 * @property {number} actionCount - how many actions the run was given.
 * @property {number} actionsApplied - how many it got through before it stopped, or all of them.
 * @property {number} simSeconds - simulated seconds advanced (a hidden tab advances none).
 * @property {number} hiddenSeconds - simulated seconds *not* advanced because the tab was hidden.
 * @property {number} framesPumped - real animation frames released, one per return to visible.
 * @property {number} maxMachineStillSeconds - the longest the machine state held still, in simulated
 *   seconds, while the screen kept responding. Not a failure — a screen with a working local overlay does
 *   this all day — but it is how a screen that absorbs input shows up in the numbers.
 * @property {number} expensiveSeconds - simulated seconds spent in a {@link STATES_THAT_RENDER_UNASKED}
 *   state, capped at {@link EXPENSIVE_STATE_BUDGET_SECONDS}.
 * @property {number} expensiveSkippedSeconds - simulated seconds the run declined to advance in such a state
 *   once that cap was reached. Actions kept landing throughout; only time stopped passing.
 * @property {string[]} statesVisited
 * @property {MonkeyTransition[]} transitions
 * @property {MonkeyProblem[]} problems - the first {@link MAX_REPORTED_PROBLEMS}.
 * @property {number} problemCount - the true total.
 * @property {{actionIndex: number, rule: string} | null} stopped - why the run ended early, or `null`.
 * @property {string[]} pageErrors
 * @property {number} wallMs
 * @property {Record<string, {frames: number, wallMs: number}>} stateCost - how many frames were advanced in
 *   each state and what they cost in the page. See {@link runMonkeyStepsInPage}'s `advance` for why.
 * @property {Record<string, {count: number, wallMs: number}>} opCost - the same, by the kind of step.
 * @property {{loadMs: number, stepsMs: number, resizeMs: number, stretches: number}} timing - where the
 *   wall clock went. Kept on every result rather than measured once behind a flag, because AC3 is a budget
 *   and a budget that is missed has to say *which part* missed it — the page load, the steps in the page, or
 *   the round trips a resize costs.
 */

/**
 * Draws one index from a weight table. One `rng.next()` call, so a caller can reason about how many draws an
 * action costs — which is what makes {@link generateActions} reproducible under a change to any *later* part
 * of the draw but not to an earlier one.
 *
 * @param {import('../../src/core/rng.js').Rng} rng
 * @param {readonly number[]} weights
 * @returns {number}
 */
function weightedIndex(rng, weights) {
  let total = 0;
  for (const weight of weights) total += weight;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/**
 * The action sequence for one seed. Pure, deterministic and Node-side: the list is *data* the driver ships
 * into the page, never a generator function serialised into it, which is what lets AC1 be proved without a
 * browser and lets KI-18-02 shrink a list by deleting entries from it.
 *
 * The tab's visibility is tracked here rather than read back from the page, and a `visibilitychange` simply
 * **toggles** it. That keeps the list a pure function of the seed: nothing about it depends on what the game
 * did.
 *
 * A hide also schedules its own return, at most {@link MAX_HIDDEN_ACTIONS} actions later. Without that, a
 * toggle at the weight `visibilitychange` carries leaves the tab hidden for about fifty actions at a time —
 * measured at **43 % of a 200-action run** — and a hidden tab advances no simulated time (see this module's
 * header), so nearly half of that run was spent not playing the game. The forced return is also the more
 * faithful model: alt-tabbing away and back is a few seconds, not half a session. Keys, `blur` and `focus`
 * still fire while the tab is hidden, which is its own thing worth fuzzing.
 *
 * A `resize` always moves to a *different* viewport than the one in force, because a `setViewportSize` to the
 * size already in force fires no `resize` event at all and would be an action that silently did nothing —
 * which is the exact defect #291 was.
 *
 * @param {number} seed
 * @param {number} count - how many actions to generate.
 * @returns {MonkeyAction[]}
 */
export function generateActions(seed, count) {
  const rng = createRng(seed);
  const kindWeights = ACTION_KINDS.map((kind) => ACTION_WEIGHTS[kind]);
  const bandWeights = WAIT_BANDS.map((band) => band.weight);
  /** @type {MonkeyAction[]} */
  const actions = [];
  let hidden = false;
  let returnAt = 0;
  let viewportIndex = 0;

  for (let index = 0; index < count; index += 1) {
    const band = WAIT_BANDS[weightedIndex(rng, bandWeights)];
    const waitSeconds = band.minSeconds + rng.next() * (band.maxSeconds - band.minSeconds);
    let kind = /** @type {MonkeyAction['kind']} */ (ACTION_KINDS[weightedIndex(rng, kindWeights)]);
    // The return a hide scheduled for itself. Every draw above still happens either way, so overriding the
    // kind here changes nothing about the rest of the stream — which is what keeps the list a pure function
    // of the seed rather than of its own history.
    if (hidden && index >= returnAt) kind = 'visibilitychange';

    if (kind === 'key') {
      actions.push({
        index,
        kind,
        waitSeconds,
        code: MONKEY_KEY_CODES[rng.int(MONKEY_KEY_CODES.length)],
      });
    } else if (kind === 'visibilitychange') {
      hidden = !hidden;
      if (hidden) returnAt = index + 1 + rng.int(MAX_HIDDEN_ACTIONS);
      actions.push({ index, kind, waitSeconds, hidden });
    } else if (kind === 'resize') {
      // One draw over the *other* sizes, so the event always fires.
      const offset = 1 + rng.int(MONKEY_VIEWPORTS.length - 1);
      viewportIndex = (viewportIndex + offset) % MONKEY_VIEWPORTS.length;
      actions.push({ index, kind, waitSeconds, viewport: MONKEY_VIEWPORTS[viewportIndex] });
    } else {
      actions.push({ index, kind, waitSeconds });
    }
  }

  return actions;
}

/**
 * One action as a sentence. KI-18-02 writes a shrunk sequence out "as a sentence"; the vocabulary belongs
 * with the thing that defines it, so it lives here and that ticket joins the lines up.
 *
 * @param {MonkeyAction} action
 * @returns {string}
 */
export function describeAction(action) {
  const wait = `wait ${action.waitSeconds.toFixed(3)} s`;
  switch (action.kind) {
    case 'key':
      return `${wait}, press ${action.code}`;
    case 'visibilitychange':
      return `${wait}, ${action.hidden === true ? 'hide the tab' : 'come back to the tab'}`;
    case 'resize':
      return `${wait}, resize to ${action.viewport?.width}×${action.viewport?.height}`;
    default:
      return `${wait}, ${action.kind} the window`;
  }
}

/**
 * Every state that has a row landing on `target`. Used to resolve the {@link PREVIOUS} sentinel: `RESUME`
 * from `PAUSE` may land on any state that can enter `PAUSE`, and `BACK` from `REPLAY` on any state that can
 * enter `REPLAY`.
 *
 * @param {string} target
 * @returns {string[]}
 */
export function statesLeadingTo(target) {
  return Object.keys(TRANSITIONS).filter((state) =>
    Object.values(TRANSITIONS[/** @type {keyof typeof TRANSITIONS} */ (state)]).includes(
      /** @type {any} */ (target),
    ),
  );
}

/**
 * Is `from --event--> to` a row in the machine's own table?
 *
 * This is the second half of the ticket's stuck check ("so is any state the machine's own table says is
 * unreachable"), and it can be exact rather than approximate because the monkey records the machine's real
 * dispatches rather than sampling `getState()` — see this module's header. A sampled check would have to
 * guess about two dispatches inside one frame; this one never does.
 *
 * @param {string} from
 * @param {string} event
 * @param {string} to
 * @returns {boolean}
 */
export function isTableTransition(from, event, to) {
  const row = /** @type {Record<string, string> | undefined} */ (
    /** @type {any} */ (TRANSITIONS)[from]
  );
  if (row === undefined) return false;
  const target = row[event];
  if (target === undefined) return false;
  if (target !== PREVIOUS) return target === to;
  return statesLeadingTo(from).includes(to);
}

/**
 * The judgement half, on the Node side where `gameStateMachine.js` is an ordinary import: everything the
 * in-page half recorded, checked against the table.
 *
 * @param {MonkeyResult} result
 * @returns {MonkeyProblem[]} problems found here, to be merged into the result's own.
 */
export function analyseRun(result) {
  /** @type {MonkeyProblem[]} */
  const found = [];
  for (const transition of result.transitions) {
    if (isTableTransition(transition.from, transition.event, transition.to)) continue;
    found.push({
      rule: 'transition outside the machine table',
      detail:
        `${transition.from} --${transition.event}--> ${transition.to} is not a row in TRANSITIONS ` +
        `(src/game/gameStateMachine.js)`,
      actionIndex: transition.actionIndex,
      state: transition.to,
    });
  }
  // The in-page half reports the state it is *in* on every action; this catches one the machine passed
  // through and left again, which no per-action read could see. Deduplicated by state so a single bad
  // state is one finding, not two.
  const alreadyReported = new Set(
    result.problems.filter((p) => p.rule === 'state outside the machine table').map((p) => p.state),
  );
  for (const state of result.statesVisited) {
    if (KNOWN_STATES.includes(state) || alreadyReported.has(state)) continue;
    alreadyReported.add(state);
    found.push({
      rule: 'state outside the machine table',
      detail: `the machine reported ${state}, which TRANSITIONS does not define`,
      actionIndex: -1,
      state,
    });
  }
  return found;
}

/**
 * Every reason this run is not healthy, in the words a failure message should use — empty when it is.
 *
 * The same shape as `driver.js`'s `failureReasons`, and for the same reason: a pure function so a spec
 * asserts one thing, and so the rule itself is unit-testable without a browser. Every message names the
 * **seed and the action index**, because a campaign's log is the only thing a shrinking run has to start
 * from.
 *
 * @param {MonkeyResult[]} results
 * @returns {string[]}
 */
export function monkeyFailureReasons(results) {
  /** @type {string[]} */
  const reasons = [];
  for (const result of results) {
    const where = `seed ${result.seed}`;
    for (const error of result.pageErrors) reasons.push(`${where}: ${error}`);
    if (result.problemCount === 0) continue;
    const shown = result.problems
      .slice(0, 5)
      .map(
        (problem) =>
          `${problem.rule} @action ${problem.actionIndex} in ${problem.state}: ${problem.detail}`,
      );
    reasons.push(
      `${where}: ${result.problemCount} problem(s) over ${result.actionsApplied} actions\n    ` +
        shown.join('\n    ') +
        (result.problemCount > shown.length
          ? `\n    …and ${result.problemCount - shown.length} more`
          : ''),
    );
  }
  return reasons;
}

/**
 * @typedef {object} MonkeyStep
 * @property {'advance' | 'key' | 'blur' | 'focus' | 'visibility' | 'pumpFrame' | 'observe'} op
 * @property {number} [seconds] - `advance`
 * @property {string} [code] - `key`
 * @property {boolean} [hidden] - `visibility`
 * @property {number} [actionIndex] - `observe`
 */

/**
 * @typedef {object} MonkeyStretch
 * @property {MonkeyStep[]} steps
 * @property {{width: number, height: number} | null} resize - the viewport the Node side moves to *after*
 *   these steps, or `null` for the last stretch.
 */

/**
 * Compiles an action list into the stretches the Playwright side executes.
 *
 * Every action becomes `advance → apply → observe`. A `resize` is the one action the page cannot apply to
 * itself — a `resize` event dispatched in-page leaves `window.innerWidth` where it was, so `session.resize()`
 * would re-fit the camera to the size it already had and the action would be a no-op wearing an action's
 * name. So a resize cuts the stretch: its `advance` ends one stretch, the Node side calls
 * `page.setViewportSize`, and its `observe` opens the next. That costs one round trip per resize rather than
 * one per action, which is what keeps AC3's budget intact.
 *
 * A `visibilitychange` back to visible is followed by a `pumpFrame`: see this module's header for why the
 * loop's deferred auto-pause has no other way to fire.
 *
 * @param {MonkeyAction[]} actions
 * @returns {MonkeyStretch[]}
 */
export function compileStretches(actions) {
  /** @type {MonkeyStretch[]} */
  const stretches = [];
  /** @type {MonkeyStep[]} */
  let steps = [];

  for (const action of actions) {
    if (action.waitSeconds > 0) steps.push({ op: 'advance', seconds: action.waitSeconds });
    if (action.kind === 'resize') {
      stretches.push({ steps, resize: action.viewport ?? null });
      steps = [{ op: 'observe', actionIndex: action.index }];
      continue;
    }
    if (action.kind === 'key') steps.push({ op: 'key', code: action.code });
    else if (action.kind === 'blur') steps.push({ op: 'blur' });
    else if (action.kind === 'focus') steps.push({ op: 'focus' });
    else if (action.kind === 'visibilitychange') {
      steps.push({ op: 'visibility', hidden: action.hidden === true });
      if (action.hidden !== true) steps.push({ op: 'pumpFrame' });
    }
    steps.push({ op: 'observe', actionIndex: action.index });
  }

  stretches.push({ steps, resize: null });
  return stretches;
}

/**
 * The init script the page runs **before any application code**, replacing the browser's animation frames
 * with a queue the monkey controls. See this module's header for the two things it buys (determinism across
 * the round trips a resize needs, and a route for `loop.js`'s deferred auto-pause to fire at all).
 *
 * Written as a self-contained function with no free variables and no imports, because `page.addInitScript`
 * serialises it exactly as `page.evaluate` does.
 */
export function monkeyFramePumpInitScript() {
  const scope = /** @type {any} */ (globalThis);
  /** @type {Map<number, (timestampMs: number) => void>} */
  const queued = new Map();
  let nextHandle = 1;
  let resizes = 0;

  scope.requestAnimationFrame = (/** @type {(timestampMs: number) => void} */ callback) => {
    const handle = nextHandle;
    nextHandle += 1;
    queued.set(handle, callback);
    return handle;
  };
  scope.cancelAnimationFrame = (/** @type {number} */ handle) => {
    queued.delete(handle);
  };

  // Registered before the application's own `resize` listener, so a counter read from the Node side after it
  // has moved is proof the game's listener has already run for that same event.
  scope.addEventListener('resize', () => {
    resizes += 1;
  });

  scope.__kobiMonkeyFrames = {
    pending: () => queued.size,
    resizes: () => resizes,
    /**
     * Runs every frame callback the game has scheduled, with the timestamp the monkey chooses. Returns how
     * many ran.
     * @param {number} timestampMs
     */
    pump(timestampMs) {
      const due = Array.from(queued.values());
      queued.clear();
      for (const callback of due) callback(timestampMs);
      return due.length;
    },
  };
}

/**
 * One stretch of steps, **inside the page**.
 *
 * A top-level function taking one bag of arguments rather than a closure, because `page.evaluate` serialises
 * it: it may not reference anything in this module's scope. It observes and records; it never judges — see
 * this module's header, and {@link analyseRun} for the half that does.
 *
 * State that has to survive between the stretches of one seed lives on `globalThis.__kobiMonkeyState`, which
 * a page load clears for free.
 *
 * Exported for AC2: `monkey.spec.js` reads this function's own source text and asserts it touches nothing on
 * `__kobi` outside {@link MONKEY_KOBI_MEMBERS}. Nothing else calls it — {@link runMonkeySession} is the entry
 * point.
 *
 * @param {object} args
 * @returns {object}
 */
export function runMonkeyStepsInPage(args) {
  const {
    steps,
    invariantsSource,
    invariantConfig,
    frameSeconds,
    stuckSimulatedSeconds,
    roundRunningStates,
    knownStates,
    expensiveStates,
    expensiveBudgetSeconds,
    maxReportedProblems,
    maxTraceEntries,
  } = args;

  const kobi = /** @type {any} */ (globalThis).__kobi;
  const doc = /** @type {any} */ (globalThis).document;
  const scope = /** @type {any} */ (globalThis);
  let run = scope.__kobiMonkeyState;
  if (run === undefined) {
    run = {
      simSeconds: 0,
      hiddenSeconds: 0,
      hidden: false,
      framesPumped: 0,
      expensiveSeconds: 0,
      expensiveSkippedSeconds: 0,
      stateCost: {},
      opCost: {},
      // `new Function` rather than `eval`: the source arrives as plain text, as it does in `driver.js`.
      // Compiled once per page load and kept here, so a run of several stretches neither re-sends the
      // invariants module's source across the wire nor recompiles it — a resize cuts the stretch, and a
      // campaign has hundreds of them.
      checkInvariants:
        invariantsSource === null ? null : new Function('return (' + invariantsSource + ')')(),
      actionIndex: -1,
      lastChangeSimSeconds: 0,
      lastFingerprint: null,
      lastTransitionSimSeconds: 0,
      maxMachineStillSeconds: 0,
      statesVisited: [kobi.getState()],
      transitions: [],
      problems: [],
      problemCount: 0,
      actionsApplied: 0,
      stopped: null,
    };
    scope.__kobiMonkeyState = run;
  }

  /**
   * Records every real dispatch the machine performs, by calling through it. Installed once per page load
   * and idempotent, because a run is several `page.evaluate` calls against one page. This is the only thing
   * in this function that touches `__kobi.stateMachine`, and it neither swallows nor alters a dispatch — it
   * is a listener, not a controller.
   */
  const machine = kobi.stateMachine;
  if (
    machine !== undefined &&
    machine !== null &&
    typeof machine.dispatch === 'function' &&
    machine.dispatch.__kobiMonkeyWrapped !== true
  ) {
    const original = machine.dispatch;
    const wrapped = function (/** @type {string} */ event) {
      const from = kobi.getState();
      const to = original(event);
      if (run.transitions.length < maxTraceEntries) {
        run.transitions.push({
          event,
          from,
          to,
          actionIndex: run.actionIndex,
          simSeconds: run.simSeconds,
        });
      }
      if (to !== from) {
        // A self-transition (BACK on MAIN_MENU is a real row that lands on MAIN_MENU) is deliberately not a
        // change: the stuck check asks whether the game *moved*, and a screen that answers every key with
        // itself has not.
        run.lastChangeSimSeconds = run.simSeconds;
        run.lastTransitionSimSeconds = run.simSeconds;
        if (run.statesVisited.indexOf(to) === -1) run.statesVisited.push(to);
      }
      return to;
    };
    wrapped.__kobiMonkeyWrapped = true;
    machine.dispatch = wrapped;
  }

  /**
   * @param {string} rule
   * @param {string} detail
   * @param {boolean} fatal
   */
  const report = (rule, detail, fatal) => {
    run.problemCount += 1;
    if (run.problems.length < maxReportedProblems) {
      run.problems.push({
        rule,
        detail,
        actionIndex: run.actionIndex,
        state: kobi.getState(),
        fatal,
      });
    }
    if (fatal) run.stopped = { actionIndex: run.actionIndex, rule };
  };

  const readHud = () => {
    // `ui.js` puts the HUD up in COUNTDOWN, PLAYING, LASER_WARNING and PAUSE and hides its container
    // everywhere else (`hud.js`'s `setVisible` sets `container.hidden`). Its text nodes keep whatever they
    // last said, so comparing them against a snapshot on a screen where nobody can see them is #119 F4 in a
    // new costume — the first pilot campaign reported thirteen `hud-timer-agrees` problems on one seed,
    // every one of them the REPLAY screen still holding last round's `1:30` while `getSnapshot()` served
    // the finished round it was built from. Answering `null` makes `checkInvariants` skip its HUD half and
    // keep every snapshot check, which is exactly the right split.
    //
    // Asked of the DOM rather than mirrored from `ui.js`'s `HUD_STATES` (which it does not export): a
    // mirror can fall out of step with the list it copies, and `hidden` is the game's own answer.
    if (doc.querySelector('.hud')?.hidden === true) {
      return { timerText: null, p1Text: null, p2Text: null };
    }
    return {
      timerText: doc.querySelector('.hud-timer')?.textContent ?? null,
      p1Text: doc.querySelector('.hud-player--p1')?.textContent ?? null,
      p2Text: doc.querySelector('.hud-player--p2')?.textContent ?? null,
    };
  };

  /** @param {number} seconds */
  const advance = (seconds) => {
    // `loop.js` gives a hidden tab no frames at all, so neither does the monkey — see the module header.
    if (run.hidden) {
      run.hiddenSeconds += seconds;
      return;
    }
    // Which state the frames went into, and what they cost. Sampled once per action rather than once per
    // frame, so it is a `performance.now()` pair per action and not per 1/60 s. It earns its keep: AC3 is a
    // budget, and the first pilot run of this module missed it by forty times over with the whole overrun in
    // one state, which no total could have said.
    const state = kobi.getState();
    const expensive = expensiveStates.indexOf(state) !== -1;
    if (expensive && run.expensiveSeconds >= expensiveBudgetSeconds) {
      // The budget for this run is spent. The monkey keeps *acting* — keys, blur, focus and resizes all
      // still land, so the way out of the screen is still fuzzed — it simply stops paying for time to pass
      // in a state whose every update renders (#317). Exactly the device a hidden tab already uses.
      run.expensiveSkippedSeconds += seconds;
      return;
    }
    const startedAt = scope.performance.now();
    let frames = 0;
    let remaining = seconds;
    while (remaining > 1e-9) {
      const chunk = remaining < frameSeconds ? remaining : frameSeconds;
      kobi.advance(chunk);
      run.simSeconds += chunk;
      remaining -= chunk;
      frames += 1;
      if (expensive) {
        run.expensiveSeconds += chunk;
        // Checked inside the loop, not once per action: a single action may wait two simulated seconds,
        // and a hundred and twenty frames of #317's per-update render is most of a seed's whole budget.
        if (run.expensiveSeconds >= expensiveBudgetSeconds) break;
      }
    }
    const cost = run.stateCost[state] ?? { frames: 0, wallMs: 0 };
    cost.frames += frames;
    cost.wallMs += scope.performance.now() - startedAt;
    run.stateCost[state] = cost;
  };

  /** @param {boolean} hidden */
  const setVisibility = (hidden) => {
    // The browser is what a test cannot ask to hide a tab, so the two properties `loop.js` reads are shadowed
    // on the document instance and the real event is dispatched at the real target. The game reads exactly
    // what it would read in a backgrounded tab, through exactly the listener it registered.
    Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    run.hidden = hidden;
    doc.dispatchEvent(new scope.Event('visibilitychange'));
  };

  /**
   * What the player can see, cheaply: the state, whichever menu row is focused, and how many things under
   * `#ui` are hidden — which moves the moment a panel or a screen opens or closes.
   *
   * This is what the stuck check compares, rather than the machine state alone. The first campaign's only
   * finding was a seed that sat on `MAIN_MENU` for sixty simulated seconds and was reported stuck, and it
   * was not: focus moved on 109 of those actions and the HOW TO PLAY overlay opened and closed 133 times.
   * The game answered nearly every key; what held still was the *machine*, because that overlay is local to
   * `MAIN_MENU` by design (`mainMenu.js` gives it input priority and swallows everything but `BACK`, arrows
   * included, which pins focus on its own row and absorbs `Enter`).
   *
   * #119's F4 is why that matters enough to change: the first version of the HUD invariant reported 135
   * problems a match and every one of them was the design, and a QA layer that cries wolf is worse than
   * none. "Stuck" has to mean *the game did not respond*, which is the question the ticket is really asking
   * — a state nobody can get out of — and not merely *the machine did not transition*, which a screen with
   * a working local overlay does all day.
   */
  const fingerprint = () => {
    const focused = doc.querySelector('.menu-item--focused .menu-item-label')?.textContent ?? '';
    const root = doc.querySelector('#ui');
    const hiddenCount = root === null ? 0 : root.querySelectorAll('[hidden]').length;
    return kobi.getState() + '|' + focused + '|' + hiddenCount;
  };

  const observe = () => {
    const state = kobi.getState();
    if (knownStates.indexOf(state) === -1) {
      report('state outside the machine table', `the machine reported ${state}`, true);
      return;
    }
    if (run.checkInvariants !== null) {
      const snapshot = kobi.getSnapshot();
      if (snapshot !== null) {
        const found = run.checkInvariants({
          snapshot,
          hud: readHud(),
          state,
          config: invariantConfig,
        });
        for (let i = 0; i < found.length; i += 1) report(found[i].rule, found[i].detail, false);
      }
    }
    // Any visible change is the game responding, and resets the clock. The machine's own transitions still
    // reset it too (the dispatch recorder above), which matters for the changes this fingerprint cannot
    // see — a transition between two screens that happen to hide the same number of things.
    // Kept as a number rather than raised as a problem: how long the *machine* held still while the screen
    // kept answering is real information — it is how a screen that absorbs input shows up — but it is an
    // observation about the game's shape, not a defect, and the first campaign proved that reporting it as
    // one produces a bug report that has to be withdrawn.
    const machineStill = run.simSeconds - run.lastTransitionSimSeconds;
    if (machineStill > run.maxMachineStillSeconds) run.maxMachineStillSeconds = machineStill;

    const seen = fingerprint();
    if (seen !== run.lastFingerprint) {
      run.lastFingerprint = seen;
      run.lastChangeSimSeconds = run.simSeconds;
      return;
    }
    const still = run.simSeconds - run.lastChangeSimSeconds;
    if (still >= stuckSimulatedSeconds && roundRunningStates.indexOf(state) === -1) {
      report(
        'stuck',
        `${state} has not changed in ${still.toFixed(1)} simulated seconds with no round running`,
        true,
      );
    }
  };

  for (let i = 0; i < steps.length && run.stopped === null; i += 1) {
    const step = steps[i];
    const opStartedAt = scope.performance.now();
    try {
      if (step.op === 'advance') advance(step.seconds);
      else if (step.op === 'key') {
        scope.window.dispatchEvent(
          new scope.KeyboardEvent('keydown', {
            code: step.code,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else if (step.op === 'blur') scope.window.dispatchEvent(new scope.Event('blur'));
      else if (step.op === 'focus') scope.window.dispatchEvent(new scope.Event('focus'));
      else if (step.op === 'visibility') setVisibility(step.hidden === true);
      else if (step.op === 'pumpFrame') {
        run.framesPumped += scope.__kobiMonkeyFrames.pump(run.simSeconds * 1000) > 0 ? 1 : 0;
      } else if (step.op === 'observe') {
        run.actionIndex = step.actionIndex;
        run.actionsApplied = step.actionIndex + 1;
        observe();
      }
    } catch (error) {
      report('threw', String(/** @type {any} */ (error)?.message ?? error), true);
    }
    const opCost = run.opCost[step.op] ?? { count: 0, wallMs: 0 };
    opCost.count += 1;
    opCost.wallMs += scope.performance.now() - opStartedAt;
    run.opCost[step.op] = opCost;
  }

  return {
    simSeconds: run.simSeconds,
    hiddenSeconds: run.hiddenSeconds,
    framesPumped: run.framesPumped,
    resizes: scope.__kobiMonkeyFrames.resizes(),
    maxMachineStillSeconds: run.maxMachineStillSeconds,
    expensiveSeconds: run.expensiveSeconds,
    expensiveSkippedSeconds: run.expensiveSkippedSeconds,
    stateCost: run.stateCost,
    opCost: run.opCost,
    statesVisited: run.statesVisited.slice(),
    transitions: run.transitions.slice(),
    problems: run.problems.slice(),
    problemCount: run.problemCount,
    actionsApplied: run.actionsApplied,
    stopped: run.stopped,
  };
}

/** Pages that already carry {@link monkeyFramePumpInitScript}; an init script is added, never replaced. */
const harnessed = new WeakSet();

/**
 * Installs the frame pump on a page. Idempotent, because `page.addInitScript` accumulates and a campaign
 * drives hundreds of seeds through one page.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installMonkeyHarness(page) {
  if (harnessed.has(page)) return;
  harnessed.add(page);
  await page.addInitScript(monkeyFramePumpInitScript);
}

/**
 * Runs one seed's actions against the built site and reports what happened.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {number} options.seed
 * @param {MonkeyAction[]} [options.actions] - defaults to {@link generateActions} for this seed.
 * @param {number} [options.actionCount] - how many to generate when `actions` is not given.
 * @param {((input: object) => {rule: string, detail: string}[]) | null} [options.invariants]
 * @param {object} [options.invariantConfig]
 * @param {number} [options.frameSeconds]
 * @param {number} [options.stuckSimulatedSeconds]
 * @returns {Promise<MonkeyResult>}
 */
export async function runMonkeySession(page, options) {
  const {
    seed,
    actionCount = 500,
    actions = generateActions(seed, actionCount),
    invariants = null,
    invariantConfig = {},
    frameSeconds = FRAME_SECONDS,
    stuckSimulatedSeconds = STUCK_SIMULATED_SECONDS,
  } = options;

  /** @type {string[]} */
  const pageErrors = [];
  const onPageError = (/** @type {Error} */ error) =>
    pageErrors.push(`pageerror: ${error.message}`);
  const onConsole = (/** @type {import('@playwright/test').ConsoleMessage} */ message) => {
    if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  const startedAt = Date.now();
  let loadMs = 0;
  let stepsMs = 0;
  let resizeMs = 0;
  try {
    await installMonkeyHarness(page);
    // Every seed starts at the designed size, so one seed's last resize can never reach the next one and
    // make a run depend on the order it was played in.
    await page.setViewportSize({ ...DEFAULT_VIEWPORT });
    await page.goto(`/?test=1&seed=${seed}`);
    // Interval polling, like the resize wait below and for the same reason: Playwright's default is to poll
    // on `requestAnimationFrame`, which the frame pump has replaced with a queue that only fires when the
    // monkey says so. A `raf`-polled wait would evaluate its predicate once and then never again.
    await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi), undefined, {
      polling: 50,
    });
    loadMs = Date.now() - startedAt;

    const stretches = compileStretches(actions);
    /** @type {any} */
    let raw = {
      simSeconds: 0,
      hiddenSeconds: 0,
      framesPumped: 0,
      maxMachineStillSeconds: 0,
      expensiveSeconds: 0,
      expensiveSkippedSeconds: 0,
      stateCost: {},
      opCost: {},
      statesVisited: [],
      transitions: [],
      problems: [],
      problemCount: 0,
      actionsApplied: 0,
      stopped: null,
    };

    for (const stretch of stretches) {
      const stepsStartedAt = Date.now();
      raw = await page.evaluate(runMonkeyStepsInPage, {
        steps: stretch.steps,
        invariantsSource: invariants === null ? null : invariants.toString(),
        invariantConfig,
        frameSeconds,
        stuckSimulatedSeconds,
        roundRunningStates: [...ROUND_RUNNING_STATES],
        knownStates: [...KNOWN_STATES],
        expensiveStates: [...STATES_THAT_RENDER_UNASKED],
        expensiveBudgetSeconds: EXPENSIVE_STATE_BUDGET_SECONDS,
        maxReportedProblems: MAX_REPORTED_PROBLEMS,
        maxTraceEntries: MAX_TRACE_ENTRIES,
      });
      stepsMs += Date.now() - stepsStartedAt;
      if (raw.stopped !== null) break;
      if (stretch.resize === null) continue;
      const resizeStartedAt = Date.now();
      // The counter comes back with the stretch rather than in a round trip of its own: a campaign has
      // hundreds of resizes and a `page.evaluate` costs about a third of a second here.
      const before = raw.resizes;
      await page.setViewportSize({ ...stretch.resize });
      // The counter is incremented by a listener registered before the application's own, so a move here is
      // proof the game's `resize` handler has run for the same event — a `setViewportSize` alone only
      // promises the browser was told.
      await page.waitForFunction(
        (count) => /** @type {any} */ (globalThis).__kobiMonkeyFrames.resizes() > count,
        before,
        // Interval polling, not Playwright's default `raf`: the frame pump above is exactly the thing that
        // stops animation frames from firing, so a `raf`-polled wait inside a monkey run would evaluate its
        // predicate once and then never again. It cost a run of this suite to find, and it is the kind of
        // interaction that only shows up when the harness replaces a browser primitive.
        { timeout: 10_000, polling: 10 },
      );
      resizeMs += Date.now() - resizeStartedAt;
    }

    /** @type {MonkeyResult} */
    const result = {
      seed,
      actionCount: actions.length,
      actionsApplied: raw.actionsApplied,
      simSeconds: raw.simSeconds,
      hiddenSeconds: raw.hiddenSeconds,
      framesPumped: raw.framesPumped,
      statesVisited: raw.statesVisited,
      maxMachineStillSeconds: raw.maxMachineStillSeconds,
      expensiveSeconds: raw.expensiveSeconds,
      expensiveSkippedSeconds: raw.expensiveSkippedSeconds,
      stateCost: raw.stateCost,
      opCost: raw.opCost,
      transitions: raw.transitions,
      problems: raw.problems,
      problemCount: raw.problemCount,
      stopped: raw.stopped,
      pageErrors,
      wallMs: Date.now() - startedAt,
      timing: { loadMs, stepsMs, resizeMs, stretches: stretches.length },
    };

    // The Node-side half of the checks (this module's header): the table is an import here, and the
    // transition log is exact rather than sampled, so this can be strict.
    for (const problem of analyseRun(result)) {
      result.problemCount += 1;
      if (result.problems.length < MAX_REPORTED_PROBLEMS) result.problems.push(problem);
    }
    return result;
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}
