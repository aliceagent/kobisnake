// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KI-03-05 AC2 — "no two Playwright suites run at once in any job" (#86: two concurrent suites in one
 * container corrupt both).
 *
 * The runtime guarantee is `scripts/run-playwright-suite.mjs`, whose container-wide lock makes a second suite
 * wait for the first. This file guards the one way that guarantee can be lost: a workflow calling
 * `playwright test` **around** the runner instead of through it. That is a thing a future ticket adds without
 * malice — it is what `nightly.yml` did until this ticket — and nothing else would notice.
 *
 * Two jobs in the same workflow run on **different runners**, which are different containers and cannot
 * contend at all, so "two jobs" is not the hazard and this file does not pretend to check it. The hazard is
 * two suites in one job, and the only defence that survives someone not reading a comment is the lock. Hence
 * the assertion below is about routing, not about job graphs.
 */

const WORKFLOW_DIR = '.github/workflows';

/** `npx playwright install` is not a suite; `playwright test` is. */
const RUNS_A_SUITE = /playwright\s+test\b/;

/** The runner every Playwright invocation must go through, directly or through one of the npm scripts. */
const RUNNER = 'scripts/run-playwright-suite.mjs';

/**
 * The npm scripts that are themselves defined as the runner (checked against package.json below).
 *
 * KI-08-04 added the two `tests/perf` suites. They belong here for the same reason the first three do, and
 * the gap was real rather than theoretical: this list is what the reporter check below uses to decide
 * whether a workflow step is running a suite, so until a script is named here, a workflow could run it with
 * no `--reporter=github` and nothing would notice — leaving a CI failure readable only in a job log that an
 * agent session cannot open.
 *
 * `test:perf` itself is deliberately **not** here: it is an umbrella that shells out to the two scripts
 * below (`npm run test:perf:bundle && npm run test:perf:drawcalls`) rather than naming the runner itself, so
 * the package.json assertion below would fail on it for a reason that is not a defect. Workflows invoke the
 * specific scripts; the umbrella is for a person at a terminal.
 */
const ROUTED_NPM_SCRIPTS = [
  'test:e2e',
  'test:visual',
  'test:agent',
  'test:perf:drawcalls',
  'test:perf:frametime',
  // KI-18-01 added the session fuzzer's campaign, which `agent-playtest.yml` runs as its own job. Same
  // reasoning as the two `test:perf` entries above: this list is what the reporter check reads to decide
  // whether a workflow step is running a suite at all.
  'test:agent:monkey',
];

function workflowFiles() {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }));
}

/**
 * Every `run:` command in a workflow, each folded onto one line.
 *
 * A hand-rolled reader rather than a YAML parser because adding a dependency for a test is exactly what
 * `CLAUDE.md` forbids, and because the shape being read is narrow: a `run:` key whose value is either inline
 * or a `|`/`>`/`>-` block of more-indented lines. Folding matters — `nightly.yml` writes its invocation as a
 * `>-` block, so a line-by-line check would see the runner and its `--reporter` flag as unrelated lines.
 *
 * Each entry carries two views of the same `run:` block. `command` is everything, joined — what the lock
 * check needs, since a suite invocation hidden anywhere in a block is still an invocation. `executable`
 * drops lines that merely *print* text (`echo ...`), which the reporter check needs: KI-19-01's failure
 * steps echo `npm run test:e2e` at the developer as the command to reproduce a failure with, and a check
 * that could not tell that from an invocation would force those messages to stop naming the command — which
 * is the one thing the sprint file requires a failing gate to do.
 *
 * @param {string} text
 * @returns {{line: number, command: string, executable: string}[]}
 */
function runCommands(text) {
  const lines = text.split('\n');
  /** @type {{line: number, command: string, executable: string}[]} */
  const commands = [];
  /** Lines that only print text run nothing, whatever they happen to quote. */
  const isEcho = (/** @type {string} */ part) => /^echo\b/.test(part);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)-?\s*run:\s*(.*)$/.exec(lines[i]);
    if (match === null) continue;
    const indent = match[1].length;
    const inline = match[2].trim();
    if (inline !== '' && !/^[|>][-+]?$/.test(inline)) {
      commands.push({ line: i + 1, command: inline, executable: isEcho(inline) ? '' : inline });
      continue;
    }
    const parts = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const body = lines[j];
      if (body.trim() === '') continue;
      const bodyIndent = body.length - body.trimStart().length;
      if (bodyIndent <= indent) break;
      parts.push(body.trim());
      i = j;
    }
    commands.push({
      line: match.index === undefined ? 0 : i + 1,
      command: parts.join(' '),
      executable: parts.filter((part) => !isEcho(part)).join(' '),
    });
  }
  return commands;
}

describe('KI-03-05 AC2 · no two Playwright suites at once', () => {
  it('KI-03-05 AC2: every npm script that runs a Playwright suite goes through the runner', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const script of ROUTED_NPM_SCRIPTS) {
      expect(pkg.scripts[script], `package.json script "${script}"`).toContain(RUNNER);
      // …and does not sneak a second, unlocked invocation in after it.
      expect(pkg.scripts[script].match(RUNS_A_SUITE)).toBeNull();
    }
  });

  it('KI-03-05 AC2: no workflow calls `playwright test` outside the runner', () => {
    /** @type {string[]} */
    const offenders = [];
    for (const { name, text } of workflowFiles()) {
      for (const { line, command } of runCommands(text)) {
        if (!RUNS_A_SUITE.test(command)) continue;
        if (command.includes(RUNNER)) continue;
        offenders.push(`${name}:${line}: ${command}`);
      }
    }
    expect(
      offenders,
      'A workflow runs a Playwright suite without the #86 lock. Route it through ' +
        `\`node ${RUNNER} <label> …\` or one of: ${ROUTED_NPM_SCRIPTS.join(', ')}.`,
    ).toEqual([]);
  });

  it('KI-03-05 AC1: a workflow runs the agent suite on a schedule and on demand, and uploads the report', () => {
    const agent = workflowFiles().find(({ text }) => text.includes('test:agent'));
    expect(agent, 'no workflow runs `npm run test:agent`').toBeDefined();
    const text = /** @type {{name: string, text: string}} */ (agent).text;
    expect(text).toMatch(/schedule:/);
    expect(text).toMatch(/cron:/);
    expect(text).toMatch(/workflow_dispatch:/);
    expect(text).toMatch(/upload-artifact/);
    expect(text).toContain('docs/qa/playtests/agent-run.md');
    // A run of the agent suite must never share a job with another suite.
    expect(text.match(/test:e2e|test:visual/)).toBeNull();
  });

  it('KI-08-04 AC1: the cheap performance budgets run on every pull request', () => {
    // The sprint file's own split: bundle and draw calls on every PR, the expensive frame-time and leak
    // suite nightly. This asserts the per-PR half — that `ci.yml` runs both cheap gates, and that it runs
    // them on `pull_request` at all, which is the difference between a budget and a document.
    const ci = workflowFiles().find(({ name }) => name === 'ci.yml');
    expect(ci, 'ci.yml is missing').toBeDefined();
    const text = /** @type {{name: string, text: string}} */ (ci).text;

    expect(text).toMatch(/pull_request:/);
    expect(text, 'ci.yml does not run the bundle budget').toContain('test:perf:bundle');
    expect(text, 'ci.yml does not run the draw-call budget').toContain('test:perf:drawcalls');
    // The expensive one is deliberately not here (see `nightly.yml`); if it ever moves onto every PR that is
    // a decision, and this line is where it gets made rather than noticed.
    expect(text).not.toContain('test:perf:frametime');
  });

  it('KI-08-04 AC2: no job runs two Playwright suites, and the perf suites are not added to one that already has two', () => {
    // AC2 is about *within* a job: two suites in one container corrupt both (#86). Two jobs are two runners
    // and cannot contend, which is why `ci.yml`'s perf job is separate from `browser` rather than a third
    // step inside it. This counts routed suite invocations per job and holds every job to at most one —
    // except `browser`, whose two are the pre-existing e2e-then-visual pair that KI-03-05 documents as
    // sequential steps in one job, never parallel.
    //
    // The match is anchored on the right, not a plain `includes`: KI-18-01 added `test:agent:monkey`, and
    // every script name is a prefix of any longer one built from it — so `includes('test:agent')` counted the
    // monkey's single invocation as two suites and failed a job that runs one. The lookahead says "this
    // script name, not the start of a longer one".
    const suiteInvocations = (/** @type {string} */ jobText) =>
      ROUTED_NPM_SCRIPTS.filter((script) => new RegExp(`${script}(?![\\w:.-])`).test(jobText))
        .length;

    for (const { name, text } of workflowFiles()) {
      // Jobs start at a two-space-indented key under `jobs:`; split on that rather than parsing YAML, for
      // the same reason `runCommands` is hand-rolled.
      const jobs = text.split(/\n {2}(?=[a-z][\w-]*:\n)/);
      for (const job of jobs) {
        const header = job.split('\n')[0];
        const count = suiteInvocations(job);
        const allowed = job.includes('name: browser') ? 2 : 1;
        expect(
          count,
          `${name}: job "${header}" runs ${count} Playwright suites`,
        ).toBeLessThanOrEqual(allowed);
      }
    }
  });

  it('KI-08-04 AC1: the expensive frame-time and leak budget runs nightly, with its report kept', () => {
    const nightly = workflowFiles().find(({ name }) => name === 'nightly.yml');
    expect(nightly, 'nightly.yml is missing').toBeDefined();
    const text = /** @type {{name: string, text: string}} */ (nightly).text;

    expect(text, 'the nightly perf slot is still a placeholder').toContain('test:perf:frametime');
    expect(text).toMatch(/schedule:/);
    expect(text).toMatch(/upload-artifact/);
    // A nightly run must never rewrite the committed baseline: regenerating it is a person's job, in a PR.
    // The assertion is on the env *assignment*, not on the word — `nightly.yml`'s own comment names the
    // variable to explain why it is unset, and a check that could not tell those apart would force the
    // comment to stop naming it, which is the same trap KI-19-01's echo lines set for the reporter check.
    expect(
      text,
      'nightly.yml sets KI_PERF_BASELINE, so a scheduled run would rewrite the baseline',
    ).not.toMatch(/KI_PERF_BASELINE\s*:/);
  });

  it('KI-03-05: a CI failure is readable as a check-run annotation, not only in the log', () => {
    // The job log and the artifact both redirect to blob storage the egress proxy refuses, so an agent
    // session can only read a failure through the annotations API — which needs Playwright's `github`
    // reporter. Without this the seed a failure names (`failureReasons`, `tests/agent/driver.js`) never
    // reaches anyone who could replay it.
    const runsASuite = (/** @type {string} */ command) =>
      command.includes(RUNNER) || ROUTED_NPM_SCRIPTS.some((script) => command.includes(script));
    let checked = 0;
    for (const { name, text } of workflowFiles()) {
      for (const { line, command, executable } of runCommands(text)) {
        // `executable`, not `command`: a step that *prints* `npm run test:e2e` as the command to reproduce a
        // failure with (KI-19-01's own failure steps do exactly that) is not running a suite, and requiring
        // a `--reporter` flag on a line of prose would only teach people to stop naming the command.
        if (!runsASuite(executable)) continue;
        checked += 1;
        expect(command, `${name}:${line}`).toContain('--reporter=github');
      }
    }
    // A test that checked nothing would pass silently the day the invocations move.
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
