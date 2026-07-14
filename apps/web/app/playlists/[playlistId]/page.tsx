import { PlaylistView } from "@/client/PlaylistView";

export default async function PlaylistPage({ params }: { params: Promise<{ playlistId: string }> }) {
  const { playlistId } = await params;
  return (
    <main className="page">
      <PlaylistView playlistId={playlistId} />
    </main>
  );
}
