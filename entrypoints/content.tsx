import { Show, createMemo, createSignal, type Component } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "../styles/content.css";
import {
  GET_PULL_REQUEST_STATUS,
  type PullRequestLocator,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../lib/ghff";

const ROOT_ID = "ghff-status-root";
const PAGE_CACHE_TTL_MS = 30_000;
const URL_CHECK_INTERVAL_MS = 750;
const PR_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

type StatusTone = "loading" | "success" | "muted" | "error" | "neutral";

type StatusCardState =
  | {
      kind: "loading";
    }
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "loaded";
      result: PullRequestStatusResult;
    };

type StatusCardPresentation = {
  tone: StatusTone;
  title: string;
  detail?: string;
  meta?: string;
  actionLabel?: string;
};

type PageCacheEntry = {
  cachedAt: number;
  result: PullRequestStatusResult;
};

// GitHub swaps PR pages with Turbo/PJAX, so the content script has to keep
// enough state to debounce refreshes and ignore stale async responses.
const pageState = {
  cache: new Map<string, PageCacheEntry>(),
  currentPath: "",
  pendingKey: null as string | null,
  requestId: 0,
  scheduled: false,
};

const StatusCard: Component<{ state: StatusCardState }> = (props) => {
  const presentation = createMemo<StatusCardPresentation>(() => {
    if (props.state.kind === "loading") {
      return {
        tone: "loading",
        title: "Checking fast-forward status",
      };
    }

    if (props.state.kind === "error") {
      return {
        tone: "error",
        title: "Fast-forward status unavailable",
        detail: props.state.message,
      };
    }

    switch (props.state.result.status) {
      case "ff-possible":
        return {
          tone: "success",
          title: "Fast-forward merge possible",
          meta: `${props.state.result.aheadBy} commit${props.state.result.aheadBy === 1 ? "" : "s"} ahead`,
          actionLabel: "Fast-forward merge",
        };
      case "up-to-date":
        return {
          tone: "neutral",
          title: "Already up to date",
        };
      case "cross-repository":
        return {
          tone: "muted",
          title: "Fast-forward merge not supported",
        };
      case "base-ahead":
      case "diverged":
        return {
          tone: "muted",
          title: "Fast-forward merge not possible",
        };
      case "closed":
        return {
          tone: "neutral",
          title: "Pull request is not open",
        };
      default:
        return {
          tone: "error",
          title: "Fast-forward status unavailable",
          detail: "GitHub did not return a comparison state this extension understands.",
        };
    }
  });

  return (
    <section class={`ghff-status ghff-status--${presentation().tone}`}>
      <div class="ghff-status__title">{presentation().title}</div>
      <Show when={presentation().detail}>
        <div class="ghff-status__detail">{presentation().detail}</div>
      </Show>
      <Show when={presentation().meta}>
        <div class="ghff-status__meta">{presentation().meta}</div>
      </Show>
      <Show when={presentation().actionLabel}>
        <div class="ghff-status__actions">
          <button class="ghff-status__button" type="button">
            {presentation().actionLabel}
          </button>
        </div>
      </Show>
    </section>
  );
};

function main() {
  pageState.currentPath = location.pathname;

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const [state, setState] = createSignal<StatusCardState>({ kind: "loading" });

  render(() => <StatusCard state={state()} />, root);

  // Re-run the PR check after both full page loads and GitHub's partial
  // navigations so the card follows in-app route changes.
  refresh(root, setState);

  window.addEventListener("load", () => refresh(root, setState));
  window.addEventListener("popstate", () => refresh(root, setState));
  document.addEventListener("pjax:end", () => refresh(root, setState), true);
  document.addEventListener("turbo:load", () => refresh(root, setState), true);
  document.addEventListener("turbo:render", () => refresh(root, setState), true);

  setInterval(() => {
    if (location.pathname === pageState.currentPath) {
      return;
    }

    pageState.currentPath = location.pathname;
    refresh(root, setState);
  }, URL_CHECK_INTERVAL_MS);
}

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  runAt: "document_idle",
  main,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refresh(root: HTMLDivElement, setState: (state: StatusCardState) => void) {
  // Ignore refresh() call if refresh() has been called within
  // 100 milliseconds.
  //
  // GitHub can fire several navigation-related events for one transition.
  // Following logic collapses them into a single refresh tick.
  if (pageState.scheduled) {
    return;
  }
  pageState.scheduled = true;
  await sleep(100);
  pageState.scheduled = false;

  //
  // Actual refresh logic starts here.
  //

  // Parse URL
  const match = location.pathname.match(PR_PATH_PATTERN);
  if (!match) {
    removeRoot(root);
    return;
  }
  const prMatch: PullRequestLocator = {
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3]),
  };
  const signature = `${prMatch.owner}/${prMatch.repo}#${prMatch.pullNumber}`;

  // Find mount target in the PR sidebar
  const mountTarget = document.querySelector<HTMLElement>("#partial-discussion-sidebar");
  if (!mountTarget) {
    removeRoot(root);
    return;
  }
  // Ensure the root is mounted properly
  if (mountTarget.nextElementSibling !== root) {
    mountTarget.insertAdjacentElement("afterend", root);
  }

  const cached = pageState.cache.get(signature);

  // Reuse recent API results while the user flips between tabs inside the
  // same pull request page.
  if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
    setState({
      kind: "loaded",
      result: cached.result,
    });
    return;
  }

  setState({ kind: "loading" });

  if (pageState.pendingKey === signature) {
    return;
  }

  pageState.pendingKey = signature;
  const requestId = ++pageState.requestId;

  try {
    const result = await requestPullRequestStatus(prMatch);
    // Drop late responses from older requests when the user navigates quickly
    // between pull requests.
    if (requestId !== pageState.requestId) {
      return;
    }

    pageState.cache.set(signature, {
      result,
      cachedAt: Date.now(),
    });
    setState({
      kind: "loaded",
      result,
    });
  } catch (error) {
    if (requestId !== pageState.requestId) {
      return;
    }

    setState({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (pageState.pendingKey === signature) {
      pageState.pendingKey = null;
    }
  }
}

function removeRoot(root: HTMLDivElement) {
  root.remove();
}

async function requestPullRequestStatus(
  request: PullRequestLocator,
): Promise<PullRequestStatusResult> {
  // Ask the background worker to call the GitHub API so the content script
  // stays focused on DOM work.
  const response = await browser.runtime.sendMessage({
    type: GET_PULL_REQUEST_STATUS,
    ...request,
  } satisfies PullRequestStatusRequest);
  const typedResponse = response as PullRequestStatusResponse | undefined;

  if (!typedResponse?.ok) {
    throw new Error(typedResponse?.error.message ?? "The extension could not fetch PR status.");
  }

  return typedResponse.result;
}
