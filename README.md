# Fast-forward merge for GitHub

WXT + Solid browser extension for GitHub pull request pages.

Current scope:

- Detect whether a pull request can be fast-forward merged.
- Render that status in the GitHub PR sidebar.
- Render a fast-forward merge button when the PR is eligible.

Current limitations:

- The check only supports same-repository pull requests.
- The extension uses unauthenticated GitHub API requests, so it currently works best for public repositories.
- The merge button is only visual for now and does not trigger a merge yet.

## Develop locally

1. Install dependencies with `pnpm install`.
2. Start the extension dev server with `pnpm dev`.
3. Load the generated `.output/chrome-mv3` directory as an unpacked extension.

## How it works

When the content script runs on a URL like `https://github.com/<owner>/<repo>/pull/<number>`, the background worker:

1. Fetches the pull request from the GitHub REST API.
2. Compares the base commit SHA and head commit SHA.
3. Marks the PR as fast-forwardable only when the comparison result is `ahead`.
