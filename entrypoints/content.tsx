import { Show, createSignal, type Component } from "solid-js";
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

type StatusView = {
  tone: StatusTone;
  status: string;
  title: string;
  detail?: string;
  meta?: string;
  action?: {
    label: string;
  };
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

const StatusCard: Component<{ view: StatusView }> = (props) => {
  return (
    <section class={`ghff-status ghff-status--${props.view.tone}`} data-status={props.view.status}>
      <div class="ghff-status__title">{props.view.title}</div>
      <Show when={props.view.detail}>
        <div class="ghff-status__detail">{props.view.detail}</div>
      </Show>
      <Show when={props.view.meta}>
        <div class="ghff-status__meta">{props.view.meta}</div>
      </Show>
      <Show when={props.view.action}>
        <div class="ghff-status__actions">
          <button class="ghff-status__button" type="button">
            {props.view.action?.label}
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

  const [view, setView] = createSignal<StatusView>({
    tone: "loading",
    status: "loading",
    title: "Checking fast-forward status",
  });

  render(() => <StatusCard view={view()} />, root);

  // Re-run the PR check after both full page loads and GitHub's partial
  // navigations so the card follows in-app route changes.
  refresh(root, setView);

  window.addEventListener("load", () => refresh(root, setView));
  window.addEventListener("popstate", () => refresh(root, setView));
  document.addEventListener("pjax:end", () => refresh(root, setView), true);
  document.addEventListener("turbo:load", () => refresh(root, setView), true);
  document.addEventListener("turbo:render", () => refresh(root, setView), true);

  setInterval(() => {
    if (location.pathname === pageState.currentPath) {
      return;
    }

    pageState.currentPath = location.pathname;
    refresh(root, setView);
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

async function refresh(root: HTMLDivElement, setView: (view: StatusView) => void) {
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

  // Find mount target
  //
  // Prefer the discussion sidebar as a mount target, but fallback to the header
  // if GitHub shifts the layout.
  const mountTarget =
    document.querySelector<HTMLElement>("#partial-discussion-sidebar") ??
    document.querySelector<HTMLElement>("#pr-conversation-sidebar") ??
    document.querySelector<HTMLElement>("main h1")?.closest<HTMLElement>("header") ??
    null;
  if (!mountTarget) {
    await sleep(250);
    return refresh(root, setView);
  }

  ensureMounted(root, mountTarget);

  const cached = pageState.cache.get(signature);

  // Reuse recent API results while the user flips between tabs inside the
  // same pull request page.
  if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
    setView(buildViewModel(cached.result));
    return;
  }

  setView({
    tone: "loading",
    status: "loading",
    title: "Checking fast-forward status",
  });

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
    setView(buildViewModel(result));
  } catch (error) {
    if (requestId !== pageState.requestId) {
      return;
    }

    setView({
      tone: "error",
      status: "error",
      title: "Fast-forward status unavailable",
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (pageState.pendingKey === signature) {
      pageState.pendingKey = null;
    }
  }
}

function ensureMounted(root: HTMLDivElement, mountTarget: HTMLElement) {
  const shouldAppend = mountTarget.id === "pr-conversation-sidebar";

  if (shouldAppend) {
    // The sidebar wrapper is the outer fallback container, so append the card
    // as its last child instead of inserting it between GitHub-owned siblings.
    if (root.parentElement !== mountTarget || mountTarget.lastElementChild !== root) {
      mountTarget.append(root);
    }
    return;
  }

  if (
    root.previousElementSibling !== mountTarget ||
    root.parentElement !== mountTarget.parentElement
  ) {
    mountTarget.insertAdjacentElement("afterend", root);
  }
}

function removeRoot(root: HTMLDivElement) {
  root.remove();
}

function buildViewModel(result: PullRequestStatusResult): StatusView {
  // Keep the sidebar copy compact: headline first, ahead count only when it
  // adds actionable information for a mergeable pull request.
  switch (result.status) {
    case "ff-possible":
      return {
        tone: "success",
        status: result.status,
        title: "Fast-forward merge possible",
        meta: `${result.aheadBy} commit${result.aheadBy === 1 ? "" : "s"} ahead`,
        action: {
          label: "Fast-forward merge",
        },
      };
    case "up-to-date":
      return {
        tone: "neutral",
        status: result.status,
        title: "Already up to date",
      };
    case "cross-repository":
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not supported",
      };
    case "base-ahead":
    case "diverged":
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not possible",
      };
    case "closed":
      return {
        tone: "neutral",
        status: result.status,
        title: "Pull request is not open",
      };
    default:
      return {
        tone: "error",
        status: result.status,
        title: "Fast-forward status unavailable",
        detail: "GitHub did not return a comparison state this extension understands.",
      };
  }
}

function requestPullRequestStatus(request: PullRequestLocator): Promise<PullRequestStatusResult> {
  // Ask the background worker to call the GitHub API so the content script
  // stays focused on DOM work.
  return browser.runtime
    .sendMessage({
      type: GET_PULL_REQUEST_STATUS,
      ...request,
    } satisfies PullRequestStatusRequest)
    .then((response) => {
      const typedResponse = response as PullRequestStatusResponse | undefined;

      if (!typedResponse?.ok) {
        throw new Error(typedResponse?.error.message ?? "The extension could not fetch PR status.");
      }

      return typedResponse.result;
    });
}
