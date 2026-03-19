import { Show, createSignal, onMount } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "./style.css";
import { GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY } from "../../utils/protocol";

const GITHUB_FINE_GRAINED_TOKEN_PATTERN = /^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}$/;
const GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH = 93;

function sanitizeTokenInput(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "").slice(0, GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH);
}

function OptionsPage() {
  const [token, setToken] = createSignal("");
  const [hasSavedToken, setHasSavedToken] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal("");
  const [errorMessage, setErrorMessage] = createSignal("");

  const trimmedToken = () => token().trim();
  const hasTokenInput = () => trimmedToken() !== "";
  const hasValidTokenInput = () => GITHUB_FINE_GRAINED_TOKEN_PATTERN.test(trimmedToken());

  onMount(async () => {
    const stored = await browser.storage.local.get(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
    const savedToken = stored[GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY];
    setHasSavedToken(typeof savedToken === "string" && savedToken.trim() !== "");
  });

  async function saveToken(event: SubmitEvent) {
    event.preventDefault();
    if (!hasTokenInput()) {
      return;
    }
    if (!hasValidTokenInput()) {
      setErrorMessage("Invalid token format");
      setStatusMessage("");
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      await browser.storage.local.set({
        [GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY]: trimmedToken(),
      });
      setToken("");
      setHasSavedToken(true);
      setStatusMessage("Token saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeToken() {
    setIsSaving(true);
    setErrorMessage("");

    try {
      await browser.storage.local.remove(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
      setToken("");
      setHasSavedToken(false);
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
          Save a GitHub fine-grained personal access token to enable authenticated API requests and
          future fast-forward merge actions.
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
            onInput={(event) => {
              const sanitizedToken = sanitizeTokenInput(event.currentTarget.value);
              event.currentTarget.value = sanitizedToken;
              setToken(sanitizedToken);
              setStatusMessage("");
              setErrorMessage("");
            }}
            placeholder="github_pat_..."
            spellcheck={false}
            autocomplete="off"
            maxLength={GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH}
            aria-invalid={hasTokenInput() && !hasValidTokenInput()}
          />
          <Show when={hasTokenInput() && !hasValidTokenInput()}>
            <p class="ghff-options__error">Invalid token format.</p>
          </Show>
          <Show when={hasSavedToken()}>
            <p class="ghff-options__hint">
              A token is currently saved. Enter a new one to replace it.
            </p>
          </Show>

          <div class="ghff-options__actions">
            <button
              class="ghff-options__button ghff-options__button--primary"
              type="submit"
              disabled={isSaving() || !hasTokenInput() || !hasValidTokenInput()}
            >
              Save token
            </button>
            <Show when={hasSavedToken()}>
              <button
                class="ghff-options__button ghff-options__button--secondary"
                type="button"
                onClick={removeToken}
                disabled={isSaving()}
              >
                Remove token
              </button>
            </Show>
          </div>
        </form>

        <Show when={errorMessage()}>
          <p class="ghff-options__status ghff-options__status--error" role="alert">
            {errorMessage()}
          </p>
        </Show>

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
