import { afterEach, describe, expect, it } from 'vitest';
import { isPrimaryShard, jobCompletionIndex, shardCount, workerInstanceLabel } from '../utils/workerShard.js';

describe('worker shard identity', () => {
    afterEach(() => {
        delete process.env.JOB_COMPLETION_INDEX;
        delete process.env.SHARD_COUNT;
    });

    it('defaults to a single primary shard outside an Indexed Job', () => {
        expect(jobCompletionIndex()).toBe(0);
        expect(shardCount()).toBe(1);
        expect(isPrimaryShard()).toBe(true);
        expect(workerInstanceLabel()).toBe('0');
    });

    it('reads the completion index and treats only index 0 as primary', () => {
        process.env.JOB_COMPLETION_INDEX = '3';
        process.env.SHARD_COUNT = '4';
        expect(jobCompletionIndex()).toBe(3);
        expect(shardCount()).toBe(4);
        expect(isPrimaryShard()).toBe(false);
        expect(workerInstanceLabel()).toBe('3');
    });

    it('ignores malformed values', () => {
        process.env.JOB_COMPLETION_INDEX = 'nope';
        process.env.SHARD_COUNT = '-2';
        expect(jobCompletionIndex()).toBe(0);
        expect(shardCount()).toBe(1);
    });
});
