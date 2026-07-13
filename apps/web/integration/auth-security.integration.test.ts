import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setMailer } from "../src/server/mailer";
import { createHarness, makeRequest, signIn } from "./helpers";
import type { TestHarness } from "./helpers";

const RUN = Date.now().toString(36);
const databaseUrl = process.env.DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("authentication & session security (spec §16.2)", () => {
  let harness: TestHarness;
  const sentLinks: { email: string; url: string }[] = [];

  beforeAll(async () => {
    harness = await createHarness();
    setMailer({
      async sendLoginLink(email, loginUrl) {
        sentLinks.push({ email, url: loginUrl });
      },
    });
  });

  afterAll(async () => {
    setMailer(undefined);
    await harness.close();
  });

  it("answers identically for known and unknown emails (enumeration resistance)", async () => {
    const { POST } = await import("../app/api/v1/auth/request-link/route.js");
    await signIn(harness.db, `known-account-${RUN}@example.test`);

    const unknown = await POST(
      makeRequest("POST", "/api/v1/auth/request-link", { body: { email: `nobody-${RUN}@example.test` } }),
    );
    const known = await POST(
      makeRequest("POST", "/api/v1/auth/request-link", { body: { email: `known-account-${RUN}@example.test` } }),
    );
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("rate-limits login link requests per email", async () => {
    const { POST } = await import("../app/api/v1/auth/request-link/route.js");
    const email = `rate-limit-me-${RUN}@example.test`;
    let lastStatus = 0;
    for (let i = 0; i < 6; i += 1) {
      const response = await POST(
        makeRequest("POST", "/api/v1/auth/request-link", { body: { email } }),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("rejects cross-origin login requests", async () => {
    const { POST } = await import("../app/api/v1/auth/request-link/route.js");
    const response = await POST(
      makeRequest("POST", "/api/v1/auth/request-link", {
        body: { email: `x-${RUN}@example.test` },
        origin: "https://evil.example.com",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("login tokens are single-use and expired/garbage tokens fail", async () => {
    const { POST: requestLink } = await import("../app/api/v1/auth/request-link/route.js");
    const { POST: verify } = await import("../app/api/v1/auth/verify/route.js");

    sentLinks.length = 0;
    await requestLink(
      makeRequest("POST", "/api/v1/auth/request-link", { body: { email: `single-use-${RUN}@example.test` } }),
    );
    const token = new URL(sentLinks[0]!.url).searchParams.get("token")!;

    const first = await verify(makeRequest("POST", "/api/v1/auth/verify", { body: { token } }));
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect(first.headers.get("set-cookie")).toContain("SameSite=Lax");

    const replay = await verify(makeRequest("POST", "/api/v1/auth/verify", { body: { token } }));
    expect(replay.status).toBe(400);

    const garbage = await verify(
      makeRequest("POST", "/api/v1/auth/verify", { body: { token: "a".repeat(43) } }),
    );
    expect(garbage.status).toBe(400);
  });

  it("requires a session for API access and honors logout revocation", async () => {
    const { GET: me } = await import("../app/api/v1/auth/me/route.js");
    const { POST: logout } = await import("../app/api/v1/auth/logout/route.js");

    const anonymous = await me(makeRequest("GET", "/api/v1/auth/me"));
    expect(anonymous.status).toBe(401);

    const cookie = await signIn(harness.db, `session-lifecycle-${RUN}@example.test`);
    const authed = await me(makeRequest("GET", "/api/v1/auth/me", { cookie }));
    expect(authed.status).toBe(200);

    const out = await logout(makeRequest("POST", "/api/v1/auth/logout", { cookie, body: {} }));
    expect(out.status).toBe(200);

    const afterLogout = await me(makeRequest("GET", "/api/v1/auth/me", { cookie }));
    expect(afterLogout.status).toBe(401);
  });

  it("rejects mutating requests without a same-origin header even with a session", async () => {
    const { POST } = await import("../app/api/v1/taste/seeds/route.js");
    const cookie = await signIn(harness.db, `csrf-check-${RUN}@example.test`);
    const crossOrigin = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", {
        cookie,
        body: { items: [] },
        origin: "https://evil.example.com",
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const noOrigin = await POST(
      makeRequest("POST", "/api/v1/taste/seeds", { cookie, body: { items: [] }, origin: null }),
    );
    expect(noOrigin.status).toBe(403);
  });
});
