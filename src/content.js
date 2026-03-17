const ROOT_ID = "ghff-status-root";
const PAGE_CACHE_TTL_MS = 30_000;
const URL_CHECK_INTERVAL_MS = 750;
const PR_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

// GitHub swaps PR pages with Turbo/PJAX, so the content script has to keep
// enough state to debounce refreshes and ignore stale async responses.
const pageState = {
  cache: new Map(),
  currentPath: location.pathname,
  pendingKey: null,
  requestId: 0,
  scheduled: false,
};

init();

function init() {
  // Re-run the PR check after both full page loads and GitHub's partial
  // navigations so the card follows in-app route changes.
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
  // GitHub can fire several navigation-related events for one transition.
  // Collapse them into a single refresh tick.
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

  // Reuse recent API results while the user flips between tabs inside the
  // same pull request page.
  if (cached && Date.now() - cached.cachedAt < PAGE_CACHE_TTL_MS) {
    renderResult(card, cached.result);
    return;
  }

  renderCard(card, {
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
  // Prefer the discussion sidebar now that the card lives there, but keep a
  // header fallback so the extension still renders if GitHub shifts the layout.
  return (
    document.querySelector("#partial-discussion-sidebar") ??
    document.querySelector("#pr-conversation-sidebar") ??
    document.querySelector("main h1")?.closest("header") ??
    null
  );
}

function ensureCard(mountTarget) {
  let card = document.getElementById(ROOT_ID);
  if (!card) {
    card = document.createElement("section");
    card.id = ROOT_ID;
    card.className = "ghff-status";
  }

  const shouldAppend = mountTarget.id === "pr-conversation-sidebar";

  if (shouldAppend) {
    // The sidebar wrapper is the outer fallback container, so append the card
    // as its last child instead of inserting it between GitHub-owned siblings.
    if (card.parentElement !== mountTarget || mountTarget.lastElementChild !== card) {
      mountTarget.append(card);
    }
    return card;
  }

  if (card.previousElementSibling !== mountTarget || card.parentElement !== mountTarget.parentElement) {
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
      return {
        tone: "muted",
        status: result.status,
        title: "Fast-forward merge not possible",
      };
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

function renderCard(card, view) {
  card.dataset.status = view.status;
  card.className = `ghff-status ghff-status--${view.tone}`;

  const title = document.createElement("div");
  title.className = "ghff-status__title";
  title.textContent = view.title;

  const children = [title];

  if (view.detail) {
    const detail = document.createElement("div");
    detail.className = "ghff-status__detail";
    detail.textContent = view.detail;
    children.push(detail);
  }

  if (view.meta) {
    const meta = document.createElement("div");
    meta.className = "ghff-status__meta";
    meta.textContent = view.meta;
    children.push(meta);
  }

  if (view.action) {
    const actions = document.createElement("div");
    actions.className = "ghff-status__actions";

    // The button is visual-only for now; the merge action will be wired up in
    // a later step.
    const button = document.createElement("button");
    button.className = "ghff-status__button";
    button.type = "button";
    button.textContent = view.action.label;

    actions.append(button);
    children.push(actions);
  }

  card.replaceChildren(...children);
}

function requestPullRequestStatus({ owner, repo, pullNumber }) {
  return new Promise((resolve, reject) => {
    // Ask the background worker to call the GitHub API so the content script
    // stays focused on DOM work.
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
