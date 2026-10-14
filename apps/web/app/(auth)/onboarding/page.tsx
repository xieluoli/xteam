"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@multica/core/auth";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@multica/core/paths";
import { useWorkspaceList } from "@multica/core/workspace";
import { OnboardingFlow } from "@multica/views/onboarding";

/** Web auth shell for the shared onboarding flow. */
export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hasOnboarded = useHasOnboarded();
  const { workspaces, ready: workspacesReady } = useWorkspaceList({
    enabled: !!user,
  });
  // Completion refreshes auth before the flow navigates. Keep the auth guard
  // from competing with that navigation.
  const completingRef = useRef(false);

  useEffect(() => {
    if (isLoading || !user) {
      if (!isLoading && !user) router.replace(paths.login());
      return;
    }
    if (!workspacesReady) return;
    if (completingRef.current) return;
    // A workspace can exist before completion succeeds; only onboarded_at
    // gates this route, never workspaces.length.
    if (hasOnboarded) {
      router.replace(resolvePostAuthDestination(workspaces, hasOnboarded));
    }
  }, [isLoading, user, hasOnboarded, workspacesReady, workspaces, router]);

  if (isLoading || !user || hasOnboarded) return null;

  // Layout: page owns its own scroll (root layout sets `body {
  // overflow: hidden }` for the app-shell convention). OnboardingFlow
  // owns the per-step width constraint internally — Welcome renders a
  // wide two-column hero, all other steps wrap themselves at max-w-xl.
  return (
    <div className="h-full overflow-y-auto bg-background">
      <OnboardingFlow
        onComplete={(ws) => {
          completingRef.current = true;
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
