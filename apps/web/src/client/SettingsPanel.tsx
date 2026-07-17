"use client";

import { useEffect, useState } from "react";

import { ApiError, api } from "./api";

import { SpotifyConnections } from "./SpotifyConnections";

interface MeResponse {
  user: { displayName: string | null; locale: string; timeZone: string };
  consents: { purpose: string; status: string; occurredAt: string }[];
  features?: { spotifyExport: boolean };
}

const CONSENT_LABELS: Record<string, string> = {
  terms_privacy: "Terms of Service and Privacy Policy",
  core_personalization: "Personalized recommendations (required for the product to work)",
  analytics: "Product analytics",
  model_improvement: "Use my feedback to improve recommendations for everyone",
  research: "Include my anonymized usage in research analytics",
  marketing: "Product news emails",
};

const OPTIONAL_PURPOSES = ["model_improvement", "research", "analytics", "marketing"];

export function SettingsPanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MeResponse>("/api/v1/auth/me")
      .then((response) => {
        setMe(response);
        setDisplayName(response.user.displayName ?? "");
      })
      .catch(() => setError("Could not load settings. Are you signed in?"));
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await api("/api/v1/settings", {
        method: "PATCH",
        body: { displayName: displayName || null },
      });
      setMessage("Profile saved.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your profile.");
    }
  }

  async function setConsent(purpose: string, status: "granted" | "withdrawn") {
    setMessage(null);
    setError(null);
    try {
      await api("/api/v1/privacy/consents", { body: { purpose, status } });
      const refreshed = await api<MeResponse>("/api/v1/auth/me");
      setMe(refreshed);
      setMessage("Consent updated. Your consent history is preserved, never overwritten.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not update consent.");
    }
  }

  async function requestExport() {
    setMessage(null);
    setError(null);
    try {
      const request = await api<{ id: string }>("/api/v1/privacy/export", { body: {} });
      setMessage(`Export queued (request ${request.id}). Check back shortly.`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not request the export.");
    }
  }

  async function requestDeletion() {
    const confirmation = window.prompt(
      'This permanently deletes your account and taste data. Type "delete my account" to confirm.',
    );
    if (confirmation !== "delete my account") return;
    try {
      await api("/api/v1/privacy/delete", { body: { confirm: confirmation } });
      setMessage("Deletion queued. Your account will be removed shortly.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not request deletion.");
    }
  }

  async function signOut() {
    await api("/api/v1/auth/logout", { body: {} });
    window.location.href = "/";
  }

  if (error && !me) {
    return (
      <p role="alert" className="error">
        {error} <a href="/">Sign in</a>
      </p>
    );
  }
  if (!me) return <p role="status">Loading…</p>;

  const consentStatus = new Map(me.consents.map((consent) => [consent.purpose, consent.status]));

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Profile</h2>
        <form onSubmit={saveProfile} className="stack">
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            value={displayName}
            maxLength={80}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <div className="actions">
            <button type="submit">Save profile</button>
            <button type="button" className="secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </form>
      </section>

      <section className="card stack" aria-labelledby="consents-heading">
        <h2 id="consents-heading">Consents</h2>
        <ul className="seed-list">
          {OPTIONAL_PURPOSES.map((purpose) => {
            const granted = consentStatus.get(purpose) === "granted";
            return (
              <li key={purpose}>
                <span>
                  {CONSENT_LABELS[purpose]}{" "}
                  <span className="result-meta">({granted ? "granted" : "not granted"})</span>
                </span>
                <button
                  type="button"
                  onClick={() => setConsent(purpose, granted ? "withdrawn" : "granted")}
                >
                  {granted ? "Withdraw" : "Grant"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {me.features?.spotifyExport ? <SpotifyConnections /> : null}

      <section className="card stack" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Your data</h2>
        <div className="actions">
          <button type="button" onClick={requestExport}>
            Export my data
          </button>
          <button type="button" className="danger" onClick={requestDeletion}>
            Delete my account
          </button>
        </div>
      </section>

      {message ? (
        <p role="status" className="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
