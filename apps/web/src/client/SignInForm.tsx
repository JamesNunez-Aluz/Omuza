"use client";

import { useState } from "react";

import { ApiError, api } from "./api";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api("/api/v1/auth/request-link", { body: { email } });
      setState("sent");
    } catch (cause) {
      setState("error");
      setError(cause instanceof ApiError ? cause.message : "Could not send the link. Try again.");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className="status">
        Check your email — if the address is valid, a sign-in link is on its way. It works once and
        expires in 15 minutes.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="stack" aria-describedby={error ? "signin-error" : undefined}>
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {error ? (
        <p id="signin-error" role="alert" className="error">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
