import { strict as assert } from "node:assert";

import { RetryPolicy } from "@shared/retry";

suite("RetryPolicy", () => {
    test("reads limits from configuration", () => {
        const values: Record<string, unknown> = {};
        values["jaenvtix.retry.maxAttempts"] = 5;
        values["jaenvtix.retry.initialDelayMs"] = 150;
        values["jaenvtix.retry.maxDelayMs"] = 2_000;
        values["jaenvtix.retry.factor"] = 3;
        values["jaenvtix.retry.jitter"] = 0.5;
        const configuration = {
            get: <T>(key: string): T | undefined => values[key] as T | undefined,
        };

        const policy = RetryPolicy.fromConfiguration(configuration);
        const options = policy.createOptions();

        assert.strictEqual(policy.maxAttempts, 5);
        assert.strictEqual(options.initialDelayMs, 150);
        assert.strictEqual(options.maxDelayMs, 2_000);
        assert.strictEqual(options.factor, 3);
        assert.strictEqual(options.jitter, 0.5);
    });

    test("stops when beforeRetry declines a new attempt", async () => {
        const policy = new RetryPolicy({
            limits: {
                maxAttempts: 4,
                initialDelayMs: 0,
                maxDelayMs: 0,
                factor: 1,
                jitter: 0,
            },
        });

        let attempts = 0;
        let confirmations = 0;

        await assert.rejects(
            () =>
                policy.execute(async (attempt) => {
                    attempts = attempt;
                    throw new Error("operation failed");
                }, {
                    beforeRetry: async () => {
                        confirmations += 1;

                        return false;
                    },
                }),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /operation failed/);

                return true;
            },
        );

        assert.strictEqual(attempts, 1);
        assert.strictEqual(confirmations, 1);
    });
});
