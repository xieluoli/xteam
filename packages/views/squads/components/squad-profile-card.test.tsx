import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { SquadProfileCard } from "./squad-profile-card";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@multica/core/workspace/queries", () => ({
  squadListOptions: () => ({ queryKey: ["squads"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
  memberListOptions: () => ({ queryKey: ["members"] }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "squads"
      ? [{ id: "squad-1", name: "Historical squad", description: "Preserved identity", member_count: 0 }]
      : [],
    isLoading: false,
  }),
}));
vi.mock("../../common/actor-avatar", () => ({ ActorAvatar: () => null }));

describe("SquadProfileCard", () => {
  it("preserves historical identity without linking to the deleted detail page", () => {
    renderWithI18n(<SquadProfileCard squadId="squad-1" />);
    expect(screen.getByText("Historical squad")).toBeInTheDocument();
    expect(screen.getByText("Preserved identity")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
