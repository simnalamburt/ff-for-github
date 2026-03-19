import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "./style.css";
import { GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY } from "../../utils/protocol";

const GITHUB_FINE_GRAINED_TOKEN_PATTERN = /^github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}$/;
const GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH = 93;
const GITHUB_FINE_GRAINED_TOKEN_CREATION_URL =
  "https://github.com/settings/personal-access-tokens/new?name=Fast-forward%20merge%20for%20GitHub&description=A%20fine-grained%20token%20for%20the%20Chrome%20extension%20Fast-forward%20merge%20for%20GitHub.&expires_in=none&contents=write";
const GITHUB_CURRENT_USER_URL = "https://api.github.com/user";
const GITHUB_VALIDATION_DEBOUNCE_MS = 400;

type GitHubUserResponse = {
  login?: unknown;
};

type TokenValidationState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; login: string; expirationLabel: string }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

function sanitizeTokenInput(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_]/g, "").slice(0, GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH);
}

function parseTokenExpirationHeader(headerValue: string | null) {
  if (headerValue === null) {
    return null;
  }

  const normalizedValue = headerValue.trim().replace(" UTC", "Z").replace(" ", "T");
  const parsedDate = new Date(normalizedValue);
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate;
  }

  const fallbackDate = new Date(headerValue);
  return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
}

function formatDurationPart(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatTokenExpirationLabel(expiresAt: Date | null) {
  if (expiresAt === null) {
    return "No expiration.";
  }

  const millisecondsRemaining = expiresAt.getTime() - Date.now();
  if (millisecondsRemaining <= 0) {
    return "Expired.";
  }

  const totalMinutes = Math.floor(millisecondsRemaining / 60_000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  let relativeLabel = "";
  if (totalDays >= 1) {
    const remainingHours = totalHours % 24;
    relativeLabel =
      remainingHours > 0
        ? `${formatDurationPart(totalDays, "day")} ${formatDurationPart(remainingHours, "hour")}`
        : formatDurationPart(totalDays, "day");
  } else if (totalHours >= 1) {
    const remainingMinutes = totalMinutes % 60;
    relativeLabel =
      remainingMinutes > 0
        ? `${formatDurationPart(totalHours, "hour")} ${formatDurationPart(remainingMinutes, "minute")}`
        : formatDurationPart(totalHours, "hour");
  } else {
    relativeLabel = formatDurationPart(Math.max(totalMinutes, 1), "minute");
  }

  const absoluteLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    expiresAt,
  );
  return `Expires in ${relativeLabel} (${absoluteLabel}).`;
}

async function validateGitHubFineGrainedToken(
  token: string,
  signal: AbortSignal,
): Promise<TokenValidationState> {
  try {
    const response = await fetch(GITHUB_CURRENT_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { kind: "invalid", message: "Invalid token." };
    }

    if (!response.ok) {
      return { kind: "error", message: "Could not validate the token right now." };
    }

    const payload = (await response.json()) as GitHubUserResponse;
    if (typeof payload.login !== "string" || payload.login === "") {
      return { kind: "error", message: "Could not determine the token owner." };
    }

    return {
      kind: "valid",
      login: payload.login,
      expirationLabel: formatTokenExpirationLabel(
        parseTokenExpirationHeader(response.headers.get("GitHub-Authentication-Token-Expiration")),
      ),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    return { kind: "error", message: "Could not validate the token right now." };
  }
}

function OptionsPage() {
  const [token, setToken] = createSignal("");
  const [hasSavedToken, setHasSavedToken] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal("");
  const [tokenValidation, setTokenValidation] = createSignal<TokenValidationState>({
    kind: "idle",
  });

  const trimmedToken = () => token().trim();
  const hasTokenInput = () => trimmedToken() !== "";
  const hasValidTokenInput = () => GITHUB_FINE_GRAINED_TOKEN_PATTERN.test(trimmedToken());
  const hasInvalidTokenInput = () => {
    const validation = tokenValidation();
    return hasTokenInput() && (!hasValidTokenInput() || validation.kind === "invalid");
  };
  const validTokenValidation = () => {
    const validation = tokenValidation();
    return validation.kind === "valid" ? validation : null;
  };
  const failedTokenValidation = () => {
    const validation = tokenValidation();
    return validation.kind === "invalid" || validation.kind === "error" ? validation : null;
  };

  onMount(async () => {
    const stored = await browser.storage.local.get(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
    const savedToken = stored[GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY];
    setHasSavedToken(typeof savedToken === "string" && savedToken.trim() !== "");
  });

  createEffect(() => {
    const currentToken = trimmedToken();

    if (currentToken === "" || !hasValidTokenInput()) {
      setTokenValidation({ kind: "idle" });
      return;
    }

    setTokenValidation({ kind: "checking" });

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const validation = await validateGitHubFineGrainedToken(
          currentToken,
          abortController.signal,
        );
        if (!abortController.signal.aborted) {
          setTokenValidation(validation);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setTokenValidation({ kind: "error", message: "Could not validate the token right now." });
      }
    }, GITHUB_VALIDATION_DEBOUNCE_MS);

    onCleanup(() => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    });
  });

  async function saveToken(event: SubmitEvent) {
    event.preventDefault();
    if (!hasTokenInput()) {
      return;
    }
    if (!hasValidTokenInput()) {
      setStatusMessage("");
      return;
    }
    if (tokenValidation().kind !== "valid") {
      setStatusMessage("");
      return;
    }

    setIsSaving(true);

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

    try {
      await browser.storage.local.remove(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
      setToken("");
      setHasSavedToken(false);
      setStatusMessage("Token removed.");
      setTokenValidation({ kind: "idle" });
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
          fast-forward merge actions.
        </p>
        <p class="ghff-options__link-row">
          <a
            class="ghff-options__link"
            href={GITHUB_FINE_GRAINED_TOKEN_CREATION_URL}
            target="_blank"
            rel="noreferrer"
          >
            Create a fine-grained token on GitHub
          </a>
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
            }}
            placeholder="github_pat_..."
            spellcheck={false}
            autocomplete="off"
            maxLength={GITHUB_FINE_GRAINED_TOKEN_MAX_LENGTH}
            aria-invalid={hasInvalidTokenInput()}
          />
          <Show when={hasTokenInput() && !hasValidTokenInput()}>
            <p class="ghff-options__error">Invalid token format.</p>
          </Show>
          <Show when={hasValidTokenInput()}>
            <Show when={tokenValidation().kind === "checking"}>
              <p class="ghff-options__status ghff-options__status--muted" role="status">
                Checking token...
              </p>
            </Show>
            <Show when={validTokenValidation()}>
              {(validation) => (
                <p class="ghff-options__status" role="status">
                  Valid token for{" "}
                  <span class="ghff-options__status-login">@{validation().login}</span>.{" "}
                  {validation().expirationLabel}
                </p>
              )}
            </Show>
            <Show when={failedTokenValidation()}>
              {(validation) => (
                <p class="ghff-options__status ghff-options__status--error" role="status">
                  {validation().message}
                </p>
              )}
            </Show>
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
              disabled={
                isSaving() ||
                !hasTokenInput() ||
                !hasValidTokenInput() ||
                tokenValidation().kind !== "valid"
              }
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
