import type { BuildProgress } from "@shared/schemas/build-events";
import type { TaskSnapshot, TaskType } from "@shared/schemas/operations";
import type { SyncProgress } from "@shared/schemas/sync-events";

import { ChevronDown, ChevronUp, Download, Loader2, Merge, RefreshCw, Search } from "lucide-react";
import { useState } from "react";

import { useOperations } from "@/lib/operations-context";

import { Badge } from "./ui/badge";

const TYPE_LABELS: Record<TaskType, string> = {
  discover: "Discover",
  download: "Download",
  merge: "Merge",
  sync: "Sync All",
  "sync-single": "Sync",
};

const TYPE_ICONS: Record<TaskType, React.ElementType> = {
  discover: Search,
  download: Download,
  merge: Merge,
  sync: RefreshCw,
  "sync-single": RefreshCw,
};

export function OperationsPanel() {
  const { tasks } = useOperations();
  const [expanded, setExpanded] = useState(false);

  const activeTasks = Array.from(tasks.values());
  if (activeTasks.length === 0) return null;

  const running = activeTasks.filter((t) => t.status === "running").length;
  const queued = activeTasks.filter((t) => t.status === "queued").length;
  const completed = activeTasks.filter((t) => t.status === "completed").length;
  const failed = activeTasks.filter((t) => t.status === "failed").length;

  const summaryParts: string[] = [];
  if (running > 0) summaryParts.push(`${running} running`);
  if (queued > 0) summaryParts.push(`${queued} queued`);
  if (completed > 0) summaryParts.push(`${completed} done`);
  if (failed > 0) summaryParts.push(`${failed} failed`);

  return (
    <div className="border-b bg-muted/30">
      <div className="container mx-auto px-4">
        <button
          className="flex w-full items-center justify-between py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <div className="flex items-center gap-2">
            {running > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>{summaryParts.join(", ")}</span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {expanded && (
          <div className="pb-3 space-y-1.5">
            {activeTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DownloadProgress({ progress }: { progress: BuildProgress }) {
  if (progress.phase === "downloading") {
    const trackLabel = `Track ${progress.trackNumber ?? "?"}/${progress.trackTotal ?? "?"}`;
    if (progress.bytesDownloaded !== undefined) {
      const dl = formatBytes(progress.bytesDownloaded);
      const total = progress.bytesTotal ? ` / ${formatBytes(progress.bytesTotal)}` : "";
      return (
        <p className="text-xs text-muted-foreground">
          {trackLabel} &mdash; {dl}
          {total}
        </p>
      );
    }
    return <p className="text-xs text-muted-foreground">{trackLabel}</p>;
  }
  if (progress.phase === "merging") {
    return (
      <p className="text-xs text-muted-foreground">Merging &mdash; {progress.percent ?? 0}%</p>
    );
  }
  if (progress.phase === "chapters") {
    return <p className="text-xs text-muted-foreground">Writing chapters...</p>;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MergeProgress({ progress }: { progress: BuildProgress }) {
  if (progress.phase === "merging") {
    return (
      <p className="text-xs text-muted-foreground">Merging &mdash; {progress.percent ?? 0}%</p>
    );
  }
  if (progress.phase === "chapters") {
    return <p className="text-xs text-muted-foreground">Writing chapters...</p>;
  }
  if (progress.phase === "downloading") {
    const trackLabel = `Downloading track ${progress.trackNumber ?? "?"}/${progress.trackTotal ?? "?"}`;
    return <p className="text-xs text-muted-foreground">{trackLabel}</p>;
  }
  return null;
}

function ProgressText({ task }: { task: TaskSnapshot }) {
  if (!task.progress || task.status !== "running") return null;

  if (task.type === "download") {
    return <DownloadProgress progress={task.progress as unknown as BuildProgress} />;
  }
  if (task.type === "merge") {
    return <MergeProgress progress={task.progress as unknown as BuildProgress} />;
  }
  if (task.type === "sync") {
    return <SyncProgressText progress={task.progress as unknown as SyncProgress} />;
  }

  return null;
}

function StatusBadge({ status }: { status: TaskSnapshot["status"] }) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Done</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "queued":
      return <Badge variant="outline">Queued</Badge>;
    case "running":
      return <Badge variant="secondary">Running</Badge>;
  }
}

function SyncProgressText({ progress }: { progress: SyncProgress }) {
  if (progress.phase === "discovery") {
    return <p className="text-xs text-muted-foreground">Fetching discography...</p>;
  }
  if (progress.phase === "syncing") {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <p className="text-xs text-muted-foreground">
        {progress.current}/{progress.total} ({pct}%)
        {progress.episodeTitle ? ` — ${progress.episodeTitle}` : ""}
      </p>
    );
  }
  return null;
}

function TaskRow({ task }: { task: TaskSnapshot }) {
  const Icon = TYPE_ICONS[task.type];
  const label = TYPE_LABELS[task.type];
  const title = task.context.episodeTitle ?? task.context.podcastSlug;

  return (
    <div className="flex items-center gap-3 rounded-md bg-background/60 px-3 py-2 text-sm">
      <Icon
        className={`h-4 w-4 flex-shrink-0 ${task.status === "running" ? "text-primary" : "text-muted-foreground"}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{title}</span>
          <span className="text-muted-foreground text-xs">{label}</span>
        </div>
        <ProgressText task={task} />
      </div>
      <StatusBadge status={task.status} />
      {task.status === "failed" && task.error && (
        <span className="text-xs text-destructive max-w-48 truncate" title={task.error}>
          {task.error}
        </span>
      )}
    </div>
  );
}
