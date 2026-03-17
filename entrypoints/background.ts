import { browser } from 'wxt/browser';

import {
  GET_PULL_REQUEST_STATUS,
  type PullRequestComparisonStatus,
  type PullRequestStatusRequest,
  type PullRequestStatusResponse,
  type PullRequestStatusResult,
} from '../lib/ghff';

export default defineBackground(() => {
  // The background worker is the single place that talks to the GitHub API.
  // Content scripts ask for a PR status snapshot and get back a small view model.
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isPullRequestStatusRequest(message)) {
      return undefined;
    }

    return getPullRequestStatus(message)
      .then<PullRequestStatusResponse>((result) => ({ ok: true, result }))
      .catch<PullRequestStatusResponse>((error) => ({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }));
  });
});

function isPullRequestStatusRequest(message: unknown): message is PullRequestStatusRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    'owner' in message &&
    'repo' in message &&
    'pullNumber' in message &&
    (message as { type?: unknown }).type === GET_PULL_REQUEST_STATUS
  );
}

async function getPullRequestStatus({
  owner,
  repo,
  pullNumber,
}: PullRequestStatusRequest): Promise<PullRequestStatusResult> {
  // Pull request metadata gives us the current base/head refs and SHAs that
  // GitHub is comparing on the page.
  const pullRequest = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(String(pullNumber))}`,
  );

  const baseRepository = pullRequest.base?.repo?.full_name as string | undefined;
  const headRepository = pullRequest.head?.repo?.full_name as string | undefined;
  const result = {
    owner,
    repo,
    pullNumber,
    baseRef: pullRequest.base?.ref ?? '',
    headRef: pullRequest.head?.ref ?? '',
    baseSha: pullRequest.base?.sha ?? '',
    headSha: pullRequest.head?.sha ?? '',
    baseRepository,
    headRepository,
    state: pullRequest.state ?? 'open',
    aheadBy: 0,
    behindBy: 0,
    status: 'unknown' as PullRequestComparisonStatus,
    canFastForward: false,
  };

  if (result.state !== 'open') {
    return {
      ...result,
      status: 'closed',
    };
  }

  // The eventual merge action will update the base ref in place, so for now we
  // only surface status for same-repository pull requests.
  if (!baseRepository || !headRepository || baseRepository !== headRepository) {
    return {
      ...result,
      status: 'cross-repository',
    };
  }

  const comparison = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(result.baseSha)}...${encodeURIComponent(result.headSha)}`,
  );

  return {
    ...result,
    comparisonStatus: comparison.status ?? 'unknown',
    aheadBy: comparison.ahead_by ?? 0,
    behindBy: comparison.behind_by ?? 0,
    status: getFastForwardStatus(comparison.status),
    canFastForward: comparison.status === 'ahead',
  };
}

function getFastForwardStatus(comparisonStatus: string | undefined): PullRequestComparisonStatus {
  // GitHub's compare API already tells us the ancestry relationship, so map it
  // directly to the UI states used by the content script.
  switch (comparisonStatus) {
    case 'ahead':
      return 'ff-possible';
    case 'identical':
      return 'up-to-date';
    case 'behind':
      return 'base-ahead';
    case 'diverged':
      return 'diverged';
    default:
      return 'unknown';
  }
}

async function githubRequest(pathname: string) {
  // Centralize GitHub API headers and error normalization so every request
  // fails the same way in the content script.
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data.message === 'string'
        ? data.message
        : `GitHub API request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return data;
}
