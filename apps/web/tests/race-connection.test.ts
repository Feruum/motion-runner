import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RaceConnection } from '../src/race-connection';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState=0; sent: unknown[]=[];
  onopen:(()=>void)|null=null; onclose:(()=>void)|null=null;
  onmessage:((event:{data:string})=>void)|null=null;
  constructor(readonly url:string){Socket.instances.push(this);}
  open(){this.readyState=1;this.onopen?.();}
  send(message:string){this.sent.push(JSON.parse(message));}
  close(){this.readyState=3;this.onclose?.();}
  receive(message:unknown){this.onmessage?.({data:JSON.stringify(message)});}
}
const room={code:'ABCDEF',hostId:'p1',phase:'lobby',fillBots:true,players:[],countdownMs:0,race:null};
describe('race connection',()=>{
  beforeEach(()=>{vi.useFakeTimers();Socket.instances=[];vi.stubGlobal('WebSocket',Socket);});
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
  it('resumes the same room after a lost connection and restarts input sequencing',()=>{
    const callbacks={room:vi.fn(),status:vi.fn(),error:vi.fn()};
    const client=new RaceConnection('ws://localhost/api/race',callbacks);
    client.connect({type:'create',name:'Runner',characterId:'rogue',fillBots:true});
    const first=Socket.instances[0];first.open();
    expect(first.sent[0]).toMatchObject({type:'create'});
    first.receive({type:'welcome',playerId:'p1',token:'secret',room});
    client.input(.5,true,true);
    expect(first.sent[1]).toMatchObject({type:'input',seq:1,jump:true});
    first.close();vi.advanceTimersByTime(500);
    const second=Socket.instances[1];second.open();
    expect(second.sent[0]).toEqual({type:'resume',code:'ABCDEF',token:'secret'});
    second.receive({type:'welcome',playerId:'p1',token:'secret',room});
    client.input(0,false,true);
    expect(second.sent[1]).toMatchObject({seq:1});
    expect(callbacks.status).toHaveBeenLastCalledWith('connected');
    client.close();vi.advanceTimersByTime(10000);
    expect(Socket.instances).toHaveLength(2);
  });
  it('reports an unavailable server instead of leaving the entry screen connecting',()=>{
    const callbacks={room:vi.fn(),status:vi.fn(),error:vi.fn()};
    const client=new RaceConnection('ws://localhost/api/race',callbacks);
    client.connect({type:'join',code:'ABCDEF',name:'Runner',characterId:'rogue'});
    Socket.instances[0].close();
    expect(callbacks.status).toHaveBeenLastCalledWith('closed');
    expect(callbacks.error).toHaveBeenCalled();
    client.close();
  });
  it('ends recovery within the server grace window even when handshakes never answer',()=>{
    const callbacks={room:vi.fn(),status:vi.fn(),error:vi.fn()};
    const client=new RaceConnection('ws://localhost/api/race',callbacks);
    client.connect({type:'create',name:'Runner',characterId:'rogue',fillBots:true});
    const socket=Socket.instances[0];socket.open();
    socket.receive({type:'welcome',playerId:'p1',token:'secret',room});socket.close();
    vi.advanceTimersByTime(9000);
    expect(callbacks.status).toHaveBeenLastCalledWith('closed');
    expect(callbacks.error).toHaveBeenCalledWith('Connection lost. Your reconnect window has ended.');
    client.close();
  });
  it('ignores queued socket events after leaving the room',()=>{
    const callbacks={room:vi.fn(),status:vi.fn(),error:vi.fn()};
    const client=new RaceConnection('ws://localhost/api/race',callbacks);
    client.connect({type:'create',name:'Runner',characterId:'rogue',fillBots:true});
    const socket=Socket.instances[0];
    client.close();
    Object.values(callbacks).forEach(callback=>callback.mockClear());
    socket.open();
    socket.receive({type:'welcome',playerId:'stale',token:'old',room});
    socket.receive({type:'room',room});
    socket.receive({type:'error',code:'ROOM_CLOSED',message:'Old room'});
    expect(socket.sent).toEqual([]);
    expect(client.playerId).toBe('');
    Object.values(callbacks).forEach(callback=>expect(callback).not.toHaveBeenCalled());
  });
  it('ignores old socket messages and close events during recovery',()=>{
    const callbacks={room:vi.fn(),status:vi.fn(),error:vi.fn()};
    const client=new RaceConnection('ws://localhost/api/race',callbacks);
    client.connect({type:'create',name:'Runner',characterId:'rogue',fillBots:true});
    const oldSocket=Socket.instances[0];oldSocket.open();
    oldSocket.receive({type:'welcome',playerId:'p1',token:'secret',room});
    oldSocket.close();vi.advanceTimersByTime(500);
    Object.values(callbacks).forEach(callback=>callback.mockClear());
    oldSocket.receive({type:'room',room:{...room,code:'STALE'}});
    oldSocket.close();
    Object.values(callbacks).forEach(callback=>expect(callback).not.toHaveBeenCalled());
    vi.advanceTimersByTime(500);
    expect(Socket.instances).toHaveLength(2);
    client.close();
  });
});
