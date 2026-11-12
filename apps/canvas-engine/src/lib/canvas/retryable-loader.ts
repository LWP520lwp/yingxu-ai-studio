export function createRetryableLoader(
  load: () => Promise<boolean>,
): () => Promise<void> {
  let complete = false;
  let pending: Promise<void> | null = null;

  return () => {
    if (complete) return Promise.resolve();
    if (pending) return pending;

    pending = load()
      .then((success) => {
        complete = success;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
