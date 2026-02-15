import { io, Socket } from 'socket.io-client';
import { SERVER_URL, SOCKET_NAMESPACE } from './constants';

let socket: Socket | null = null;

export function getSocket(): Socket {
    if (!socket) {
        socket = io(`${SERVER_URL}${SOCKET_NAMESPACE}`, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10,
        });

        socket.on('connect', () => {
            console.log('[Socket] Connected to game server');
        });

        socket.on('disconnect', (reason) => {
            console.log(`[Socket] Disconnected: ${reason}`);
        });

        socket.on('connect_error', (err) => {
            console.error('[Socket] Connection error:', err.message);
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
