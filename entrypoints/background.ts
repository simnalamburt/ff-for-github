import { browser } from "wxt/browser";

import {
  GET_PULL_REQUEST_STATUS,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from "../lib/ghff";

type RuntimeWithMessageCallback = {
  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: PullRequestStatusResponse) => void,
      ) => boolean | void,
    ): void;
  };
};

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

type GitHubErrorResponse = {
  message?: string;
};

export default defineBackground(() => {
  // The background worker is the single place that talks to the GitHub API.
  // Content scripts ask for a PR status snapshot and get back a small view model.
  const chromeRuntime = (
    globalThis as typeof globalThis & {
      chrome?: {
        runtime?: RuntimeWithMessageCallback;
      };
    }
  ).chrome?.runtime;
  const runtime = (chromeRuntime ?? browser.runtime) as RuntimeWithMessageCallback;

  runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isPullRequestStatusRequest(message)) {
      return undefined;
    }

    void sendPullRequestStatusResponse(message, sendResponse);

    // Chrome extension messaging keeps the channel open only when the listener
    // returns true and replies through sendResponse asynchronously.
    return true;
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

async function sendPullRequestStatusResponse(
  request: PullRequestStatusRequest,
  sendResponse: (response: PullRequestStatusResponse) => void,
) {
  try {
    const result = await getPullRequestStatus(request);
    sendResponse({ ok: true, result });
  } catch (error) {
    sendResponse({
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function getPullRequestStatus({
  owner,
  repo,
  pullNumber,
}: PullRequestStatusRequest): Promise<PullRequestStatusResult> {
  // Pull request metadata gives us the current base/head refs and SHAs that
  // GitHub is comparing on the page.
  const pullRequest = await githubRequest<GitHubPullRequestResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
  );

  const baseRepository = pullRequest.base?.repo?.full_name as string | undefined;
  const headRepository = pullRequest.head?.repo?.full_name as string | undefined;
  const baseSha = pullRequest.base?.sha ?? "";
  const headSha = pullRequest.head?.sha ?? "";
  const state = pullRequest.state ?? "open";

  if (state !== "open") {
    return {
      status: "closed",
      aheadBy: 0,
    };
  }

  // The eventual merge action will update the base ref in place, so for now we
  // only surface status for same-repository pull requests.
  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    return {
      status: "cross-repository",
      aheadBy: 0,
    };
  }

  const comparison = await githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
  );

  return {
    aheadBy: comparison.ahead_by ?? 0,

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

async function githubRequest<T>(pathname: string): Promise<T> {
  // Centralize GitHub API headers and error normalization so every request
  // fails the same way in the content script.
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
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
      isGitHubErrorResponse(data) && typeof data.message === "string"
        ? data.message
        : `GitHub API request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data as T;
}

function isGitHubErrorResponse(data: unknown): data is GitHubErrorResponse {
  return typeof data === "object" && data !== null && "message" in data;
}
