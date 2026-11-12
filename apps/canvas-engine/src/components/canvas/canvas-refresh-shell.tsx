interface CanvasRefreshShellProps {
  error?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function CanvasRefreshShell({
  error,
  retryLabel = "重试",
  onRetry,
}: CanvasRefreshShellProps) {
  return (
    <main
      className="relative h-full min-h-0 overflow-hidden bg-background text-foreground"
      aria-busy={!error}
      aria-label={error ? undefined : "画布加载中"}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div aria-hidden="true" className="absolute inset-x-0 top-0 flex h-12 items-center border-b border-border bg-background/90 px-4">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="ml-auto flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-7 w-7 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-[88px] items-center gap-2 border-t border-border bg-background/95 px-4">
        <div className="size-12 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="h-12 w-36 shrink-0 animate-pulse rounded-lg bg-muted" />
        <div className="h-12 min-w-24 max-w-64 flex-1 animate-pulse rounded-lg bg-muted" />
        <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
      </div>

      <div aria-hidden="true" className="absolute bottom-28 left-5 hidden h-32 w-48 rounded-md border border-border bg-background/85 p-3 shadow-md sm:block">
        <div className="h-full rounded border border-dashed border-border" />
      </div>

      {error ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background/75 p-5 backdrop-blur-sm" role="alert">
          <div className="w-full max-w-md border-l-2 border-destructive bg-background px-5 py-4 shadow-lg">
            <p className="mb-4 text-sm text-foreground">{error}</p>
            {onRetry ? (
              <button
                type="button"
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                onClick={onRetry}
              >
                {retryLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
