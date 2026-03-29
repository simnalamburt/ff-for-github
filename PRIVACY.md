# Privacy policy

Fast-forward merge for GitHub handles only the data necessary to show
fast-forward status for the current GitHub pull request and, if the user
chooses, perform a fast-forward merge through GitHub.

Data handled by the extension:
- A GitHub Personal Access Token entered by the user on the options page.
- GitHub repository owner/name and pull request number derived from the current
  GitHub pull request URL.
- GitHub API responses needed to determine whether the pull request can be
  fast-forward merged and, when the user requests it, to update the base branch
  reference.

How the data is used:
- The token is stored locally in the browser and used only to authenticate
  requests to GitHub.
- The extension sends data only to `https://api.github.com` over HTTPS and only
  to provide its core GitHub fast-forward feature.
- The extension does not send user data to the developer, advertisers, analytics
  providers, or data brokers.
- The extension does not sell user data or use it for any purpose unrelated to
  the extension’s single purpose.

Data retention and user control:
- The user can remove the saved token at any time from the extension’s options
  page.
- Data stored by the extension is removed when the extension is uninstalled.

The extension does not use remote code.

&nbsp;

--------

&nbsp;

For the sake of documentation and transparency, I will also record here the
Privacy form submitted to the Chrome Web Store.

## Single purpose
> An extension must have a single purpose that is narrow and easy-to-understand.
> [Learn more][policies]

Fast-forward merge for GitHub has one narrow purpose: it helps a user evaluate
and, if they choose, perform a fast-forward merge for the GitHub pull request
currently open in the browser. On GitHub pull request pages, the extension adds
a small status card in the sidebar, reads the repository owner/name and pull
request number from the page URL, asks the GitHub API for the pull request
metadata and branch comparison, and shows whether a fast-forward merge is
possible. If the user has saved a GitHub Personal Access Token and explicitly
clicks the action button, the extension sends the corresponding GitHub API
request to update the base branch ref and complete the fast-forward merge. The
extension does not provide unrelated features such as issue management,
analytics, advertising, or general page modification outside GitHub pull request
pages.

## Permission justification
> A [permission] is either one of a list of known strings, such as "activeTab",
> or a [match pattern] giving access to one or more hosts. Remove any permission
> that is not needed to fulfill the single purpose of your extension. Requesting
> an unnecessary permission will result in this version being rejected.
>
> NOTE: Due to the Host Permission, your extension may require an in-depth
> review which will delay publishing.

#### storage justification
`storage` is used only to save the GitHub Personal Access Token that the user
explicitly enters on the options page, and to check whether a token has already
been saved. The token is required so the extension can authenticate requests to
the GitHub API, especially for private repositories, and perform the optional
fast-forward merge action on the user’s behalf. The token is stored in
`chrome.storage.local`, can be removed by the user at any time from the options
page, and is deleted when the extension is uninstalled. The extension does not
sync this token to the developer’s servers or any analytics service. The
background worker also limits storage access to trusted extension contexts so
content scripts cannot directly read the stored token.

#### Host permission justification
> A host permission is any match pattern specified in the "permissions" and
> "content_scripts" fields of the extension manifest

Two GitHub host accesses are required for the extension’s single purpose. First,
the content script runs on `https://github.com/*/*/pull/*` so it can detect that
the current page is a GitHub pull request, read the owner/repository/pull
request number from the URL, and render the fast-forward status card in the pull
request sidebar. It does not run on unrelated websites. Second,
`https://api.github.com/*` is required because the background worker calls the
GitHub REST API to fetch pull request metadata, compare the base branch against
the pull request head, validate the user’s GitHub token, and, only after the
user explicitly clicks the merge button, update the base branch reference to
perform the fast-forward merge. No other external hosts are used.

#### Are you using remote code?
> Remote code is any JS or Wasm that is not included in the extension's package.
> This includes references to external files in `<script>` tags, modules
> pointing to external files, and strings evaluated through `eval()`

No, I am not using remote code.

## Data usage
> The content of this form will be displayed publicly on the item detail page.
> By publishing your item, you are certifying that these disclosures reflect the
> most up-to-date content of your privacy policy.

#### What user data do you plan to collect from users now or in the future? (See [FAQ] for more information)
- [ ] Personally identifiable information \
      For example: name, address, email address, age, or identification number
- [ ] Health information \
      For example: heart rate data, medical history, symptoms, diagnoses, or
      procedures
- [ ] Financial and payment information \
      For example: transactions, credit card numbers, credit ratings, financial
      statements, or payment history
- [x] Authentication information \
      For example: passwords, credentials, security question, or personal
      identification number (PIN)
- [ ] Personal communications \
      For example: emails, texts, or chat messages
- [ ] Location \
      For example: region, IP address, GPS coordinates, or information about
      things near the user’s device
- [ ] Web history \
      The list of web pages a user has visited, as well as associated data such
      as page title and time of visit
- [ ] User activity \
      For example: network monitoring, clicks, mouse position, scroll, or
      keystroke logging
- [ ] Website content \
      For example: text, images, sounds, videos, or hyperlinks

#### I certify that the following disclosures are true:
- [x] I do not sell or transfer user data to third parties, outside of the
      [approved use cases]
- [x] I do not use or transfer user data for purposes that are unrelated to my
      item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for
      lending purposes

> You must certify all three disclosures to comply with our [Developer Program
> Policies]

[permission]: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
[match pattern]: https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
[FAQ]: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
[approved use cases]: https://developer.chrome.com/docs/webstore/program-policies#limited_use
[Developer Program Policies]: https://developer.chrome.com/docs/webstore/program-policies
[policies]: https://developer.chrome.com/webstore/program_policies#extensions
[privacy]: https://developer.chrome.com/docs/webstore/program-policies/privacy/
