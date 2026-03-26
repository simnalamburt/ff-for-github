import { browser } from "wxt/browser";

import {
  GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY,
  GET_PULL_REQUEST_STATUS,
  MERGE_PULL_REQUEST,
  type MergePullRequestRequest,
  type MergePullRequestResponse,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../utils/protocol";

type GitHubBranchReference = {
  ref?: string;
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
      if (isPullRequestStatusRequest(message)) {
        void getPullRequestStatusResponse(message, sender).then(sendResponse);

        // Chrome extension messaging keeps the channel open only when the listener
        // returns true and replies through sendResponse asynchronously.
        return true;
      }

      if (isMergePullRequestRequest(message)) {
        void mergePullRequestResponse(message, sender).then(sendResponse);

        // Chrome extension messaging keeps the channel open only when the listener
        // returns true and replies through sendResponse asynchronously.
        return true;
      }

      return undefined;
    });
    return;
  }

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (isPullRequestStatusRequest(message)) {
      return getPullRequestStatusResponse(message, sender as RuntimeMessageSender);
    }

    if (isMergePullRequestRequest(message)) {
      return mergePullRequestResponse(message, sender as RuntimeMessageSender);
    }

    return undefined;
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

function isMergePullRequestRequest(message: unknown): message is MergePullRequestRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "owner" in message &&
    "repo" in message &&
    "pullNumber" in message &&
    (message as { type?: unknown }).type === MERGE_PULL_REQUEST
  );
}

async function getPullRequestStatusResponse(
  request: PullRequestStatusRequest,
  sender: RuntimeMessageSender,
): Promise<PullRequestStatusResponse> {
  try {
    const validatedRequest = validatePullRequestRequestSender(request, sender);
    const result = await getPullRequestStatus(validatedRequest);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function mergePullRequestResponse(
  request: MergePullRequestRequest,
  sender: RuntimeMessageSender,
): Promise<MergePullRequestResponse> {
  try {
    const validatedRequest = validatePullRequestRequestSender(request, sender);
    await mergePullRequest(validatedRequest);
    return { ok: true };
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
  const token = await getGitHubPersonalAccessToken();
  const hasGitHubPersonalAccessToken = token.trim() !== "";

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
      hasGitHubPersonalAccessToken,
      status: "closed",
      aheadBy: 0,
    };
  }

  // The merge action updates the base ref in place, so this extension only
  // surfaces status for same-repository pull requests.
  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    return {
      hasGitHubPersonalAccessToken,
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
    hasGitHubPersonalAccessToken,

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

async function mergePullRequest({
  owner,
  repo,
  pullNumber,
}: MergePullRequestRequest): Promise<void> {
  const token = await getGitHubPersonalAccessToken();
  if (token.trim() === "") {
    throw new Error("No GitHub token is saved.");
  }

  const pullRequest = await githubRequest<GitHubPullRequestResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
    token,
  );

  const baseRepository = pullRequest.base?.repo?.full_name ?? "";
  const headRepository = pullRequest.head?.repo?.full_name ?? "";
  const baseRef = pullRequest.base?.ref ?? "";
  const baseSha = pullRequest.base?.sha ?? "";
  const headSha = pullRequest.head?.sha ?? "";
  const state = pullRequest.state ?? "open";

  if (state !== "open") {
    throw new Error("Pull request is not open.");
  }

  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    throw new Error("Fast-forward merge is only supported for same-repository pull requests.");
  }

  if (!baseRef || !baseSha || !headSha) {
    throw new Error("Could not determine the pull request branch heads.");
  }

  const comparison = await githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
    token,
  );

  if (comparison.status === "identical") {
    throw new Error("The base branch is already up to date.");
  }
  if (comparison.status === "behind") {
    throw new Error("The base branch is already ahead of this pull request.");
  }
  if (comparison.status === "diverged") {
    throw new Error("Fast-forward merge is not possible because the branches have diverged.");
  }
  if (comparison.status !== "ahead") {
    throw new Error("GitHub did not return a comparison state this extension understands.");
  }

  await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeGitReference(baseRef)}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({
        sha: headSha,
        force: false,
      }),
    },
  );
}

async function githubRequest<T>(
  pathname: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  // Centralize GitHub API headers and error normalization so every request
  // fails the same way in the content script.
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Cache-Control", "no-cache");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`https://api.github.com${pathname}`, {
    ...init,
    cache: "no-store",
    headers,
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

function validatePullRequestRequestSender<
  T extends { owner: string; repo: string; pullNumber: number },
>(request: T, sender: RuntimeMessageSender): T {
  const senderUrl = sender.tab?.url;
  if (!senderUrl) {
    throw new Error("Pull request status requests must come from a browser tab.");
  }

  const senderRequest = parsePullRequestLocatorFromUrl(senderUrl);
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

  return request;
}

function parsePullRequestLocatorFromUrl(urlString: string) {
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
    owner,
    repo,
    pullNumber,
  };
}

function encodeGitReference(reference: string) {
  return reference.split("/").map(encodeURIComponent).join("/");
}

async function getGitHubPersonalAccessToken(): Promise<string> {
  const stored = await browser.storage.local.get(GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY);
  const token = stored[GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY];
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
