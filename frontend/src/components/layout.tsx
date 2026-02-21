import { Link } from "react-router-dom";

import { OperationsPanel } from "./operations-panel";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto flex items-center gap-6 px-4 py-3">
          <Link className="text-lg font-bold tracking-tight" to="/">
            Beetcast
          </Link>
        </div>
      </header>
      <OperationsPanel />
      <main className="container mx-auto px-4 py-6 flex-1">{children}</main>
      <footer className="border-t py-3">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          v{__APP_VERSION__} ({__GIT_HASH__})
        </div>
      </footer>
    </div>
  );
}
