/** Onboarding steps (CLAUDE.md §11), shared by the page (server) and the wizard (browser). */
export type SetupStep = "invite" | "client" | "document";
export type OnboardingStep = "start" | "avatar" | "company" | SetupStep;

/** Set up later from the home page's checklist: each one returns to the home page. */
export const SETUP_STEPS: readonly SetupStep[] = ["invite", "client", "document"];

export function isSetupStep(value: string): value is SetupStep {
  return (SETUP_STEPS as readonly string[]).includes(value);
}
