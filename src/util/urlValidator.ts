import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';

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
