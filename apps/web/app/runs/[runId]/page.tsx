import { RunView } from "@/client/RunView";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return (
    <main className="page">
      <h1>Your playlist</h1>
      <RunView runId={runId} />
    </main>
  );
}
