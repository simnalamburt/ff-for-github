import { browser } from "wxt/browser";

import {
  GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY,
  GET_PULL_REQUEST_STATUS,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../utils/protocol";

type GitHubBranchReference = {
  sha?: string;
  repo?: {
    full_name?: string;
  };
};

type GitHubPullRequestResponse = {
  base?: GitHubBranchReference;
  head?: GitHubBranchReference;
  state?: string;
};

type GitHubCompareResponse = {
  status?: string;
  ahead_by?: number;
};

type RuntimeMessageSender = {
  tab?: {
    url?: string;
  };
};

const GITHUB_PULL_REQUEST_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

export default defineBackground(() => {
  // The background worker is the single place that talks to the GitHub API.
  // Content scripts ask for a PR status snapshot and get back a small view model.
  void setStorageAccessLevelToTrustedContexts();

  if (typeof chrome !== "undefined") {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (!isPullRequestStatusRequest(message)) {
        return undefined;
      }

      void getPullRequestStatusResponse(message, sender).then(sendResponse);

      // Chrome extension messaging keeps the channel open only when the listener
      // returns true and replies through sendResponse asynchronously.
      return true;
    });
    return;
  }

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isPullRequestStatusRequest(message)) {
      return undefined;
    }

    return getPullRequestStatusResponse(message, sender as RuntimeMessageSender);
  });
});

function isPullRequestStatusRequest(message: unknown): message is PullRequestStatusRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "owner" in message &&
    "repo" in message &&
    "pullNumber" in message &&
    (message as { type?: unknown }).type === GET_PULL_REQUEST_STATUS
  );
}

async function getPullRequestStatusResponse(
  request: PullRequestStatusRequest,
  sender: RuntimeMessageSender,
): Promise<PullRequestStatusResponse> {
  try {
    const validatedRequest = validatePullRequestStatusRequestSender(request, sender);
    const result = await getPullRequestStatus(validatedRequest);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function getPullRequestStatus({
  owner,
  repo,
  pullNumber,
}: PullRequestStatusRequest): Promise<PullRequestStatusResult> {
  const token = await getGitHubFineGrainedToken();
  const hasGitHubFineGrainedToken = token.trim() !== "";

  // Pull request metadata gives us the current base/head refs and SHAs that
  // GitHub is comparing on the page.
  const pullRequest = await githubRequest<GitHubPullRequestResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
    token,
  );

  const baseRepository = pullRequest.base?.repo?.full_name as string | undefined;
  const headRepository = pullRequest.head?.repo?.full_name as string | undefined;
  const baseSha = pullRequest.base?.sha ?? "";
  const headSha = pullRequest.head?.sha ?? "";
  const state = pullRequest.state ?? "open";

  if (state !== "open") {
    return {
      hasGitHubFineGrainedToken,
      status: "closed",
      aheadBy: 0,
    };
  }

  // The eventual merge action will update the base ref in place, so for now we
  // only surface status for same-repository pull requests.
  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    return {
      hasGitHubFineGrainedToken,
      status: "cross-repository",
      aheadBy: 0,
    };
  }

  const comparison = await githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
    token,
  );

  return {
    aheadBy: comparison.ahead_by ?? 0,
    hasGitHubFineGrainedToken,

    // GitHub's compare API already tells us the ancestry relationship, so map it
    // directly to the UI states used by the content script.
    status:
      comparison.status == "ahead"
        ? "ff-possible"
        : comparison.status == "identical"
          ? "up-to-date"
          : comparison.status == "behind"
            ? "base-ahead"
            : comparison.status == "diverged"
              ? "diverged"
              : "unknown",
  };
}

async function githubRequest<T>(pathname: string, token: string): Promise<T> {
  // Centralize GitHub API headers and error normalization so every request
  // fails the same way in the content script.
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
        ? data.message
        : `GitHub API request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data as T;
}

function validatePullRequestStatusRequestSender(
  request: PullRequestStatusRequest,
  sender: RuntimeMessageSender,
): PullRequestStatusRequest {
  const senderUrl = sender.tab?.url;
  if (!senderUrl) {
    throw new Error("Pull request status requests must come from a browser tab.");
  }

  const senderRequest = parsePullRequestStatusRequestFromUrl(senderUrl);
  if (!senderRequest) {
    throw new Error(
      "Pull request status requests are only allowed from GitHub pull request pages.",
    );
  }

  if (
    senderRequest.owner !== request.owner ||
    senderRequest.repo !== request.repo ||
    senderRequest.pullNumber !== request.pullNumber
  ) {
    throw new Error("Pull request status request did not match the sender tab.");
  }

  return senderRequest;
}

function parsePullRequestStatusRequestFromUrl(urlString: string): PullRequestStatusRequest | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    return null;
  }

  const match = url.pathname.match(GITHUB_PULL_REQUEST_PATH_PATTERN);
  if (!match) {
    return null;
  }

  const [, owner, repo, pullNumberText] = match;
  const pullNumber = Number(pullNumberText);
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    return null;
  }

  return {
    type: GET_PULL_REQUEST_STATUS,
    owner,
    repo,
    pullNumber,
  };
}

async function getGitHubFineGrainedToken(): Promise<string> {
  const stored = await browser.storage.local.get(GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY);
  const token = stored[GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY];
  return typeof token === "string" ? token : "";
}

async function setStorageAccessLevelToTrustedContexts() {
  if (typeof chrome === "undefined") {
    return;
  }

  await chrome.storage.local.setAccessLevel?.({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}
