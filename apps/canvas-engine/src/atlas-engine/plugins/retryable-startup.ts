export function createRetryableStartup(load: () => Promise<boolean>): () => Promise<void> {
  let completed = false;
  let pending: Promise<void> | null = null;

  return () => {
    if (completed) return Promise.resolve();
    if (pending) return pending;

    const attempt = load().then((success) => {
      completed = success;
    });
    pending = attempt.finally(() => {
      pending = null;
    });
    return pending;
  };
}
