export async function mapConcurrent<T, Result>(
  values: readonly T[],
  limit: number,
  map: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (values.length === 0) return [];

  const results = new Array<Result>(values.length);
  const workerLimit = Math.min(
    values.length,
    Math.max(1, Math.floor(limit) || 1),
  );
  let cursor = 0;
  let failed = false;
  let failure: unknown;

  await Promise.all(
    Array.from({ length: workerLimit }, async () => {
      while (!failed) {
        const index = cursor++;
        if (index >= values.length) return;
        try {
          results[index] = await map(values[index], index);
        } catch (error) {
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );

  if (failed) throw failure;
  return results;
}
