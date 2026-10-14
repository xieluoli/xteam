import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { CommentTriggerPreviewAgent } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { CommentTriggerChips } from "./comment-trigger-chips";

vi.mock("@multica/core/agents", () => ({
  useAgentPresenceDetail: () => ({ availability: "online", workload: "idle" }),
}));

vi.mock("@multica/core/paths", () => ({
  useCurrentWorkspace: () => ({ id: "ws-1" }),
}));

vi.mock("../../common/actor-avatar", () => ({
  AgentStatusDot: () => <span data-testid="status-dot" />,
}));

const walt: CommentTriggerPreviewAgent = {
  id: "agent-1",
  name: "Walt",
  source: "issue_assignee",
  reason: "",
};

const bob: CommentTriggerPreviewAgent = {
  id: "agent-2",
  name: "Bob",
  source: "mention_agent",
  reason: "",
};

describe("CommentTriggerChips", () => {
  it("renders nothing without recipients", () => {
    const { container } = renderWithI18n(<CommentTriggerChips recipients={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("describes @all semantics without promising any recipients", () => {
    renderWithI18n(<CommentTriggerChips recipients={[]} hasAllMembersMention />);
    expect(screen.getByText("Member broadcast · @all does not start agents")).toBeInTheDocument();
    expect(screen.queryByText(/notif/i)).not.toBeInTheDocument();
  });

  it("keeps explicit agent triggers visible alongside @all semantics", () => {
    renderWithI18n(<CommentTriggerChips recipients={[walt]} hasAllMembersMention />);
    expect(screen.getByText("Member broadcast · @all does not start agents")).toBeInTheDocument();
    expect(screen.getByText("Starts right away.")).toBeInTheDocument();
  });

  it("states the start condition of a single recipient", () => {
    renderWithI18n(<CommentTriggerChips recipients={[walt]} />);
    expect(screen.getByText("Starts right away.")).toBeInTheDocument();
  });

  it("counts every recipient of a stacked message", () => {
    renderWithI18n(<CommentTriggerChips recipients={[walt, bob]} />);
    expect(screen.getByText("2 agents will receive this")).toBeInTheDocument();
  });

  it("lists each recipient and where it came from", async () => {
    renderWithI18n(<CommentTriggerChips recipients={[walt, bob]} />);
    fireEvent.click(screen.getByText("2 agents will receive this"));
    expect(await screen.findByText("Recipients")).toBeInTheDocument();
    expect(screen.getByText("Walt")).toBeInTheDocument();
    expect(screen.getByText("assignee")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("@mention")).toBeInTheDocument();
  });

  it("names a blocked mention with an error reason instead of a count", () => {
    renderWithI18n(
      <CommentTriggerChips
        recipients={[]}
        blocked={[
          {
            target_type: "agent",
            target_id: "deadbeef-0001",
            status: "blocked",
            reason_code: "invocation_not_allowed",
          },
        ]}
        draftContent="[@Go](mention://agent/deadbeef-0001) hi"
      />,
    );

    // The name the user typed (not a "1 mention won't trigger" count) plus the
    // short reason, which must not assert a permission cause the server never
    // gave: invocation_not_allowed also covers an unresolved id (MUL-5548).
    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText("Not found or no permission")).toBeInTheDocument();
    expect(screen.queryByText(/won't trigger/i)).not.toBeInTheDocument();
  });

  it("falls back to the reason alone when the label can't be correlated", () => {
    renderWithI18n(
      <CommentTriggerChips
        recipients={[]}
        blocked={[
          {
            target_type: "agent",
            target_id: "deadbeef-0001",
            status: "blocked",
            reason_code: "invocation_not_allowed",
          },
        ]}
        // No matching mention markup for the blocked target → no label available.
        draftContent="plain text"
      />,
    );

    expect(screen.getByText("Not found or no permission")).toBeInTheDocument();
    expect(screen.queryByText("Go")).not.toBeInTheDocument();
  });

  it("renders one named chip per blocked mention", () => {
    renderWithI18n(
      <CommentTriggerChips
        recipients={[]}
        blocked={[
          { target_type: "agent", target_id: "deadbeef-0001", status: "blocked", reason_code: "invocation_not_allowed" },
          { target_type: "squad", target_id: "cafef00d-0002", status: "blocked", reason_code: "runtime_offline" },
        ]}
        draftContent="[@Go](mention://agent/deadbeef-0001) [@Ops](mention://squad/cafef00d-0002)"
      />,
    );

    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText("Not found or no permission")).toBeInTheDocument();
    expect(screen.getByText("Ops")).toBeInTheDocument();
    expect(screen.getByText("Runtime offline")).toBeInTheDocument();
  });
});
