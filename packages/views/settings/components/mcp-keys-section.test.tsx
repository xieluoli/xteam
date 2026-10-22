import {beforeEach,expect,it,vi} from "vitest";
import {screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {renderWithI18n} from "../../test/i18n";
import {MCPKeysSection} from "./mcp-keys-section";
const mocks=vi.hoisted(()=>({list:vi.fn(),create:vi.fn(),revoke:vi.fn(),copy:vi.fn()}));
vi.mock("@multica/core/auth",()=>({useAuthStore:(selector:(state:{user:{id:string}})=>unknown)=>selector({user:{id:"user"}})}));
vi.mock("@multica/core/api",()=>({api:{listMCPKeys:mocks.list,createMCPKey:mocks.create,revokeMCPKey:mocks.revoke,getBaseUrl:()=>"https://xteam.example"}}));
vi.mock("@multica/core/workspace/queries",()=>({workspaceListOptions:()=>({queryKey:["workspaces"],queryFn:async()=>[{id:"ws",name:"Organization",slug:"org"}]})}));
vi.mock("@multica/ui/lib/clipboard",()=>({copyText:mocks.copy}));
function renderSection(){return renderWithI18n(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MCPKeysSection/></QueryClientProvider>)}
beforeEach(()=>{mocks.list.mockResolvedValue([]);mocks.create.mockReset();mocks.revoke.mockReset();mocks.copy.mockResolvedValue(true)});
it("creates a workspace-bound read key and copies configuration without the secret",async()=>{
 const user=userEvent.setup();renderSection();await user.type(await screen.findByLabelText("Key name"),"Codex project");
 await user.selectOptions(await screen.findByLabelText("Workspace"),"ws");
 mocks.create.mockResolvedValue({id:"key",name:"Codex project",workspace_id:"ws",scopes:["issues:read"],token_prefix:"xtm_prefix",token:"xtm_fixture_secret",expires_at:"2026-12-01T00:00:00Z",created_at:"2026-10-22T00:00:00Z",last_used_at:null});
 await user.click(screen.getByRole("button",{name:"Create MCP key"}));expect(await screen.findByText("xtm_fixture_secret")).toBeVisible();
 await user.click(screen.getByRole("button",{name:"Copy Codex configuration"}));
 expect(mocks.copy.mock.calls.at(-1)?.[0]).toContain('bearer_token_env_var = "XTEAM_MCP_KEY"');
 expect(mocks.copy.mock.calls.at(-1)?.[0]).not.toContain("xtm_fixture_secret");
 await user.click(screen.getByRole("button",{name:"I stored the key"}));await waitFor(()=>expect(screen.queryByText("xtm_fixture_secret")).not.toBeInTheDocument());
});
it("keeps creation input after a failure and requires confirmation before revoking",async()=>{
 mocks.list.mockResolvedValue([{id:"key",name:"Existing key",workspace_id:"ws",scopes:["issues:read"],token_prefix:"xtm_prefix",expires_at:"2026-12-01T00:00:00Z",created_at:"2026-10-22T00:00:00Z",last_used_at:null}]);
 const user=userEvent.setup();renderSection();await user.type(await screen.findByLabelText("Key name"),"Keep this");await user.selectOptions(screen.getByLabelText("Workspace"),"ws");
 mocks.create.mockRejectedValue(new Error("Temporarily unavailable"));await user.click(screen.getByRole("button",{name:"Create MCP key"}));expect(await screen.findByRole("alert")).toHaveTextContent("Temporarily unavailable");expect(screen.getByLabelText("Key name")).toHaveValue("Keep this");
 await user.click(screen.getByRole("button",{name:"Revoke Existing key"}));expect(mocks.revoke).not.toHaveBeenCalled();
 mocks.revoke.mockResolvedValue(undefined);await user.click(screen.getByRole("button",{name:"Confirm revocation"}));await waitFor(()=>expect(mocks.revoke).toHaveBeenCalledWith("key"));
});
