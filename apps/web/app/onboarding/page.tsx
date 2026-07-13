import { OnboardingWizard } from "@/client/onboarding/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <main className="page">
      <h1>Set up your taste profile</h1>
      <OnboardingWizard />
    </main>
  );
}
