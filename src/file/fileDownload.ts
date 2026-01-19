import { request as httpsRequest, RequestOptions } from 'node:https';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { JAENVTIX_TEMP_PATH } from '../build/directory';
import { Messages } from '../util/message';

export interface DownloadOptions {
    url: string;
    fileName: string;
    extension: string;
    timeout?: number;
    redirectsLeft?: number;
}

export interface DownloadResult {
    success: boolean;
    filePath: string;
    error?: string;
}

function getRequestModule(protocol: string): typeof httpsRequest {
    return protocol === 'https:' ? httpsRequest : httpRequest;
}

function isRedirect(statusCode: number): boolean {
    return [301, 302, 303, 307, 308].includes(statusCode);
}

export function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
    const { url, fileName, extension, timeout = 30000, redirectsLeft = 5 } = options;
    const fullPath = join(JAENVTIX_TEMP_PATH, `${fileName}.${extension}`);

    return new Promise((resolve) => {
        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            resolve({ success: false, filePath: fullPath, error: Messages.Error.INVALID_URL });
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
                    resolve({ success: false, filePath: fullPath, error: Messages.Error.REDIRECT_WITHOUT_LOCATION });
                    return;
                }

                if (redirectsLeft <= 0) {
                    response.resume();
                    resolve({ success: false, filePath: fullPath, error: Messages.Error.TOO_MANY_REDIRECTS });
                    return;
                }

                let redirectUrl: URL;
                try {
                    redirectUrl = new URL(location, urlObj);
                } catch {
                    response.resume();
                    resolve({ success: false, filePath: fullPath, error: Messages.Error.INVALID_REDIRECT_URL });
                    return;
                }

                downloadFile({
                    ...options,
                    url: redirectUrl.toString(),
                    redirectsLeft: redirectsLeft - 1,
                }).then(resolve);
                return;
            }

            if (statusCode >= 400) {
                response.resume();
                resolve({ success: false, filePath: fullPath, error: Messages.Error.REQUEST_FAILED_STATUS(statusCode) });
                return;
            }

            const fileStream = createWriteStream(fullPath);
            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve({ success: true, filePath: fullPath });
            });

            fileStream.on('error', (err) => {
                resolve({ success: false, filePath: fullPath, error: err.message });
            });
        });

        req.on('error', (err) => {
            resolve({ success: false, filePath: fullPath, error: err.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, filePath: fullPath, error: Messages.Error.REQUEST_TIMEOUT });
        });

        req.end();
    });
}
