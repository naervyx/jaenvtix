import { request as httpsRequest, RequestOptions } from 'node:https';
import { request as httpRequest, IncomingMessage } from 'node:http';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { JAENVTIX_TEMP_PATH } from '../features/build/directory';

export interface DownloadOptions {
    url: string;
    fileName: string;
    extension: string;
    timeout?: number;
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
    const { url, fileName, extension, timeout = 30000 } = options;
    const fullPath = join(JAENVTIX_TEMP_PATH, `${fileName}.${extension}`);

    return new Promise((resolve) => {
        const urlObj = new URL(url);
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

            if (isRedirect(statusCode) && response.headers.location) {
                downloadFile({ ...options, url: response.headers.location }).then(resolve);
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
            resolve({ success: false, filePath: fullPath, error: 'Timeout' });
        });

        req.end();
    });
}