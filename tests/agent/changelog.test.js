// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * KI-19-04 — the changelog discipline, asserted where it can be.
 *
 * AC2 ("a `player-visible` PR without a changelog line goes red") is a property of a GitHub workflow reacting
 * to a label, and no unit test can prove that end to end — that is demonstrated on a real pull request, and
 * the demonstration is linked from this ticket's PR. What a test *can* hold still is everything the workflow
 * depends on: that it fires on the label events at all (the whole reason it is a separate workflow), that it
 * gates on the right label, that its failure message tells the author what to write, and that the changelog
 * itself is in the shape Keep a Changelog describes.
 *
 * Read as text, for the same reason `supplyChain.test.js` is: there is no YAML parser here and `CLAUDE.md`
 * forbids adding a dependency for one.
 */

const WORKFLOW = '.github/workflows/changelog.yml';

describe('KI-19-04 changelog discipline', () => {
  it('KI-19-04 AC1: the changelog is backfilled and in Keep a Changelog shape', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    expect(changelog).toMatch(/^# Changelog$/m);
    expect(changelog).toContain('keepachangelog.com');
    expect(changelog).toMatch(/^## \[Unreleased\]$/m);
    // The three categories the backfill actually uses; Keep a Changelog's other three (Deprecated, Removed,
    // Security) have nothing to say about a game that has not shipped yet, and inventing empty headings for
    // them would be noise.
    for (const heading of ['### Added', '### Changed', '### Fixed']) {
      expect(changelog).toContain(heading);
    }
  });

  it('KI-19-04 AC1: the backfill reaches back to the first playable and forward to the current main', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    // A spot-check of the span rather than an inventory: the earliest player-visible thing this project
    // shipped (two-player play, Sprint 03) and one of the most recent (the HOW TO PLAY panel, KI-10-03). If
    // either end is missing, "backfilled through the current main" is not true.
    expect(changelog).toContain('Two-player local play');
    expect(changelog).toContain('HOW TO PLAY');
    // The two findings the agent QA pass (#119) raised as majors, both of which a player meets directly.
    expect(changelog).toContain('A match of draws now ends');
    expect(changelog).toContain('The apple is easier to see');
  });

  it('KI-19-04 AC2: the check fires when a label is added, not only when code is pushed', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    // The load-bearing line. A label is normally applied *after* CI has run, so a check that only fires on
    // push would pass an unlabelled PR and never re-run once the label arrived.
    //
    // Asserted against the `types:` line itself, not against the words appearing somewhere in the file. A
    // first version of this test used `toContain('labeled')` and **survived deleting both triggers**: the
    // words are in this workflow's own header comment, and `labeled` is a substring of `unlabeled` into the
    // bargain. It was caught by mutating the workflow and watching the test stay green, which is the only
    // reason it is not still passing for nothing.
    const types = workflow.match(/^\s*types:\s*\[([^\]]*)\]/m);
    expect(types, 'the workflow declares no pull_request `types:` list').not.toBeNull();
    const declared = String(types?.[1] ?? '')
      .split(',')
      .map((t) => t.trim());
    expect(declared).toContain('labeled');
    expect(declared).toContain('unlabeled');
  });

  it('KI-19-04 AC2: the check gates on the player-visible label and looks at CHANGELOG.md', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    expect(workflow).toContain(
      "contains(github.event.pull_request.labels.*.name, 'player-visible')",
    );
    expect(workflow).toContain("grep -qx 'CHANGELOG.md'");
    expect(workflow).toContain('exit 1');
  });

  it('KI-19-04 AC2: the failure says what to write, not merely that something is missing', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    // The sprint file's Risks section: "every gate must fail with a message that says what to do".
    expect(workflow).toContain('## [Unreleased]');
    expect(workflow).toContain('### Added');
    expect(workflow).toContain('Write it for the player');
    // And the escape hatch, so nobody bends a changelog around a mislabelled PR.
    expect(workflow).toContain('the label is the thing to remove');
  });

  it('KI-19-04: the pull-request template asks the question the label answers', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8');
    expect(template).toContain('## Player-visible?');
    expect(template).toContain('player-visible');
    expect(template).toContain('CHANGELOG.md');
  });

  it('KI-19-04: the rule is written down where the build team reads it', () => {
    const roles = readFileSync('docs/process/AGENT-ROLES-AND-WORKFLOW.md', 'utf8');
    expect(roles).toContain('player-visible');
    expect(roles).toContain('CHANGELOG.md');
    // The limitation is stated rather than implied: the check cannot catch an unlabelled PR that should have
    // been labelled, and a reader who does not know that will over-trust it.
    expect(roles).toContain('one-directional');
  });
});
