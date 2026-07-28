export interface BoundedConcurrentBatchOptions {
    concurrency: number;
    deadlineAtMs?: number;
    now?: () => number;
}

export interface BoundedConcurrentBatchResult {
    startedCount: number;
    completedCount: number;
    stoppedEarly: boolean;
}

/**
 * Runs a finite batch with bounded concurrency and stops claiming new items
 * once the deadline is reached. Items that were not claimed remain eligible
 * for the next retention cycle.
 */
export async function runBoundedConcurrentBatch<T>(
    items: readonly T[],
    options: BoundedConcurrentBatchOptions,
    processItem: (item: T, index: number) => Promise<void>,
): Promise<BoundedConcurrentBatchResult> {
    const concurrency = Math.max(1, Math.min(Math.trunc(options.concurrency), items.length || 1));
    const deadlineAtMs = options.deadlineAtMs ?? Number.POSITIVE_INFINITY;
    const now = options.now ?? Date.now;
    let nextIndex = 0;
    let completedCount = 0;

    const worker = async (): Promise<void> => {
        while (nextIndex < items.length) {
            if (now() >= deadlineAtMs) {
                return;
            }

            const index = nextIndex;
            nextIndex += 1;
            await processItem(items[index], index);
            completedCount += 1;
        }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return {
        startedCount: nextIndex,
        completedCount,
        stoppedEarly: nextIndex < items.length,
    };
}

/**
 * Interleaves retention-tier batches so a large backlog in one tier cannot
 * consume the whole runtime budget before the other tiers make progress.
 */
export function interleaveBatches<T>(batches: readonly (readonly T[])[]): T[] {
    const result: T[] = [];
    const maxLength = batches.reduce((max, batch) => Math.max(max, batch.length), 0);

    for (let index = 0; index < maxLength; index += 1) {
        for (const batch of batches) {
            if (index < batch.length) {
                result.push(batch[index]);
            }
        }
    }

    return result;
}
