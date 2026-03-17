import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Fast-forward merge for GitHub",
    description: "Shows whether a GitHub pull request can be fast-forward merged.",
    host_permissions: ["https://api.github.com/*"],
  },
});
