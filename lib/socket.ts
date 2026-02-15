import { io, Socket } from 'socket.io-client';
import { SERVER_URL, SOCKET_NAMESPACE } from './constants';

let socket: Socket | null = null;
let hasShownConnectWarning = false;

export function getSocket(): Socket {
    if (!socket) {
        socket = io(`${SERVER_URL}${SOCKET_NAMESPACE}`, {
            // Allow fallback to polling if websocket fails in some environments.
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10,
            timeout: 5000,
        });

        socket.on('connect', () => {
            console.log('[Socket] Connected to game server');
            hasShownConnectWarning = false;
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket] Disconnected: ${reason}`);
        });

        socket.on('connect_error', (err) => {
            // Avoid spamming Next.js error overlay with repeated console.error logs.
            if (!hasShownConnectWarning) {
                console.warn('[Socket] Unable to connect to game server. Is server running on', SERVER_URL + '?', `(${err.message})`);
                hasShownConnectWarning = true;
            }
        });
    }
    return socket;
}

export function disconnectSocket(): void {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
