import {request as httpsRequest, RequestOptions} from 'node:https';
import {request as httpRequest, IncomingMessage} from 'node:http';
import {createWriteStream, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

import {JAENVTIX_TEMP_PATH} from '../build/directory';
import {Messages} from '../util/message';
import {log} from '../util/logger';

/**
 * Parameters for a single file download. The resulting file is always written
 * as `<targetDir>/<fileName>.<extension>`.
 */
export interface DownloadOptions {
    /** Fully-qualified HTTP or HTTPS URL to download. */
    url: string;
    /** Base name for the local file (without extension). */
    fileName: string;
    /** File extension, e.g. `'zip'` or `'tar.gz'`. */
    extension: string;
    /** Request timeout in milliseconds. Defaults to 30 000 ms. */
    timeout?: number;
    /**
     * How many redirects are still permitted before failing.
     * Decremented on each recursive hop; defaults to 5.
     */
    redirectsLeft?: number;
    /**
     * Override the destination directory. Defaults to `JAENVTIX_TEMP_PATH`.
     * Primarily used by tests to avoid touching the real user temp tree.
     */
    targetDir?: string;
    /**
     * How many times a download that failed transiently is retried
     * (`jaenvtix.downloadMaxRetries`, wired by the orchestrator).
     * `0` disables retries (fail-fast). Defaults to 3.
     */
    maxRetries?: number;
    /** First backoff delay in ms; doubles per retry (1s → 2s → 4s). Tests pass 1. */
    baseBackoffMs?: number;
}

/**
 * Result of a completed download attempt (success or failure).
 * `filePath` is always populated so callers can clean up partial files if needed.
 */
export interface DownloadResult {
    success: boolean;
    filePath: string;
    error?: string;
    /** Node errno code of a network failure (e.g. `'ECONNRESET'`), when known. */
    errorCode?: string;
    /** HTTP status of a non-2xx response, when the server answered. */
    statusCode?: number;
}

function getRequestModule(protocol: string): typeof httpsRequest {
    return protocol === 'https:' ? httpsRequest : httpRequest;
}

function isRedirect(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
}

/**
 * Classifies a failed attempt as worth retrying.
 *
 * Business rules (transient → retry):
 * - `ETIMEDOUT` / `ECONNRESET` / `ECONNABORTED`: transient network blips and
 *   overloaded CDNs.
 * - HTTP 5xx and 429: server-side and rate-limit conditions that often clear.
 *
 * Everything else fails fast: `ECONNREFUSED`/`ENOTFOUND` mean the server or
 * DNS is genuinely unavailable, and remaining 4xx mean the URL or permission
 * is wrong; retrying cannot help.
 */
export function isTransientDownloadFailure(result: DownloadResult): boolean {
    if (result.success) {
        return false;
    }
    if (result.errorCode === 'ETIMEDOUT' || result.errorCode === 'ECONNRESET' || result.errorCode === 'ECONNABORTED') {
        return true;
    }
    const status = result.statusCode;
    return status === 429 || (status !== undefined && status >= 500 && status < 600);
}

/** Exponential backoff: `base * 2^attempt` (1s, 2s, 4s, ... for the default base). */
export function computeBackoffMs(baseBackoffMs: number, attempt: number): number {
    return baseBackoffMs * Math.pow(2, attempt);
}

/**
 * Performs one download attempt from `options.url`, writing to disk and
 * resolving (never rejecting) with a `DownloadResult`.
 *
 * Business rules:
 * - Follows HTTP redirects (301, 302, 303, 307, 308) up to `redirectsLeft` hops.
 * - Automatically creates the destination directory if it does not exist.
 * - Treats any 4xx or 5xx response as a failure; does not leave partial files.
 * - Failure results carry `errorCode`/`statusCode` so the retry layer can
 *   distinguish transient from permanent failures.
 */
function attemptDownload(options: DownloadOptions): Promise<DownloadResult> {
    const {url, fileName, extension, timeout = 30000, redirectsLeft = 5, targetDir = JAENVTIX_TEMP_PATH} = options;
    const fullPath = join(targetDir, `${fileName}.${extension}`);

    return new Promise((resolve) => {
        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            resolve({success: false, filePath: fullPath, error: Messages.Error.INVALID_URL});
            return;
        }
        const requestModule = getRequestModule(urlObj.protocol);

        const requestOptions: RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout,
        };

        const req = requestModule(requestOptions, (response: IncomingMessage) => {
            const statusCode = response.statusCode ?? 0;

            if (isRedirect(statusCode)) {
                const locationHeader = response.headers.location;
                const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;

                if (!location) {
                    response.resume();
                    resolve({success: false, filePath: fullPath, error: Messages.Error.REDIRECT_WITHOUT_LOCATION});
                    return;
                }

                if (redirectsLeft <= 0) {
                    response.resume();
                    resolve({success: false, filePath: fullPath, error: Messages.Error.TOO_MANY_REDIRECTS});
                    return;
                }

                let redirectUrl: URL;
                try {
                    redirectUrl = new URL(location, urlObj);
                } catch {
                    response.resume();
                    resolve({success: false, filePath: fullPath, error: Messages.Error.INVALID_REDIRECT_URL});
                    return;
                }

                attemptDownload({
                    ...options,
                    url: redirectUrl.toString(),
                    redirectsLeft: redirectsLeft - 1,
                }).then(resolve).catch((err: unknown) => {
                    const message = err instanceof Error ? err.message : String(err);
                    resolve({success: false, filePath: fullPath, error: message});
                });
                return;
            }

            if (statusCode >= 400) {
                response.resume();
                resolve({
                    success: false,
                    filePath: fullPath,
                    error: Messages.Error.REQUEST_FAILED_STATUS(statusCode),
                    statusCode,
                });
                return;
            }

            try {
                mkdirSync(dirname(fullPath), {recursive: true});
            } catch (err) {
                response.resume();
                const message = err instanceof Error ? err.message : String(err);
                resolve({success: false, filePath: fullPath, error: message});
                return;
            }

            const fileStream = createWriteStream(fullPath);
            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve({success: true, filePath: fullPath});
            });

            fileStream.on('error', (err) => {
                resolve({success: false, filePath: fullPath, error: err.message});
            });
        });

        req.on('error', (err) => {
            resolve({
                success: false,
                filePath: fullPath,
                error: err.message,
                errorCode: (err as NodeJS.ErrnoException).code,
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                success: false,
                filePath: fullPath,
                error: Messages.Error.REQUEST_TIMEOUT,
                errorCode: 'ETIMEDOUT',
            });
        });

        req.end();
    });
}

/**
 * Downloads a file from `options.url`, retrying transient failures with
 * exponential backoff, and resolves (never rejects) with a `DownloadResult`.
 *
 * Business rules:
 * - Transient failures (see `isTransientDownloadFailure`) are retried up to
 *   `maxRetries` times (default 3) with exponential backoff (1s, 2s, 4s).
 * - Permanent failures (bad URL, 404, DNS, connection refused) fail fast.
 * - Each retry is logged to the output channel; the final failure surfaces
 *   exactly like before retries existed, so callers are unaffected.
 * - `maxRetries: 0` restores the historic fail-fast behaviour.
 * - The retry wraps the WHOLE download (including its redirect chain); the
 *   redirect recursion uses single attempts so hops never multiply retries.
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
    const maxRetries = options.maxRetries ?? 3;
    const baseBackoffMs = options.baseBackoffMs ?? 1000;

    let result = await attemptDownload(options);
    for (let attempt = 0; attempt < maxRetries && isTransientDownloadFailure(result); attempt++) {
        log(Messages.Log.DOWNLOAD_RETRY(attempt + 1, maxRetries, options.url, result.error ?? ''));
        await sleep(computeBackoffMs(baseBackoffMs, attempt));
        result = await attemptDownload(options);
    }

    return result;
}
