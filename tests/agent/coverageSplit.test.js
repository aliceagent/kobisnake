// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * KI-19-06 — the correctness run and the coverage run are two commands, and both are gates.
 *
 * The failure this guards against is subtle and already happened once: a run with coverage on exceeded
 * birpc's unconfigurable 60-second RPC window, and `npm run test:unit` exited **non-zero with every test
 * passing**. `main` was red for hours on it. The fix is structural — coverage no longer runs over the whole
 * suite — so what needs holding still is the structure, not a number.
 *
 * `vitest.config.js` carries the measurements and the reasoning; these are the invariants that make it true.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const CI_YML = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('KI-19-06 correctness and coverage are separate runs', () => {
  it('KI-19-06: `test:unit` runs every test with coverage off', () => {
    const script = pkg.scripts['test:unit'];
    expect(script).toContain('--coverage.enabled=false');
    // No path argument: it must keep running `tests/sim` and `tests/agent`'s Vitest half, which is the whole
    // point of separating the two — correctness coverage was never the thing being narrowed.
    expect(script).toMatch(/^vitest run\s+--coverage\.enabled=false$/);
  });

  it('KI-19-06: `test:coverage` enforces the thresholds and sets COVERAGE_STRICT itself', () => {
    const script = pkg.scripts['test:coverage'];
    expect(script, 'test:coverage must exist').toBeDefined();
    // Setting the flag inside the script closes the trap the old layout carried: COVERAGE_STRICT lived only
    // in ci.yml, so thresholds were silently 0 locally and a run could be green while the gate was red.
    expect(script).toContain('COVERAGE_STRICT=1');
    expect(script).toContain('tests/unit');
    expect(script).toContain('tests/agent');
  });

  it('KI-19-06: the coverage run excludes tests/sim, and says so somewhere a reader will find it', () => {
    expect(pkg.scripts['test:coverage']).not.toContain('tests/sim');
    // The exclusion is a real trade — a src file covered only by tests/sim would now fall below its floor —
    // so it must be argued in the config, not left for someone to discover from a glob.
    const config = readFileSync('vitest.config.js', 'utf8');
    expect(config).toContain('tests/sim');
    expect(config).toContain('onTaskUpdate');
  });

  it('KI-19-06: CI runs both, under the one check name branch protection already requires', () => {
    // Two steps in the existing `unit` job rather than a new job: a new check would not be required until
    // somebody changed a repository setting agents cannot write, and the coverage gate would be advisory
    // until they did.
    expect(CI_YML).toContain('npm run test:unit');
    expect(CI_YML).toContain('npm run test:coverage');
    const unitJob = CI_YML.slice(CI_YML.indexOf('\n  unit:'), CI_YML.indexOf('\n  build:'));
    expect(unitJob).toContain('npm run test:unit');
    expect(unitJob).toContain('npm run test:coverage');
  });

  it('KI-19-06: the thresholds themselves are unchanged', () => {
    const config = readFileSync('vitest.config.js', 'utf8');
    // QA-STRATEGY §1's floors, and the per-file rule KS-02-07 established. Separating the runs must not have
    // moved any of them; if a future change wants to, it should have to edit this test to say so.
    expect(config).toContain('STRICT ? 90 : 0');
    expect(config).toContain('STRICT ? 75 : 0');
    expect(config).toContain('perFile: true');
  });
});
