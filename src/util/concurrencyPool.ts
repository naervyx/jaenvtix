/**
 * How many Language-Server-bound calls Jaenvtix keeps in flight at once.
 * The calls become queued jobs inside JDT (m2e serializes the actual imports
 * internally), so this bounds the request burst to the same path the server
 * already exercises on every window open with a bulk import, without
 * serializing round-trips on our side.
 */
export const DEFAULT_CONCURRENCY_LIMIT = 4;

/**
 * Runs `task` over `items` with at most `limit` tasks in flight, resolving
 * once every task settled. Results keep the input order.
 *
 * Business rules:
 * - `Promise.allSettled` semantics: one task failing never aborts or delays
 *   the others; the caller inspects each result individually.
 * - Task order of COMPLETION is unspecified; result order is by input index.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            try {
                results[index] = {status: 'fulfilled', value: await task(items[index] as T)};
            } catch (reason) {
                results[index] = {status: 'rejected', reason};
            }
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({length: workerCount}, () => worker()));

    return results;
}
