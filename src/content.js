const ROOT_ID = "ghff-status-root";
const PAGE_CACHE_TTL_MS = 30_000;
const URL_CHECK_INTERVAL_MS = 750;
const PR_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

const pageState = {
  cache: new Map(),
  currentPath: location.pathname,
  pendingKey: null,
  requestId: 0,
  scheduled: false,
};

init();

function init() {
  scheduleRefresh();

  window.addEventListener("load", scheduleRefresh);
  window.addEventListener("popstate", scheduleRefresh);
  document.addEventListener("pjax:end", scheduleRefresh, true);
  document.addEventListener("turbo:load", scheduleRefresh, true);
  document.addEventListener("turbo:render", scheduleRefresh, true);

  setInterval(() => {
    if (location.pathname === pageState.currentPath) {
      return;
    }

    pageState.currentPath = location.pathname;
    scheduleRefresh();
  }, URL_CHECK_INTERVAL_MS);
}

function scheduleRefresh() {
  if (pageState.scheduled) {
    return;
  }

  pageState.scheduled = true;
  window.setTimeout(() => {
    pageState.scheduled = false;
    void refresh();
  }, 100);
}

async function refresh() {
  const prMatch = parsePullRequestPath(location.pathname);
  if (!prMatch) {
    removeCard();
    return;
  }

  const mountTarget = findMountTarget();
  if (!mountTarget) {
    window.setTimeout(scheduleRefresh, 250);
    return;
  }

  const signature = `${prMatch.owner}/${prMatch.repo}#${prMatch.pullNumber}`;
  const card = ensureCard(mountTarget);
  const cached = pageState.cache.get(signature);

  if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
    renderResult(card, cached.result);
    return;
  }

  renderCard(card, {
    tone: "loading",
    status: "loading",
    title: "Checking fast-forward status",
    detail: "Comparing the PR base and head commits on GitHub.",
    meta: formatBranchMeta(`${prMatch.owner}/${prMatch.repo}`, "", ""),
  });

  if (pageState.pendingKey === signature) {
    return;
  }

  pageState.pendingKey = signature;
  const requestId = ++pageState.requestId;

  try {
    const result = await requestPullRequestStatus(prMatch);
    if (requestId !== pageState.requestId) {
      return;
    }

    pageState.cache.set(signature, { result, cachedAt: Date.now() });
    renderResult(card, result);
  } catch (error) {
    if (requestId !== pageState.requestId) {
      return;
    }

    renderCard(card, {
      tone: "error",
      status: "error",
      title: "Fast-forward status unavailable",
      detail: error instanceof Error ? error.message : String(error),
      meta: formatBranchMeta(`${prMatch.owner}/${prMatch.repo}`, "", ""),
    });
  } finally {
    if (pageState.pendingKey === signature) {
      pageState.pendingKey = null;
    }
  }
}

function parsePullRequestPath(pathname) {
  const match = pathname.match(PR_PATH_PATTERN);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    pullNumber: Number(match[3]),
  };
}

function findMountTarget() {
  return document.querySelector("main h1")?.closest("header") ?? null;
}

function ensureCard(mountTarget) {
  let card = document.getElementById(ROOT_ID);
  if (!card) {
    card = document.createElement("section");
    card.id = ROOT_ID;
    card.className = "ghff-status";
  }

  if (card.previousElementSibling !== mountTarget) {
    mountTarget.insertAdjacentElement("afterend", card);
  }

  return card;
}

function removeCard() {
  document.getElementById(ROOT_ID)?.remove();
}

function renderResult(card, result) {
  const view = buildViewModel(result);
  renderCard(card, view);
}

function buildViewModel(result) {
  const meta = formatBranchMeta(
    result.baseRepository ?? `${result.owner}/${result.repo}`,
    result.baseRef,
    result.headRef,
  );

  switch (result.status) {
    case "ff-possible":
      return {
        tone: "success",
        status: result.status,
        title: "Fast-forward merge possible",
        detail: `${labelBranch(result.baseRef)} can move to ${labelBranch(result.headRef)} without creating a merge commit.`,
        meta: `${meta} · ${result.aheadBy} commit${result.aheadBy === 1 ? "" : "s"} ahead`,
        action: {
          label: "Fast-forward merge",
        },
      };
    case "up-to-date":
      return {
        tone: "neutral",
        status: result.status,
        title: "Already up to date",
        detail: `${labelBranch(result.baseRef)} already points at the PR head commit.`,
        meta,
      };
    case "cross-repository":
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not supported",
        detail: "This PR comes from a different repository. The current extension only checks same-repository pull requests.",
        meta: `${result.baseRepository} <- ${result.headRepository}`,
      };
    case "base-ahead":
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not possible",
        detail: `${labelBranch(result.baseRef)} is already ahead of ${labelBranch(result.headRef)}.`,
        meta,
      };
    case "diverged":
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not possible",
        detail: `${labelBranch(result.baseRef)} and ${labelBranch(result.headRef)} have diverged.`,
        meta,
      };
    case "closed":
      return {
        tone: "neutral",
        status: result.status,
        title: "Pull request is not open",
        detail: "This check only applies to open pull requests.",
        meta,
      };
    default:
      return {
        tone: "error",
        status: result.status,
        title: "Fast-forward status unavailable",
        detail: "GitHub did not return a comparison state this extension understands.",
        meta,
      };
  }
}

function renderCard(card, view) {
  card.dataset.status = view.status;
  card.className = `ghff-status ghff-status--${view.tone}`;

  const eyebrow = document.createElement("div");
  eyebrow.className = "ghff-status__eyebrow";
  eyebrow.textContent = "Fast-forward merge";

  const title = document.createElement("div");
  title.className = "ghff-status__title";
  title.textContent = view.title;

  const detail = document.createElement("div");
  detail.className = "ghff-status__detail";
  detail.textContent = view.detail;

  const meta = document.createElement("div");
  meta.className = "ghff-status__meta";
  meta.textContent = view.meta;

  const children = [eyebrow, title, detail, meta];

  if (view.action) {
    const actions = document.createElement("div");
    actions.className = "ghff-status__actions";

    const button = document.createElement("button");
    button.className = "ghff-status__button";
    button.type = "button";
    button.textContent = view.action.label;

    actions.append(button);
    children.push(actions);
  }

  card.replaceChildren(...children);
}

function formatBranchMeta(repositoryName, baseRef, headRef) {
  const branchPair =
    baseRef && headRef ? `${labelBranch(baseRef)} <- ${labelBranch(headRef)}` : "Preparing branch comparison";
  return `${repositoryName} · ${branchPair}`;
}

function labelBranch(branchName) {
  return branchName ? `"${branchName}"` : "the branch";
}

function requestPullRequestStatus({ owner, repo, pullNumber }) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "ghff:get-pull-request-status",
        owner,
        repo,
        pullNumber,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error?.message ?? "The extension could not fetch PR status."));
          return;
        }

        resolve(response.result);
      },
    );
  });
}
