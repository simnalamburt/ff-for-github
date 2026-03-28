import { Show, createMemo, createSignal, type Component } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "./style.css";
import {
  GET_PULL_REQUEST_STATUS,
  MERGE_PULL_REQUEST,
  type MergePullRequestRequest,
  type MergePullRequestResponse,
  OPEN_OPTIONS_PAGE,
  type OpenOptionsPageRequest,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../../utils/protocol";

const ROOT_ID = "ghff-root";
const PAGE_CACHE_TTL_MS = 30_000;
const URL_CHECK_INTERVAL_MS = 750;
const PR_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

// GitHub swaps PR pages with Turbo/PJAX, so the content script has to keep
// enough state to debounce refreshes and ignore stale async responses.
const pageState = {
  cache: new Map<string, { cachedAt: number; result: PullRequestStatusResult }>(),
  currentPath: "",
  optimisticClosedUntil: new Map<string, number>(),
  pendingKey: null as string | null,
  requestId: 0,
  scheduled: false,
};

type StatusCardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; result: PullRequestStatusResult };

type MergeState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };
type RefreshOptions = {
  bypassCache?: boolean;
  preserveState?: boolean;
};

const StatusCard: Component<{
  state: StatusCardState;
  mergeState: MergeState;
  onMerge: () => void;
}> = (props) => {
  type StatusCardPresentation = {
    tone: "loading" | "success" | "muted" | "error";
    title: string;
    detail?: string;
    action?: "merge" | "open-options";
  };
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

    const formatStatusDetail = (aheadBy: number) =>
      `${aheadBy} commit${aheadBy === 1 ? "" : "s"} ahead`;
    const action = props.state.result.hasGitHubPersonalAccessToken ? "merge" : "open-options";

    switch (props.state.result.status) {
      case "ff-possible":
        return {
          tone: "success",
          title: "Fast-forward merge possible",
          detail: formatStatusDetail(props.state.result.aheadBy),
          action,
        };
      case "ff-possible-but-closed":
        return {
          tone: "error",
          title: "Fast-forward merge possible, but the pull request is not open",
          detail: formatStatusDetail(props.state.result.aheadBy),
          action,
        };
      case "ff-possible-but-draft":
        return {
          tone: "error",
          title: "Fast-forward merge possible, but the pull request is a draft",
          detail: formatStatusDetail(props.state.result.aheadBy),
          action,
        };
      case "up-to-date":
        return {
          tone: "muted",
          title: "Already up to date",
        };
      case "base-ahead":
      case "diverged":
        return {
          tone: "muted",
          title: "Fast-forward merge not possible",
        };
      case "closed":
        return {
          tone: "muted",
          title: "Pull request is not open",
        };
      case "unknown":
        return {
          tone: "error",
          title: "Fast-forward status unavailable",
          detail: "GitHub did not return a comparison state this extension understands.",
        };
    }
  });

  return (
    <article data-tone={presentation().tone}>
      <div class="ghff-title">{presentation().title}</div>
      <Show when={presentation().detail}>
        <div class="ghff-detail">{presentation().detail}</div>
      </Show>
      <Show when={props.mergeState.kind === "error"}>
        <div class="ghff-detail ghff-detail--error">
          {props.mergeState.kind === "error" ? props.mergeState.message : ""}
        </div>
      </Show>
      <Show when={presentation().action === "merge"}>
        <button
          type="button"
          onClick={() => props.onMerge()}
          disabled={props.mergeState.kind === "submitting"}
        >
          {props.mergeState.kind === "submitting" ? "Fast-forwarding..." : "Fast-forward merge"}
        </button>
      </Show>
      <Show when={presentation().action === "open-options"}>
        <button
          type="button"
          onClick={async () => {
            await browser.runtime.sendMessage({
              type: OPEN_OPTIONS_PAGE,
            } satisfies OpenOptionsPageRequest);
          }}
        >
          Set up GitHub token
        </button>
      </Show>
    </article>
  );
};

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  runAt: "document_idle",
  main() {
    pageState.currentPath = location.pathname;

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const [state, setState] = createSignal<StatusCardState>({ kind: "loading" });
    const [mergeState, setMergeState] = createSignal<MergeState>({ kind: "idle" });

    render(
      () => (
        <StatusCard
          state={state()}
          mergeState={mergeState()}
          onMerge={() => {
            void fastForwardMerge(root, state, setState, setMergeState);
          }}
        />
      ),
      root,
    );

    // Re-run the PR check after both full page loads and GitHub's partial
    // navigations so the card follows in-app route changes.
    refresh(root, setState, setMergeState);

    window.addEventListener("load", () => refresh(root, setState, setMergeState));
    window.addEventListener("popstate", () => refresh(root, setState, setMergeState));
    document.addEventListener("pjax:end", () => refresh(root, setState, setMergeState), true);
    document.addEventListener("turbo:load", () => refresh(root, setState, setMergeState), true);
    document.addEventListener("turbo:render", () => refresh(root, setState, setMergeState), true);

    setInterval(() => {
      if (location.pathname === pageState.currentPath) {
        return;
      }

      pageState.currentPath = location.pathname;
      refresh(root, setState, setMergeState);
    }, URL_CHECK_INTERVAL_MS);
  },
});

async function refresh(
  root: HTMLDivElement,
  setState: (state: StatusCardState) => void,
  setMergeState: (state: MergeState) => void,
  options: RefreshOptions = {},
) {
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
    root.remove();
    setMergeState({ kind: "idle" });
    return;
  }
  const [, owner, repo, pullNumber] = match;
  const signature = `${owner}/${repo}#${pullNumber}`;

  // Find mount target in the PR sidebar
  const mountTarget = document.querySelector<HTMLElement>("#partial-discussion-sidebar");
  if (!mountTarget) {
    root.remove();
    setMergeState({ kind: "idle" });
    return;
  }
  // Ensure the root is mounted properly
  if (mountTarget.nextElementSibling !== root) {
    mountTarget.insertAdjacentElement("beforeend", root);
  }

  const cached = pageState.cache.get(signature);

  // Reuse recent API results while the user flips between tabs inside the
  // same pull request page.
  if (!options.bypassCache && cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
    setMergeState({ kind: "idle" });
    setState({
      kind: "loaded",
      result: cached.result,
    });
    return;
  }

  if (!options.preserveState) {
    setState({ kind: "loading" });
  }

  if (!options.bypassCache && pageState.pendingKey === signature) {
    return;
  }

  pageState.pendingKey = signature;
  const requestId = ++pageState.requestId;

  try {
    // Ask the background worker to call the GitHub API so the content script
    // stays focused on DOM work.
    const response = (await browser.runtime.sendMessage({
      type: GET_PULL_REQUEST_STATUS,
      owner,
      repo,
      pullNumber: Number(pullNumber),
    } satisfies PullRequestStatusRequest)) as PullRequestStatusResponse | undefined;
    if (!response?.ok) {
      throw new Error(response?.error.message ?? "The extension could not fetch PR status.");
    }

    // Drop late responses from older requests when the user navigates quickly
    // between pull requests.
    if (requestId !== pageState.requestId) {
      return;
    }

    const optimisticClosedUntil = pageState.optimisticClosedUntil.get(signature) ?? 0;
    if (optimisticClosedUntil > Date.now() && response.result.status !== "closed") {
      window.setTimeout(() => {
        void refresh(root, setState, setMergeState, {
          bypassCache: true,
          preserveState: true,
        });
      }, 1000);
      return;
    }

    pageState.optimisticClosedUntil.delete(signature);

    if (options.bypassCache) {
      pageState.cache.delete(signature);
    } else {
      pageState.cache.set(signature, {
        result: response.result,
        cachedAt: Date.now(),
      });
    }
    setMergeState({ kind: "idle" });
    setState({
      kind: "loaded",
      result: response.result,
    });
  } catch (error) {
    if (requestId !== pageState.requestId) {
      return;
    }

    if (options.preserveState) {
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

async function fastForwardMerge(
  root: HTMLDivElement,
  state: () => StatusCardState,
  setState: (state: StatusCardState) => void,
  setMergeState: (state: MergeState) => void,
) {
  const match = location.pathname.match(PR_PATH_PATTERN);
  if (!match) {
    setMergeState({ kind: "error", message: "This is no longer a pull request page." });
    return;
  }

  const [, owner, repo, pullNumber] = match;

  setMergeState({ kind: "submitting" });

  try {
    const signature = `${owner}/${repo}#${pullNumber}`;
    const response = (await browser.runtime.sendMessage({
      type: MERGE_PULL_REQUEST,
      owner,
      repo,
      pullNumber: Number(pullNumber),
    } satisfies MergePullRequestRequest)) as MergePullRequestResponse | undefined;
    if (!response?.ok) {
      throw new Error(
        response?.error.message ?? "The extension could not fast-forward merge this PR.",
      );
    }

    const currentState = state();
    const optimisticClosedResult: PullRequestStatusResult = {
      aheadBy: 0,
      hasGitHubPersonalAccessToken:
        currentState.kind === "loaded" ? currentState.result.hasGitHubPersonalAccessToken : true,
      status: "closed",
    };
    pageState.optimisticClosedUntil.set(signature, Date.now() + 5_000);
    pageState.cache.set(signature, {
      result: optimisticClosedResult,
      cachedAt: Date.now(),
    });
    setMergeState({ kind: "idle" });
    setState({
      kind: "loaded",
      result: optimisticClosedResult,
    });

    window.setTimeout(() => {
      pageState.cache.delete(signature);
      void refresh(root, setState, setMergeState, {
        bypassCache: true,
        preserveState: true,
      });
    }, 1500);
  } catch (error) {
    pageState.optimisticClosedUntil.delete(`${owner}/${repo}#${pullNumber}`);
    setMergeState({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
