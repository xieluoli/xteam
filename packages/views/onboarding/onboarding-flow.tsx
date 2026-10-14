"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAuthStore } from "@multica/core/auth";
import {
  completeOnboarding,
  saveQuestionnaire,
  type QuestionnaireAnswers,
} from "@multica/core/onboarding";
import { useWorkspaceList } from "@multica/core/workspace";
import type { Workspace } from "@multica/core/types";
import { StepWelcome } from "./steps/step-welcome";
import type { OnboardingRailStep } from "./components/step-sidebar";
import { StepShell } from "./components/step-shell";
import { StepAboutYou } from "./steps/step-about-you";
import { StepWorkspace } from "./steps/step-workspace";
import { OnboardingLogoutButton } from "./components/onboarding-logout-button";
import { useT } from "../i18n";

const EMPTY_QUESTIONNAIRE: QuestionnaireAnswers = {
  source: [],
  source_other: null,
  source_skipped: false,
  role: null,
  role_other: null,
  role_skipped: false,
  use_case: [],
  use_case_other: null,
  use_case_skipped: false,
  version: 2,
};

/**
 * Coerce a stored questionnaire slot into the array shape used by the
 * current UI. Earlier versions of this app wrote `source` / `use_case`
 * as a single string; tolerate that on read so a user who started
 * onboarding before this change doesn't see their previous answer
 * disappear on re-entry. Empty string and null both collapse to [].
 */
function coerceToArray<T extends string>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is T => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value as T];
  }
  return [];
}

/**
 * Merge persisted answers into the empty default. Re-entry pre-fills
 * answered slots but treats `*_skipped` as fresh (the user can answer
 * this time) — the v1 skip marker is dropped on read, the analytics
 * record of the prior skip stays in the DB.
 */
function mergeQuestionnaire(
  raw: Record<string, unknown>,
): QuestionnaireAnswers {
  const merged = {
    ...EMPTY_QUESTIONNAIRE,
    ...(raw as Partial<QuestionnaireAnswers>),
  };
  return {
    ...merged,
    source: coerceToArray<QuestionnaireAnswers["source"][number]>(raw.source),
    use_case: coerceToArray<QuestionnaireAnswers["use_case"][number]>(
      raw.use_case,
    ),
    source_skipped: false,
    role_skipped: false,
    use_case_skipped: false,
  };
}

interface OnboardingFlowProps {
  onComplete: (workspace?: Workspace) => void;
  mode?: OnboardingMode;
  onCancel?: () => void;
}

/** Shared first-run and new-workspace flow; completion never provisions agents. */
export function OnboardingFlow({
  onComplete,
  mode = "first_run",
  onCancel,
}: OnboardingFlowProps) {
  const { t } = useT("onboarding");
  const user = useAuthStore((state) => state.user);
  if (!user) throw new Error("OnboardingFlow requires an authenticated user");

  const [answers, setAnswers] = useState<QuestionnaireAnswers>(
    () => mergeQuestionnaire(user.onboarding_questionnaire),
  );
  const isNewWorkspace = mode === "new_workspace";
  const [step, setStep] = useState<OnboardingStep>(
    isNewWorkspace ? "workspace" : "welcome",
  );
  const [stepBusy, setStepBusy] = useState(false);
  const { workspaces, ready: workspacesReady } = useWorkspaceList({
    enabled: step === "welcome" || step === "workspace",
  });

  const applyAnswers = useCallback((patch: Partial<QuestionnaireAnswers>) => {
    setAnswers((previous) => {
      const next = { ...previous, ...patch };
      void saveQuestionnaire(next).catch((error) => {
        if (error instanceof Error) toast.error(error.message);
      });
      return next;
    });
  }, []);

  const handleWelcomeSkip = async () => {
    try {
      await completeOnboarding("skip_existing", workspaces[0]?.id);
      onComplete(workspaces[0]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.errors.skip_failed));
    }
  };

  const handleWorkspaceCreated = async (workspace: Workspace) => {
    try {
      // Name the target explicitly: the desktop tab system still owns the
      // active workspace until onComplete navigates to this workspace.
      await completeOnboarding("runtime_skipped", workspace.id);
      onComplete(workspace);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.errors.skip_failed));
    }
  };

  if (step === "welcome") {
    return (
      <>
        <OnboardingLogoutButton />
        <StepWelcome
          onNext={() => setStep("about_you")}
          onSkip={workspacesReady && workspaces.length > 0 ? handleWelcomeSkip : undefined}
        />
      </>
    );
  }

  return (
    <StepShell
      currentStep={step}
      onBack={isNewWorkspace ? onCancel : () => setStep(step === "workspace" ? "about_you" : "welcome")}
      backDisabled={stepBusy}
      onStepChange={isNewWorkspace ? undefined : setStep}
      chromeFooter={<OnboardingLogoutButton inline />}
    >
      {step === "about_you" && (
        <StepAboutYou
          answers={answers}
          onChange={applyAnswers}
          onAdvance={() => setStep("workspace")}
          onSkip={() => setStep("workspace")}
        />
      )}
      {step === "workspace" && (
        <StepWorkspace
          existing={isNewWorkspace ? null : workspaces[0]}
          onCreated={handleWorkspaceCreated}
          onBusyChange={setStepBusy}
        />
      )}
    </StepShell>
  );
}

export type OnboardingMode = "first_run" | "new_workspace";

export type OnboardingStep = "welcome" | OnboardingRailStep;
