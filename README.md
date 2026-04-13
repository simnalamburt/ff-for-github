# Fast-forward merge for GitHub

Conveniently fast-forward merge branches directly from your browser, without
opening a terminal!

[**Install this extension** at chrome web store](https://chromewebstore.google.com/detail/mdhgpmfmpanllfnemeammedjedkdcjpo)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://i.hyeon.me/ff-for-github/dark.avif">
  <source media="(prefers-color-scheme: light)" srcset="https://i.hyeon.me/ff-for-github/light.avif">
  <img alt="Fast-forward merge for GitHub screenshot" src="https://i.hyeon.me/ff-for-github/light.avif">
</picture>

### Privacy

This browser extension requires a GitHub personal access token (classic) to
function. Your token is stored only on your local machine using the
`browser.storage.local` API[^1][^2] and is not synchronized. Your token will be
used solely to call the following APIs:

[^1]: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/local

[^2]: https://developer.chrome.com/docs/extensions/reference/api/storage#property-local

- [GET https://api.github.com/repos/OWNER/REPO/pulls/PULL_NUMBER](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2026-03-10#get-a-pull-request)
- [GET https://api.github.com/repos/OWNER/REPO/compare/BASE...HEAD](https://docs.github.com/en/rest/commits/commits?apiVersion=2026-03-10#compare-two-commits)
- [GET https://api.github.com/repos/OWNER/REPO/commits/REF](https://docs.github.com/en/rest/commits/commits?apiVersion=2026-03-10#get-a-commit)
- [PATCH https://api.github.com/repos/OWNER/REPO/git/refs/REF](https://docs.github.com/en/rest/git/refs?apiVersion=2026-03-10#update-a-reference)

For more details, please refer to [PRIVACY.md].

&nbsp;

---

_ff-for-github_ is primarily distributed under the terms of both the [Apache
License (Version 2.0)] and the [MIT license]. See [COPYRIGHT] for details.

[PRIVACY.md]: PRIVACY.md
[MIT license]: LICENSE-MIT
[Apache License (Version 2.0)]: LICENSE-APACHE
[COPYRIGHT]: COPYRIGHT
