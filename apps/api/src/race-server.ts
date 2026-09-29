import type { RaceRoomManager, RaceSocket } from './race-rooms';

interface ApiApp {
  fetch(request: Request): Response | Promise<Response>;
}

interface UpgradeServer {
  upgrade(request: Request): boolean;
}

export function createRaceServerHooks(app: ApiApp, rooms: RaceRoomManager) {
  return {
    fetch(request: Request, server: UpgradeServer): Response | undefined | Promise<Response | undefined> {
      if (new URL(request.url).pathname !== '/api/race') return app.fetch(request);
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required.', {
          status: 426,
          headers: { Upgrade: 'websocket' },
        });
      }
      if (server.upgrade(request)) return undefined;
      return new Response('WebSocket upgrade failed.', { status: 400 });
    },
    websocket: {
      maxPayloadLength: 4_096,
      open(socket: RaceSocket) {
        rooms.open(socket);
      },
      message(socket: RaceSocket, message: unknown) {
        rooms.message(socket, message);
      },
      close(socket: RaceSocket) {
        rooms.close(socket);
      },
    },
  };
}
