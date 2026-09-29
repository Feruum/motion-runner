import { CONFIG, GestureEngine, SessionController } from '@motion-runner/game';
import type { GestureAnalysis, PoseSample } from '@motion-runner/game';
import { RaceEngine } from '../../../packages/game/src/core/race';
import { RACE_TRACK } from '../../../packages/game/src/core/race-track';
import type { RaceEntrant, RaceInput, RaceRoomSnapshot, RaceSnapshot } from '../../../packages/game/src/core/race-types';
import { CHARACTERS } from './presentation/characters';
import { RaceWorld } from './presentation/race-world';
import { PoseTracker } from './vision/pose-tracker';
import { RaceConnection } from './race-connection';
import { predictRacePlayer, raceSocketUrl, raceSteer } from './race-controls';
import './presentation/party-race.css';

const root = document.querySelector<HTMLElement>('#app')!;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const params = new URLSearchParams(location.search);
const home = new URL(location.href); home.search = ''; home.hash = '';
document.body.classList.add('party-race');
document.body.dataset.selectedMode = 'party-race';
root.innerHTML = `
  <header class="race-header"><a href="${escape(home.href)}">← All games</a><b>PARTY<span>RACE</span></b><span>MOVE TOGETHER.</span></header>
  <main class="race-layout">
    <section class="race-stage" aria-label="Party Race track">
      <canvas id="race-world" aria-label="Three-dimensional race with moving obstacles"></canvas>
      <div class="race-hud"><div><small>PLACE</small><strong id="race-place">— / 8</strong></div><div><small>TIME LEFT</small><strong id="race-time">02:00</strong></div></div>
      <div id="race-overlay" class="race-overlay"></div>
      <div class="race-course-progress"><span id="race-distance">0 / 480 m</span><progress id="race-progress" max="480" value="0" aria-label="Distance to finish"></progress><span>FINISH ↗</span></div>
      <p id="race-tracking-notice" class="race-tracking-notice" role="status" hidden></p>
    </section>
    <aside class="race-sidebar">
      <section class="race-camera-card"><div class="race-card-heading"><b>YOUR CAMERA</b><span>LOCAL ONLY</span></div><video id="race-video" autoplay muted playsinline></video><p id="race-camera-status" role="status">Enable your camera to steer with your body.</p><button id="race-enable-camera" type="button">Enable camera</button></section>
      <section class="race-controls-card"><span class="race-eyebrow">YOUR BODY, YOUR CONTROLLER</span><h2>Find your line.</h2><p><b>Lean</b> to move sideways. Stand upright to hold your line.</p><p><b>Raise both hands</b> to jump. Lower them before jumping again.</p><p>Moving gates. Sweeping beams. Gaps. Reach the next flag to save your progress.</p></section>
      <p id="race-error" class="race-error" role="alert" hidden></p>
    </aside>
  </main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const overlay = element('race-overlay');
const video = element<HTMLVideoElement>('race-video');
const cameraButton = element<HTMLButtonElement>('race-enable-camera');
const errorLabel = element('race-error');
const gesture = new GestureEngine();
const tutorial = new SessionController(120_000);
let latest: GestureAnalysis | null = null;
let tracker: PoseTracker | null = null;
let cameraStage: 'off' | 'loading' | 'calibration' | 'tutorial' | 'ready' | 'error' = 'off';
let connection: RaceConnection | null = null;
let connectionStatus = 'closed';
let room: RaceRoomSnapshot | null = null;
let receivedAt = 0;
let offline: RaceEngine | null = null;
let localId = 'local-player';
let jumpPending = false;
let pendingInput: RaceInput = { steer:0,jump:false,tracking:false };
let previousOverlay = '';
let lastFrame = performance.now();
let lastInputAt = 0;
let lastUiAt = 0;
let offlineCountdownAt = 0;
let frameHandle = 0;
let cameraRecoveryAt = -1;
let cameraWasLost = true;
let savedName = 'Runner';
let savedCharacter = 'rogue';
let connecting = false;
try {
  savedName = localStorage.getItem('motion-runner-profile-name') || 'Runner';
  const saved = localStorage.getItem('motion-runner-character');
  if (CHARACTERS.some(item => item.id === saved)) savedCharacter = saved!;
} catch { /* Profile storage is optional. */ }
let world: RaceWorld | null = null;
try { world = new RaceWorld(element<HTMLCanvasElement>('race-world')); void world.ready.catch(showError); }
catch (error) { showError(error); }

function showError(error: unknown) {
  errorLabel.textContent = error instanceof Error ? error.message : String(error);
  errorLabel.hidden = false;
}
function clearError() { errorLabel.hidden = true; errorLabel.textContent = ''; }
function freshBody(now = performance.now()) {
  return !!latest?.trackingValid && now - latest.timestampMs <= CONFIG.staleMs && !document.hidden;
}
function cameraInput(now: number): RaceInput {
  const fresh = cameraStage === 'ready' && freshBody(now);
  if (!fresh) { cameraRecoveryAt = -1; cameraWasLost = true; jumpPending = false; }
  else if (cameraWasLost) {
    if (cameraRecoveryAt < 0) cameraRecoveryAt = now;
    if (now - cameraRecoveryAt >= CONFIG.recoveryMs) cameraWasLost = false;
    jumpPending = false;
  }
  const tracking = fresh && !cameraWasLost;
  return { steer:tracking ? raceSteer(latest!.lean) : 0, jump:tracking && jumpPending, tracking };
}
function poseReceived(sample: PoseSample) {
  latest = gesture.update(sample, cameraStage === 'tutorial' ? tutorial.tutorialTarget : undefined);
  if (cameraStage === 'calibration' || cameraStage === 'tutorial') {
    tutorial.tick(performance.now(), latest);
    cameraStage = tutorial.stage === 'READY' ? 'ready' : tutorial.stage === 'TUTORIAL' ? 'tutorial' : 'calibration';
  } else if (cameraStage === 'ready' && room?.phase === 'racing' && !cameraWasLost && latest.jumpTriggered) jumpPending = true;
}
cameraButton.addEventListener('click', async () => {
  if (cameraStage === 'loading') return;
  clearError(); tracker?.stop(); gesture.reset(); tutorial.stage = 'CALIBRATION'; tutorial.setTutorialMode('classic-run');
  latest = null; cameraStage = 'loading'; jumpPending = false;
  cameraButton.disabled = true;
  tracker = new PoseTracker(video, poseReceived, message => { cameraStage = 'error'; cameraButton.disabled = false; showError(message); });
  try { await tracker.start(); cameraStage = 'calibration'; }
  catch (error) { cameraStage = 'error'; showError(error); }
  cameraButton.disabled = false;
});

function profile(): RaceEntrant {
  savedName = (element<HTMLInputElement>('race-name')?.value || savedName).trim().slice(0,24) || 'Runner';
  savedCharacter = element<HTMLSelectElement>('race-character')?.value || savedCharacter;
  try { localStorage.setItem('motion-runner-profile-name',savedName); localStorage.setItem('motion-runner-character',savedCharacter); } catch { /* Optional. */ }
  return { id:localId,name:savedName,characterId:savedCharacter,isBot:false };
}
function bots(): RaceEntrant[] {
  return Array.from({length:7},(_,i)=>({id:`bot-${i}`,name:['Pip','Moss','Dash','Sunny','Pebble','Bramble','Echo'][i],characterId:CHARACTERS[i%CHARACTERS.length].id,isBot:true}));
}
function offlineLobby() {
  connection?.close(); connection = null; connectionStatus = 'closed'; localId = 'local-player';
  const entrants = [profile(),...bots()]; offline = new RaceEngine(entrants, 17);
  room = {code:'',hostId:localId,phase:'lobby',fillBots:true,players:entrants.map(p=>({...p,ready:p.isBot,connected:true})),countdownMs:0,race:offline.snapshot()};
  clearError(); previousOverlay = '';
}
function openRoom(action: 'create'|'join') {
  const entrant = profile();
  const code = (element<HTMLInputElement>('race-code')?.value || '').trim().toUpperCase();
  if (action === 'join' && !/^[A-Z0-9]{6}$/.test(code)) { showError('Enter the six-character room code.'); return; }
  clearError(); connecting = true; connection?.close(); offline = null;
  try {
    connection = new RaceConnection(raceSocketUrl(location.href, import.meta.env.VITE_RACE_SERVER_URL), {
      room: value => {
        const before = room?.phase; room = value; receivedAt = performance.now();
        localId = connection!.playerId;
        if (before !== value.phase) jumpPending = false;
        connecting = false;
        if (value.code) { const url = new URL(location.href); url.searchParams.set('mode','party-race'); url.searchParams.set('room',value.code); history.replaceState(null,'',url); }
      },
      status: status => { connectionStatus = status; if (status === 'closed') connecting = false; },
      error: showError,
    });
    connection.connect(action === 'create'
      ? { type:'create',name:entrant.name,characterId:entrant.characterId,fillBots:true }
      : { type:'join',code,name:entrant.name,characterId:entrant.characterId });
  } catch (error) { connecting = false; showError(error); }
}
function leave() {
  connection?.close(); connection = null; offline = null; room = null; connecting = false;
  connectionStatus = 'closed'; jumpPending = false; previousOverlay = '';
  const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null,'',url);
}
overlay.addEventListener('click', async event => {
  const action = (event.target as Element).closest<HTMLButtonElement>('[data-race-action]')?.dataset.raceAction;
  if (!action) return;
  if (action === 'offline') offlineLobby();
  if (action === 'create' || action === 'join') openRoom(action);
  if (action === 'leave') leave();
  if (action === 'ready' && cameraStage === 'ready' && freshBody()) {
    if (offline && room) room.players[0].ready = !room.players[0].ready;
    else connection?.send({type:'ready',ready:!room?.players.find(p=>p.id===localId)?.ready});
  }
  if (action === 'start' && room && room.players.filter(p=>!p.isBot).every(p=>p.ready && p.connected)) {
    jumpPending = false;
    if (offline) { room.phase = 'countdown'; offlineCountdownAt = performance.now()+3000; }
    else connection?.send({type:'start'});
  }
  if (action === 'fill' && room) {
    if (offline) {
      const human = room.players.find(p=>!p.isBot)!;
      room.fillBots = !room.fillBots;
      room.players = [human,...(room.fillBots ? bots().map(p=>({...p,ready:true,connected:true})) : [])];
      offline = new RaceEngine(room.players,17); room.race = offline.snapshot();
    } else connection?.send({type:'fillBots',enabled:!room.fillBots});
  }
  if (action === 'rematch') {
    jumpPending = false;
    if (offline && room) {
      offline = new RaceEngine(room.players,17); room.race = offline.snapshot(); room.phase = 'lobby';
      room.players.forEach(p=>p.ready=p.isBot);
    } else connection?.send({type:'rematch'});
  }
  if (action === 'copy' && room) {
    try { await navigator.clipboard.writeText(location.href); (event.target as HTMLElement).textContent = 'Link copied'; }
    catch { showError(`Share this room code: ${room.code}`); }
  }
});

function tutorialText(): string {
  if (cameraStage === 'loading') return 'Opening your camera…';
  if (cameraStage === 'calibration') return `Stand upright with your hands down. ${Math.round((latest?.calibrationProgress ?? 0)*100)}% calibrated`;
  if (cameraStage === 'tutorial') {
    if (tutorial.awaitingNeutral) return 'Return to neutral. Lower your hands and stand upright.';
    return ['Lean left to steer.','Lean right to steer.','Raise both hands to jump.'][tutorial.tutorialIndex] || '';
  }
  if (cameraStage === 'ready') return freshBody() ? (latest?.handsTracked ? 'Camera ready. Your body stays on this device.' : 'Hands out of view. Steering still works.') : 'Show your head, shoulders and hips.';
  return cameraStage === 'error' ? 'Camera unavailable. Try enabling it again.' : 'Enable your camera, then learn the three moves.';
}
function renderOverlay(now: number) {
  let html = '';
  if (!room) {
    html = `<div class="race-dialog race-menu"><span class="race-eyebrow">8 RUNNERS. ONE FINISH LINE.</span><h1>Make a<br><em>run for it.</em></h1><p>Lean, leap and bump your way through the course. Play with bots or invite your friends.</p><div class="race-profile"><label>Runner name<input id="race-name" maxlength="24" autocomplete="nickname" value="${escape(savedName)}"></label><label>Character<select id="race-character">${CHARACTERS.map(c=>`<option value="${c.id}" ${c.id===savedCharacter?'selected':''}>${c.name}</option>`).join('')}</select></label></div><div class="race-actions"><button data-race-action="offline" ${connecting?'disabled':''}>Play with bots</button><button class="race-secondary" data-race-action="create" ${connecting?'disabled':''}>Create room</button></div><div class="race-join"><input id="race-code" aria-label="Room code" maxlength="6" placeholder="ROOM CODE" value="${escape(params.get('room')?.toUpperCase() || '')}"><button class="race-secondary" data-race-action="join" ${connecting?'disabled':''}>Join room</button></div>${connecting?'<p role="status">Connecting to the race server…</p>':''}</div>`;
  } else if (connection && connectionStatus === 'closed') {
    html = '<div class="race-dialog"><span class="race-eyebrow">CONNECTION LOST</span><h1>Let’s regroup.</h1><p>The reconnect window has ended. Return to the menu to join a new room or play with bots.</p><button data-race-action="leave">Back to race menu</button></div>';
  } else if (room.phase === 'lobby') {
    const host = room.hostId === localId;
    const me = room.players.find(p=>p.id===localId);
    const allReady = room.players.filter(p=>!p.isBot).every(p=>p.ready&&p.connected);
    const ready = cameraStage==='ready'&&freshBody(now);
    html = `<div class="race-dialog race-lobby"><span class="race-eyebrow">${offline?'PRACTICE WITH BOTS':'YOUR PRIVATE ROOM'}</span><h1>${offline?'Meet the runners.':`Room <span id="race-room-code">${escape(room.code)}</span>`}</h1>${!offline?'<button class="race-link-button" data-race-action="copy">Copy invite link</button>':''}<ul id="race-players">${room.players.map(p=>`<li><span class="race-player-dot" style="--player-color:${CHARACTERS.find(c=>c.id===p.characterId)?.color || '#78aa8c'}"></span><span>${escape(p.name)}${p.id===localId?' (you)':''}</span><small>${p.isBot?'BOT':!p.connected?'RECONNECTING':p.ready?'READY':'PREPARING'}</small></li>`).join('')}</ul><p class="race-setup-instruction">${escape(tutorialText())}</p><div class="race-actions"><button data-race-action="ready" ${!ready?'disabled':''}>${me?.ready?'Not ready':'Ready to race'}</button>${host?`<button data-race-action="start" ${!allReady?'disabled':''}>Start race</button>`:'<span>Waiting for the host to start.</span>'}</div>${host?`<button class="race-link-button" data-race-action="fill">${room.fillBots?'✓ ':''}Fill empty places with bots</button>`:''}<button class="race-link-button" data-race-action="leave">Leave room</button></div>`;
  } else if (room.phase === 'countdown') {
    const remaining = offline ? offlineCountdownAt-now : room.countdownMs-(now-receivedAt);
    html = `<div class="race-countdown"><span>FIND YOUR LINE</span><strong id="race-countdown">${Math.max(1,Math.ceil(remaining/1000))}</strong><p>Lean to steer. Hands up to jump.</p></div>`;
  } else if (room.phase === 'results') {
    const players = room.race?.players ?? [];
    const me = players.find(p=>p.id===localId);
    html = `<div class="race-dialog race-results"><span class="race-eyebrow">THE FINISH LINE</span><h1>${me?.status==='finished'?`You placed #${me.rank}.`:'What a race.'}</h1><ol>${[...players].sort((a,b)=>a.rank-b.rank).map(p=>`<li><b>#${p.rank}</b><span>${escape(p.name)}${p.isBot?' · BOT':''}</span><strong>${p.finishMs!==null?`${(p.finishMs/1000).toFixed(2)}s`:'DNF'}</strong></li>`).join('')}</ol><div class="race-actions">${room.hostId===localId?'<button data-race-action="rematch">Race again</button>':'<span>Waiting for the host to start a rematch.</span>'}<button class="race-secondary" data-race-action="leave">Leave room</button></div></div>`;
  }
  if (html !== previousOverlay) {
    // Do not replace text inputs during menu editing unless its connection state changes.
    if (!room && previousOverlay && html.includes('race-menu') && overlay.querySelector('.race-menu')) {
      savedName = element<HTMLInputElement>('race-name')?.value || savedName;
      savedCharacter = element<HTMLSelectElement>('race-character')?.value || savedCharacter;
    }
    overlay.innerHTML = html; previousOverlay = html;
  }
  overlay.classList.toggle('is-clear',!html);
}

function renderUi(now: number) {
  document.body.dataset.racePhase = room?.phase || 'menu';
  document.body.dataset.cameraStage = cameraStage;
  element('race-camera-status').textContent = tutorialText();
  cameraButton.hidden = !['off','error','loading'].includes(cameraStage);
  const snapshot = room?.race;
  const player = snapshot?.players.find(p=>p.id===localId);
  element('race-place').textContent = player ? `${player.rank} / ${snapshot!.players.length}` : '— / 8';
  const seconds = Math.max(0,Math.ceil((RACE_TRACK.timeLimitMs-(snapshot?.elapsedMs || 0))/1000));
  element('race-time').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const distance = Math.max(0,Math.min(RACE_TRACK.length,player?.z || 0));
  element('race-distance').textContent = `${Math.floor(distance)} / ${RACE_TRACK.length} m`;
  element<HTMLProgressElement>('race-progress').value = distance;
  const notice = element('race-tracking-notice');
  notice.hidden = room?.phase !== 'racing';
  notice.textContent = connection && connectionStatus!=='connected' ? 'Reconnecting… Other runners keep racing.'
    : player?.status==='finished' ? 'You finished! Watching the remaining runners.'
    : player?.status==='dnf' ? 'Your race has ended. Watching the remaining runners.'
    : player?.status==='falling' ? 'Back to your last checkpoint…'
    : !pendingInput.tracking ? 'Show your body to continue. The race keeps going.'
    : !latest?.handsTracked ? 'Hands out of view. Lean to steer; show both hands to jump.' : '';
  if (!notice.textContent) notice.hidden = true;
  renderOverlay(now);
}

function frame(now: number) {
  const dt = Math.max(0,Math.min(100,now-lastFrame)); lastFrame = now;
  pendingInput = cameraInput(now);
  if (room?.phase==='countdown') jumpPending = false;
  if (offline && room) {
    if (room.phase==='countdown' && now>=offlineCountdownAt) { room.phase='racing'; jumpPending=false; }
    if (room.phase==='racing') {
      offline.update(dt,{[localId]:pendingInput}); jumpPending=false;
      room.race=offline.snapshot(); if(room.race.finished) room.phase='results';
    }
  } else if (connection && room?.phase==='racing' && now-lastInputAt>=1000/30) {
    connection.input(pendingInput.steer,pendingInput.jump,pendingInput.tracking);
    jumpPending=false; lastInputAt=now;
  }
  let snapshot = room?.race;
  if (snapshot && connection && room?.phase==='racing' && connectionStatus==='connected') {
    snapshot={...snapshot,players:snapshot.players.map(p=>p.id===localId?predictRacePlayer(p,pendingInput,now-receivedAt):p)};
  }
  if (snapshot) world?.update(snapshot,localId,dt);
  else world?.update({elapsedMs:0,finished:false,players:[]},localId,dt);
  if (now-lastUiAt>=80) { renderUi(now); lastUiAt=now; }
  frameHandle=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{ if(document.hidden){jumpPending=false;connection?.input(0,false,false);} });
window.addEventListener('pagehide',()=>{cancelAnimationFrame(frameHandle);tracker?.stop();connection?.close();world?.destroy();});
renderUi(performance.now()); frameHandle=requestAnimationFrame(frame);
