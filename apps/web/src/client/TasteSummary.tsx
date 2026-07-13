"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

interface SummarySeed {
  id: string;
  sentiment: string;
  entity: { name: string; entityType: string; disambiguation: string | null } | null;
}

interface SummaryResponse {
  seeds: SummarySeed[];
  preferences: { key: string; preferenceValue: string; origin: string }[];
}

export function TasteSummary() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SummaryResponse>("/api/v1/taste/summary")
      .then(setSummary)
      .catch(() => setError("Could not load your profile. Are you signed in?"));
  }, []);

  if (error) {
    return (
      <p role="alert" className="error">
        {error} <a href="/">Sign in</a>
      </p>
    );
  }
  if (!summary) return <p role="status">Loading…</p>;

  const loved = summary.seeds.filter((seed) => ["strong_positive", "positive"].includes(seed.sentiment));
  const avoided = summary.seeds.filter((seed) => !["strong_positive", "positive"].includes(seed.sentiment));

  return (
    <section className="card stack" aria-label="Taste profile summary">
      <h2>Declarations</h2>
      <p>
        {loved.length} loved · {avoided.length} avoided · {summary.preferences.length} derived
        preference facts
      </p>
      <ul>
        {loved.slice(0, 10).map((seed) => (
          <li key={seed.id}>{seed.entity?.name}</li>
        ))}
      </ul>
    </section>
  );
}
