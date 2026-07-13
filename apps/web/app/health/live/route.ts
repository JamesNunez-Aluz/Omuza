export const dynamic = "force-dynamic";

/** Liveness: answers 200 whenever the web process can serve requests. */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
