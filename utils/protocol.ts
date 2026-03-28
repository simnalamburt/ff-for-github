export const GET_PULL_REQUEST_STATUS = "ghff:get-pull-request-status";
export const MERGE_PULL_REQUEST = "ghff:merge-pull-request";
export const OPEN_OPTIONS_PAGE = "ghff:open-options-page";
export const GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY = "ghff:github-personal-access-token";

export type PullRequestStatusRequest = {
  type: typeof GET_PULL_REQUEST_STATUS;
  owner: string;
  repo: string;
  pullNumber: number;
};

export type MergePullRequestRequest = {
  type: typeof MERGE_PULL_REQUEST;
  owner: string;
  repo: string;
  pullNumber: number;
};

export type OpenOptionsPageRequest = {
  type: typeof OPEN_OPTIONS_PAGE;
};

export type PullRequestStatusResult = {
  aheadBy: number;
  hasGitHubPersonalAccessToken: boolean;
  status:
    | "ff-possible"
    | "ff-possible-but-closed"
    | "ff-possible-but-draft"
    | "up-to-date"
    | "base-ahead"
    | "diverged"
    | "closed"
    | "unknown";
};

export type PullRequestStatusResponse =
  | {
      ok: true;
      result: PullRequestStatusResult;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export type MergePullRequestResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };
