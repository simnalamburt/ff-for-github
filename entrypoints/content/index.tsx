import { Show, createMemo, createSignal, type Component } from "solid-js";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";

import "./style.css";
import {
  GET_COMPARISON_STATUS,
  GET_PULL_REQUEST_STATUS,
  MERGE_COMPARISON,
  MERGE_PULL_REQUEST,
  OPEN_OPTIONS_PAGE,
  type ComparisonStatusRequest,
  type ComparisonStatusResponse,
  type ComparisonStatusResult,
  type MergeComparisonRequest,
  type MergeComparisonResponse,
  type MergePullRequestRequest,
  type MergePullRequestResponse,
  type OpenOptionsPageRequest,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../../utils/protocol";

const ROOT_ID = "ghff-root";
const PAGE_CACHE_TTL_MS = 30_000;
const URL_CHECK_INTERVAL_MS = 750;
const PR_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;
const COMPARE_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/compare\/([^/]+)(?:\/.*)?$/;

type PageKind = "pull-request" | "compare";
type StatusResult = PullRequestStatusResult | ComparisonStatusResult;
type RouteLocator =
  | {
      kind: "pull-request";
      pageKind: PageKind;
      owner: string;
      repo: string;
      pullNumber: number;
      signature: string;
      optimisticStatusAfterMerge: "closed";
    }
  | {
      kind: "compare";
      pageKind: PageKind;
      owner: string;
      repo: string;
      base: string;
      head: string;
      signature: string;
      optimisticStatusAfterMerge: "up-to-date";
    };
type MountInstruction =
  | { kind: "append"; element: HTMLElement }
  | { kind: "before"; element: HTMLElement };
type OptimisticStatus = {
  expectedStatus: StatusResult["status"];
  until: number;
};

// GitHub swaps pages with Turbo/PJAX, so the content script keeps a small
// amount of page-scoped state to debounce refreshes and ignore stale responses.
const pageState = {
  cache: new Map<string, { cachedAt: number; result: StatusResult }>(),
  currentPath: "",
  optimisticStatuses: new Map<string, OptimisticStatus>(),
  pendingKey: null as string | null,
  requestId: 0,
  scheduled: false,
};

type StatusViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; result: StatusResult };

type MergeState = { kind: "idle" } | { kind: "submitting" } | { kind: "error"; message: string };
type RefreshOptions = {
  bypassCache?: boolean;
  preserveState?: boolean;
};
type StatusPresentation = {
  tone: "loading" | "success" | "muted" | "error";
  title: string;
  detail?: string;
  action?: "merge" | "open-options";
};

const StatusActionButton: Component<{
  action?: StatusPresentation["action"];
  mergeState: MergeState;
  onMerge: () => void;
}> = (props) => (
  <>
    <Show when={props.action === "merge"}>
      <button
        type="button"
        onClick={() => props.onMerge()}
        disabled={props.mergeState.kind === "submitting"}
      >
        {props.mergeState.kind === "submitting" ? "Fast-forwarding..." : "Fast-forward merge"}
      </button>
    </Show>
    <Show when={props.action === "open-options"}>
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
  </>
);

const StatusCard: Component<{
  state: StatusViewState;
  mergeState: MergeState;
  onMerge: () => void;
}> = (props) => {
  const presentation = createMemo(() => getStatusPresentation(props.state));

  return (
    <article class="ghff-card" data-tone={presentation().tone}>
      <div class="ghff-title">{presentation().title}</div>
      <Show when={presentation().detail}>
        <div class="ghff-detail">{presentation().detail}</div>
      </Show>
      <Show when={props.mergeState.kind === "error"}>
        <div class="ghff-detail ghff-detail--error">
          {props.mergeState.kind === "error" ? props.mergeState.message : ""}
        </div>
      </Show>
      <StatusActionButton
        action={presentation().action}
        mergeState={props.mergeState}
        onMerge={props.onMerge}
      />
    </article>
  );
};

const ComparisonBanner: Component<{
  state: StatusViewState;
  mergeState: MergeState;
  onMerge: () => void;
}> = (props) => {
  const presentation = createMemo(() => getStatusPresentation(props.state));

  return (
    <article class="ghff-compare-banner" data-tone={presentation().tone}>
      <div class="ghff-compare-banner__copy">
        <div class="ghff-title">{presentation().title}</div>
        <Show when={presentation().detail}>
          <div class="ghff-detail">{presentation().detail}</div>
        </Show>
        <Show when={props.mergeState.kind === "error"}>
          <div class="ghff-detail ghff-detail--error">
            {props.mergeState.kind === "error" ? props.mergeState.message : ""}
          </div>
        </Show>
      </div>
      <Show when={presentation().action}>
        <div class="ghff-compare-banner__actions">
          <StatusActionButton
            action={presentation().action}
            mergeState={props.mergeState}
            onMerge={props.onMerge}
          />
        </div>
      </Show>
    </article>
  );
};

const RootView: Component<{
  pageKind: () => PageKind | null;
  state: () => StatusViewState;
  mergeState: () => MergeState;
  onMerge: () => void;
}> = (props) => (
  <Show when={props.pageKind()}>
    {(currentPageKind) => (
      <Show
        when={currentPageKind() === "compare"}
        fallback={
          <StatusCard
            state={props.state()}
            mergeState={props.mergeState()}
            onMerge={props.onMerge}
          />
        }
      >
        <ComparisonBanner
          state={props.state()}
          mergeState={props.mergeState()}
          onMerge={props.onMerge}
        />
      </Show>
    )}
  </Show>
);

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*", "https://github.com/*/*/compare/*"],
  runAt: "document_idle",
  main() {
    pageState.currentPath = location.pathname;

    const root = document.createElement("div");
    root.id = ROOT_ID;

    const [pageKind, setPageKind] = createSignal<PageKind | null>(null);
    const [state, setState] = createSignal<StatusViewState>({ kind: "loading" });
    const [mergeState, setMergeState] = createSignal<MergeState>({ kind: "idle" });

    render(
      () => (
        <RootView
          pageKind={pageKind}
          state={state}
          mergeState={mergeState}
          onMerge={() => {
            void fastForwardMerge(root, setPageKind, state, setState, setMergeState);
          }}
        />
      ),
      root,
    );

    refresh(root, setPageKind, setState, setMergeState);

    window.addEventListener("load", () => refresh(root, setPageKind, setState, setMergeState));
    window.addEventListener("popstate", () => refresh(root, setPageKind, setState, setMergeState));
    document.addEventListener(
      "pjax:end",
      () => refresh(root, setPageKind, setState, setMergeState),
      true,
    );
    document.addEventListener(
      "turbo:load",
      () => refresh(root, setPageKind, setState, setMergeState),
      true,
    );
    document.addEventListener(
      "turbo:render",
      () => refresh(root, setPageKind, setState, setMergeState),
      true,
    );

    setInterval(() => {
      if (location.pathname === pageState.currentPath) {
        return;
      }

      pageState.currentPath = location.pathname;
      refresh(root, setPageKind, setState, setMergeState);
    }, URL_CHECK_INTERVAL_MS);
  },
});

function getStatusPresentation(state: StatusViewState): StatusPresentation {
  if (state.kind === "loading") {
    return {
      tone: "loading",
      title: "Checking fast-forward status",
    };
  }

  if (state.kind === "error") {
    return {
      tone: "error",
      title: "Fast-forward status unavailable",
      detail: state.message,
    };
  }

  const formatStatusDetail = (aheadBy: number) =>
    `${aheadBy} commit${aheadBy === 1 ? "" : "s"} ahead`;
  const action = state.result.hasGitHubPersonalAccessToken ? "merge" : "open-options";

  switch (state.result.status) {
    case "ff-possible":
      return {
        tone: "success",
        title: "Fast-forward merge possible",
        detail: formatStatusDetail(state.result.aheadBy),
        action,
      };
    case "ff-possible-but-closed":
      return {
        tone: "error",
        title: "Fast-forward merge possible, but the pull request is not open",
        detail: formatStatusDetail(state.result.aheadBy),
        action,
      };
    case "ff-possible-but-draft":
      return {
        tone: "error",
        title: "Fast-forward merge possible, but the pull request is a draft",
        detail: formatStatusDetail(state.result.aheadBy),
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
}

async function refresh(
  root: HTMLDivElement,
  setPageKind: (pageKind: PageKind | null) => void,
  setState: (state: StatusViewState) => void,
  setMergeState: (state: MergeState) => void,
  options: RefreshOptions = {},
) {
  if (pageState.scheduled) {
    return;
  }
  pageState.scheduled = true;
  await sleep(100);
  pageState.scheduled = false;

  const locator = parseCurrentRoute(location.pathname);
  if (!locator) {
    root.remove();
    setPageKind(null);
    setMergeState({ kind: "idle" });
    return;
  }

  const mountInstruction = findMountInstruction(locator);
  if (!mountInstruction) {
    root.remove();
    return;
  }

  setPageKind(locator.pageKind);
  ensureMounted(root, mountInstruction);

  const cached = pageState.cache.get(locator.signature);
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

  if (!options.bypassCache && pageState.pendingKey === locator.signature) {
    return;
  }

  pageState.pendingKey = locator.signature;
  const requestId = ++pageState.requestId;

  try {
    const result = await getStatusResult(locator);
    if (requestId !== pageState.requestId) {
      return;
    }

    const optimisticStatus = pageState.optimisticStatuses.get(locator.signature);
    if (
      optimisticStatus &&
      optimisticStatus.until > Date.now() &&
      result.status !== optimisticStatus.expectedStatus
    ) {
      window.setTimeout(() => {
        void refresh(root, setPageKind, setState, setMergeState, {
          bypassCache: true,
          preserveState: true,
        });
      }, 1000);
      return;
    }

    pageState.optimisticStatuses.delete(locator.signature);

    if (options.bypassCache) {
      pageState.cache.delete(locator.signature);
    } else {
      pageState.cache.set(locator.signature, {
        result,
        cachedAt: Date.now(),
      });
    }
    setMergeState({ kind: "idle" });
    setState({
      kind: "loaded",
      result,
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
    if (pageState.pendingKey === locator.signature) {
      pageState.pendingKey = null;
    }
  }
}

async function getStatusResult(locator: RouteLocator): Promise<StatusResult> {
  if (locator.kind === "pull-request") {
    const response = (await browser.runtime.sendMessage({
      type: GET_PULL_REQUEST_STATUS,
      owner: locator.owner,
      repo: locator.repo,
      pullNumber: locator.pullNumber,
    } satisfies PullRequestStatusRequest)) as PullRequestStatusResponse | undefined;
    if (!response?.ok) {
      throw new Error(response?.error.message ?? "The extension could not fetch PR status.");
    }
    return response.result;
  }

  const response = (await browser.runtime.sendMessage({
    type: GET_COMPARISON_STATUS,
    owner: locator.owner,
    repo: locator.repo,
    base: locator.base,
    head: locator.head,
  } satisfies ComparisonStatusRequest)) as ComparisonStatusResponse | undefined;
  if (!response?.ok) {
    throw new Error(response?.error.message ?? "The extension could not fetch comparison status.");
  }
  return response.result;
}

async function fastForwardMerge(
  root: HTMLDivElement,
  setPageKind: (pageKind: PageKind | null) => void,
  state: () => StatusViewState,
  setState: (state: StatusViewState) => void,
  setMergeState: (state: MergeState) => void,
) {
  const locator = parseCurrentRoute(location.pathname);
  if (!locator) {
    setMergeState({ kind: "error", message: "This is no longer a supported GitHub page." });
    return;
  }

  setMergeState({ kind: "submitting" });

  try {
    if (locator.kind === "pull-request") {
      const response = (await browser.runtime.sendMessage({
        type: MERGE_PULL_REQUEST,
        owner: locator.owner,
        repo: locator.repo,
        pullNumber: locator.pullNumber,
      } satisfies MergePullRequestRequest)) as MergePullRequestResponse | undefined;
      if (!response?.ok) {
        throw new Error(
          response?.error.message ?? "The extension could not fast-forward merge this PR.",
        );
      }
    } else {
      const response = (await browser.runtime.sendMessage({
        type: MERGE_COMPARISON,
        owner: locator.owner,
        repo: locator.repo,
        base: locator.base,
        head: locator.head,
      } satisfies MergeComparisonRequest)) as MergeComparisonResponse | undefined;
      if (!response?.ok) {
        throw new Error(
          response?.error.message ?? "The extension could not fast-forward merge this comparison.",
        );
      }
    }

    const currentState = state();
    const optimisticResult: StatusResult = {
      aheadBy: 0,
      hasGitHubPersonalAccessToken:
        currentState.kind === "loaded" ? currentState.result.hasGitHubPersonalAccessToken : true,
      status: locator.optimisticStatusAfterMerge,
    };
    pageState.optimisticStatuses.set(locator.signature, {
      expectedStatus: locator.optimisticStatusAfterMerge,
      until: Date.now() + 5_000,
    });
    pageState.cache.set(locator.signature, {
      result: optimisticResult,
      cachedAt: Date.now(),
    });
    setMergeState({ kind: "idle" });
    setState({
      kind: "loaded",
      result: optimisticResult,
    });

    window.setTimeout(() => {
      pageState.cache.delete(locator.signature);
      void refresh(root, setPageKind, setState, setMergeState, {
        bypassCache: true,
        preserveState: true,
      });
    }, 1500);
  } catch (error) {
    pageState.optimisticStatuses.delete(locator.signature);
    setMergeState({
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseCurrentRoute(pathname: string): RouteLocator | null {
  const pullRequestMatch = pathname.match(PR_PATH_PATTERN);
  if (pullRequestMatch) {
    const [, owner, repo, pullNumberText] = pullRequestMatch;
    const pullNumber = Number(pullNumberText);
    if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
      return null;
    }

    return {
      kind: "pull-request",
      pageKind: "pull-request",
      owner,
      repo,
      pullNumber,
      signature: `pull-request:${owner}/${repo}#${pullNumber}`,
      optimisticStatusAfterMerge: "closed",
    };
  }

  const compareMatch = pathname.match(COMPARE_PATH_PATTERN);
  if (!compareMatch) {
    return null;
  }

  const comparison = parseComparisonSpec(compareMatch[3]);
  if (!comparison) {
    return null;
  }

  const [, owner, repo] = compareMatch;
  return {
    kind: "compare",
    pageKind: "compare",
    owner,
    repo,
    base: comparison.base,
    head: comparison.head,
    signature: `compare:${owner}/${repo}:${comparison.base}...${comparison.head}`,
    optimisticStatusAfterMerge: "up-to-date",
  };
}

function parseComparisonSpec(spec: string) {
  let decodedSpec: string;
  try {
    decodedSpec = decodeURIComponent(spec);
  } catch {
    return null;
  }

  const separatorIndex = decodedSpec.indexOf("...");
  if (separatorIndex <= 0) {
    return null;
  }

  const base = decodedSpec.slice(0, separatorIndex);
  const head = decodedSpec.slice(separatorIndex + 3);
  if (!base || !head) {
    return null;
  }

  return { base, head };
}

function findMountInstruction(locator: RouteLocator): MountInstruction | null {
  if (locator.kind === "pull-request") {
    const mountTarget = document.querySelector<HTMLElement>("#partial-discussion-sidebar");
    if (!mountTarget) {
      return null;
    }

    return { kind: "append", element: mountTarget };
  }

  const commitsBucket = document.querySelector<HTMLElement>("#commits_bucket");
  const summaryBox = commitsBucket?.previousElementSibling;
  if (!(summaryBox instanceof HTMLElement)) {
    return null;
  }

  return { kind: "before", element: summaryBox };
}

function ensureMounted(root: HTMLDivElement, mountInstruction: MountInstruction) {
  if (mountInstruction.kind === "append") {
    if (root.parentElement !== mountInstruction.element) {
      mountInstruction.element.insertAdjacentElement("beforeend", root);
    }
    return;
  }

  if (mountInstruction.element.previousElementSibling !== root) {
    mountInstruction.element.insertAdjacentElement("beforebegin", root);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
