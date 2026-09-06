// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-01-01's QA plan for this exact spec: "loads the page, asserts canvas exists and no console errors."
 * SwiftShader (this environment has no GPU) prints its own environment warnings to the console — e.g.
 * "Automatic fallback to software WebGL" and GL_CLOSE_PATH_NV performance notices — which are not errors and
 * must not be asserted on; this only checks messages of type "error" and uncaught page errors, which are
 * genuinely zero.
 *
 * Originally written against the Sprint 01 scaffold cube; KS-03-05 replaced that scene, but the assertion
 * itself — a canvas renders, `#ui` is attached, nothing errors — still holds against whatever `index.html`
 * renders today, so only the wording below changed.
 */
test.describe('KS-01-03 smoke', () => {
  test('KS-01-03 AC1: npm run test:e2e passes — the page renders a canvas with zero console errors', async ({
    page,
  }) => {
    /** @type {string[]} */
    const consoleErrors = [];
    /** @type {string[]} */
    const pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(DEFAULT_QUERY);

    await expect(page.locator('#game')).toBeVisible();
    await expect(page.locator('#ui')).toBeAttached();

    expect(consoleErrors, `console.error messages: ${consoleErrors.join('\n')}`).toEqual([]);
    expect(pageErrors, `uncaught page errors: ${pageErrors.join('\n')}`).toEqual([]);
  });
});
