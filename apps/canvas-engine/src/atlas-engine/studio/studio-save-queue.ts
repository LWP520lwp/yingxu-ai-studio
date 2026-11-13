/** Coalesce interactive revisions without serialising the graph during a frame.
 * A maximum delay bounds unsaved work even during a long drag; capture/leave flush synchronously. */
export function createStudioSaveQueue(
  save: () => void,
  delay = 350,
  maxDelay = 1500,
) {
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let scheduledAt = 0;
  const cancel = () => {
    clearTimeout(quiet);
    clearTimeout(deadline);
    quiet = deadline = undefined;
  };
  const flush = () => {
    cancel();
    if (!dirty) return;
    dirty = false;
    try {
      save();
    } catch (error) {
      dirty = true;
      throw error;
    }
  };
  const afterQuietPeriod = () => {
    quiet = undefined;
    const remaining = delay - (performance.now() - scheduledAt);
    if (remaining > 0) {
      quiet = setTimeout(afterQuietPeriod, remaining);
    } else {
      flush();
    }
  };
  return {
    schedule() {
      dirty = true;
      scheduledAt = performance.now();
      quiet ??= setTimeout(afterQuietPeriod, delay);
      deadline ??= setTimeout(flush, maxDelay);
    },
    flush,
    dispose() {
      cancel();
      dirty = false;
    },
  };
}
