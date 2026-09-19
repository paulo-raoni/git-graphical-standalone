import { BRIDGE_GLOBAL_NAME } from '../contracts/index';
import type { GraphPage } from '../contracts/index';

import { mountGraphTable } from './graph-table';
import type { GraphTableView } from './graph-table';

/**
 * The renderer's entry point: assert the window was built correctly, mount the
 * view, and publish the three things the rest of the application drives it with.
 */

/** Where the view is published on the window's global. */
const VIEW_GLOBAL_NAME = 'gitGraphicalView';

/**
 * The view, as everything outside this ring sees it.
 *
 * **Why it is on a global at all.** S06 composes the application in-process and
 * imports `mountGraphTable` directly; it does not need this. The end-to-end gate
 * does. `src/ui/renderer.ts` is a bundle entry point that runs at module scope,
 * so without a published handle there is no seam for a driver to hand the view a
 * page — and the alternative, a second bundle entry holding fixtures, would ship
 * test data in the distributable and would need a size budget that is not this
 * task's to write. One named property costs the bundle a few bytes and keeps the
 * fixtures in `test/e2e/`, where the driver builds them and this ring never sees
 * them.
 */
export interface GraphTableGlobal {
  /** Mount a table into an element, which is what S06 calls. */
  readonly mount: (root: HTMLElement) => GraphTableView;
  /** Hand the mounted view a page to draw. */
  readonly showPage: (page: GraphPage) => void;
  /** Register the listener the Load More Commits control calls. */
  readonly onLoadMore: (listener: () => void) => void;
}

declare global {
  interface Window {
    /**
     * The mounted view. Present in every window this renderer starts; absent
     * anywhere else, which is why nothing may assume it.
     */
    gitGraphicalView?: GraphTableGlobal;
  }
}

/**
 * Fail loudly when the preload did not run.
 *
 * A window created without the bridge looks identical to a correct one until
 * something tries to use it, which would be several slices from now. Checking at
 * startup turns a silent misconfiguration of `webPreferences` into an error in
 * the console of the very window that has it.
 */
function assertBridgeIsPresent(): void {
  if (!(BRIDGE_GLOBAL_NAME in window)) {
    throw new Error(
      `The preload bridge "${BRIDGE_GLOBAL_NAME}" is missing: this window was created without it.`,
    );
  }
}

function start(): void {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('The document has no #app element to render into.');
  }
  const view = mountGraphTable(root);
  window[VIEW_GLOBAL_NAME] = {
    mount: mountGraphTable,
    showPage: view.showPage,
    onLoadMore: view.onLoadMore,
  };
}

assertBridgeIsPresent();
start();
