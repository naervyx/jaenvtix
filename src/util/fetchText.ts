import {request as httpsRequest, RequestOptions} from 'node:https';
import {request as httpRequest, IncomingMessage} from 'node:http';

import {Messages} from './message';

/** Options for `fetchTextContent`. */
export interface FetchTextOptions {
    /** Request timeout in milliseconds. Defaults to 10 000 ms. */
    timeout?: number;
    /**
     * How many redirects are still permitted before failing.
     * Decremented on each recursive hop; defaults to 5.
     */
    redirectsLeft?: number;
}

function isRedirect(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
}

/**
 * Fetches `url` with an HTTP GET and resolves to the response body as UTF-8 text.
 *
 * Business rules:
 * - Selects HTTP or HTTPS transport based on the URL protocol.
 * - Follows redirects (301, 302, 303, 307, 308) up to `redirectsLeft` hops.
 * - Rejects on malformed URLs, network errors, timeouts, non-2xx responses,
 *   and redirect chains that are broken or too long — callers decide how to
 *   surface the failure.
 * - Fully asynchronous: never blocks the extension-host event loop.
 */
export function fetchTextContent(url: string, options: FetchTextOptions = {}): Promise<string> {
    const {timeout = 10000, redirectsLeft = 5} = options;

    return new Promise((resolve, reject) => {
        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            reject(new Error(Messages.Error.INVALID_URL));
            return;
        }

        const isHttps = urlObj.protocol === 'https:';
        const requestModule = isHttps ? httpsRequest : httpRequest;
        const requestOptions: RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout,
        };

        const req = requestModule(requestOptions, (response: IncomingMessage) => {
            const statusCode = response.statusCode ?? 0;

            if (isRedirect(statusCode)) {
                const locationHeader = response.headers.location;
                const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
                response.resume();

                if (!location) {
                    reject(new Error(Messages.Error.REDIRECT_WITHOUT_LOCATION));
                    return;
                }

                if (redirectsLeft <= 0) {
                    reject(new Error(Messages.Error.TOO_MANY_REDIRECTS));
                    return;
                }

                let redirectUrl: URL;
                try {
                    redirectUrl = new URL(location, urlObj);
                } catch {
                    reject(new Error(Messages.Error.INVALID_REDIRECT_URL));
                    return;
                }

                fetchTextContent(redirectUrl.toString(), {timeout, redirectsLeft: redirectsLeft - 1})
                    .then(resolve, reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                response.resume();
                reject(new Error(Messages.Error.REQUEST_FAILED_STATUS(statusCode)));
                return;
            }

            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            response.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(Messages.Error.REQUEST_TIMEOUT));
        });

        req.end();
    });
}
