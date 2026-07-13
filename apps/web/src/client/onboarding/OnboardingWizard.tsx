"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConsentStep } from "./ConsentStep";
import { ControlsStep } from "./ControlsStep";
import { ReviewStep } from "./ReviewStep";
import { SeedStep } from "./SeedStep";

const STEPS = [
  "Consent",
  "Music you love",
  "Music to avoid",
  "Discovery controls",
  "Review",
] as const;

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const next = () => setStep((current) => Math.min(current + 1, STEPS.length - 1));
  const back = () => setStep((current) => Math.max(current - 1, 0));

  return (
    <div className="stack">
      <nav aria-label="Onboarding progress">
        <ol className="steps">
          {STEPS.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined}>
              {label}
            </li>
          ))}
        </ol>
      </nav>

      <p role="status" className="visually-hidden">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      <section aria-label={STEPS[step]} className="card">
        {step === 0 && <ConsentStep onDone={next} />}
        {step === 1 && <SeedStep mode="positive" onDone={next} onBack={back} />}
        {step === 2 && <SeedStep mode="negative" onDone={next} onBack={back} />}
        {step === 3 && <ControlsStep onDone={next} onBack={back} />}
        {step === 4 && <ReviewStep onBack={back} onComplete={() => router.replace("/home")} />}
      </section>
    </div>
  );
}
