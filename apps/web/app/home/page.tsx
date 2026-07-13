import Link from "next/link";

import { TasteSummary } from "@/client/TasteSummary";

export default function HomeAfterOnboarding() {
  return (
    <main className="page">
      <h1>Your taste profile</h1>
      <p className="lede">
        Playlist generation arrives with the recommendation engine (Milestone 2). Your profile is
        ready and keeps learning from what you add here.
      </p>
      <TasteSummary />
      <p>
        <Link href="/settings">Settings, consents, and your data</Link>
      </p>
    </main>
  );
}
