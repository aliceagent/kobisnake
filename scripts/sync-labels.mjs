#!/usr/bin/env node
// Make the repository's labels match .github/labels.json.
//
// Agent sessions cannot write repository settings, and labels are close enough to settings that the request
// proxy refuses them too, so this script exists to be run by a human (or by CI with a token):
//
//   GITHUB_TOKEN=<a token with `repo` scope> node scripts/sync-labels.mjs            # apply
//   GITHUB_TOKEN=... node scripts/sync-labels.mjs --dry-run                          # show what would change
//   GITHUB_TOKEN=... node scripts/sync-labels.mjs --prune                            # also delete extras
//
// It creates labels that are missing, updates colour and description where they drift, and leaves labels
// that are not in the file alone unless --prune says otherwise (deleting a label also removes it from every
// issue that carries it, so that is never the default).
//
// No dependencies: Node 20's built-in fetch is all this needs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY ?? 'aliceagent/kobisnake';
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const token = process.env.GITHUB_TOKEN;
const dryRun = process.argv.includes('--dry-run');
const prune = process.argv.includes('--prune');

if (!token) {
  console.error('GITHUB_TOKEN is not set. Create a token with `repo` scope and try again.');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const wanted = JSON.parse(readFileSync(join(here, '..', '.github', 'labels.json'), 'utf8'));

/**
 * Call the GitHub API and fail loudly, because a half-applied label set is worse than none.
 *
 * @param {string} path e.g. `/repos/owner/name/labels`
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

async function listExistingLabels() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/repos/${REPO}/labels?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

const existing = await listExistingLabels();
const byName = new Map(existing.map((label) => [label.name, label]));
const plan = { created: [], updated: [], deleted: [], unchanged: 0 };

for (const label of wanted) {
  const current = byName.get(label.name);
  if (!current) {
    plan.created.push(label.name);
    if (!dryRun) await api(`/repos/${REPO}/labels`, { method: 'POST', body: label });
  } else if (
    current.color.toLowerCase() !== label.color.toLowerCase() ||
    (current.description ?? '') !== label.description
  ) {
    plan.updated.push(label.name);
    if (!dryRun) {
      await api(`/repos/${REPO}/labels/${encodeURIComponent(label.name)}`, {
        method: 'PATCH',
        body: { new_name: label.name, color: label.color, description: label.description },
      });
    }
  } else {
    plan.unchanged += 1;
  }
}

if (prune) {
  const wantedNames = new Set(wanted.map((label) => label.name));
  for (const label of existing) {
    if (wantedNames.has(label.name)) continue;
    plan.deleted.push(label.name);
    if (!dryRun)
      await api(`/repos/${REPO}/labels/${encodeURIComponent(label.name)}`, { method: 'DELETE' });
  }
}

const verb = dryRun ? 'would be' : '';
console.log(
  `${REPO}: ${plan.created.length} created ${verb}, ${plan.updated.length} updated ${verb}, ` +
    `${plan.deleted.length} deleted ${verb}, ${plan.unchanged} already correct`,
);
for (const name of plan.created) console.log(`  + ${name}`);
for (const name of plan.updated) console.log(`  ~ ${name}`);
for (const name of plan.deleted) console.log(`  - ${name}`);
if (!prune && existing.some((label) => !wanted.find((w) => w.name === label.name))) {
  console.log(
    'Labels on the repository that are not in .github/labels.json were left alone (--prune removes them).',
  );
}
