import { Show, createMemo, type Component } from "solid-js";

import type { PullRequestStatusResult } from "../lib/ghff";

export type StatusCardState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; result: PullRequestStatusResult };

export const StatusCard: Component<{ state: StatusCardState }> = (props) => {
  type StatusCardPresentation = {
    tone: "loading" | "success" | "muted" | "error" | "neutral";
    title: string;
    detail?: string;
    meta?: string;
    actionLabel?: string;
  };
  const presentation = createMemo<StatusCardPresentation>(() => {
    if (props.state.kind === "loading") {
      return {
        tone: "loading",
        title: "Checking fast-forward status",
      };
    }

    if (props.state.kind === "error") {
      return {
        tone: "error",
        title: "Fast-forward status unavailable",
        detail: props.state.message,
      };
    }

    switch (props.state.result.status) {
      case "ff-possible":
        return {
          tone: "success",
          title: "Fast-forward merge possible",
          meta: `${props.state.result.aheadBy} commit${props.state.result.aheadBy === 1 ? "" : "s"} ahead`,
          actionLabel: "Fast-forward merge",
        };
      case "up-to-date":
        return {
          tone: "neutral",
          title: "Already up to date",
        };
      case "cross-repository":
        return {
          tone: "muted",
          title: "Fast-forward merge not supported",
        };
      case "base-ahead":
      case "diverged":
        return {
          tone: "muted",
          title: "Fast-forward merge not possible",
        };
      case "closed":
        return {
          tone: "neutral",
          title: "Pull request is not open",
        };
      default:
        return {
          tone: "error",
          title: "Fast-forward status unavailable",
          detail: "GitHub did not return a comparison state this extension understands.",
        };
    }
  });

  return (
    <section class={`ghff-status ghff-status--${presentation().tone}`}>
      <div class="ghff-status__title">{presentation().title}</div>
      <Show when={presentation().detail}>
        <div class="ghff-status__detail">{presentation().detail}</div>
      </Show>
      <Show when={presentation().meta}>
        <div class="ghff-status__meta">{presentation().meta}</div>
      </Show>
      <Show when={presentation().actionLabel}>
        <div class="ghff-status__actions">
          <button class="ghff-status__button" type="button">
            {presentation().actionLabel}
          </button>
        </div>
      </Show>
    </section>
  );
};
