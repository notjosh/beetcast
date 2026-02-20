import { type PodcastsResponse, PodcastsResponseSchema } from "@shared/schemas/admin-api";
import { Check, Clock, Disc3, SkipForward } from "lucide-react";
import { Link } from "react-router-dom";
import useSWR from "swr";

import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { zodFetcher } from "@/lib/api";

export function Dashboard() {
  const { data, isLoading } = useSWR<PodcastsResponse>(
    "/api/admin/podcasts",
    zodFetcher(PodcastsResponseSchema),
  );
  const podcasts = data?.podcasts ?? [];

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Manage your Bandcamp-to-Podcast feeds</p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : podcasts.length === 0 ? (
        <p className="text-muted-foreground">No podcasts configured.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {podcasts.map((p) => (
            <Link key={p.slug} to={`/${p.slug}`}>
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Disc3 className="h-5 w-5" />
                    {p.title}
                  </CardTitle>
                  <CardDescription>{p.author}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      <Disc3 className="mr-1 h-3 w-3" />
                      {p.episodeCount} episodes
                    </Badge>
                    <Badge variant="outline">
                      {p.syncedCount}/{p.episodeCount} synced
                    </Badge>
                    <Badge variant="success">
                      <Check className="mr-1 h-3 w-3" />
                      {p.cachedCount} cached
                    </Badge>
                    {p.skippedCount > 0 && (
                      <Badge variant="warning">
                        <SkipForward className="mr-1 h-3 w-3" />
                        {p.skippedCount} skipped
                      </Badge>
                    )}
                  </div>
                  {p.lastUpdated && (
                    <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Last synced: {new Date(p.lastUpdated).toLocaleString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
