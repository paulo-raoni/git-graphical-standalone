import { BRIDGE_GLOBAL_NAME } from '../contracts/index';

/**
 * The product's display name, as the window shows it.
 *
 * It is spelled here and in the document's title, and nowhere else. The final
 * name is still an owner decision (`docs/INPUTS.md`, open item 6), so it is kept
 * in one place per process rather than threaded through the contract.
 */
const APPLICATION_NAME = 'Git Graphical Standalone';

/** What the window says when it has nothing to draw. */
const EMPTY_STATE_MESSAGE = 'No repository is open.';

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

/**
 * Build the empty state.
 *
 * The document is assembled from elements and `textContent` rather than from a
 * markup string, so that no path in the renderer can ever interpret data as
 * markup. The content security policy in the document forbids inline script;
 * this is the same rule applied to the code that runs after it.
 */
function buildEmptyState(): HTMLElement {
  const container = document.createElement('section');
  container.className = 'empty-state';

  const title = document.createElement('h1');
  title.className = 'empty-state__title';
  title.textContent = APPLICATION_NAME;

  const message = document.createElement('p');
  message.className = 'empty-state__message';
  message.textContent = EMPTY_STATE_MESSAGE;

  container.append(title, message);
  return container;
}

function render(): void {
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('The document has no #app element to render into.');
  }
  root.replaceChildren(buildEmptyState());
}

assertBridgeIsPresent();
render();
