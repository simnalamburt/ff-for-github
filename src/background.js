const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ghff:get-pull-request-status") {
    return false;
  }

  getPullRequestStatus(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    );

  return true;
});

async function getPullRequestStatus({ owner, repo, pullNumber }) {
  const pullRequest = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
  );

  const baseRepository = pullRequest.base?.repo?.full_name;
  const headRepository = pullRequest.head?.repo?.full_name;
  const result = {
    owner,
    repo,
    pullNumber,
    baseRef: pullRequest.base?.ref ?? "",
    headRef: pullRequest.head?.ref ?? "",
    baseSha: pullRequest.base?.sha ?? "",
    headSha: pullRequest.head?.sha ?? "",
    baseRepository,
    headRepository,
    state: pullRequest.state ?? "open",
  };

  if (result.state !== "open") {
    return {
      ...result,
      status: "closed",
      canFastForward: false,
    };
  }

  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    return {
      ...result,
      status: "cross-repository",
      canFastForward: false,
    };
  }

  const comparison = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(result.baseSha)}...${encodeURIComponent(result.headSha)}`,
  );

  return {
    ...result,
    comparisonStatus: comparison.status ?? "unknown",
    aheadBy: comparison.ahead_by ?? 0,
    behindBy: comparison.behind_by ?? 0,
    status: getFastForwardStatus(comparison.status),
    canFastForward: comparison.status === "ahead",
  };
}

function getFastForwardStatus(comparisonStatus) {
  switch (comparisonStatus) {
    case "ahead":
      return "ff-possible";
    case "identical":
      return "up-to-date";
    case "behind":
      return "base-ahead";
    case "diverged":
      return "diverged";
    default:
      return "unknown";
  }
}

async function githubRequest(pathname) {
  const response = await fetch(`${GITHUB_API_ROOT}${pathname}`, {
    headers: GITHUB_API_HEADERS,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data.message === "string"
        ? data.message
        : `GitHub API request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data;
}
