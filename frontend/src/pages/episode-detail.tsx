import {
  type EpisodeDetail,
  EpisodeDetailSchema,
  type EpisodePatchRequest,
  type EpisodePatchResponse,
  EpisodePatchResponseSchema,
  EpisodeSyncResponseSchema,
} from "@shared/schemas/admin-api";
import {
  BuildErrorSchema,
  type BuildProgress,
  BuildProgressSchema,
  BuildResultSchema,
} from "@shared/schemas/build-events";
import {
  ArrowLeft,
  Check,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Merge,
  Music,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import useSWR from "swr";
import useSWRMutation from "swr/mutation";

import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { zodFetcher, zodMutator } from "@/lib/api";
import { useSSEAction } from "@/lib/use-sse-action";

export function EpisodeDetail() {
  const { id, podcast } = useParams<{ id: string; podcast: string }>();
  const {
    data: episode,
    isLoading,
    mutate,
  } = useSWR<EpisodeDetail>(
    `/api/admin/podcasts/${podcast}/episodes/${id}`,
    zodFetcher(EpisodeDetailSchema),
  );

  const {
    error: syncError,
    isMutating: syncing,
    trigger: triggerSync,
  } = useSWRMutation(
    `/api/admin/podcasts/${podcast}/episodes/${id}/sync`,
    zodMutator(EpisodeSyncResponseSchema),
  );

  const { isMutating: patching, trigger: triggerPatch } = useSWRMutation(
    `/api/admin/podcasts/${podcast}/episodes/${id}`,
    zodMutator<EpisodePatchResponse, EpisodePatchRequest>(EpisodePatchResponseSchema, "PATCH"),
  );

  const downloadSSE = useSSEAction<BuildProgress, { message: string }>(
    `/api/admin/podcasts/${podcast}/episodes/${id}/download`,
    { error: BuildErrorSchema, progress: BuildProgressSchema, result: BuildResultSchema },
  );

  const mergeSSE = useSSEAction<BuildProgress, { message: string }>(
    `/api/admin/podcasts/${podcast}/episodes/${id}/merge`,
    { error: BuildErrorSchema, progress: BuildProgressSchema, result: BuildResultSchema },
  );

  const handleSync = async () => {
    await triggerSync();
    await mutate();
  };

  const handleDownload = async () => {
    await downloadSSE.execute();
    await mutate();
  };

  const handleMerge = async () => {
    await mergeSSE.execute();
    await mutate();
  };

  const handleToggleSkip = async () => {
    if (!episode) return;
    await triggerPatch({ skipped: !episode.skipped });
    await mutate();
  };

  if (isLoading) {
    return (
      <Layout>
        <p className="text-muted-foreground">Loading...</p>
      </Layout>
    );
  }

  if (!episode) {
    return (
      <Layout>
        <Link
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
          to={`/${podcast}`}
        >
          <ArrowLeft className="h-3 w-3" />
          Back to episodes
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Not Found</h1>
        <p className="text-muted-foreground mt-2">Episode not found.</p>
      </Layout>
    );
  }

  const totalDuration = episode.tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const isPending = episode.tracks.length === 0 && !episode.skipped && !episode.merged;
  const allTracksDownloaded =
    episode.tracks.length > 0 && episode.tracks.every((t) => t.fileSize !== null);

  return (
    <Layout>
      <Link
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
        to={`/${podcast}`}
      >
        <ArrowLeft className="h-3 w-3" />
        Back to episodes
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{episode.title}</h1>
            {syncError && (
              <Card className="mt-3 border-destructive">
                <CardContent className="py-3">
                  <p className="text-sm text-destructive">
                    {syncError instanceof Error ? syncError.message : String(syncError)}
                  </p>
                </CardContent>
              </Card>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {episode.tracks.length === 0 && !episode.skipped && !episode.merged ? (
                <Badge variant="outline">Pending</Badge>
              ) : episode.skipped ? (
                <Badge variant="destructive">Skipped</Badge>
              ) : episode.merged ? (
                <Badge variant="success">Cached</Badge>
              ) : (
                <Badge variant="warning">Synced</Badge>
              )}
              {episode.minimumPrice !== null &&
                (episode.minimumPrice > 0 ? (
                  <Badge variant="destructive">
                    {episode.minimumPrice} {episode.priceCurrency ?? ""}
                  </Badge>
                ) : (
                  <Badge variant="muted">Free</Badge>
                ))}
            </div>
          </div>

          {episode.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {episode.description}
                </p>
              </CardContent>
            </Card>
          )}

          {episode.tracks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Music className="h-4 w-4" />
                  Tracks ({episode.tracks.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-24 text-right">Duration</TableHead>
                      <TableHead className="w-24 text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {episode.tracks.map((track) => (
                      <TableRow key={track.position}>
                        <TableCell className="font-mono text-muted-foreground">
                          {track.position}
                        </TableCell>
                        <TableCell>{track.title}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDuration(track.durationMs)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {track.fileSize !== null ? formatBytes(track.fileSize) : "Missing"}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell />
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatDuration(totalDuration)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {episode.credits && (
            <Card>
              <CardHeader>
                <CardTitle>Credits</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {episode.credits}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {episode.artworkUrl && (
            <Card>
              <CardContent className="p-4">
                <img
                  alt={`Artwork for ${episode.title}`}
                  className="w-full rounded-lg"
                  src={episode.artworkUrl}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                disabled={syncing || patching}
                onClick={handleSync}
                size="sm"
                variant="outline"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync"}
              </Button>
              <Button
                disabled={isPending || patching || syncing}
                onClick={handleToggleSkip}
                size="sm"
                variant="outline"
              >
                {episode.skipped ? (
                  <>
                    <Eye className="h-4 w-4" /> Include
                  </>
                ) : (
                  <>
                    <EyeOff className="h-4 w-4" /> Skip
                  </>
                )}
              </Button>
              <Button
                disabled={
                  isPending || episode.skipped || allTracksDownloaded || downloadSSE.running
                }
                onClick={handleDownload}
                size="sm"
                variant="outline"
              >
                <Download className={`h-4 w-4 ${downloadSSE.running ? "animate-pulse" : ""}`} />
                {downloadSSE.running ? "Downloading..." : "Download"}
              </Button>
              <Button
                disabled={
                  isPending ||
                  episode.skipped ||
                  episode.merged ||
                  !allTracksDownloaded ||
                  mergeSSE.running ||
                  downloadSSE.running
                }
                onClick={handleMerge}
                size="sm"
                variant="outline"
              >
                <Merge className={`h-4 w-4 ${mergeSSE.running ? "animate-pulse" : ""}`} />
                {mergeSSE.running ? "Merging..." : "Merge"}
              </Button>
            </CardContent>
            {(downloadSSE.running ||
              downloadSSE.progress ||
              downloadSSE.error ||
              downloadSSE.result) && (
              <CardContent className="pt-0">
                {downloadSSE.error && (
                  <p className="text-sm text-destructive">{downloadSSE.error}</p>
                )}
                {downloadSSE.progress && !downloadSSE.result && !downloadSSE.error && (
                  <p className="text-sm text-muted-foreground">
                    {formatDownloadProgress(downloadSSE.progress)}
                  </p>
                )}
                {downloadSSE.result && (
                  <p className="text-sm text-green-600">{downloadSSE.result.message}</p>
                )}
              </CardContent>
            )}
            {(mergeSSE.running || mergeSSE.progress || mergeSSE.error || mergeSSE.result) && (
              <CardContent className="pt-0">
                {mergeSSE.error && <p className="text-sm text-destructive">{mergeSSE.error}</p>}
                {mergeSSE.progress && !mergeSSE.result && !mergeSSE.error && (
                  <p className="text-sm text-muted-foreground">
                    {formatMergeProgress(mergeSSE.progress)}
                  </p>
                )}
                {mergeSSE.result && (
                  <p className="text-sm text-green-600">{mergeSSE.result.message}</p>
                )}
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <EpisodeNumberEditor
                disabled={isPending}
                episode={episode}
                id={id!}
                onSaved={() => mutate()}
                podcast={podcast!}
              />
              {episode.releaseDate && (
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span>{new Date(episode.releaseDate).toLocaleDateString()}</span>
                </div>
              )}
              {episode.fileSize && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  File size: {formatBytes(episode.fileSize)}
                </div>
              )}
              <a
                className="flex items-center gap-1 text-primary hover:underline"
                href={episode.bandcampUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View on Bandcamp
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardContent>
          </Card>

          {episode.tags && episode.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {episode.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}

function EpisodeNumberEditor({
  disabled,
  episode,
  id,
  onSaved,
  podcast,
}: {
  disabled?: boolean;
  episode: EpisodeDetail;
  id: string;
  onSaved: () => void;
  podcast: string;
}) {
  const [editing, setEditing] = useState(false);
  const [numStr, setNumStr] = useState(episode.episodeNumber?.toString() ?? "");
  const [part, setPart] = useState(episode.episodePart ?? "");

  const { isMutating, trigger } = useSWRMutation(
    `/api/admin/podcasts/${podcast}/episodes/${id}`,
    zodMutator<EpisodePatchResponse, EpisodePatchRequest>(EpisodePatchResponseSchema, "PATCH"),
  );

  const handleOpen = () => {
    setNumStr(episode.episodeNumber?.toString() ?? "");
    setPart(episode.episodePart ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    const episodeNumber = numStr.trim() ? parseInt(numStr.trim(), 10) : undefined;
    if (numStr.trim() && isNaN(episodeNumber as number)) return;
    const episodePart = part.trim().toUpperCase() || undefined;
    await trigger({ episodeNumber, episodePart });
    setEditing(false);
    onSaved();
  };

  const handleCancel = () => setEditing(false);

  const display =
    episode.episodeNumber !== undefined
      ? `#${episode.episodeNumber}${episode.episodePart ?? ""}`
      : "Not set";

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm font-medium">Ep #</span>
        <input
          autoFocus
          className="w-20 rounded border border-input bg-background px-2 py-1 text-sm"
          onChange={(e) => setNumStr(e.target.value)}
          placeholder="Number"
          type="number"
          value={numStr}
        />
        <input
          className="w-12 rounded border border-input bg-background px-2 py-1 text-sm"
          maxLength={1}
          onChange={(e) => setPart(e.target.value.slice(0, 1))}
          placeholder="Part"
          type="text"
          value={part}
        />
        <Button disabled={isMutating} onClick={handleSave} size="sm" variant="ghost">
          <Check className="h-3 w-3" />
        </Button>
        <Button disabled={isMutating} onClick={handleCancel} size="sm" variant="ghost">
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">
        Episode: <span className="font-mono">{display}</span>
      </span>
      {episode.episodeNumberManual && (
        <span className="text-xs text-muted-foreground">(manual)</span>
      )}
      <Button disabled={disabled} onClick={handleOpen} size="sm" variant="ghost">
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDownloadProgress(progress: BuildProgress): string {
  switch (progress.phase) {
    case "done":
      return "Done!";
    case "downloading": {
      const trackLabel = `Downloading track ${progress.trackNumber ?? "?"}/${progress.trackTotal ?? "?"}`;
      if (progress.bytesDownloaded !== undefined) {
        const dl = formatBytes(progress.bytesDownloaded);
        const total = progress.bytesTotal ? ` / ${formatBytes(progress.bytesTotal)}` : "";
        return `${trackLabel} — ${dl}${total}`;
      }
      return trackLabel;
    }
    default:
      return "";
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatMergeProgress(progress: BuildProgress): string {
  switch (progress.phase) {
    case "chapters":
      return "Writing chapters...";
    case "done":
      return "Done!";
    case "merging":
      return `Merging — ${progress.percent ?? 0}%`;
    default:
      return "";
  }
}
