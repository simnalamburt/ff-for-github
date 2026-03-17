# Fast-forward merge for GitHub

Manifest V3 browser extension for GitHub pull request pages.

Current scope:

- Detect whether a pull request can be fast-forward merged.
- Render that status directly on the PR page header.

Current limitations:

- The check only supports same-repository pull requests.
- The extension uses unauthenticated GitHub API requests, so it currently works best for public repositories.
- The merge button is not implemented yet.

## Load locally

1. Open the browser's extensions page.
2. Enable developer mode.
3. Load this repository as an unpacked extension.

## How it works

When the content script runs on a URL like `https://github.com/<owner>/<repo>/pull/<number>`, the background worker:

1. Fetches the pull request from the GitHub REST API.
2. Compares the base commit SHA and head commit SHA.
3. Marks the PR as fast-forwardable only when the comparison result is `ahead`.
