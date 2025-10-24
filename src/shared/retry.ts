import { type Result, err } from "./result";

export interface RetryOptions {
    retries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitter?: number;
    onRetry?: (error: unknown, attempt: number) => void;
}

const defaultOptions: Required<RetryOptions> = {
    retries: 3,
    initialDelayMs: 200,
    maxDelayMs: 5_000,
    factor: 2,
    jitter: 0.25,
    onRetry: () => undefined,
};

function wait(delay: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}

function getDelay(attempt: number, options: Required<RetryOptions>): number {
    const exponentialDelay = options.initialDelayMs * options.factor ** (attempt - 1);
    const boundedDelay = Math.min(exponentialDelay, options.maxDelayMs);
    const jitterValue = boundedDelay * options.jitter * (Math.random() * 2 - 1);

    return Math.max(0, boundedDelay + jitterValue);
}

export async function retry<T>(operation: () => Promise<T> | PromiseLike<T> | T, options: RetryOptions = {}): Promise<T> {
    const resolvedOptions: Required<RetryOptions> = {
        ...defaultOptions,
        ...options,
    };

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= resolvedOptions.retries) {
        try {
            const result = await operation();

            return result;
        } catch (error) {
            lastError = error;
            attempt += 1;

            if (attempt > resolvedOptions.retries) {
                break;
            }

            resolvedOptions.onRetry(error, attempt);
            const delay = getDelay(attempt, resolvedOptions);
            await wait(delay);
        }
    }

    throw lastError ?? new Error("Retry operation failed without throwing an error");
}

export async function retryResult<T, E>(
    operation: () => Promise<Result<T, E>> | PromiseLike<Result<T, E>> | Result<T, E>,
    options: RetryOptions = {},
): Promise<Result<T, E>> {
    try {
        return await retry(async () => {
            const result = await operation();

            if (!result.ok) {
                throw result.error;
            }

            return result;
        }, options);
    } catch (error) {
        return err(error as E);
    }
}
