import { AgentsPage } from "@multica/views/agents/agents-page";
import { readPmInstallRelease } from "@/platform/pm-install-release";

export default function AgentsRoute() {
  return <AgentsPage pmInstallRelease={readPmInstallRelease(process.env.XTEAM_PM_INSTALL_RELEASE)} />;
}
