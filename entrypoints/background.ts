import * as v from "valibot";
import { browser } from "wxt/browser";

import {
  GET_COMPARISON_STATUS,
  GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY,
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
  draft?: boolean;
  head?: GitHubBranchReference;
  state?: string;
};

type GitHubCompareResponse = {
  status?: string;
  ahead_by?: number;
};

type GitHubCommitResponse = {
  sha?: string;
};

type RuntimeMessageSender = {
  tab?: {
    url?: string;
  };
};

const GITHUB_COMPARE_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/compare\/([^/]+)(?:\/.*)?$/;
const GITHUB_PULL_REQUEST_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;
const ComparisonStatusRequestSchema = v.object({
  type: v.literal(GET_COMPARISON_STATUS),
  owner: v.string(),
  repo: v.string(),
  base: v.string(),
  head: v.string(),
});
const PullRequestStatusRequestSchema = v.object({
  type: v.literal(GET_PULL_REQUEST_STATUS),
  owner: v.string(),
  repo: v.string(),
  pullNumber: v.number(),
});
const MergeComparisonRequestSchema = v.object({
  type: v.literal(MERGE_COMPARISON),
  owner: v.string(),
  repo: v.string(),
  base: v.string(),
  head: v.string(),
});
const MergePullRequestRequestSchema = v.object({
  type: v.literal(MERGE_PULL_REQUEST),
  owner: v.string(),
  repo: v.string(),
  pullNumber: v.number(),
});
const OpenOptionsPageRequestSchema = v.object({
  type: v.literal(OPEN_OPTIONS_PAGE),
});

export default defineBackground(() => {
  // The background worker is the single place that talks to the GitHub API.
  // Content scripts ask for a PR status snapshot and get back a small view model.
  void setStorageAccessLevelToTrustedContexts();

  if (typeof chrome !== "undefined") {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      if (v.is(ComparisonStatusRequestSchema, message)) {
        void getComparisonStatusResponse(message, sender).then(sendResponse);

        return true;
      }

      if (v.is(PullRequestStatusRequestSchema, message)) {
        void getPullRequestStatusResponse(message, sender).then(sendResponse);

        // Chrome extension messaging keeps the channel open only when the listener
        // returns true and replies through sendResponse asynchronously.
        return true;
      }

      if (v.is(MergeComparisonRequestSchema, message)) {
        void mergeComparisonResponse(message, sender).then(sendResponse);

        return true;
      }

      if (v.is(MergePullRequestRequestSchema, message)) {
        void mergePullRequestResponse(message, sender).then(sendResponse);

        // Chrome extension messaging keeps the channel open only when the listener
        // returns true and replies through sendResponse asynchronously.
        return true;
      }

      if (v.is(OpenOptionsPageRequestSchema, message)) {
        void openOptionsPage().then(sendResponse);

        // Chrome extension messaging keeps the channel open only when the listener
        // returns true and replies through sendResponse asynchronously.
        return true;
      }

      return undefined;
    });
    return;
  }

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (v.is(ComparisonStatusRequestSchema, message)) {
      return getComparisonStatusResponse(message, sender as RuntimeMessageSender);
    }

    if (v.is(PullRequestStatusRequestSchema, message)) {
      return getPullRequestStatusResponse(message, sender as RuntimeMessageSender);
    }

    if (v.is(MergeComparisonRequestSchema, message)) {
      return mergeComparisonResponse(message, sender as RuntimeMessageSender);
    }

    if (v.is(MergePullRequestRequestSchema, message)) {
      return mergePullRequestResponse(message, sender as RuntimeMessageSender);
    }

    if (v.is(OpenOptionsPageRequestSchema, message)) {
      return openOptionsPage();
    }

    return undefined;
  });
});

async function getComparisonStatusResponse(
  request: ComparisonStatusRequest,
  sender: RuntimeMessageSender,
): Promise<ComparisonStatusResponse> {
  try {
    const validatedRequest = validateComparisonRequestSender(request, sender);
    const result = await getComparisonStatus(validatedRequest);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
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

async function mergeComparisonResponse(
  request: MergeComparisonRequest,
  sender: RuntimeMessageSender,
): Promise<MergeComparisonResponse> {
  try {
    const validatedRequest = validateComparisonRequestSender(request, sender);
    await mergeComparison(validatedRequest);
    return { ok: true };
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

async function openOptionsPage(): Promise<void> {
  await browser.runtime.openOptionsPage();
}

async function getComparisonStatus({
  owner,
  repo,
  base,
  head,
}: ComparisonStatusRequest): Promise<ComparisonStatusResult> {
  const token = await getGitHubPersonalAccessToken();
  const comparison = await getGitHubComparison({
    owner,
    repo,
    base,
    head,
    token,
  });
  return {
    aheadBy: comparison.ahead_by ?? 0,
    hasGitHubPersonalAccessToken: token.trim() !== "",
    status: mapComparisonStatus(comparison.status),
  };
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

  const baseRef = pullRequest.base?.ref ?? "";
  const headSha = pullRequest.head?.sha ?? "";
  const isDraft = pullRequest.draft === true;
  const state = pullRequest.state ?? "open";

  if (!baseRef || !headSha) {
    return {
      hasGitHubPersonalAccessToken,
      status: state !== "open" ? "closed" : "unknown",
      aheadBy: 0,
    };
  }

  const comparison = await githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headSha)}`,
    token,
  );
  const aheadBy = comparison.ahead_by ?? 0;
  const status = (() => {
    if (state !== "open") {
      return comparison.status === "ahead" ? "ff-possible-but-closed" : "closed";
    }
    // GitHub's compare API already tells us the ancestry relationship, so map it
    // directly to the UI states used by the content script.
    switch (comparison.status) {
      case "ahead":
        return isDraft ? "ff-possible-but-draft" : "ff-possible";
      case "identical":
        return "up-to-date";
      case "behind":
        return "base-ahead";
      case "diverged":
        return "diverged";
      default:
        return "unknown";
    }
  })();
  return { aheadBy, hasGitHubPersonalAccessToken, status };
}

async function mergeComparison({ owner, repo, base, head }: MergeComparisonRequest): Promise<void> {
  const token = await getGitHubPersonalAccessToken();
  if (token.trim() === "") {
    throw new Error("No GitHub token is saved.");
  }

  const comparison = await getGitHubComparison({
    owner,
    repo,
    base,
    head,
    token,
  });

  if (comparison.status === "identical") {
    throw new Error("The base branch is already up to date.");
  }
  if (comparison.status === "behind") {
    throw new Error("The base branch is already ahead of this comparison.");
  }
  if (comparison.status === "diverged") {
    throw new Error("Fast-forward merge is not possible because the branches have diverged.");
  }
  if (comparison.status !== "ahead") {
    throw new Error("GitHub did not return a comparison state this extension understands.");
  }

  const { owner: baseOwner, ref: baseRef } = parseQualifiedReference(base, owner);
  const { owner: headOwner, ref: headRef } = parseQualifiedReference(head, owner);
  const headCommit = await githubRequest<GitHubCommitResponse>(
    `/repos/${encodeURIComponent(headOwner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(headRef)}`,
    token,
  );
  const headSha = headCommit.sha ?? "";

  if (!headSha) {
    throw new Error("Could not determine the comparison head commit.");
  }

  await githubRequest(
    `/repos/${encodeURIComponent(baseOwner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeGitReference(baseRef)}`,
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

  const baseRef = pullRequest.base?.ref ?? "";
  const headSha = pullRequest.head?.sha ?? "";

  if (!baseRef || !headSha) {
    throw new Error("Could not determine the pull request branch heads.");
  }

  const comparison = await githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(headSha)}`,
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

async function getGitHubComparison({
  owner,
  repo,
  base,
  head,
  token,
}: {
  owner: string;
  repo: string;
  base: string;
  head: string;
  token: string;
}): Promise<GitHubCompareResponse> {
  return githubRequest<GitHubCompareResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeComparisonReference(base)}...${encodeComparisonReference(head)}`,
    token,
  );
}

function mapComparisonStatus(status: string | undefined): ComparisonStatusResult["status"] {
  switch (status) {
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

function validateComparisonRequestSender<
  T extends { owner: string; repo: string; base: string; head: string },
>(request: T, sender: RuntimeMessageSender): T {
  const senderUrl = sender.tab?.url;
  if (!senderUrl) {
    throw new Error("Comparison requests must come from a browser tab.");
  }

  const senderRequest = parseComparisonLocatorFromUrl(senderUrl);
  if (!senderRequest) {
    throw new Error("Comparison requests are only allowed from GitHub compare pages.");
  }

  if (
    senderRequest.owner !== request.owner ||
    senderRequest.repo !== request.repo ||
    senderRequest.base !== request.base ||
    senderRequest.head !== request.head
  ) {
    throw new Error("Comparison request did not match the sender tab.");
  }

  return request;
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

function parseComparisonLocatorFromUrl(urlString: string) {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    return null;
  }

  const match = url.pathname.match(GITHUB_COMPARE_PATH_PATTERN);
  if (!match) {
    return null;
  }

  let comparisonSpec: string;
  try {
    comparisonSpec = decodeURIComponent(match[3]);
  } catch {
    return null;
  }

  const separatorIndex = comparisonSpec.indexOf("...");
  if (separatorIndex <= 0) {
    return null;
  }

  const base = comparisonSpec.slice(0, separatorIndex);
  const head = comparisonSpec.slice(separatorIndex + 3);
  if (!base || !head) {
    return null;
  }

  const [, owner, repo] = match;
  return {
    owner,
    repo,
    base,
    head,
  };
}

function encodeGitReference(reference: string) {
  return reference.split("/").map(encodeURIComponent).join("/");
}

function encodeComparisonReference(reference: string) {
  return encodeURIComponent(reference);
}

function parseQualifiedReference(reference: string, defaultOwner: string) {
  const separatorIndex = reference.indexOf(":");
  if (separatorIndex <= 0) {
    return { owner: defaultOwner, ref: reference };
  }

  return {
    owner: reference.slice(0, separatorIndex),
    ref: reference.slice(separatorIndex + 1),
  };
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
