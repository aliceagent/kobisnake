// @ts-check

/**
 * KI-20-03 (`docs/sprints/improvement-20-string-catalogue.md`, tracking #212, ticket #251) — the ESLint rule
 * that keeps `src/ui` honest about KI-20-02's migration: nothing under `src/ui` may hand a hardcoded string
 * of copy to `.textContent`, `.innerText`, a `label` property/assignment, or manufacture one directly inside
 * a function body. Every rendered word has to be a reference into the catalogue instead — `src/ui/strings.js`
 * for every screen except `src/ui/screens/playtestPrompt.js`, which reads `src/ui/strings.playtest.js`
 * (KI-20-06, #317 — the two files are a bundling split, not a naming choice, and this rule's own message
 * points each offending file at the half it is actually supposed to import from).
 *
 * Wired into `npm run lint` by `eslint.config.js`, which imports {@link catalogueOnlyCopyRule} below as a
 * local ESLint plugin rule scoped to `src/ui/**\/*.js`, minus the catalogue's own three files (`strings.js`,
 * `strings.playtest.js`, `deepFreeze.js` — the source of truth, not a consumer of it, and expected to be full
 * of literal copy). `tests/unit/lint/lint-strings.test.js` runs this rule directly through ESLint's own
 * `Linter` class against committed fixture files under `tests/unit/lint/fixtures/`, so both the red case
 * (KI-20-03 AC1) and the green case (AC2, mirrored by the real `npm run lint` run over the live tree) are
 * regression-tested, not just demonstrated once in a PR description.
 *
 * ## What this catches, precisely, and why exactly this and not more
 *
 * Three sink shapes. Each was chosen because a fully migrated tree (this one, today) has zero legitimate
 * hits in it, and a future regression reliably would:
 *
 *   A. `<expr>.textContent = <literal>` / `<expr>.innerText = <literal>`
 *   B. `{ label: <literal> }` (an object literal's `label` property), or `<expr>.label = <literal>`
 *   C. An arrow function whose *concise* (expression, no braces) body directly *is* a literal — a bare
 *      string or template literal, not an expression built from one.
 *
 * (C) is what actually catches a hand-written label-building helper such as `matchSetup.js`'s
 * `COLOUR_NOTE_COPY.suggestion` — a function assigned to an object property, whose *result* is what later
 * reaches a `.textContent` write, several lines and one more indirection away. Tracing a literal all the way
 * from its sink back to its declaration is a general taint tracker this ticket is not sized to build; instead
 * (C) treats "a function that manufactures literal prose" as a violation at its own declaration, wherever it
 * sits — which is also why this rule's name and this module's own doc comment say "a label" rather than only
 * the literal property name `label`: in this codebase a label is at least as often the return value of a
 * small function (`hud.length(player, n)`, `matchSetup.controlsCard(...)`) as it is an object property.
 *
 * (C) is deliberately scoped to a *concise arrow* body only, not every `return` statement in the file: an
 * earlier version of this rule also flagged a bare-literal `return` inside any function body, and it produced
 * a real false positive of its own — a block-bodied function returning a short internal status string (never
 * displayed, e.g. `return 'skip';`) is a completely ordinary pattern with no relationship to display copy.
 * Every concise-arrow-body case actually found in this codebase (`COLOUR_NOTE_COPY.suggestion`, the only one)
 * is caught without it, so the broader check was removed rather than patched with another exemption.
 *
 * `<literal>` above means: a non-empty string `Literal`, or a `TemplateLiteral` whose *static* text (its
 * quasis, joined, ignoring every `${...}` hole) contains a letter. Two consequences fall out of that on their
 * own, with no separate exemption list needed for either:
 *   - `textContent = ''` (a clear) never matches — there is no letter in `''`.
 *   - A template built purely from interpolated catalogue values (`` `${a.b} ${c.d(e)}` ``, only punctuation
 *     or whitespace in the glue) never matches either, because the only thing that could make it a violation
 *     is a hardcoded word in the template's *own* static text, and there is none.
 *
 * ## What this deliberately does not catch (bounded, not broadened)
 *
 * A whole-file scan of every string literal in `src/ui` was tried first and rejected: it lit up on CSS class
 * names (`className`, `iconClass`), inline style objects, `data-*`/`aria-*` attribute names passed to
 * `setAttribute`, MIME types, colour-name data maps (`{ 1: 'red', 2: 'blue' }`), and `STATES`/`GAME_EVENTS`-
 * shaped comparisons (`switch` cases, `===`) — none of which are copy, and none of which sit inside the three
 * sink shapes above. Scoping to those three shapes is what keeps every one of those categories out without a
 * single named exemption for any of them — they are never visited as violations in the first place, not
 * allow-listed after the fact.
 *
 * This is a **structural** check, not a semantic one: a `Literal`/`TemplateLiteral` in one of the three sink
 * shapes is flagged regardless of whether it happens to already equal a string the catalogue carries — the
 * fix is always "read it from the catalogue," never "leave the literal, it matches anyway." It also cannot
 * see a literal reach a sink through more than one hop of indirection (an intermediate variable assigned a
 * literal, then assigned again to `.textContent` several lines later) — the three shapes above are exactly
 * the ones this ticket's spec names, not a general data-flow tracker. Bounded, and documented as such rather
 * than overclaimed.
 *
 * One narrow, deliberate exemption exists in the tree today: `src/ui/screens/matchSetup.js`'s
 * `COLOUR_NOTE_COPY.suggestion` renders `DESIGN-DECISIONS §3`'s colour-note suggestion in a lower-case,
 * player-number-hard-coded form that is a real discrepancy against the catalogue's approved (capitalised,
 * computed) form — tracked on #214, not this ticket's to resolve. It carries its own
 * `eslint-disable-next-line` naming #214, immediately above the literal, so the exemption disappears the day
 * #214 lands rather than living in this rule.
 */

/** File-basename → the catalogue group a screen's copy belongs under, for the "try this key" suggestion.
 * Not exhaustive of every file in `src/ui` (`ui.js`, `focus.js` carry no copy of their own) — those fall back
 * to a generic "the appropriate group" suggestion below rather than a guess. */
const GROUP_BY_BASENAME = new Map([
  ['mainMenu.js', 'menu'],
  ['howToPlayPanel.js', 'howToPlay'],
  ['matchSetup.js', 'matchSetup'],
  ['matchOver.js', 'matchOver'],
  ['scoreboard.js', 'scoreboard'],
  ['pause.js', 'pause'],
  ['countdown.js', 'countdown'],
  ['replay.js', 'replay'],
  ['hud.js', 'hud'],
  ['tuning.js', 'tuning'],
  ['error.js', 'error'],
  ['playtestPrompt.js', 'playtestPrompt'],
]);

/** @param {string} filename @returns {boolean} */
function isPlaytestScreen(filename) {
  return filename.replace(/\\/g, '/').endsWith('src/ui/screens/playtestPrompt.js');
}

/**
 * Which half of the catalogue an offending file should read from — the whole reason this rule's message is
 * generated per file rather than a single fixed string. Never suggests `playtestPrompt.js` import
 * `../strings.js` (#317) and never suggests any other screen import `../strings.playtest.js`.
 * @param {string} filename @returns {string}
 */
function catalogueFileFor(filename) {
  return isPlaytestScreen(filename) ? 'src/ui/strings.playtest.js' : 'src/ui/strings.js';
}

/** @param {string} filename @returns {string | null} */
function groupFor(filename) {
  const basename = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  return GROUP_BY_BASENAME.get(basename) ?? null;
}

/** Lower-cases the first character; not a full camelCase pass, just enough to turn an `Identifier` or
 * `Property` name already in the codebase's own casing convention into a plausible key fragment.
 * @param {string} name @returns {string} */
function toKeyFragment(name) {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '');
  if (cleaned.length === 0) return 'newKey';
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/**
 * Best-effort key-name suggestion from local context — never authoritative, always a starting point for the
 * PR that actually adds the key. @param {import('eslint').Rule.Node} node
 * @param {import('eslint').Rule.Node[]} ancestors @returns {string}
 */
function suggestFragment(node, ancestors) {
  if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression') {
    const object = node.left.object;
    if (object.type === 'Identifier') return toKeyFragment(object.name);
    if (object.type === 'MemberExpression' && object.property.type === 'Identifier') {
      return toKeyFragment(object.property.name);
    }
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = ancestors[i];
    if (
      ancestor.type === 'Property' &&
      !ancestor.computed &&
      (ancestor.key.type === 'Identifier' || ancestor.key.type === 'Literal')
    ) {
      const keyName =
        ancestor.key.type === 'Identifier' ? ancestor.key.name : String(ancestor.key.value);
      return toKeyFragment(keyName);
    }
    if (ancestor.type === 'VariableDeclarator' && ancestor.id.type === 'Identifier') {
      return toKeyFragment(ancestor.id.name);
    }
    if (
      (ancestor.type === 'FunctionDeclaration' || ancestor.type === 'FunctionExpression') &&
      ancestor.id
    ) {
      return toKeyFragment(ancestor.id.name);
    }
  }
  return 'newKey';
}

/** @param {string} filename @param {import('eslint').Rule.Node} node
 * @param {import('eslint').Rule.Node[]} ancestors @returns {string} */
function suggestKey(filename, node, ancestors) {
  const group = groupFor(filename);
  const fragment = suggestFragment(node, ancestors);
  return group ? `${group}.${fragment}` : `<group>.${fragment}`;
}

/** @param {import('estree').Node} node @returns {boolean} whether `node` is a non-empty string literal or a
 * template literal whose static (quasi) text contains a letter — the shape this rule treats as "hardcoded
 * copy", never a catalogue lookup. */
function isFlaggableLiteral(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value.length > 0 && /[A-Za-z]/.test(node.value);
  }
  if (node.type === 'TemplateLiteral') {
    const staticText = node.quasis.map((quasi) => quasi.value.cooked ?? '').join('');
    return /[A-Za-z]/.test(staticText);
  }
  return false;
}

/** @param {import('estree').MemberExpression} member @returns {string | null} */
function memberPropertyName(member) {
  if (member.computed) return null;
  if (member.property.type !== 'Identifier') return null;
  return member.property.name;
}

const CATALOGUE_APPROVAL_NOTE =
  'new copy is a catalogue diff the design lead approves (AGENT-ROLES-AND-WORKFLOW §3.1), never a literal in a screen module';

/** @type {import('eslint').Rule.RuleModule} */
export const catalogueOnlyCopyRule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow a hardcoded string assigned to textContent, innerText, or a label in src/ui — every user-visible string must come from the catalogue',
    },
    schema: [],
    messages: {
      sink: '"{{snippet}}" is a hardcoded literal reaching {{sink}} in {{shortFile}} — not a catalogue lookup. Add a key to {{catalogueFile}} (try `{{suggestedKey}}`) and read it from there instead; {{note}}.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** @param {import('eslint').Rule.Node} node @param {string} sink */
    function report(node, sink) {
      const ancestors = sourceCode.getAncestors(node);
      const text = sourceCode.getText(node);
      context.report({
        node,
        messageId: 'sink',
        data: {
          snippet: text.length > 60 ? `${text.slice(0, 57)}...` : text,
          sink,
          shortFile: filename.replace(/\\/g, '/').split('/src/ui/')[1] ?? filename,
          catalogueFile: catalogueFileFor(filename),
          suggestedKey: suggestKey(filename, node, ancestors),
          note: CATALOGUE_APPROVAL_NOTE,
        },
      });
    }

    return {
      // Sink (A): `<expr>.textContent = <literal>` / `<expr>.innerText = <literal>`.
      // Sink (B), assignment form: `<expr>.label = <literal>`.
      AssignmentExpression(node) {
        if (node.operator !== '=' || node.left.type !== 'MemberExpression') return;
        const propertyName = memberPropertyName(node.left);
        if (
          propertyName !== 'textContent' &&
          propertyName !== 'innerText' &&
          propertyName !== 'label'
        ) {
          return;
        }
        if (isFlaggableLiteral(/** @type {any} */ (node.right))) {
          report(node, `\`.${propertyName}\``);
        }
      },
      // Sink (B), object-literal form: `{ label: <literal> }`.
      Property(node) {
        if (node.computed) return;
        const keyName =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal' && typeof node.key.value === 'string'
              ? node.key.value
              : null;
        if (keyName !== 'label') return;
        if (isFlaggableLiteral(/** @type {any} */ (node.value))) {
          report(node, 'a `label` property');
        }
      },
      // Sink (C): an arrow function's own concise body directly is a literal — see this module's doc
      // comment for why this is scoped to concise arrow bodies only, not every `return` in the file.
      ArrowFunctionExpression(node) {
        if (node.expression && isFlaggableLiteral(/** @type {any} */ (node.body))) {
          report(node, 'a label-building function');
        }
      },
    };
  },
};

export default catalogueOnlyCopyRule;
