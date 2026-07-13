import { getPool } from "@/server/db";
import { pingDatabase } from "@resonance/db";

export const dynamic = "force-dynamic";

/** Readiness: 200 only when configuration is valid and the database answers. */
export async function GET(): Promise<Response> {
  try {
    const ok = await pingDatabase(getPool());
    return Response.json(
      { status: ok ? "ok" : "unavailable", checks: { database: ok } },
      { status: ok ? 200 : 503 },
    );
  } catch {
    return Response.json(
      { status: "unavailable", checks: { database: false } },
      { status: 503 },
    );
  }
}
