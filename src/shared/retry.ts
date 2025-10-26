import type * as vscode from "vscode";

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

function clamp(value: number, { min, max }: { min: number; max?: number }): number {
    if (Number.isNaN(value)) {
        return min;
    }

    if (value < min) {
        return min;
    }

    if (typeof max === "number" && value > max) {
        return max;
    }

    return value;
}

function readNumericSetting(
    reader: ConfigurationReader | undefined,
    key: string,
    fallback: number,
    constraints: { min: number; max?: number },
): number {
    if (!reader) {
        return fallback;
    }

    const raw = reader.get<unknown>(key);

    if (typeof raw !== "number") {
        return fallback;
    }

    return clamp(raw, constraints);
}

function limitsFromConfiguration(reader: ConfigurationReader | undefined): RetryPolicyLimits | undefined {
    if (!reader) {
        return undefined;
    }

    const maxAttempts = readNumericSetting(reader, "jaenvtix.retry.maxAttempts", defaultPolicyLimits.maxAttempts, {
        min: 1,
        max: 10,
    });
    const initialDelayMs = readNumericSetting(
        reader,
        "jaenvtix.retry.initialDelayMs",
        defaultPolicyLimits.initialDelayMs,
        { min: 0 },
    );
    const maxDelayMs = readNumericSetting(reader, "jaenvtix.retry.maxDelayMs", defaultPolicyLimits.maxDelayMs, {
        min: initialDelayMs,
    });
    const factor = readNumericSetting(reader, "jaenvtix.retry.factor", defaultPolicyLimits.factor, {
        min: 1,
        max: 10,
    });
    const jitter = readNumericSetting(reader, "jaenvtix.retry.jitter", defaultPolicyLimits.jitter, {
        min: 0,
        max: 1,
    });

    return {
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        factor,
        jitter,
    } satisfies RetryPolicyLimits;
}

function limitsToRetryOptions(limits: RetryPolicyLimits): Required<RetryOptions> {
    return {
        retries: Math.max(0, Math.floor(limits.maxAttempts) - 1),
        initialDelayMs: limits.initialDelayMs,
        maxDelayMs: Math.max(limits.initialDelayMs, limits.maxDelayMs),
        factor: limits.factor,
        jitter: limits.jitter,
        onRetry: () => undefined,
    };
}

export interface RetryPolicyLimits {
    readonly maxAttempts: number;
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly factor: number;
    readonly jitter: number;
}

export interface RetryPolicyInit {
    readonly limits?: Partial<RetryPolicyLimits>;
}

export interface RetryPolicyExecutionOptions extends RetryOptions {
    readonly beforeRetry?: (error: unknown, nextAttempt: number) => boolean | Promise<boolean>;
}

const defaultPolicyLimits: RetryPolicyLimits = {
    maxAttempts: defaultOptions.retries + 1,
    initialDelayMs: defaultOptions.initialDelayMs,
    maxDelayMs: defaultOptions.maxDelayMs,
    factor: defaultOptions.factor,
    jitter: defaultOptions.jitter,
};

export type ConfigurationReader = Pick<vscode.WorkspaceConfiguration, "get">;

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

export class RetryPolicy {
    private readonly limits: RetryPolicyLimits;

    public constructor(init: RetryPolicyInit = {}) {
        this.limits = {
            ...defaultPolicyLimits,
            ...(init.limits ?? {}),
        } satisfies RetryPolicyLimits;
    }

    public static fromConfiguration(
        configuration?: ConfigurationReader,
        overrides?: Partial<RetryPolicyLimits>,
    ): RetryPolicy {
        const configLimits = limitsFromConfiguration(configuration);

        return new RetryPolicy({ limits: { ...(configLimits ?? {}), ...(overrides ?? {}) } });
    }

    public get maxAttempts(): number {
        return Math.max(1, Math.floor(this.limits.maxAttempts));
    }

    public createOptions(overrides: RetryOptions = {}): Required<RetryOptions> {
        const base = limitsToRetryOptions(this.limits);

        return {
            ...base,
            ...overrides,
            retries: overrides.retries ?? base.retries,
            initialDelayMs: overrides.initialDelayMs ?? base.initialDelayMs,
            maxDelayMs: overrides.maxDelayMs ?? base.maxDelayMs,
            factor: overrides.factor ?? base.factor,
            jitter: overrides.jitter ?? base.jitter,
            onRetry: overrides.onRetry ?? base.onRetry,
        } satisfies Required<RetryOptions>;
    }

    public async execute<T>(
        operation: (attempt: number) => Promise<T>,
        options: RetryPolicyExecutionOptions = {},
    ): Promise<T> {
        const resolved = this.createOptions(options);
        const beforeRetry = options.beforeRetry;
        let attempt = 0;
        let lastError: unknown;

        while (attempt < this.maxAttempts) {
            attempt += 1;

            try {
                return await operation(attempt);
            } catch (error) {
                lastError = error;

                if (attempt >= this.maxAttempts) {
                    break;
                }

                if (beforeRetry) {
                    const shouldContinue = await beforeRetry(error, attempt + 1);

                    if (!shouldContinue) {
                        break;
                    }
                }

                resolved.onRetry?.(error, attempt);
                const delay = getDelay(attempt, resolved);
                await wait(delay);
            }
        }

        throw lastError ?? new Error("Retry operation failed without throwing an error");
    }
}
