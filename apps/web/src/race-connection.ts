import type { RaceClientMessage, RaceServerMessage, RaceRoomSnapshot } from '../../../packages/game/src/core/race-types';

export class RaceConnection {
  playerId = '';
  private token = '';
  private code = '';
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryUntil = 0;
  private sequence = 0;
  private initial: RaceClientMessage | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly url: string, private readonly callbacks: {
    room: (room: RaceRoomSnapshot) => void;
    status: (status: 'connecting' | 'connected' | 'reconnecting' | 'closed') => void;
    error: (message: string) => void;
  }) {}

  connect(message: RaceClientMessage): void {
    this.initial = message;
    this.open();
  }

  send(message: RaceClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  input(steer: number, jump: boolean, tracking: boolean): void {
    this.send({ type:'input',seq:++this.sequence,steer,jump,tracking });
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.retry); clearTimeout(this.handshakeTimer);
    this.send({ type:'leave' });
    this.socket?.close();
  }

  private open(): void {
    if (this.stopped) return;
    this.callbacks.status(this.token ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(this.url);
    this.socket = socket;
    const handshakeMs = this.retryUntil ? Math.max(1,Math.min(5000,this.retryUntil-Date.now())) : 5000;
    this.handshakeTimer = setTimeout(() => socket.close(), handshakeMs);
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      const message: RaceClientMessage | null = this.token
        ? { type:'resume',code:this.code,token:this.token } : this.initial;
      if (message) socket.send(JSON.stringify(message));
    };
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      let message: RaceServerMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === 'error') {
        this.callbacks.error(message.message);
        if (!this.playerId || ['INVALID_TOKEN','ROOM_NOT_FOUND','INVALID_RESUME','ROOM_CLOSED'].includes(message.code)) {
          this.stopped = true; clearTimeout(this.handshakeTimer); socket.close();
          this.callbacks.status('closed');
        }
        return;
      }
      if (message.type === 'welcome') {
        clearTimeout(this.handshakeTimer);
        this.playerId = message.playerId; this.token = message.token; this.code = message.room.code;
        this.sequence = 0; this.retryUntil = 0;
        this.callbacks.status('connected'); this.callbacks.room(message.room);
      } else if (message.type === 'room') this.callbacks.room(message.room);
    };
    socket.onerror = () => { /* onclose handles recovery consistently. */ };
    socket.onclose = () => {
      if (this.stopped || this.socket !== socket) return;
      clearTimeout(this.handshakeTimer);
      this.socket = null;
      if (!this.token) {
        this.stopped = true;
        this.callbacks.status('closed');
        this.callbacks.error('Cannot reach the race server. Try again or play with bots.');
        return;
      }
      this.retryUntil ||= Date.now() + 9000;
      if (Date.now() >= this.retryUntil) {
        this.callbacks.status('closed'); this.callbacks.error('Connection lost. Your reconnect window has ended.');
        this.stopped = true; return;
      }
      this.callbacks.status('reconnecting');
      this.retry = setTimeout(() => this.open(), 500);
    };
  }
}
