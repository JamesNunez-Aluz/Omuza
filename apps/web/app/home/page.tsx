import Link from "next/link";

import { GenerateRunButton } from "@/client/GenerateRunButton";
import { TasteSummary } from "@/client/TasteSummary";

export default function HomeAfterOnboarding() {
  return (
    <main className="page">
      <h1>Your taste profile</h1>
      <p className="lede">
        Generate a 20-track discovery playlist from your declarations — no streaming service
        required.
      </p>
      <GenerateRunButton />
      <TasteSummary />
      <p>
        <Link href="/settings">Settings, consents, and your data</Link>
      </p>
    </main>
  );
}
