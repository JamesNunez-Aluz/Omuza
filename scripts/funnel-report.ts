import { createPool } from "../packages/db/src/client.ts";

/**
 * First funnel query (spec §15.2, M3 deliverable): signups → onboarded →
 * first run → first feedback → first playlist → first export. Prints a
 * JSON report; no personal data, only counts.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = createPool(databaseUrl);

try {
  const [users, onboarded, ran, fedBack, saved, exported] = await Promise.all([
    count(`select count(distinct id) as n from users where status = 'active'`),
    count(`select count(distinct id) as n from users where onboarding_completed_at is not null`),
    count(`select count(distinct user_id) as n from recommendation_runs
           where status in ('completed', 'degraded')`),
    count(`select count(distinct user_id) as n from feedback_events`),
    count(`select count(distinct user_id) as n from playlists where status = 'active'`),
    count(`select count(distinct user_id) as n from analytics_events
           where event_name = 'file_export_completed'`),
  ]);

  const step = (label: string, n: number, base: number) => ({
    step: label,
    users: n,
    conversionFromPrevious: base > 0 ? Math.round((n / base) * 1000) / 10 : null,
  });

  console.log(
    JSON.stringify(
      {
        report: "activation_funnel_v1",
        steps: [
          step("active_users", users, users),
          step("onboarding_completed", onboarded, users),
          step("first_successful_run", ran, onboarded),
          step("first_feedback", fedBack, ran),
          step("first_playlist_saved", saved, ran),
          step("first_file_export", exported, saved),
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}

async function count(sqlText: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sqlText);
  return Number(rows[0]?.n ?? 0);
}
