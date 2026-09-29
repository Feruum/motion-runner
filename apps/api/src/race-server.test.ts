import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { RaceServerMessage } from '../../../packages/game/src/core/race-types';
import { RaceRoomManager } from './race-rooms';
import { createRaceServerHooks } from './race-server';

function nextMessage(socket: WebSocket, type: RaceServerMessage['type']): Promise<RaceServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 3_000);
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as RaceServerMessage;
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      resolve(message);
    };
    socket.addEventListener('message', onMessage);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  return socket;
}

describe('Bun race websocket route', () => {
  it('upgrades /api/race and leaves existing Hono routes available', async () => {
    const app = new Hono().get('/api/health', context => context.json({ status: 'ok' }));
    const rooms = new RaceRoomManager({ makeEngine: () => { throw new Error('Race engine should not start in this test'); } });
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      ...createRaceServerHooks(app, rooms),
    });
    const host = await openSocket(`ws://127.0.0.1:${server.port}/api/race`);
    const guest = await openSocket(`ws://127.0.0.1:${server.port}/api/race`);

    try {
      const hostWelcomePromise = nextMessage(host, 'welcome');
      host.send(JSON.stringify({ type: 'create', name: 'Host', characterId: 'rogue' }));
      const hostWelcome = await hostWelcomePromise;
      if (hostWelcome.type !== 'welcome') throw new Error('Expected host welcome');

      const hostRoomPromise = nextMessage(host, 'room');
      const guestWelcomePromise = nextMessage(guest, 'welcome');
      guest.send(JSON.stringify({ type: 'join', code: hostWelcome.room.code, name: 'Guest', characterId: 'mage' }));
      const [hostRoom, guestWelcome] = await Promise.all([hostRoomPromise, guestWelcomePromise]);
      expect(hostRoom.type).toBe('room');
      expect(guestWelcome.type).toBe('welcome');
      if (hostRoom.type !== 'room' || guestWelcome.type !== 'welcome') throw new Error('Expected room messages');
      expect(guestWelcome.room.code).toBe(hostWelcome.room.code);
      expect(hostRoom.room.players).toHaveLength(2);
      expect(JSON.stringify(hostRoom.room)).not.toContain(guestWelcome.token);

      const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });
      const nonUpgrade = await fetch(`http://127.0.0.1:${server.port}/api/race`);
      expect(nonUpgrade.status).toBe(426);
    } finally {
      host.close();
      guest.close();
      await server.stop(true);
    }
  });
});
