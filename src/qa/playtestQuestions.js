// @ts-check

/**
 * The playtest question bank as data (Improvement 11 "Playtest capture mode",
 * `docs/sprints/improvement-11-playtest-capture-mode.md` KI-11-01). Every field below is lifted verbatim
 * from `docs/qa/PLAYTEST-SCRIPT.md` §2–§8 — no question here is worded, punctuated or capitalised any
 * differently than its cell in that table. `tests/unit/qa/playtestQuestions.test.js` parses the markdown
 * itself and asserts both directions of that equality, which is what keeps the two from drifting; do not
 * edit a `question`, `procedure` or `passCondition` string here without first changing the script.
 *
 * `src/qa/` is pure data and pure functions — no DOM, no three.js — so it imports cleanly into a Node/Vitest
 * test and keeps the same discipline `src/core/` keeps for the simulation (ARCHITECTURE §3).
 *
 * §9 and §10 of the script (rewards/shop/tutorial, the feel checklist) are Gate 2 only and out of scope for
 * this ticket; they are not represented here. The `Bot stat` row under §5 is a 500-round bot statistic, not
 * a question a human answers between rounds, and is excluded the same way the parsing test excludes it: its
 * first cell does not match the question-id pattern (see {@link QUESTION_ID_PATTERN}).
 */

/** Every human-facing question id in `PLAYTEST-SCRIPT.md` §2–§8 starts with a letter and a number. This is
 * the one rule that decides what is a question and what is not — the script's own `Q` column headers, its
 * `|---|---|` separator rows, and the `Bot stat` row all fail it, so nothing here needs to name them. */
export const QUESTION_ID_PATTERN = /^[A-Z]\d+\b/;

/** Answer types actually used in §2–§8. `yes-no` covers almost every pass condition ("answer yes", "Majority
 * yes", "Nobody says…"); `choice` is used only where the script itself spells out a complete, closed set of
 * named answers (`A2`, `A4`). Nothing in §2–§8 asks for a 1–5 rating, so no such type is defined here — that
 * is the correct reading of the script, not a gap. */
export const ANSWER_TYPES = /** @type {const} */ ({
  YES_NO: 'yes-no',
  CHOICE: 'choice',
});

/** The three trigger shapes the script's own procedure text produces (tech-lead notes on issue #160):
 * a fixed number of rounds having been played, the laser phase having actually been seen at least once
 * (not merely "a round having happened" — a round that never armed its lasers does not satisfy this), and
 * the end of the session. `A2` needs both the first and the second at once — its own procedure names both
 * "after 5 rounds" and the lasers having come — which {@link AfterRoundTrigger}'s `requiresLaserPhase` flag
 * expresses without a fourth kind. */
export const TRIGGER_KINDS = /** @type {const} */ ({
  AFTER_ROUND: 'after-round',
  LASER_PHASE_SEEN: 'laser-phase-seen',
  END_OF_SESSION: 'end-of-session',
});

/**
 * @typedef {(typeof ANSWER_TYPES)[keyof typeof ANSWER_TYPES]} AnswerType
 * @typedef {(typeof TRIGGER_KINDS)[keyof typeof TRIGGER_KINDS]} TriggerKind
 */

/**
 * @typedef {object} AfterRoundTrigger
 * @property {'after-round'} kind
 * @property {number} roundCount - rounds that must have been played before this question is due
 * @property {boolean} [requiresLaserPhase] - when true, the round count alone is not enough: the laser phase
 *   must also have been seen at least once this session. `A2`'s procedure names both conditions in one
 *   sentence ("did the lasers come too early/late?" *after 5 rounds*) — a round count that never saw a laser
 *   cannot answer a question about the lasers' timing, so this flag makes that the trigger's actual meaning
 *   instead of only its round-count half.
 */

/**
 * @typedef {object} LaserPhaseSeenTrigger
 * @property {'laser-phase-seen'} kind
 */

/**
 * @typedef {object} EndOfSessionTrigger
 * @property {'end-of-session'} kind
 * @property {boolean} [requiresPractice] - **KI-11-05 (#169).** When true, the end of the session is not
 *   enough: practice mode must exist in the build. `V3`'s procedure is "Grow both snakes past 15 segments in
 *   **practice mode**", and practice mode arrives in Sprint 15 — so until it does, that question cannot be
 *   performed, and `G2`'s whole pass condition is the cross-reference "See V3." Before Improvement 11 a
 *   facilitator simply skipped a row that did not apply; `?playtest=1` removed the facilitator, so the rule
 *   the facilitator was applying has to be written down. Same shape as {@link AfterRoundTrigger}'s
 *   `requiresLaserPhase`, and for the same reason: a question is not asked before it can honestly be
 *   answered (AC2).
 */

/** @typedef {AfterRoundTrigger | LaserPhaseSeenTrigger | EndOfSessionTrigger} Trigger */

/**
 * The facts a trigger is checked against — a shape KI-11-02 (the between-round prompt) can build cheaply
 * from a session in progress, without this module needing to know anything about `src/game` or `src/core`.
 *
 * @typedef {object} RoundFacts
 * @property {number} roundsPlayed - rounds completed so far in this session
 * @property {boolean} laserPhaseSeen - true once any round's lasers have armed (left the parked state) at
 *   least once this session; false for a session where every round ended before `laserStartTime`
 * @property {boolean} sessionOver - true once the match itself has ended
 * @property {boolean} practiceExists - **KI-11-05 (#169).** Whether this build has practice mode at all
 *   (Sprint 15). False for every build before it lands, which is what keeps `V3` and `G2` from being put to
 *   two humans who have no way to perform them.
 */

/**
 * @typedef {object} PlaytestQuestion
 * @property {string} id - matches {@link QUESTION_ID_PATTERN}, unique, taken from the script's `Q` column
 * @property {number} section - the script's section number (2-8)
 * @property {string} sectionTitle - the script's section heading, verbatim, with the leading "N. " removed
 * @property {string} question - the script's `Q` cell, verbatim, with the leading id removed
 * @property {string | null} procedure - the script's `Procedure` cell, verbatim; `null` where the script's
 *   table for that section has no `Procedure` column (§6-§8)
 * @property {string} passCondition - the script's `Pass condition` cell, verbatim
 * @property {AnswerType} answerType
 * @property {readonly string[] | null} choices - the closed answer set, verbatim words from the script,
 *   for {@link ANSWER_TYPES.CHOICE} questions; `null` for {@link ANSWER_TYPES.YES_NO}
 * @property {Trigger} trigger
 */

/**
 * @param {number} roundCount
 * @param {{requiresLaserPhase?: boolean}} [options]
 * @returns {AfterRoundTrigger}
 */
const afterRound = (roundCount, options) => ({
  kind: TRIGGER_KINDS.AFTER_ROUND,
  roundCount,
  ...(options?.requiresLaserPhase ? { requiresLaserPhase: true } : {}),
});

/** @type {LaserPhaseSeenTrigger} */
const laserPhaseSeen = { kind: TRIGGER_KINDS.LASER_PHASE_SEEN };

/** @type {EndOfSessionTrigger} */
const endOfSession = { kind: TRIGGER_KINDS.END_OF_SESSION };

/** `end-of-session`, and only once practice mode exists to perform the question in (#169). */
/** @type {EndOfSessionTrigger} */
const endOfSessionNeedingPractice = {
  kind: TRIGGER_KINDS.END_OF_SESSION,
  requiresPractice: true,
};

/** @type {readonly PlaytestQuestion[]} */
export const PLAYTEST_QUESTIONS = [
  // §2 Movement (play 3 rounds)
  {
    id: 'M1',
    section: 2,
    sectionTitle: 'Movement (play 3 rounds)',
    question: 'Responsive',
    procedure: 'Both players tap quick alternating turns.',
    passCondition:
      'Every intended turn is taken; no player says "it ignored me" more than once in 3 rounds.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(3),
  },
  {
    id: 'M2',
    section: 2,
    sectionTitle: 'Movement (play 3 rounds)',
    question: 'Buffered turns',
    procedure: 'Press two directions quickly (e.g. Up then Left within 100 ms).',
    passCondition: 'Snake performs both turns on consecutive cells.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(3),
  },
  {
    id: 'M3',
    section: 2,
    sectionTitle: 'Movement (play 3 rounds)',
    question: 'Reversal safety',
    procedure: 'Press the opposite direction while moving.',
    passCondition: 'Nothing happens; snake does not die.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(3),
  },
  {
    id: 'M4',
    section: 2,
    sectionTitle: 'Movement (play 3 rounds)',
    question: 'Smoothness',
    procedure: 'Watch a long snake corner.',
    passCondition:
      'Motion glides; no visible snapping; corners bend as in `09-snake-turning-animation.png`.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(3),
  },

  // §3 Visibility
  {
    id: 'V1',
    section: 3,
    sectionTitle: 'Visibility',
    question: 'Find your head',
    procedure: 'Glance away, look back, point at your head.',
    passCondition: 'Both players find it in < 1 s every time.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'V2',
    section: 3,
    sectionTitle: 'Visibility',
    question: 'Colour readability',
    procedure: 'Play a round during the laser phase (red lighting).',
    passCondition:
      'Red snake still distinguishable from lasers and blue; players do not confuse heads.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: laserPhaseSeen,
  },
  {
    id: 'V3',
    section: 3,
    sectionTitle: 'Visibility',
    question: 'Long snakes',
    procedure: 'Grow both snakes past 15 segments in practice mode.',
    passCondition: 'Both remain readable; segments do not merge visually.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSessionNeedingPractice,
  },

  // §4 Collision fairness (play 5 rounds)
  {
    id: 'C1',
    section: 4,
    sectionTitle: 'Collision fairness (play 5 rounds)',
    question: 'Fair deaths',
    procedure: 'After each death ask the loser "was that fair?"',
    passCondition: '≥ 4/5 answer yes; any "no" is reproduced with a replay and filed.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(5),
  },
  {
    id: 'C2',
    section: 4,
    sectionTitle: 'Collision fairness (play 5 rounds)',
    question: 'Head vs body',
    procedure: 'Deliberately brush bodies side-by-side.',
    passCondition: 'No death from body contact.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(5),
  },
  {
    id: 'C3',
    section: 4,
    sectionTitle: 'Collision fairness (play 5 rounds)',
    question: 'Head-on',
    procedure:
      'Charge each other head-on, once at equal length and once after one player eats more.',
    passCondition:
      'Equal: both die, DRAW shown, round replays. Unequal: the longer snake survives and both players can say why.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: afterRound(5),
  },

  // §5 Arena closing
  {
    id: 'A1',
    section: 5,
    sectionTitle: 'Arena closing',
    question: 'Warning obvious',
    procedure: 'Do not look at the timer; notice the warning.',
    passCondition: 'Both players notice within 1 s (banner + sting + lights).',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: laserPhaseSeen,
  },
  {
    id: 'A2',
    section: 5,
    sectionTitle: 'Arena closing',
    question: 'Start time',
    procedure: 'Ask "did the lasers come too early/late?" after 5 rounds.',
    passCondition: 'Majority say "about right". Otherwise propose `laserStartTime` change.',
    // The script abbreviates the two "too early" / "too late" outcomes as "too early/late"; both words are
    // spelled out here as the two answers that phrase names, alongside "about right", which the script
    // already writes out in full (tech-lead notes on issue #160).
    answerType: ANSWER_TYPES.CHOICE,
    choices: ['too early', 'too late', 'about right'],
    // The procedure names both conditions in one sentence: "after 5 rounds" AND the lasers having actually
    // come. A round count alone cannot answer whether the lasers were early or late if nobody saw one
    // (#119 F3: 14.8% of rounds ever reach 30s, median round 16.0s — five short rounds is the expected
    // Gate 1 case, not an edge case), so this trigger requires both facts.
    trigger: afterRound(5, { requiresLaserPhase: true }),
  },
  {
    id: 'A3',
    section: 5,
    sectionTitle: 'Arena closing',
    question: 'Shrink speed',
    procedure: 'Ask "could you see where the laser will be next?"',
    passCondition: 'Yes; nobody dies to a step they could not see coming.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: laserPhaseSeen,
  },
  {
    id: 'A4',
    section: 5,
    sectionTitle: 'Arena closing',
    question: 'Climax',
    procedure: 'Ask "was the ending exciting or frustrating?"',
    passCondition: '≥ 4/5 rounds "exciting".',
    answerType: ANSWER_TYPES.CHOICE,
    choices: ['exciting', 'frustrating'],
    trigger: laserPhaseSeen,
  },

  // §6 Round length
  {
    id: 'R1',
    section: 6,
    sectionTitle: 'Round length',
    question: '"Does 90 s feel right?"',
    procedure: null,
    passCondition: 'Majority yes.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'R2',
    section: 6,
    sectionTitle: 'Round length',
    question: 'Rounds decided before timeout',
    procedure: null,
    passCondition: '≥ 80 % of human rounds end by death.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },

  // §7 Growth
  {
    id: 'G1',
    section: 7,
    sectionTitle: 'Growth',
    question: 'Growing makes it more interesting',
    procedure: null,
    passCondition: 'Players seek apples without being told.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'G2',
    section: 7,
    sectionTitle: 'Growth',
    question: 'Long snakes stay readable',
    procedure: null,
    passCondition: 'See V3.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSessionNeedingPractice,
  },

  // §8 Power-ups
  {
    id: 'P1',
    section: 8,
    sectionTitle: 'Power-ups',
    question: 'Add strategy',
    procedure: null,
    passCondition: 'Players change route to grab a power-up at least once per round.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'P2',
    section: 8,
    sectionTitle: 'Power-ups',
    question: 'Too random?',
    procedure: null,
    passCondition: 'Nobody says a power-up "decided" a round unfairly more than once in 5 rounds.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'P3',
    section: 8,
    sectionTitle: 'Power-ups',
    question: 'Frequency',
    procedure: null,
    passCondition: 'Ask about 15 s: majority "about right".',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'P4',
    section: 8,
    sectionTitle: 'Power-ups',
    question: 'Speed boost duration/controllability',
    procedure: null,
    passCondition: '5 s feels good; no uncontrollable deaths attributed to boost.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    id: 'P5',
    section: 8,
    sectionTitle: 'Power-ups',
    question: 'Slow behaviour',
    procedure: null,
    passCondition:
      'Players understand who got slowed within one use; ask whether "slow opponent" is the fun choice.',
    answerType: ANSWER_TYPES.YES_NO,
    choices: null,
    trigger: endOfSession,
  },
  {
    // KI-04-03: the question `docs/qa/playtests/round-pacing.md` measured but could not answer. The matrix
    // says `roundDuration` moves the climax fraction most and `laserStartTime` moves it without shortening
    // the round; which of those a *player* prefers is not something 14 509 bot rounds can report, so the
    // design lead deferred the value to this session (#229, `DESIGN-DECISIONS §1` row 30) and shipped both
    // candidates as tuning-overlay chips instead of changing `settings.js`.
    //
    // `end-of-session`, not `laser-phase-seen`: the procedure is three whole Best-of-3 matches compared
    // against each other, so it cannot be asked between two rounds the way A1-A4 are.
    //
    // **Last in the bank on purpose, despite being a §5 question.** `selectDueQuestions` offers in this
    // array's order, so position is meaning: asking A5 earlier would push a question out of its gap
    // (`MAX_QUESTIONS_PER_GAP` is 2), and worse, A5 makes the players spend a whole Best-of-3 on a 75 s
    // round — after which `R1` ("does 90 s feel right?") is no longer a question about the shipping
    // round length. A5 has to come after every question its own procedure would colour.
    id: 'A5',
    section: 5,
    sectionTitle: 'Arena closing',
    question: 'Pacing presets',
    procedure:
      'Session 2 only, with ?tuning=1: play a Best-of-3 on each of the three Pacing chips — round 75 s, ' +
      'laser at 0:40, and 90 s / 0:30 (shipping). A chip applies from the next round, so click it before ' +
      'the countdown.',
    passCondition: 'A clear majority prefer one chip, or an explicit "cannot tell them apart".',
    answerType: ANSWER_TYPES.CHOICE,
    // The three chip labels verbatim, plus the answer the pass condition explicitly allows — a session that
    // genuinely cannot separate them must be able to say so rather than being forced to pick one.
    choices: ['round 75 s', 'laser at 0:40', '90 s / 0:30 (shipping)', 'cannot tell them apart'],
    trigger: endOfSession,
  },
];

/**
 * Looks up a question by id.
 *
 * @param {string} id
 * @returns {PlaytestQuestion | undefined}
 */
export function findQuestionById(id) {
  return PLAYTEST_QUESTIONS.find((question) => question.id === id);
}

/**
 * Whether a trigger's laser-phase condition can only ever be satisfied by a round that actually saw the
 * lasers — true for {@link TRIGGER_KINDS.LASER_PHASE_SEEN} and for an {@link AfterRoundTrigger} carrying
 * `requiresLaserPhase`. Exported so a laser-gated question list (KI-11-02's prompt, or this file's own
 * tests) can be derived from the data instead of hand-maintained, which is what stops a future §5 question
 * from being added and quietly missing the same gate `A2` was missing.
 *
 * @param {Trigger} trigger
 * @returns {boolean}
 */
export function triggerRequiresLaserPhase(trigger) {
  return (
    trigger.kind === TRIGGER_KINDS.LASER_PHASE_SEEN ||
    (trigger.kind === TRIGGER_KINDS.AFTER_ROUND && trigger.requiresLaserPhase === true)
  );
}

/**
 * Whether `trigger` has happened yet, given `facts` about the session so far. Pure and cheap so KI-11-02 can
 * call it every round without keeping its own copy of the rule: an `after-round` trigger needs enough rounds
 * played, and — when it also {@link triggerRequiresLaserPhase} — the lasers having actually armed too, since
 * a round count alone cannot answer a question about the lasers if nobody ever saw one; a `laser-phase-seen`
 * trigger needs the lasers to have actually armed at least once — a round that ended before `laserStartTime`
 * never satisfies it, however many rounds have been played; an `end-of-session` trigger needs the match
 * itself to be over.
 *
 * @param {Trigger} trigger
 * @param {RoundFacts} facts
 * @returns {boolean}
 */
export function isTriggerDue(trigger, facts) {
  switch (trigger.kind) {
    case TRIGGER_KINDS.AFTER_ROUND:
      return (
        facts.roundsPlayed >= trigger.roundCount &&
        (!trigger.requiresLaserPhase || facts.laserPhaseSeen)
      );
    case TRIGGER_KINDS.LASER_PHASE_SEEN:
      return facts.laserPhaseSeen;
    case TRIGGER_KINDS.END_OF_SESSION:
      // #169: `requiresPractice` questions wait for the mode their own procedure names, however over the
      // session is — the same "not before it can honestly be answered" rule `requiresLaserPhase` applies.
      if (trigger.requiresPractice === true && !facts.practiceExists) return false;
      return facts.sessionOver;
    default:
      return false;
  }
}
