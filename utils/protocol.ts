export const GET_COMPARISON_STATUS = "ghff:get-comparison-status";
export const GET_PULL_REQUEST_STATUS = "ghff:get-pull-request-status";
export const MERGE_COMPARISON = "ghff:merge-comparison";
export const MERGE_PULL_REQUEST = "ghff:merge-pull-request";
export const OPEN_OPTIONS_PAGE = "ghff:open-options-page";
export const GITHUB_PERSONAL_ACCESS_TOKEN_STORAGE_KEY = "ghff:github-personal-access-token";

export type ComparisonStatusRequest = {
  type: typeof GET_COMPARISON_STATUS;
  owner: string;
  repo: string;
  base: string;
  head: string;
};

export type PullRequestStatusRequest = {
  type: typeof GET_PULL_REQUEST_STATUS;
  owner: string;
  repo: string;
  pullNumber: number;
};

export type MergeComparisonRequest = {
  type: typeof MERGE_COMPARISON;
  owner: string;
  repo: string;
  base: string;
  head: string;
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

type SharedStatusResult = {
  aheadBy: number;
  hasGitHubPersonalAccessToken: boolean;
};

export type ComparisonStatusResult = SharedStatusResult & {
  status: "ff-possible" | "up-to-date" | "base-ahead" | "diverged" | "unknown";
};

export type PullRequestStatusResult = SharedStatusResult & {
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

export type ComparisonStatusResponse =
  | {
      ok: true;
      result: ComparisonStatusResult;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
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

export type MergeComparisonResponse =
  | {
      ok: true;
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
