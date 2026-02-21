import type { SyncProgress } from "@shared/schemas/sync-events";

import { type PodcastDetailResponse, PodcastDetailResponseSchema } from "@shared/schemas/admin-api";
import { ArrowLeft, Hammer, RefreshCw, Rss, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import useSWR from "swr";

import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NotFoundError, zodFetcher } from "@/lib/api";
import { useOperations } from "@/lib/operations-context";
import { useOperation } from "@/lib/use-operation";

export function EpisodeList() {
  const { podcast } = useParams<{ podcast: string }>();
  const { data, error, isLoading, mutate } = useSWR<PodcastDetailResponse>(
    `/api/admin/podcasts/${podcast}`,
    zodFetcher(PodcastDetailResponseSchema),
  );

  const { submitTask } = useOperations();
  const discoverOp = useOperation("discover", podcast!);
  const syncOp = useOperation("sync", podcast!);

  // Revalidate when discover or sync complete
  const prevDiscoverStatus = useRef(discoverOp.task?.status);
  const prevSyncStatus = useRef(syncOp.task?.status);

  useEffect(() => {
    const wasActive =
      prevDiscoverStatus.current === "running" || prevDiscoverStatus.current === "queued";
    const isDone = discoverOp.task?.status === "completed" || discoverOp.task?.status === "failed";
    if (wasActive && isDone) mutate();
    prevDiscoverStatus.current = discoverOp.task?.status;
  }, [discoverOp.task?.status, mutate]);

  useEffect(() => {
    const wasActive = prevSyncStatus.current === "running" || prevSyncStatus.current === "queued";
    const isDone = syncOp.task?.status === "completed" || syncOp.task?.status === "failed";
    if (wasActive && isDone) mutate();
    prevSyncStatus.current = syncOp.task?.status;
  }, [syncOp.task?.status, mutate]);

  const busy = discoverOp.isActive || syncOp.isActive;

  const handleDiscover = () => {
    submitTask(`/api/admin/podcasts/${podcast}/discover`);
  };

  const handleSync = () => {
    submitTask(`/api/admin/podcasts/${podcast}/sync`);
  };

  const handleBuild = () => {
    submitTask(`/api/admin/podcasts/${podcast}/build`);
  };

  if (isLoading) {
    return (
      <Layout>
        <p className="text-muted-foreground">Loading...</p>
      </Layout>
    );
  }

  if (error instanceof NotFoundError) {
    return (
      <Layout>
        <Link
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
          to="/"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Not Found</h1>
        <p className="text-muted-foreground mt-2">
          No podcast configured with slug &ldquo;{podcast}&rdquo;.
        </p>
      </Layout>
    );
  }

  const info = data?.podcast;
  const episodes = data?.episodes ?? [];

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img
            alt=""
            className="h-16 w-16 rounded-lg object-cover hidden sm:block"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
            src={`/api/admin/podcasts/${podcast}/artwork`}
          />
          <div>
            <Link
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
              to="/"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-tight">{info?.title}</h1>
            {info?.lastUpdated && (
              <p className="text-sm text-muted-foreground mt-1">
                Last synced: {new Date(info.lastUpdated).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={handleDiscover} size="sm" variant="outline">
            <Search className={`h-4 w-4 ${discoverOp.isActive ? "animate-pulse" : ""}`} />
            {discoverOp.isActive ? "Discovering..." : "Discover"}
          </Button>
          <Button disabled={busy} onClick={handleSync} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 ${syncOp.isActive ? "animate-spin" : ""}`} />
            {syncOp.isActive ? "Syncing..." : "Sync Episodes"}
          </Button>
          <Button disabled={busy} onClick={handleBuild} size="sm" variant="outline">
            <Hammer className="h-4 w-4" />
            Build All
          </Button>
          <Button
            onClick={() => window.open(`/${podcast}/feed.xml`, "_blank")}
            size="sm"
            variant="outline"
          >
            <Rss className="h-4 w-4" />
            Feed
          </Button>
        </div>
      </div>

      {syncOp.isRunning && syncOp.progress && (
        <SyncProgressBar progress={syncOp.progress as unknown as SyncProgress} />
      )}

      {syncOp.error && !syncOp.isActive && (
        <Card className="mb-4 border-destructive">
          <CardContent className="py-3">
            <p className="text-sm text-destructive">Sync failed: {syncOp.error}</p>
          </CardContent>
        </Card>
      )}

      {episodes.length === 0 ? (
        <p className="text-muted-foreground">No episodes found. Try discovering first.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead>Title</TableHead>
              <TableHead className="w-32">Date</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20">Price</TableHead>
              <TableHead className="w-20">Tracks</TableHead>
              <TableHead className="w-24">Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {episodes.map((ep) => (
              <TableRow className={!ep.synced || ep.skipped ? "opacity-50" : ""} key={ep.id}>
                <TableCell className="font-mono text-muted-foreground">
                  {ep.episodeNumber !== undefined
                    ? `${ep.episodeNumber}${ep.episodePart ?? ""}`
                    : "-"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      className={`hover:underline font-medium ${ep.skipped ? "line-through text-muted-foreground" : ""}`}
                      to={`/${podcast}/episode/${ep.id}`}
                    >
                      {ep.title}
                    </Link>
                    {ep.skipped && <Badge variant="destructive">Skipped</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {ep.releaseDate ? new Date(ep.releaseDate).toLocaleDateString() : "-"}
                </TableCell>
                <TableCell>{statusBadge(ep)}</TableCell>
                <TableCell>
                  {ep.minimumPrice === null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : ep.minimumPrice > 0 ? (
                    <Badge className="whitespace-nowrap" variant="destructive">
                      {ep.minimumPrice} {ep.priceCurrency ?? ""}
                    </Badge>
                  ) : (
                    <Badge variant="muted">Free</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{ep.trackCount}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {ep.fileSize ? formatBytes(ep.fileSize) : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Layout>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(ep: PodcastDetailResponse["episodes"][number]) {
  if (!ep.synced) return <Badge variant="outline">Pending</Badge>;
  if (ep.skipped) return <Badge variant="destructive">Skipped</Badge>;
  if (ep.merged) return <Badge variant="success">Cached</Badge>;
  if (ep.allTracksDownloaded) return <Badge variant="secondary">Downloaded</Badge>;
  return <Badge variant="warning">Synced</Badge>;
}

function SyncProgressBar({ progress }: { progress: SyncProgress }) {
  if (progress.phase === "discovery") {
    return (
      <Card className="mb-4">
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">Fetching discography...</p>
        </CardContent>
      </Card>
    );
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Card className="mb-4">
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Syncing: {progress.current}/{progress.total}
          </span>
          <span className="font-mono text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        {progress.episodeTitle && (
          <p className="text-xs text-muted-foreground truncate">
            {progress.errored
              ? "Error"
              : progress.existing
                ? "Already synced"
                : progress.skipped
                  ? "Skipped (paid)"
                  : "Synced"}
            : {progress.episodeTitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
