import {createServer, IncomingMessage, Server, ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface TestServer {
    url: string;
    port: number;
    close: () => Promise<void>;
}

/**
 * Spin up a one-shot HTTP server bound to 127.0.0.1 on an ephemeral port.
 * Caller provides the request handler; we hand back the base URL and a
 * `close()` for teardown. Designed so each test owns its own server and we
 * never collide on a fixed port across the suite.
 */
export async function startTestServer(handler: RequestHandler): Promise<TestServer> {
    const server: Server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${address.port}`,
        port: address.port,
        close: () => new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        }),
    };
}
