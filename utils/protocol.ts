export const GET_PULL_REQUEST_STATUS = "ghff:get-pull-request-status";
export const MERGE_PULL_REQUEST = "ghff:merge-pull-request";
export const GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY = "ghff:github-fine-grained-token";

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

export type PullRequestStatusResult = {
  aheadBy: number;
  hasGitHubFineGrainedToken: boolean;
  status:
    | "ff-possible"
    | "up-to-date"
    | "cross-repository"
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
