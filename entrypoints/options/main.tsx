import { Show, createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "./style.css";
import { GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY } from "../../utils/protocol";

function OptionsPage() {
  const [token, setToken] = createSignal("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal("");

  onMount(async () => {
    const stored = await browser.storage.local.get(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
    const savedToken = stored[GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY];
    setToken(typeof savedToken === "string" ? savedToken : "");
  });

  async function saveToken(event: SubmitEvent) {
    event.preventDefault();
    setIsSaving(true);

    try {
      await browser.storage.local.set({
        [GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY]: token().trim(),
      });
      setStatusMessage("Token saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeToken() {
    setIsSaving(true);

    try {
      await browser.storage.local.remove(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
      setToken("");
      setStatusMessage("Token removed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main class="ghff-options">
      <div class="ghff-options__card">
        <h1 class="ghff-options__title">Fast-forward merge for GitHub</h1>
        <p class="ghff-options__lead">
          Save a GitHub fine-grained personal access token for authenticated API requests and future
          fast-forward merge actions.
        </p>

        <form class="ghff-options__form" onSubmit={saveToken}>
          <label class="ghff-options__label" for="github-token">
            Fine-grained personal access token
          </label>
          <input
            id="github-token"
            class="ghff-options__input"
            type="password"
            value={token()}
            onInput={(event) => setToken(event.currentTarget.value)}
            placeholder="github_pat_..."
            spellcheck={false}
            autocomplete="off"
          />
          <p class="ghff-options__hint">
            The token is stored in this browser profile with <code>storage.local</code>.
          </p>

          <div class="ghff-options__actions">
            <button
              class="ghff-options__button ghff-options__button--primary"
              type="submit"
              disabled={isSaving()}
            >
              Save token
            </button>
            <button
              class="ghff-options__button ghff-options__button--secondary"
              type="button"
              onClick={removeToken}
              disabled={isSaving() || token() === ""}
            >
              Remove token
            </button>
          </div>
        </form>

        <Show when={statusMessage()}>
          <p class="ghff-options__status" role="status">
            {statusMessage()}
          </p>
        </Show>
      </div>
    </main>
  );
}

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Options page root was not found.");
}

render(() => <OptionsPage />, root);
