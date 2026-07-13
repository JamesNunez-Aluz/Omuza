import { Suspense } from "react";

import { VerifyClient } from "@/client/VerifyClient";

export default function VerifyPage() {
  return (
    <main className="page">
      <h1>Signing you in</h1>
      <Suspense fallback={<p role="status">Checking your link…</p>}>
        <VerifyClient />
      </Suspense>
    </main>
  );
}
