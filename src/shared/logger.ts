export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerContext {
    name: string;
    defaultFields?: Record<string, unknown>;
}

export interface Logger {
    debug(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
    child(childContext: Partial<LoggerContext>): Logger;
}

function log(level: LogLevel, context: LoggerContext, message: string, fields?: Record<string, unknown>): void {
    const payload = {
        level,
        message,
        logger: context.name,
        ...(context.defaultFields ?? {}),
        ...(fields ?? {}),
        timestamp: new Date().toISOString(),
    };

    const stringified = JSON.stringify(payload);

    if (level === "error") {
        console.error(stringified);

        return;
    }

    if (level === "warn") {
        console.warn(stringified);

        return;
    }

    if (level === "info") {
        console.info(stringified);

        return;
    }

    console.debug(stringified);
}

function mergeContext(base: LoggerContext, childContext: Partial<LoggerContext>): LoggerContext {
    return {
        name: childContext.name ?? base.name,
        defaultFields: {
            ...(base.defaultFields ?? {}),
            ...(childContext.defaultFields ?? {}),
        },
    };
}

export function createLogger(context: LoggerContext): Logger {
    const logWithLevel = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
        log(level, context, message, fields);
    };

    const child = (childContext: Partial<LoggerContext>): Logger => createLogger(mergeContext(context, childContext));

    return {
        debug: (message, fields) => logWithLevel("debug", message, fields),
        info: (message, fields) => logWithLevel("info", message, fields),
        warn: (message, fields) => logWithLevel("warn", message, fields),
        error: (message, fields) => logWithLevel("error", message, fields),
        child,
    };
}
