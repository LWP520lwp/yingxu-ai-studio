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
  const cancel = () => {
    clearTimeout(quiet);
    clearTimeout(deadline);
    quiet = deadline = undefined;
  };
  const flush = () => {
    cancel();
    if (!dirty) return;
    dirty = false;
    save();
  };
  return {
    schedule() {
      dirty = true;
      clearTimeout(quiet);
      quiet = setTimeout(flush, delay);
      deadline ??= setTimeout(flush, maxDelay);
    },
    flush,
    dispose() {
      cancel();
      dirty = false;
    },
  };
}
