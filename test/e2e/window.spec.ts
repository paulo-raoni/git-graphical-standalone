import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { BRIDGE_GLOBAL_NAME, CHANNELS } from '../../src/contracts/index';
import { withOwnProfile } from './support/fixtures';

/**
 * Three tests, and no more, because these three are the ones nothing else does.
 *
 * Wave one's reviews found four ways this application can be broken or unsafe
 * while **every static gate passes**, each demonstrated by probe:
 *
 * 1. the window configured with `contextIsolation: false`, `sandbox: false`,
 *    `nodeIntegration: true` — compiles, builds, opens, looks identical;
 * 2. the preload bundled as an ES module, which Electron's sandboxed loader
 *    refuses by name, leaving a blank window;
 * 3. the bridge exposed under a name the contract does not define, also a blank
 *    window;
 * 4. a re-export deleted from the contract index, which the type projects caught
 *    and the boundary gate did not.
 *
 * The empty-state test and the console test catch the blank-window pair; the
 * sandbox test catches the first, and is the only thing in this repository
 * standing between the project and that configuration. That is the whole reason
 * this gate exists, and it is why a skipped or leaked run is never acceptable as
 * "the other gates were green".
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test.beforeAll(() => {
  const entry = join(repositoryRoot, 'dist', 'main.cjs');
  if (!existsSync(entry)) {
    throw new Error(`${entry} does not exist: run \`npm run build\` before the end-to-end gate`);
  }
});

/**
 * Launch the built application with no folder, on a user-data directory of its
 * own, and run `body` against its first window.
 *
 * Every process this suite starts is stopped by this suite: `withOwnProfile`
 * (`./support/fixtures.ts`) closes the application once `body` is done, whatever
 * it did, and reads the exit status back, because a leaked process is a failure
 * of the gate whatever the assertions said.
 */
async function withWindow(body: (page: Page) => Promise<void>): Promise<void> {
  await withOwnProfile({}, async (application) => body(await application.firstWindow()));
}

test('the window opens and shows the empty state', async () => {
  await withWindow(async (page) => {
    await expect(page.locator('.empty-state__title')).toHaveText('Git Graphical Standalone');
    await expect(page.locator('.empty-state__message')).toHaveText('No repository is open.');
  });
});

test('the sandbox is real and the bridge is the contract', async () => {
  await withWindow(async (page) => {
    await expect(page.locator('.empty-state__message')).toBeVisible();
    const observed = await page.evaluate((bridgeName: string) => {
      const scope = globalThis as unknown as Record<string, unknown>;
      const bridge = scope[bridgeName];
      return {
        require: typeof scope['require'],
        process: typeof scope['process'],
        module: typeof scope['module'],
        methods: typeof bridge === 'object' && bridge !== null ? Object.keys(bridge).sort() : null,
      };
    }, BRIDGE_GLOBAL_NAME);

    expect(observed.require).toBe('undefined');
    expect(observed.process).toBe('undefined');
    expect(observed.module).toBe('undefined');
    expect(observed.methods).toEqual(Object.keys(CHANNELS).sort());
  });
});

test('nothing is logged as an error while the renderer starts', async () => {
  await withWindow(async (page) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (failure) => {
      errors.push(failure.message);
    });
    // A reload is a renderer start, and it is the only one this test can be
    // listening to from the beginning: the first window has already loaded by the
    // time a listener can be attached to it.
    await page.reload();
    await expect(page.locator('.empty-state__message')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
