export const GET_PULL_REQUEST_STATUS = "ghff:get-pull-request-status";
export const GITHUB_FINE_GRAINED_TOKEN_STORAGE_KEY = "ghff:github-fine-grained-token";

export type PullRequestStatusRequest = {
  type: typeof GET_PULL_REQUEST_STATUS;
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PullRequestStatusResult = {
  aheadBy: number;
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
