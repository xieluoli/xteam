"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@multica/core/auth";
import { paths } from "@multica/core/paths";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { OnboardingFlow } from "@multica/views/onboarding";

/** Creating another workspace reuses the workspace step, without the intro. */
export default function Page() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const { data: wsList = [] } = useQuery({
    ...workspaceListOptions(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!isLoading && !user) router.replace(paths.login());
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  // Cancel goes to the root path — the workspace layout redirects from there
  // to the user's default workspace. Only offered when there is somewhere to
  // return to; a user with no workspaces at all has to finish.
  const onCancel =
    wsList.length > 0 ? () => router.push(paths.root()) : undefined;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <OnboardingFlow
        mode="new_workspace"
        onCancel={onCancel}
        onComplete={(ws) => {
          if (ws) {
            router.push(paths.workspace(ws.slug).issues());
          } else {
            router.push(paths.root());
          }
        }}
      />
    </div>
  );
}
