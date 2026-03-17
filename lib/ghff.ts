export const GET_PULL_REQUEST_STATUS = 'ghff:get-pull-request-status';

export type PullRequestLocator = {
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PullRequestComparisonStatus =
  | 'ff-possible'
  | 'up-to-date'
  | 'cross-repository'
  | 'base-ahead'
  | 'diverged'
  | 'closed'
  | 'unknown';

export type PullRequestStatusRequest = PullRequestLocator & {
  type: typeof GET_PULL_REQUEST_STATUS;
};

export type PullRequestStatusResult = PullRequestLocator & {
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  baseRepository?: string;
  headRepository?: string;
  state: string;
  comparisonStatus?: string;
  aheadBy: number;
  behindBy: number;
  status: PullRequestComparisonStatus;
  canFastForward: boolean;
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
