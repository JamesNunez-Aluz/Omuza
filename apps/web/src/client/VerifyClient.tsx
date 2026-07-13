"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "./api";

interface VerifyResponse {
  user: { id: string; onboardingCompleted: boolean };
}

/**
 * The magic link lands here with ?token=…; the token is redeemed via POST so
 * the secret is never re-sent in navigational requests after this page.
 */
export function VerifyClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError("This sign-in link is incomplete. Request a new one.");
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    api<VerifyResponse>("/api/v1/auth/verify", { body: { token } })
      .then((result) => {
        router.replace(result.user.onboardingCompleted ? "/home" : "/onboarding");
      })
      .catch((cause) => {
        setError(
          cause instanceof ApiError ? cause.message : "Sign-in failed. Request a new link.",
        );
      });
  }, [params, router]);

  if (error) {
    return (
      <>
        <p role="alert" className="error">
          {error}
        </p>
        <p>
          <a href="/">Back to sign in</a>
        </p>
      </>
    );
  }
  return <p role="status">Checking your link…</p>;
}
