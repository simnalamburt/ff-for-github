export const GET_PULL_REQUEST_STATUS = "ghff:get-pull-request-status";

export type PullRequestLocator = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PullRequestComparisonStatus =
  | "ff-possible"
  | "up-to-date"
  | "cross-repository"
  | "base-ahead"
  | "diverged"
  | "closed"
  | "unknown";

export type PullRequestStatusRequest = PullRequestLocator & {
  type: typeof GET_PULL_REQUEST_STATUS;
};

export type PullRequestStatusResult = {
  aheadBy: number;
  status: PullRequestComparisonStatus;
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
