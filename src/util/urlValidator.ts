import {request as httpsRequest} from 'node:https';
import {request as httpRequest} from 'node:http';

/**
 * Probes `url` with an HTTP `HEAD` request and resolves to `true` if the
 * server responds with a 2xx or 3xx status code within `timeoutMs`.
 *
 * Business rules:
 * - Selects HTTP or HTTPS transport based on the URL protocol.
 * - Resolves `false` for malformed URLs, network errors, timeouts, or
 *   4xx/5xx responses — any condition that indicates the resource is not
 *   reachable or does not exist.
 * - Used by JDK and Maven URL builders to verify a candidate download URL
 *   before committing to it.
 */
export function isUrlAccessible(url: string, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            resolve(false);
            return;
        }
        const isHttps = urlObj.protocol === 'https:';
        const request = isHttps ? httpsRequest : httpRequest;

        const req = request({
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'HEAD',
            timeout: timeoutMs,
        }, (res) => {
            const status = res.statusCode ?? 0;
            resolve(status >= 200 && status < 400);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}
