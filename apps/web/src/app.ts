import { animate } from 'motion';
import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG as C, GAME_MODES, PLAYABLE_MODES, GestureEngine, ModeEngine, SessionController, configureGameForMode, makeBeatBlasterInput } from '@motion-runner/game';
import type { Correction, GameMode, GestureAnalysis, Landmark, PoseSample, Stage, TutorialGesture } from '@motion-runner/game';
import { drawBlasterTarget, placeBlasterOverlayTarget } from './presentation/blaster-overlay';
import { RunnerWorld } from './presentation/world';
import { CharacterPicker, getRunnerName } from './presentation/character-picker';
import { BIOMES, sampleRoute } from './presentation/route';
import { MusicTransport } from './presentation/music-transport';
import { classicRunCue } from './presentation/run-cue';
import { rhythmRunCue } from './presentation/rhythm-cue';
import './presentation/rhythm.css';
import { mirrorCoachState } from './presentation/mirror-coach-state';
import { MirrorCoachVoice } from './presentation/mirror-coach-voice';
import './presentation/mirror-coach.css';
import { danceGuideState, dancePresentationCueIndex } from './presentation/dance-guide-state';
import './presentation/dance.css';
import { PoseTracker } from './vision/pose-tracker';
import { PlayerIdentityAdapter } from './vision/player-identity';
import { loadLeaderboard, submitLeaderboardScore } from './leaderboard';

const BEST_KEY = 'motion-runner-best';
const root = document.querySelector<HTMLElement>('#app')!;
// Keep complete game rounds in the local UI too: authored challenges need 60 seconds.
const duration = C.durationMs;
const developerMode = import.meta.env.DEV && new URLSearchParams(location.search).get('dev') === '1';
const availableModes = developerMode
  ? GAME_MODES.filter(mode => ['classic-run', 'rhythm-run', 'mirror-challenge', 'dodge-arena', 'six-seven', 'beat-blaster', 'dance-party', 'dance-duo', 'party-race'].includes(mode.id))
  : PLAYABLE_MODES;
const savedMode = (() => { try { return localStorage.getItem('motion-runner-mode') as GameMode | null; } catch { return null; } })();
let selectedMode: GameMode = savedMode !== 'party-race' && availableModes.some(mode => mode.id === savedMode) ? savedMode! : 'classic-run';
const session = new SessionController(duration, selectedMode);
const gesture = new GestureEngine();
const partnerGesture = new GestureEngine();
const playerIdentity = new PlayerIdentityAdapter();
const music = new MusicTransport();
const mirrorVoice = new MirrorCoachVoice();
let mirrorVoiceEnabled = true;
let modeEngine = new ModeEngine(selectedMode, duration);
const worldCanvas = document.createElement('canvas');
worldCanvas.id = 'game-world';
worldCanvas.setAttribute('aria-label', 'Motion Runner three-dimensional obstacle track');
const video = document.createElement('video');
video.id = 'camera-video';
video.autoplay = true;
video.muted = true;
video.playsInline = true;
const skeletonCanvas = document.createElement('canvas');
skeletonCanvas.id = 'skeleton-canvas';

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#top" aria-label="Motion Runner home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>MOTION<span class="brand-light">/</span>RUNNER</span>
    </a>
    <div class="topbar-meta"><span class="live-dot"></span><span>BODY-POWERED ARCADE</span><span class="topbar-separator">·</span><span>NO CONTROLLER REQUIRED</span></div>
    <div class="topbar-right"><a class="leaderboard-jump" href="#leaderboard-card">LEADERBOARD <span aria-hidden="true">↓</span></a><span class="edition">FIELD TEST 001</span><span class="edition-dev" id="dev-badge"></span></div>
  </header>

  <main id="top">
    <section class="intro">
      <div class="intro-copy">
        <div class="eyebrow"><span class="eyebrow-line"></span><span>YOUR BODY IS THE CONTROLLER</span></div>
        <h1>Move into <span>play.</span></h1>
        <p>Lean into a new lane. Lift both hands to leap. That is all it takes to leave the everyday behind.</p>
      </div>
      <div class="intro-note"><span class="note-index">01</span><span>Stand back.<br>Stay in frame.<br><b>Find your rhythm.</b></span></div>
    </section>

    <section class="mode-selector" aria-label="Choose a game mode">
      <div class="mode-selector-heading"><div><span class="mode-selector-kicker">ONE CAMERA · MANY WAYS TO MOVE</span><h2>Choose your game.</h2></div><span class="mode-selector-note">Collect stars, dodge barriers, or race friends.</span></div>
      <div class="mode-grid" id="mode-grid">
        ${availableModes.map(mode => `<button class="mode-card" type="button" data-mode="${mode.id}" aria-pressed="${mode.id === selectedMode}"><span class="mode-card-icon">${mode.icon}</span><span class="mode-card-copy"><b>${mode.title}</b><small>${mode.subtitle}</small></span><span class="mode-card-check">✓</span></button>`).join('')}
      </div>
    </section>

    <section class="experience" aria-label="Motion Runner game">
      <div class="game-panel">
        <canvas id="game-world" aria-label="Three-dimensional runner track"></canvas>
        <div class="scene-vignette" aria-hidden="true"></div>
        <div class="game-topline">
          <div class="game-wordmark"><span class="runner-glyph">MR</span><span id="game-wordmark-copy">THE WILD PATH<br><small>THREE WORLDS · ONE RUN</small></span></div>
          <div class="run-hud" aria-label="Game status">
            <div class="hud-chip"><span class="hud-label">TIME</span><strong id="timer">01:00</strong></div>
            <div class="hud-chip score-chip"><span class="hud-label">SCORE</span><strong id="score">000</strong></div>
          </div>
        </div>
        <div class="lane-guide" aria-hidden="true"><span>01</span><i></i><span>02</span><i></i><span>03</span></div>
        <section class="mirror-dialogue" id="mirror-dialogue" aria-label="Mirror coach" hidden>
          <div class="mirror-dialogue-top"><span id="mirror-phase">WATCH ME</span><button id="mirror-voice-toggle" type="button" aria-pressed="true" aria-label="Coach voice">Voice on</button></div>
          <strong id="mirror-command">Lean left</strong><span class="mirror-rule">Copy me like a mirror. Hold for half a second.</span><span class="mirror-rule" id="mirror-hint"></span>
          <div id="mirror-hold" class="mirror-hold" role="progressbar" aria-label="Hold the matching pose" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        </section>
        <section class="six-seven-guide" id="six-seven-guide" hidden aria-label="Six Seven movement guide"><small>FOLLOW THE DEMO · STAY IN PLACE</small><strong>6 ↑ · 7 ↑</strong><span>Bend your elbows. Palms up.<br>Lift one hand, then the other.</span><b>Two movements = one rep</b></section>
        <section class="dance-guide" id="dance-guide" data-cue-index="" data-cue-id="" aria-label="Dance Party guide" hidden>
          <div class="dance-guide-top"><small id="dance-mode-label">DANCE SOLO</small><span id="dance-cue-counter">01 / 08</span></div>
          <strong id="dance-target" aria-live="polite">Reach left</strong>
          <p class="dance-guide-rule">Mirror the dancer: left and right follow the screen. Hold for 0.5 seconds. Keep elbows, wrists, hips and feet in frame.</p>
          <div class="dance-progress" id="dance-progress" role="progressbar" aria-label="Dance poses completed" aria-valuemin="0" aria-valuemax="8" aria-valuenow="0" aria-valuetext="0 of 8 poses completed"><i></i></div>
          <small class="dance-progress-label" id="dance-progress-label">0 POSES COMPLETED</small>
          <div class="dance-corrections" id="dance-correction">
            <p id="dance-solo-correction"></p>
            <div id="dance-duo-corrections" hidden>
              <p><b>PLAYER 1</b><span id="dance-player-one-correction"></span></p>
              <p><b>PLAYER 2</b><span id="dance-player-two-correction"></span></p>
            </div>
          </div>
        </section>
        <div class="rhythm-guide" id="rhythm-guide" hidden><span><b>★ ↔</b> Low star: lean</span><span><b>★ ↑</b> High star: jump</span><span class="rhythm-beats" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
        <div class="mode-cue" id="mode-cue" aria-live="polite"><span class="mode-cue-icon" id="mode-cue-icon">↗</span><span class="mode-cue-copy"><small id="mode-cue-label">CLASSIC RUN</small><strong id="mode-cue-title">Lean to begin.</strong></span><span class="mode-cue-score" id="mode-cue-score"></span></div>
        <div class="game-bottomline">
          <div class="distance-track"><span id="distance-fill"></span></div>
          <div class="world-caption"><span class="world-caption-dot"></span><span id="route-name">01 / SUNLIT VALLEY</span><span id="fps-label">CAMERA CONTROLS</span></div>
        </div>
        <div class="stage-overlay" id="stage-overlay" aria-live="polite"></div>
        <div class="correction-toast" id="correction-toast" role="status" aria-live="polite" hidden>
          <span class="correction-glyph">↗</span><span id="correction-text"></span>
        </div>
      </div>

      <aside class="side-rail">
        <section class="camera-card" aria-label="Camera preview">
          <div class="card-heading"><span>CAMERA CHECK</span><span class="privacy-label"><i></i> LOCAL ONLY</span></div>
          <div class="camera-view" id="camera-view">
            <span class="camera-corner corner-tl"></span><span class="camera-corner corner-tr"></span>
            <span class="camera-corner corner-bl"></span><span class="camera-corner corner-br"></span>
            <div class="camera-empty" id="camera-empty"><span class="camera-icon">◉</span><span>Your camera view<br>will appear here</span></div>
            <div class="camera-mirror" id="camera-mirror"></div>
            <div class="camera-scanline" aria-hidden="true"></div>
            <div class="camera-status" id="camera-status"><span class="status-dot"></span><span>WAITING FOR CAMERA</span></div>
            <div class="skeleton-highlight" id="skeleton-highlight"></div>
          </div>
          <div class="frame-hint"><span class="frame-icon">⌑</span><span>Head to hips in frame.<br><b>Leave room above your head.</b></span></div>
        </section>

        <section class="leaderboard-card" id="leaderboard-card" aria-labelledby="leaderboard-title">
          <div class="leaderboard-heading">
            <div><span class="leaderboard-kicker">BEST RUNS</span><h2 id="leaderboard-title">Leaderboard</h2></div>
            <button class="leaderboard-refresh" id="leaderboard-refresh" type="button" aria-label="Refresh leaderboard" title="Refresh leaderboard">↻</button>
          </div>
          <div class="leaderboard-mode"><span class="leaderboard-live-dot"></span>CLASSIC RUN <span>TOP 5</span></div>
          <ol class="leaderboard-list" id="leaderboard-list" aria-live="polite" aria-busy="true">
            <li class="leaderboard-empty">Loading scores…</li>
          </ol>
          <p class="leaderboard-you" id="leaderboard-you" hidden></p>
          <p class="leaderboard-note" id="leaderboard-note">Runner names and scores are saved here. Video stays on your device.</p>
        </section>

        <section class="coach-card" id="coach-card">
          <div class="card-heading"><span>MOVE SET</span><span class="coach-count" id="coach-count">READY WHEN YOU ARE</span></div>
          <div class="move-row" id="move-left"><span class="move-number">01</span><span class="move-icon lean-icon left">↙</span><span class="move-copy"><b>Lean left</b><small>Change to left lane</small></span><span class="move-check">✓</span></div>
          <div class="move-row" id="move-right"><span class="move-number">02</span><span class="move-icon lean-icon right">↘</span><span class="move-copy"><b>Lean right</b><small>Change to right lane</small></span><span class="move-check">✓</span></div>
          <div class="move-row" id="move-jump"><span class="move-number">03</span><span class="move-icon jump-icon">↑</span><span class="move-copy"><b>Hands up</b><small>Jump over low barriers</small></span><span class="move-check">✓</span></div>
          <div class="coach-message" id="coach-message"><span class="coach-orbit">✳</span><span id="coach-copy">Your coach will guide you through each move.</span></div>
        </section>

        <details class="pipeline-card" id="pipeline-details">
          <summary><span><i class="pipeline-node"></i>HOW IT WORKS</span><span class="details-chevron">⌄</span></summary>
          <div class="pipeline-content">
            <p>Your landmarks go through our own movement analysis before they reach the game.</p>
            <ol class="pipeline-steps">
              <li id="pipe-landmarks"><i>01</i><span><b>33 landmarks</b><small>MediaPipe Pose Landmarker</small></span></li>
              <li id="pipe-normalize"><i>02</i><span><b>Calibrate + smooth</b><small>Body scale · neutral · motion</small></span></li>
              <li id="pipe-intent"><i>03</i><span><b>Gesture analysis</b><small>Intent · confidence · correction</small></span></li>
              <li id="pipe-game"><i>04</i><span><b>Game action</b><small>Lane · jump · score</small></span></li>
            </ol>
          </div>
        </details>
        <div class="privacy-foot"><span class="privacy-lock">▣</span><span>Video stays on this device.<br>Only your runner name and best score are saved.</span></div>
      </aside>
    </section>

    <footer class="page-foot"><span>BUILT FOR THE WAY YOU MOVE</span><span>AN EXPERIMENT IN PLAYFUL COMPUTING</span><span>01 — ∞</span></footer>
  </main>
`;

const sceneCanvas = root.querySelector<HTMLCanvasElement>('#game-world')!;
const cameraMirror = root.querySelector<HTMLElement>('#camera-mirror')!;
cameraMirror.append(video, skeletonCanvas);
const overlay = root.querySelector<HTMLElement>('#stage-overlay')!;
const scoreLabel = root.querySelector<HTMLElement>('#score')!;
const scoreCaption = root.querySelector<HTMLElement>('.score-chip .hud-label')!;
const timerLabel = root.querySelector<HTMLElement>('#timer')!;
const distanceFill = root.querySelector<HTMLElement>('#distance-fill')!;
const routeName = root.querySelector<HTMLElement>('#route-name')!;
const cameraStatus = root.querySelector<HTMLElement>('#camera-status')!;
const cameraEmpty = root.querySelector<HTMLElement>('#camera-empty')!;
const coachCount = root.querySelector<HTMLElement>('#coach-count')!;
const coachCopy = root.querySelector<HTMLElement>('#coach-copy')!;
const toast = root.querySelector<HTMLElement>('#correction-toast')!;
const toastText = root.querySelector<HTMLElement>('#correction-text')!;
const highlight = root.querySelector<HTMLElement>('#skeleton-highlight')!;
const devBadge = root.querySelector<HTMLElement>('#dev-badge')!;
const cameraView = root.querySelector<HTMLElement>('#camera-view')!;
const leaderboardList = root.querySelector<HTMLOListElement>('#leaderboard-list')!;
const leaderboardNote = root.querySelector<HTMLElement>('#leaderboard-note')!;
const leaderboardSelf = root.querySelector<HTMLElement>('#leaderboard-you')!;
const leaderboardRefresh = root.querySelector<HTMLButtonElement>('#leaderboard-refresh')!;
const modeGrid = root.querySelector<HTMLElement>('#mode-grid')!;
const introDescription = root.querySelector<HTMLElement>('.intro-copy p')!;
const modeCue = root.querySelector<HTMLElement>('#mode-cue')!;
const modeCueIcon = root.querySelector<HTMLElement>('#mode-cue-icon')!;
const modeCueLabel = root.querySelector<HTMLElement>('#mode-cue-label')!;
const modeCueTitle = root.querySelector<HTMLElement>('#mode-cue-title')!;
const modeCueScore = root.querySelector<HTMLElement>('#mode-cue-score')!;
const rhythmGuide = root.querySelector<HTMLElement>('#rhythm-guide')!;
const rhythmBeatDots = rhythmGuide.querySelectorAll('i');
const mirrorDialogue = root.querySelector<HTMLElement>('#mirror-dialogue')!;
const mirrorCommand = root.querySelector<HTMLElement>('#mirror-command')!;
const mirrorPhase = root.querySelector<HTMLElement>('#mirror-phase')!;
const mirrorHold = root.querySelector<HTMLElement>('#mirror-hold')!;
const mirrorVoiceToggle = root.querySelector<HTMLButtonElement>('#mirror-voice-toggle')!;
const danceGuide = root.querySelector<HTMLElement>('#dance-guide')!;
const danceModeLabel = root.querySelector<HTMLElement>('#dance-mode-label')!;
const danceCueCounter = root.querySelector<HTMLElement>('#dance-cue-counter')!;
const danceTarget = root.querySelector<HTMLElement>('#dance-target')!;
const danceProgress = root.querySelector<HTMLElement>('#dance-progress')!;
const danceProgressLabel = root.querySelector<HTMLElement>('#dance-progress-label')!;
const danceSoloCorrection = root.querySelector<HTMLElement>('#dance-solo-correction')!;
const danceDuoCorrections = root.querySelector<HTMLElement>('#dance-duo-corrections')!;
const dancePlayerOneCorrection = root.querySelector<HTMLElement>('#dance-player-one-correction')!;
const dancePlayerTwoCorrection = root.querySelector<HTMLElement>('#dance-player-two-correction')!;
if (!mirrorVoice.supported) {
  mirrorVoiceEnabled = false;
  mirrorVoiceToggle.disabled = true;
  mirrorVoiceToggle.textContent = 'Text only';
  mirrorVoiceToggle.setAttribute('aria-pressed','false');
  mirrorVoiceToggle.title = 'Voice is unavailable in this browser. Follow the coach and written commands.';
}
mirrorVoiceToggle.addEventListener('click', () => {
  mirrorVoiceEnabled = !mirrorVoiceEnabled;
  mirrorVoice.setEnabled(mirrorVoiceEnabled);
  mirrorVoiceToggle.setAttribute('aria-pressed', String(mirrorVoiceEnabled));
  mirrorVoiceToggle.textContent = mirrorVoiceEnabled ? 'Voice on' : 'Voice off';
});

if (developerMode) devBadge.textContent = 'DEVELOPMENT · 60 SEC';
function bestKey(mode: GameMode) {
  if (mode === 'classic-run') return BEST_KEY;
  if (mode === 'six-seven') return 'motion-runner-best:v3:six-seven-repetitions';
  return `motion-runner-best:v2:${mode}`;
}

function readBest(mode: GameMode) {
  try {
    const value = Number(localStorage.getItem(bestKey(mode)));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch { return 0; }
}

session.bestScore = readBest(selectedMode);
let persistedBest = session.bestScore;

function usesModeScoring() { return selectedMode !== 'classic-run' && selectedMode !== 'party-race'; }
function runScore() { return usesModeScoring() ? modeEngine.snapshot(session.game.elapsedMs).score : session.game.score; }
function runCleared() { return usesModeScoring() ? modeEngine.snapshot(session.game.elapsedMs).cleared : session.game.cleared; }
function runMisses() { return selectedMode === 'dodge-arena' ? modeEngine.snapshot(session.game.elapsedMs).collisions : usesModeScoring() ? modeEngine.snapshot(session.game.elapsedMs).misses : session.game.collisions; }

function refreshModePicker() {
  const canSelect = session.stage === 'WELCOME' || session.stage === 'ERROR';
  for (const button of modeGrid.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    button.disabled = !canSelect;
    button.setAttribute('aria-pressed', String(button.dataset.mode === selectedMode));
  }
}

function updateMoveSet() {
  const wordmarkCopy = selectedMode === 'rhythm-run'
    ? 'RHYTHM RUN<br><small>COLLECT STARS ON THE BEAT</small>'
    : selectedMode === 'dance-party'
      ? 'DANCE PARTY · SOLO<br><small>COPY THE POSE LIKE A MIRROR</small>'
      : selectedMode === 'dance-duo'
        ? 'DANCE PARTY · DUO<br><small>ONE SHARED DEMONSTRATOR</small>'
        : 'THE WILD PATH<br><small>THREE WORLDS · ONE RUN</small>';
  root.querySelector<HTMLElement>('#game-wordmark-copy')!.innerHTML = wordmarkCopy;
  const sceneLabel = selectedMode === 'six-seven' ? 'Six Seven: face the character and alternate hand heights'
    : selectedMode === 'mirror-challenge' ? 'Mirror: copy the character’s pose'
      : selectedMode === 'rhythm-run' ? 'Rhythm Run: collect low stars by leaning and high stars by jumping'
        : selectedMode === 'dance-party' ? 'Dance Party Solo: copy the front-facing character and hold each full-body pose'
          : selectedMode === 'dance-duo' ? 'Dance Party Duo: both players copy the same front-facing full-body pose'
            : 'Three-dimensional runner track';
  sceneCanvas.setAttribute('aria-label', sceneLabel);
  const jumpRow = document.querySelector<HTMLElement>('#move-jump');
  if (jumpRow) jumpRow.hidden = selectedMode === 'dodge-arena';
  const moveCopy = (row: string, title: string, detail: string) => {
    const copy = document.querySelector<HTMLElement>(`#${row} .move-copy`);
    if (copy) { copy.querySelector('b')!.textContent = title; copy.querySelector('small')!.textContent = detail; }
  };
  const standard = 'Lean into a new lane. Lift both hands to leap. That is all it takes to leave the everyday behind.';
  const descriptions: Partial<Record<GameMode, string>> = {
    'rhythm-run': 'Collect the stars coming down the track. Lean into the lane of a low star. Raise both hands to jump for a high star. Catch them at the glowing line to build your combo.',
    'mirror-challenge': 'Face your coach in the center. Watch the pose, copy it like a mirror, and hold it steady. Your coach shows and says each move.',
    'dodge-arena': 'Read each warning and lean to a clear lane before the obstacle reaches you.',
    'beat-blaster': 'Reach into each glowing target with the matching hand. The camera checks your aim and timing.',
    'dance-party': 'Copy the front-facing character like a mirror. Match each full-body pose and hold for 0.5 seconds.',
    'dance-duo': 'Stand side by side and copy the same front-facing pose like a mirror. Each player keeps an individual score; synchronized holds add a team bonus.',
    'six-seven': 'Stand in place, bend your elbows and face your palms up. Alternate hand heights near your chest: two movements make one repetition. Start on either side.',
  };
  introDescription.textContent = descriptions[selectedMode] ?? standard;
  if (selectedMode === 'rhythm-run') {
    moveCopy('move-left', 'Collect left stars', 'Lean left and stay in their lane');
    moveCopy('move-right', 'Collect right stars', 'Lean right and stay in their lane');
    moveCopy('move-jump', 'Catch high stars', 'Return to center, then raise both hands');
  } else if (selectedMode === 'beat-blaster') {
    moveCopy('move-left', 'Reach left', 'Use your left hand for cyan targets');
    moveCopy('move-right', 'Reach right', 'Use your right hand for coral targets');
    moveCopy('move-jump', 'Follow the target', 'Reach, then return your hand');
  } else if (selectedMode === 'six-seven') {
    moveCopy('move-left', 'Raise one hand', 'Start on either side');
    moveCopy('move-right', 'Switch hands', 'Two movements = 1 rep');
    moveCopy('move-jump', 'Repeat the pair', 'Start fresh for the next rep');
  } else if (selectedMode === 'dodge-arena') {
    moveCopy('move-left', 'Lean left', 'Evade the left lane');
    moveCopy('move-right', 'Lean right', 'Evade the right lane');
  } else if (selectedMode === 'mirror-challenge') {
    moveCopy('move-left', 'Copy the coach', 'Match the highlighted pose');
    moveCopy('move-right', 'Hold the shape', 'Keep it steady for the pulse');
    moveCopy('move-jump', 'Try each task', 'Single poses and short combos');
  } else if (selectedMode === 'dance-party') {
    moveCopy('move-left', 'Copy the full pose', 'Follow the dancer like a mirror');
    moveCopy('move-right', 'Match the hands', 'Left and right match your screen');
    moveCopy('move-jump', 'Hold the pose', '0.5 seconds to score');
  } else if (selectedMode === 'dance-duo') {
    moveCopy('move-left', 'Player 1', 'Copy the same pose');
    moveCopy('move-right', 'Player 2', 'Keep your full body in frame');
    moveCopy('move-jump', 'Hold together', 'Synchronized moves add a team bonus');
  } else {
    moveCopy('move-left', 'Lean left', 'Change to left lane');
    moveCopy('move-right', 'Lean right', 'Change to right lane');
    moveCopy('move-jump', 'Hands up', 'Jump over low barriers');
  }
}

function selectMode(mode: GameMode) {
  if (!availableModes.some(item => item.id === mode) || (session.stage !== 'WELCOME' && session.stage !== 'ERROR')) return;
  if (mode === 'party-race') {
    const route = new URL(location.href); route.searchParams.set('mode','party-race');
    location.assign(route.href); return;
  }
  selectedMode = mode;
  world?.setDanceMode(mode === 'dance-party' || mode === 'dance-duo');
  session.setTutorialMode(mode);
  playerIdentity.reset();
  partnerGesture.reset();
  duoVisiblePlayers = 0;
  duoPlayersReady = false;
  music.stop();
  modeEngine = new ModeEngine(selectedMode, duration);
  configureGameForMode(session.game, selectedMode);
  session.bestScore = readBest(selectedMode);
  persistedBest = session.bestScore;
  document.body.dataset.selectedMode = selectedMode;
  updateMoveSet();
  try { localStorage.setItem('motion-runner-mode', selectedMode); } catch { /* Mode selection stays usable without storage. */ }
  refreshModePicker();
  updateUI(performance.now(), true);
}

modeGrid.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-mode]') : null;
  if (button?.dataset.mode) selectMode(button.dataset.mode as GameMode);
});
updateMoveSet();
document.body.dataset.selectedMode = selectedMode;
configureGameForMode(session.game, selectedMode);

let world: RunnerWorld | null = null;
let tracker: PoseTracker | null = null;
let latestAnalysis: GestureAnalysis | null = null;
let latestSample: PoseSample | null = null;
let partnerAnalysis: GestureAnalysis | null = null;
let duoVisiblePlayers = 0;
let duoPlayersReady = false;
let drawingUtils: DrawingUtils | null = null;
let audio: AudioContext | null = null;
let musicStartToken = 0;
let previousAnimationTime = 0;
let previousUiAt = 0;
let previousUiKey = '';
let previousScore = -1;
let previousLane = 0;
let setupError = '';
let setupFailure: 'camera' | 'model' | 'tracking' = 'camera';
let assetMessage = 'Loading the landscape';
let previousCleared = 0;
let previousCollisions = 0;
let activeRunId = 0;
let submittedRunId = -1;
let leaderboardSubmissionMessage = '';
let leaderboardSubmissionKind: 'pending' | 'success' | 'error' = 'pending';

const DUO_REQUIRED_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24, 27, 28] as const;
const MIRROR_REQUIRED_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24] as const;
function missingPoseLandmarks(landmarks: readonly Landmark[], indexes: readonly number[]): number[] {
  return indexes.filter(index => {
    const point = landmarks[index];
    const confidence = point && Math.min(point.visibility, point.presence ?? point.visibility);
    return !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || !Number.isFinite(confidence) || confidence! < C.confidence;
  });
}

function isDuoPlayerTracked(landmarks: readonly Landmark[]): boolean {
  return missingPoseLandmarks(landmarks, DUO_REQUIRED_LANDMARKS).length === 0;
}

function isLoading() { return session.stage === 'LOADING'; }

function persistPersonalBest() {
  session.bestScore = Math.max(session.bestScore, runScore());
  if (session.bestScore <= persistedBest) return;
  try { localStorage.setItem(bestKey(selectedMode), String(session.bestScore)); } catch { /* Storage is optional. */ }
  persistedBest = session.bestScore;
}

function renderLeaderboard(snapshot: Awaited<ReturnType<typeof loadLeaderboard>>) {
  leaderboardList.replaceChildren();
  leaderboardList.setAttribute('aria-busy', 'false');
  if (snapshot.entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'leaderboard-empty';
    empty.textContent = 'No runs yet. Be the first on the board.';
    leaderboardList.append(empty);
  } else {
    for (const entry of snapshot.entries) {
      const row = document.createElement('li');
      row.className = 'leaderboard-row';
      if (entry.isCurrentPlayer) row.classList.add('is-you');
      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = String(entry.rank).padStart(2, '0');
      const runner = document.createElement('span');
      runner.className = 'leaderboard-runner';
      runner.textContent = entry.name;
      const you = document.createElement('small');
      you.textContent = entry.isCurrentPlayer ? 'YOU' : '';
      runner.append(you);
      const score = document.createElement('strong');
      score.className = 'leaderboard-score';
      score.textContent = String(entry.score).padStart(3, '0');
      row.append(rank, runner, score);
      leaderboardList.append(row);
    }
  }

  const alreadyListed = snapshot.entries.some(entry => entry.isCurrentPlayer);
  if (snapshot.personalBest && !alreadyListed) {
    leaderboardSelf.hidden = false;
    leaderboardSelf.textContent = `YOUR BEST  ·  #${snapshot.personalBest.rank}  ·  ${snapshot.personalBest.score} PTS`;
  } else {
    leaderboardSelf.hidden = true;
    leaderboardSelf.textContent = '';
  }
  leaderboardNote.textContent = snapshot.entries.length
    ? 'One best score per runner · stored by this game server.'
    : 'Your first completed run can claim the top spot.';
}

async function refreshLeaderboard() {
  leaderboardRefresh.disabled = true;
  leaderboardList.setAttribute('aria-busy', 'true');
  leaderboardNote.textContent = 'Fetching scores…';
  try {
    const snapshot = await loadLeaderboard();
    renderLeaderboard(snapshot);
  } catch {
    leaderboardList.replaceChildren();
    leaderboardList.setAttribute('aria-busy', 'false');
    const unavailable = document.createElement('li');
    unavailable.className = 'leaderboard-empty leaderboard-error';
    unavailable.textContent = 'Leaderboard is offline.';
    leaderboardList.append(unavailable);
    leaderboardSelf.hidden = true;
    leaderboardNote.textContent = 'Start the web app and Hono API together with “bun run dev”.';
  } finally {
    leaderboardRefresh.disabled = false;
  }
}

function setLeaderboardResultMessage(message: string, kind: 'pending' | 'success' | 'error') {
  leaderboardSubmissionMessage = message;
  leaderboardSubmissionKind = kind;
  const status = overlay.querySelector<HTMLElement>('#leaderboard-result-status');
  if (status) {
    status.textContent = message;
    status.dataset.state = kind;
  }
}

async function submitCompletedRun() {
  if (selectedMode !== 'classic-run') return;
  if (activeRunId === 0 || submittedRunId === activeRunId) return;
  submittedRunId = activeRunId;
  const result = {
    name: getRunnerName(),
    score: session.game.score,
    cleared: session.game.cleared,
    collisions: session.game.collisions,
  };
  setLeaderboardResultMessage('Adding your best to the leaderboard…', 'pending');
  try {
    const submission = await submitLeaderboardScore(result);
    setLeaderboardResultMessage(
      submission.improved ? 'Run saved to the leaderboard.' : 'Your leaderboard best is already higher.',
      'success',
    );
    await refreshLeaderboard();
  } catch {
    setLeaderboardResultMessage('Could not save the score. Check that the Hono API is running.', 'error');
  }
}

leaderboardRefresh.addEventListener('click', () => void refreshLeaderboard());

try {
  world = new RunnerWorld(sceneCanvas, (message, animations = []) => {
    assetMessage = message;
    document.body.dataset.runnerAssets = message;
    document.body.dataset.runnerAnimations = animations.join(',');
  });
  world.setDanceMode(selectedMode === 'dance-party' || selectedMode === 'dance-duo');
} catch (error) {
  console.error('The 3D graphics context could not start.', error);
  cameraStatus.innerHTML = '<span class="status-dot status-warning"></span><span>3D GRAPHICS UNAVAILABLE</span>';
  document.body.classList.add('graphics-error');
  overlay.innerHTML = `<div class="overlay-inner"><span class="overlay-kicker">GRAPHICS SETUP</span><h2>This browser cannot open the 3D track.</h2><p>Use an up-to-date version of Chrome or Edge with hardware acceleration enabled.</p></div>`;
}

const characterPicker = new CharacterPicker(async id => {
  if (!world) throw new Error('The 3D scene is unavailable.');
  await world.selectCharacter(id);
});

function initialiseAudio() {
  if (audio) return;
  const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return;
  audio = new AudioContextConstructor();
  void audio.resume();
}

function stopModeMusic() {
  musicStartToken++;
  music.stop();
}

function startModeMusic() {
  if (selectedMode === 'mirror-challenge') return;
  if (!GAME_MODES.find(mode => mode.id === selectedMode)?.music || !audio) return;
  const token = ++musicStartToken;
  const start = () => {
    if (token === musicStartToken && session.stage === 'PLAYING' && audio?.state === 'running') {
      music.start(audio, 120, session.game.elapsedMs);
    }
  };
  if (audio.state === 'running') start();
  else void audio.resume().then(start).catch(() => undefined);
}

function syncModeStage(previous: Stage) {
  if (previous === session.stage) return;
  if (session.stage === 'COUNTDOWN') {
    if (!session.game.paused) { modeEngine.reset(); collisionFeedbackUntil = -Infinity; }
    configureGameForMode(session.game, selectedMode);
    stopModeMusic();
  } else if (session.stage === 'PLAYING') {
    startModeMusic();
  } else if (session.stage === 'PAUSED' || session.stage === 'RESULTS') {
    stopModeMusic();
  }
  refreshModePicker();
}

function tone(frequency: number, length = 0.095, shape: OscillatorType = 'sine', volume = 0.06) {
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = shape;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + length);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + length + 0.02);
}

function playCue(kind: 'jump' | 'clear' | 'hit' | 'ready') {
  if (kind === 'jump') tone(500, 0.13, 'sine', 0.055);
  if (kind === 'clear') { tone(720, 0.11, 'sine', 0.045); window.setTimeout(() => tone(980, 0.12, 'sine', 0.035), 65); }
  if (kind === 'hit') tone(145, 0.22, 'triangle', 0.075);
  if (kind === 'ready') tone(440, 0.08, 'sine', 0.038);
}

async function beginSetup() {
  if (session.stage !== 'WELCOME' && session.stage !== 'ERROR') return;
  stopModeMusic();
  initialiseAudio();
  gesture.reset();
  partnerGesture.reset();
  playerIdentity.reset();
  duoVisiblePlayers = 0;
  duoPlayersReady = false;
  latestAnalysis = null;
  latestSample = null;
  partnerAnalysis = null;
  setupError = '';
  setupFailure = 'camera';
  session.restartSetup();
  modeEngine.reset();
  configureGameForMode(session.game, selectedMode);
  session.startLoading();
  cameraView.classList.remove('camera-live');
  updateUI(performance.now(), true);
  const preview = document.querySelector<HTMLElement>('.camera-preview-placeholder');
  preview?.remove();
  tracker = new PoseTracker(video, sample => {
    handlePoseSample(sample);
  }, message => {
    setupFailure = 'tracking';
    setupError = message;
    session.cameraFailed();
    tracker?.stop();
    latestAnalysis = null;
    latestSample = null;
    partnerAnalysis = null;
    duoPlayersReady = false;
    duoVisiblePlayers = 0;
    cameraEmpty.hidden = false;
    cameraView.classList.remove('camera-live');
    updateUI(performance.now(), true);
  }, selectedMode === 'dance-duo' ? 2 : 1);
  try {
    await Promise.all([tracker.start(), world?.ready]);
    if (!isLoading()) return;
    cameraView.classList.add('camera-live');
    session.cameraReady();
    cameraEmpty.hidden = true;
    cameraStatus.innerHTML = '<span class="status-dot status-live"></span><span>CAMERA CONNECTED</span>';
    updateUI(performance.now(), true);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    setupFailure = error instanceof DOMException ? 'camera' : 'model';
    setupError = name === 'NotAllowedError' || name === 'SecurityError'
      ? 'Camera access was blocked. Allow camera access for this site, then try again.'
      : name === 'NotFoundError' || name === 'DevicesNotFoundError'
        ? 'No camera was found. Connect a camera and try again.'
        : name === 'NotReadableError' || name === 'TrackStartError'
          ? 'The camera is busy in another app. Close that app and try again.'
          : error instanceof Error ? error.message : 'Camera or pose model could not be started.';
    session.cameraFailed();
    cameraView.classList.remove('camera-live');
    cameraStatus.innerHTML = '<span class="status-dot status-warning"></span><span>SETUP NEEDS ATTENTION</span>';
    updateUI(performance.now(), true);
  }
}

function blasterTutorialCopy(target: Extract<TutorialGesture, 'BLAST_LEFT' | 'BLAST_RIGHT'>, landmarks: Landmark[]) {
  const hand = target === 'BLAST_LEFT' ? 'left' : 'right';
  const wristIndex = hand === 'left' ? 15 : 16;
  const shoulderIndex = hand === 'left' ? 11 : 12;
  const otherWristIndex = hand === 'left' ? 16 : 15;
  const title = hand === 'left' ? 'Reach with your left hand.' : 'Now reach with your right hand.';
  const required = [landmarks[11], landmarks[12], landmarks[wristIndex], landmarks[otherWristIndex]];
  if (required.some(point => !point || !Number.isFinite(point.x) || point.visibility < C.confidence
    || (point.presence ?? point.visibility) < C.confidence)) {
    return { title, hint: 'Keep both shoulders and wrists inside the camera frame.' };
  }

  const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
  if (shoulderWidth < 0.02) return { title, hint: 'Step back until both shoulders fit inside the frame.' };

  const reach = hand === 'left'
    ? landmarks[wristIndex].x - landmarks[shoulderIndex].x
    : landmarks[shoulderIndex].x - landmarks[wristIndex].x;
  const otherReach = hand === 'left'
    ? landmarks[otherWristIndex].x - landmarks[shoulderIndex].x
    : landmarks[shoulderIndex].x - landmarks[otherWristIndex].x;
  if (otherReach >= shoulderWidth * 0.42) return { title, hint: `Use your ${hand} hand to reach toward the target.` };
  if (reach >= shoulderWidth * 0.12) return { title, hint: `Reach a little farther with your ${hand} hand.` };
  return { title, hint: `Extend your ${hand} arm toward the target.` };
}

function transitionCopy(stage: Stage, now: number) {
  const analysis = latestAnalysis;
  if (stage === 'WELCOME') return {
    kicker: 'BEFORE YOU RUN', title: 'A little room to move.',
    copy: 'We use your laptop camera to read a few body landmarks. Stand back so your head, shoulders and hips are in view.',
    action: 'Enable camera', foot: 'CAMERA + SOUND START TOGETHER', icon: '◎', actionId: 'enable-camera',
  };
  if (stage === 'LOADING') return {
    kicker: 'GETTING THE COURSE READY', title: 'Opening the wild path.',
    copy: `${assetMessage}. Camera frames are analysed on this device and never uploaded.`,
    action: '', foot: 'FIRST LOAD MAY TAKE A FEW SECONDS', icon: '✳', actionId: '',
  };
  if (stage === 'CALIBRATION') return {
    kicker: '01 / FIND YOUR NEUTRAL', title: 'Stand tall and easy.',
    copy: analysis?.correction?.text ?? `Lower your hands, stand upright and hold still for two seconds. Calibration starts automatically, then we will practise ${session.tutorialSteps.length} moves.`,
    action: '', foot: `${Math.round((analysis?.calibrationProgress ?? 0) * 100)}% CALIBRATED`, icon: '⌁', actionId: '',
  };
  if (stage === 'TUTORIAL') {
    if (session.awaitingNeutral) return {
      kicker: 'MOVE RECOGNIZED', title: 'Return to neutral.',
      copy: 'Stand upright in the center and lower both hands to continue to the next move.',
      action: '', foot: 'HANDS DOWN · SHOULDERS ABOVE HIPS', icon: '✓', actionId: '',
    };
    const sixSeven = selectedMode === 'six-seven';
    const blasterTarget = selectedMode === 'beat-blaster' ? session.tutorialTarget : null;
    const titles = sixSeven ? ['Lift your left hand higher.', 'Now lift your right hand higher.'] : ['Lean into the left lane.', 'Now find the right lane.', 'Lift off with both hands.'];
    const copies = sixSeven
      ? ['Bend your elbows with palms up. Lift your left hand higher than your right, between waist and chest.', 'Switch their heights: right hand higher, left hand lower. Keep both hands in view.']
      : [
        'Move your shoulders a little to your left. Follow the cue in your camera preview.',
        'Shift back through center, then lean your shoulders to the right.',
        'Bring both hands above your head. Make space above your head in the camera frame.',
      ];
    const blasterStep = blasterTarget === 'BLAST_LEFT' || blasterTarget === 'BLAST_RIGHT'
      ? blasterTutorialCopy(blasterTarget, latestSample?.landmarks ?? [])
      : null;
    const corrections = blasterStep?.hint ?? analysis?.correction?.text;
    return {
      kicker: `MOVEMENT LAB · 0${session.tutorialIndex + 1} / 0${session.tutorialSteps.length}`,
      title: session.tutorialSuccess ? 'That is the move.' : blasterStep?.title ?? titles[session.tutorialIndex],
      copy: session.tutorialSuccess ? 'Nice and clear. Return to neutral to continue.' : corrections ?? copies[session.tutorialIndex],
      action: '', foot: session.tutorialSuccess ? '✓ MOVE RECOGNIZED' : 'TRY IT WHEN YOU ARE READY', icon: session.tutorialSuccess ? '✓' : '↗', actionId: '',
    };
  }
  if (stage === 'READY') return {
    kicker: 'ALL SET · HOLD TO START',
    title: session.startArmed ? 'Great. Hands down.' : 'Raise both hands.',
    copy: selectedMode === 'six-seven' ? `${startInstruction(now)} Or lower both hands and press Start game.` : startInstruction(now),
    action: selectedMode === 'six-seven' ? 'Start game' : '',
    foot: session.startArmed ? 'LOWER HANDS TO COUNT IN' : selectedMode === 'six-seven' ? '2 HAND MOVEMENTS = 1 REP · START ON EITHER SIDE' : `${startHoldPercent(now)}% · HOLD BOTH HANDS HIGH`,
    icon: '↑', actionId: selectedMode === 'six-seven' ? 'start-run' : '',
  };
  if (stage === 'COUNTDOWN') {
    const count = Math.max(1, Math.ceil((session.countdownEndsAt - now) / 1000));
    return { kicker: 'GET INTO POSITION', title: `${count}`, copy: session.game.paused ? 'Tracking restored. Get ready to continue.' : 'Get ready. Keep your body in view.', action: '', foot: session.game.paused ? 'RUN RESUMING' : 'RUN STARTING', icon: '◷', actionId: '' };
  }
  if (stage === 'PAUSED') return {
    kicker: 'TRACKING PAUSED', title: 'Let’s get you back.',
    copy: trackingInstruction(now),
    action: '', foot: selectedMode === 'six-seven' ? 'REPS SAVED · CHALLENGE PAUSED' : 'SCORE + COURSE PAUSED', icon: '⌑', actionId: '',
  };
  if (stage === 'RESULTS' && selectedMode === 'rhythm-run') return {
    kicker: `RHYTHM COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: 'Your star collection.',
    copy: `You collected ${runCleared()} stars and missed ${runMisses()}. Lean for low stars and jump for high ones.`,
    action: 'Run again', foot: `SCORE ${runScore()} · BEST ${session.bestScore}`, icon: '★', actionId: 'replay-run',
  };
  if (stage === 'RESULTS' && selectedMode === 'six-seven') return {
    kicker: `CHALLENGE COMPLETE · PERSONAL BEST ${session.bestScore} REPS`,
    title: 'Your repetition count.',
    copy: `You completed ${runScore()} repetitions. Keep your elbows bent and alternate hand heights. Each fresh pair counts once.`,
    action: 'Try again', foot: `REPS ${runScore()} · PERSONAL BEST ${session.bestScore}`, icon: '67', actionId: 'replay-run',
  };
  if (stage === 'RESULTS' && selectedMode === 'beat-blaster') return {
    kicker: `BLASTER COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: 'Every reach counts.',
    copy: `You hit ${runCleared()} targets and missed ${runMisses()}.`,
    action: 'Run again', foot: `SCORE ${runScore()} · BEST COMBO ${modeEngine.snapshot(session.game.elapsedMs).bestCombo}`, icon: '✦', actionId: 'replay-run',
  };
  if (stage === 'RESULTS' && selectedMode === 'mirror-challenge') return {
    kicker: `MIRROR COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: runCleared() > 0 ? 'You matched the coach.' : 'Let’s practise the poses.',
    copy: `You held ${runCleared()} of ${modeEngine.snapshot(session.game.elapsedMs).poseCueCount} poses and missed ${runMisses()}.`,
    action: 'Run again', foot: `SCORE ${runScore()} · BEST STREAK ${modeEngine.snapshot(session.game.elapsedMs).bestCombo}`, icon: '◉', actionId: 'replay-run',
  };
  if (stage === 'RESULTS' && selectedMode === 'dance-party') return {
    kicker: `DANCE SOLO COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: 'You found your own rhythm.',
    copy: `You matched ${runCleared()} of ${modeEngine.snapshot(session.game.elapsedMs).poseCueCount} full-body poses.`,
    action: 'Dance again', foot: `SCORE ${runScore()} · BEST STREAK ${modeEngine.snapshot(session.game.elapsedMs).bestCombo}`, icon: '✺', actionId: 'replay-run',
  };
  if (stage === 'RESULTS' && selectedMode === 'dance-duo') {
    const duo = modeEngine.snapshot(session.game.elapsedMs);
    return {
      kicker: `DANCE DUO COMPLETE · TEAM BEST ${session.bestScore}`,
      title: 'You moved as a team.',
      copy: `Player 1 scored ${duo.playerOneScore}, Player 2 scored ${duo.playerTwoScore}, and you synchronized ${duo.synchronizedCueCount} phrases.`,
      action: 'Dance again', foot: `TEAM SCORE ${duo.teamScore + duo.playerOneScore + duo.playerTwoScore} · TEAM BONUSES ${duo.teamScore}`, icon: 'Ⅱ', actionId: 'replay-run',
    };
  }
  if (stage === 'RESULTS') return {
    kicker: `RUN COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: 'One more for the road?',
    copy: `You cleared ${runCleared()} waves, with ${runMisses()} collisions.`,
    action: 'Run again', foot: `SCORE ${runScore()} · PERSONAL BEST ${session.bestScore}`, icon: '✦', actionId: 'replay-run',
  };
  if (stage === 'ERROR') return {
    kicker: setupFailure === 'tracking' ? 'CAMERA INTERRUPTED' : setupFailure === 'model' ? 'POSE MODEL SETUP' : 'CAMERA SETUP',
    title: setupFailure === 'tracking' ? 'Camera tracking stopped.' : setupFailure === 'model' ? 'The pose tracker did not load.' : 'We could not get you on course.',
    copy: setupError || 'Check camera permissions, close other camera apps, then try again.',
    action: 'Try again', foot: setupFailure === 'tracking' ? 'RETRY STARTS CAMERA SETUP AGAIN' : 'YOUR CAMERA IMAGE STAYS ON THIS DEVICE', icon: '!', actionId: 'retry-camera',
  };
  return { kicker: '', title: '', copy: '', action: '', foot: '', icon: '', actionId: '' };
}

function renderResultsMetrics() {
  const snapshot = modeEngine.snapshot(session.game.elapsedMs);
  const metrics: [number | string, string][] = selectedMode === 'dance-duo'
    ? [
      [runScore(), 'TEAM SCORE'],
      [snapshot.synchronizedCueCount, 'SYNCED PHRASES'],
      [snapshot.playerOneScore, 'PLAYER 1'],
      [snapshot.playerTwoScore, 'PLAYER 2'],
    ]
    : selectedMode === 'mirror-challenge'
      ? [[runScore(), 'SCORE'], [runCleared(), 'POSES HELD'], [runMisses(), 'MISSED TASKS'], [session.bestScore, 'PERSONAL BEST']]
      : selectedMode === 'dance-party'
        ? [[runScore(), 'SCORE'], [runCleared(), 'POSES HIT'], [runMisses(), 'MISSED CUES'], [session.bestScore, 'PERSONAL BEST']]
        : selectedMode === 'rhythm-run'
          ? [[runScore(), 'SCORE'], [runCleared(), 'STARS CAUGHT'], [runMisses(), 'MISSED STARS'], [session.bestScore, 'PERSONAL BEST']]
          : selectedMode === 'beat-blaster'
            ? [[runScore(), 'SCORE'], [runCleared(), 'TARGETS HIT'], [snapshot.misses, 'MISSES'], [session.bestScore, 'PERSONAL BEST']]
            : selectedMode === 'six-seven'
              ? [[runScore(), 'REPETITIONS'], [session.bestScore, 'PERSONAL BEST']]
              : selectedMode === 'dodge-arena'
                ? [[runScore(), 'SCORE'], [runCleared(), 'WAVES CLEARED'], [snapshot.collisions, 'COLLISIONS'], [session.bestScore, 'PERSONAL BEST']]
                : [[runScore(), 'SCORE'], [runCleared(), 'WAVES CLEARED'], [runMisses(), 'COLLISIONS'], [session.bestScore, 'PERSONAL BEST']];
  return `<div class="results-metrics" data-mode="${selectedMode}">${metrics.map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>`;
}

function startHoldPercent(now: number) {
  return session.startSince < 0 ? 0 : Math.min(100, Math.floor(Math.max(0, now - session.startSince) / C.startHoldMs * 100));
}

function hasFreshBody(now: number) {
  return !!latestAnalysis?.trackingValid && now - latestAnalysis.timestampMs <= C.staleMs;
}

function trackingInstruction(now: number) {
  if (document.hidden) return 'Come back to this tab. Your run is safely paused.';
  if (selectedMode === 'dance-duo' && !duoPlayersReady) {
    const players = latestSample?.players ?? [];
    if (!isDuoPlayerTracked(players[0] ?? [])) return 'Player 1, step into frame. Keep your wrists, hips and feet visible.';
    if (!isDuoPlayerTracked(players[1] ?? [])) return 'Player 2, step into frame. Keep your wrists, hips and feet visible.';
    return 'Both players: keep your full bodies, wrists and feet inside the camera frame.';
  }
  if (selectedMode === 'dance-duo' && session.stage === 'PAUSED' && latestAnalysis?.trackingValid && !latestAnalysis.handsDown) {
    return 'Both players: lower your hands and hold still to resume together.';
  }
  if (selectedMode === 'dance-party' && missingPoseLandmarks(latestSample?.landmarks ?? [], DUO_REQUIRED_LANDMARKS).length > 0) {
    return 'Keep your elbows, wrists, hips and feet inside the camera frame for the dance.';
  }
  if (selectedMode === 'mirror-challenge' && missingPoseLandmarks(latestSample?.landmarks ?? [], MIRROR_REQUIRED_LANDMARKS).length > 0) {
    return 'Keep both elbows, wrists, shoulders and hips inside the camera frame.';
  }
  if (session.stage === 'PAUSED' && hasFreshBody(now) && latestAnalysis && !latestAnalysis.handsDown) {
    if (!latestAnalysis.handsTracked) return 'Bring both hands back into the camera frame to resume.';
    return 'Lower both hands below your shoulders. Hold still to resume.';
  }
  if (hasFreshBody(now)) return 'Body found. Hold your position for a moment. Your run will resume automatically.';
  if (latestAnalysis && now - latestAnalysis.timestampMs > C.staleMs) return 'Waiting for the camera. Keep your head, shoulders and hips in view.';
  return latestAnalysis?.correction?.text ?? 'Keep your head, shoulders and hips inside the camera frame.';
}

function startInstruction(now: number) {
  if (!hasFreshBody(now)) return trackingInstruction(now);
  if (!latestAnalysis?.handsTracked) return latestAnalysis?.correction?.text ?? 'Keep both hands inside the camera frame.';
  if (session.startArmed) return 'Gesture accepted. Lower both hands to start.';
  if (!latestAnalysis.handsUp && latestAnalysis.correction) return latestAnalysis.correction.text;
  return `Raise both hands and hold for one second · ${startHoldPercent(now)}%`;
}

function currentUiKey(now: number) {
  const countdown = session.stage === 'COUNTDOWN' ? Math.ceil((session.countdownEndsAt - now) / 1000) : 0;
  const correctionCode = latestAnalysis?.correction?.code ?? '';
  const target = session.tutorialTarget;
  const beatBlasterHint = session.stage === 'TUTORIAL' && selectedMode === 'beat-blaster'
    && (target === 'BLAST_LEFT' || target === 'BLAST_RIGHT')
    ? blasterTutorialCopy(target, latestSample?.landmarks ?? []).hint
    : '';
  const holdProgress = (session.stage === 'READY' || session.stage === 'RESULTS') && !session.startArmed
    ? Math.floor(startHoldPercent(now) / 10)
    : 0;
  return [session.stage, session.tutorialIndex, session.tutorialSuccess, session.awaitingNeutral, session.startArmed, holdProgress, countdown, correctionCode, beatBlasterHint, hasFreshBody(now)].join(':');
}

function renderOverlay(now: number) {
  const stage = session.stage;
  document.body.dataset.stage = stage;
  document.body.classList.toggle('run-focus', ['COUNTDOWN', 'PLAYING', 'PAUSED', 'RESULTS'].includes(stage));
  const copy = transitionCopy(stage, now);
  if (stage === 'PLAYING') { overlay.innerHTML = ''; overlay.classList.add('is-hidden'); return; }
  overlay.classList.remove('is-hidden');
  const progress = stage === 'CALIBRATION' ? Math.round((latestAnalysis?.calibrationProgress ?? 0) * 100) : 0;
  const holdPercent = session.startArmed ? 100 : startHoldPercent(now);
  const stateClass = stage.toLowerCase();
  overlay.className = `stage-overlay stage-${stateClass}`;
  overlay.innerHTML = `
    <div class="overlay-inner">
      <span class="overlay-icon ${stage === 'COUNTDOWN' ? 'countdown-icon' : ''}" aria-hidden="true">${copy.icon}</span>
      <span class="overlay-kicker">${copy.kicker}</span>
      <h2>${copy.title}</h2>
      <p>${copy.copy}</p>
      ${stage === 'RESULTS' ? renderResultsMetrics() : ''}
      ${stage === 'RESULTS' && selectedMode === 'classic-run' ? `<div class="leaderboard-result-status" id="leaderboard-result-status" data-state="${leaderboardSubmissionKind}" role="status" aria-live="polite">${leaderboardSubmissionMessage || 'Adding your best to the leaderboard…'}</div>` : ''}
      ${stage === 'CALIBRATION' ? `<div class="calibration-track"><i style="width:${progress}%"></i></div>` : ''}
      ${stage === 'RESULTS' ? `<p class="replay-instruction">${startInstruction(now)}</p>` : ''}
      ${stage === 'READY' || stage === 'RESULTS' ? `<div class="hold-track" role="progressbar" aria-label="Hold both hands to start" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${holdPercent}"><i style="width:${holdPercent}%"></i></div>` : ''}
      ${copy.action ? `<button class="primary-action" id="${copy.actionId}"><span>${copy.action}</span><span class="action-arrow" aria-hidden="true">↗</span></button>` : ''}
      <span class="overlay-foot">${copy.foot}</span>
    </div>`;
  if (stage === 'WELCOME') overlay.querySelector('#enable-camera')?.before(characterPicker.element);
  overlay.querySelector<HTMLButtonElement>('#enable-camera')?.addEventListener('click', () => void beginSetup());
  overlay.querySelector<HTMLButtonElement>('#retry-camera')?.addEventListener('click', () => void beginSetup());
  overlay.querySelector<HTMLButtonElement>('#start-run')?.addEventListener('click', () => {
    const now = performance.now();
    if (latestAnalysis && session.requestStart(now, latestAnalysis)) {
      syncModeStage('READY');
      updateUI(now, true);
    }
  });
  overlay.querySelector<HTMLButtonElement>('#replay-run')?.addEventListener('click', () => {
    const now = performance.now();
    if (latestAnalysis && session.requestReplay(now, latestAnalysis)) {
      syncModeStage('RESULTS');
      updateUI(now, true);
    }
  });
}

function setPipeline(analysis: GestureAnalysis | null) {
  const index = session.stage === 'WELCOME' || session.stage === 'LOADING' ? 0
    : session.stage === 'CALIBRATION' ? 1
      : session.stage === 'TUTORIAL' ? 2
        : 3;
  for (const [i, id] of ['pipe-landmarks', 'pipe-normalize', 'pipe-intent', 'pipe-game'].entries()) {
    const step = document.getElementById(id);
    step?.classList.toggle('is-active', i === index);
    step?.classList.toggle('is-done', i < index);
  }
  if (analysis?.trackingValid && session.stage === 'TUTORIAL') {
    coachCount.textContent = `STEP ${session.tutorialIndex + 1} OF ${session.tutorialSteps.length}`;
    coachCopy.textContent = session.awaitingNeutral ? 'Stand upright and lower both hands to continue.' : analysis.correction?.text ?? 'Follow the prompt above, then return to neutral.';
  } else if (session.stage === 'CALIBRATION') {
    coachCount.textContent = 'CALIBRATION · HANDS DOWN';
    coachCopy.textContent = analysis?.correction?.text ?? 'Keep your head, hips and hands visible. Stand still with both hands down for two seconds.';
  } else if (session.stage === 'PLAYING') {
    const poseSnapshot = modeEngine.snapshot(session.game.elapsedMs);
    if (selectedMode === 'dance-duo') {
      coachCount.textContent = `P1 ${poseSnapshot.playerOneScore} · P2 ${poseSnapshot.playerTwoScore} · ${poseSnapshot.synchronizedCueCount} IN SYNC`;
      coachCopy.textContent = `PLAYER 1: ${poseSnapshot.playerOneFeedback || 'Copy the pose.'}  PLAYER 2: ${poseSnapshot.playerTwoFeedback || 'Copy the pose.'}`;
    } else if (selectedMode === 'mirror-challenge' || selectedMode === 'dance-party') {
      const cueNumber = poseSnapshot.poseCueIndex === null ? poseSnapshot.poseCueCount : poseSnapshot.poseCueIndex + 1;
      coachCount.textContent = `${cueNumber} / ${poseSnapshot.poseCueCount} POSES · ${poseSnapshot.combo} STREAK`;
      coachCopy.textContent = poseSnapshot.feedback || (poseSnapshot.poseCueName ? `Copy “${poseSnapshot.poseCueName}”, then hold it steady.` : 'Follow the next full-body pose.');
    } else {
      coachCount.textContent = selectedMode === 'six-seven' ? `${modeEngine.sixSevenCount} REPS` : 'LIVE · YOU ARE IN CONTROL';
      coachCopy.textContent = selectedMode === 'rhythm-run'
      ? modeEngine.snapshot(session.game.elapsedMs).feedback || 'Collect low stars in their lane. Jump for the high stars at the glowing line.'
      : selectedMode === 'beat-blaster'
        ? modeEngine.snapshot(session.game.elapsedMs).feedback || 'Reach with the matching hand, then return your hand to neutral.'
      : selectedMode === 'dodge-arena'
        ? modeEngine.feedback || 'Watch the warning and lean into a clear lane.'
      : selectedMode === 'six-seven'
        ? modeEngine.feedback || 'Raise one hand, switch to the other, then start a fresh pair for one more rep.'
        : 'Lean to choose your lane. Raise both hands to jump.';
    }
  } else if (session.stage === 'PAUSED') {
    coachCount.textContent = 'WAITING FOR YOUR FRAME';
    coachCopy.textContent = trackingInstruction(performance.now());
  } else {
    coachCount.textContent = 'READY WHEN YOU ARE';
    coachCopy.textContent = 'Your coach will guide you through each move.';
  }
  document.querySelector('#move-left')?.classList.toggle('is-current', session.stage === 'TUTORIAL' && session.tutorialIndex === 0);
  document.querySelector('#move-right')?.classList.toggle('is-current', session.stage === 'TUTORIAL' && session.tutorialIndex === 1);
  document.querySelector('#move-jump')?.classList.toggle('is-current', session.stage === 'TUTORIAL' && session.tutorialIndex === 2);
  document.querySelector('#move-left')?.classList.toggle('is-complete', session.tutorialIndex > 0 || session.stage === 'READY' || session.stage === 'PLAYING' || session.stage === 'RESULTS');
  document.querySelector('#move-right')?.classList.toggle('is-complete', session.tutorialIndex > 1 || session.stage === 'READY' || session.stage === 'PLAYING' || session.stage === 'RESULTS');
  document.querySelector('#move-jump')?.classList.toggle('is-complete', session.stage === 'READY' || session.stage === 'PLAYING' || session.stage === 'RESULTS');
}

function cueTitle(move: string) {
  if (move === 'LEAN_LEFT') return 'Lean left';
  if (move === 'LEAN_RIGHT') return 'Lean right';
  if (move === 'HANDS_UP_JUMP') return 'Raise both hands';
  if (move === 'BLAST_LEFT') return 'Reach left';
  if (move === 'BLAST_RIGHT') return 'Reach right';
  return 'Follow the cue';
}

function updateModeHud() {
  root.querySelector<HTMLElement>('#six-seven-guide')!.hidden = selectedMode !== 'six-seven' || session.stage !== 'PLAYING';
  updateDanceGuide();
  const mirrorState = selectedMode === 'mirror-challenge' ? mirrorCoachState(modeEngine.snapshot(session.game.elapsedMs).mirror, session.game.elapsedMs) : null;
  mirrorDialogue.hidden = !mirrorState || session.stage !== 'PLAYING';
  if (mirrorState) {
    mirrorCommand.textContent = mirrorState.instruction;
    root.querySelector<HTMLElement>('#mirror-hint')!.textContent = mirrorState.hint ?? '';
    mirrorPhase.textContent = mirrorState.successful ? 'NICE MATCH!' : mirrorState.phase === 'demo' ? 'WATCH ME' : mirrorState.phase === 'attempt' ? (mirrorState.awaitingNeutral ? 'RESET TOGETHER' : 'YOUR TURN · HOLD THE POSE') : 'NEXT MOVE COMING';
    mirrorDialogue.dataset.phase = mirrorState.phase;
    const progress = mirrorState.successful ? 100 : Math.min(100,Math.round(mirrorState.holdingMs / (mirrorState.awaitingNeutral ? 200 : 500) * 100));
    mirrorHold.setAttribute('aria-valuenow',String(progress));
    mirrorHold.querySelector<HTMLElement>('i')!.style.width = `${progress}%`;
  }
  rhythmGuide.hidden = selectedMode !== 'rhythm-run' || session.stage !== 'PLAYING';
  const isDanceMode = selectedMode === 'dance-party' || selectedMode === 'dance-duo';
  modeCue.hidden = isDanceMode || session.stage !== 'PLAYING' || (!['rhythm-run', 'six-seven', 'mirror-challenge'].includes(selectedMode) && !!latestAnalysis?.correction);
  const definition = availableModes.find(mode => mode.id === selectedMode)!;
  modeCue.dataset.mode = selectedMode;
  modeCueLabel.textContent = definition.title.toUpperCase();
  if (selectedMode === 'rhythm-run' && modeEngine.rhythm) {
    const state = modeEngine.rhythm.snapshot(session.game.elapsedMs);
    const cue = rhythmRunCue(state, session.game.lane, latestAnalysis?.handsDown ?? false, session.game.jumpHeight, latestAnalysis?.handsUp ?? false);
    modeCueIcon.textContent = cue.icon;
    modeCueTitle.textContent = cue.title;
    modeCueLabel.textContent = cue.label;
    modeCue.dataset.tone = cue.tone;
    modeCueScore.textContent = `★ ${state.cleared} / ${state.stars.length}${state.combo > 1 ? ` · ${state.combo}×` : ''}`;
    rhythmBeatDots.forEach((dot, index) => dot.classList.toggle('is-beat', index === Math.floor(state.elapsedMs / 500) % 4));
    return;
  }
  if (selectedMode === 'classic-run') {
    const cue = classicRunCue(session.game, latestAnalysis?.handsDown ?? false);
    const hit = session.game.elapsedMs < collisionFeedbackUntil;
    modeCue.dataset.tone = hit ? 'hit' : cue.tone;
    modeCueIcon.textContent = hit ? '!' : cue.icon;
    modeCueLabel.textContent = hit ? 'OBSTACLE HIT' : 'CLASSIC RUN';
    modeCueTitle.textContent = hit ? 'Tall barriers: change lanes · low barriers: jump or dodge' : cue.text;
    modeCueScore.textContent = '';
    return;
  }
  modeCue.dataset.tone = 'neutral';
  const snapshot = modeEngine.snapshot(session.game.elapsedMs);
  if (selectedMode === 'six-seven') {
    modeCueIcon.textContent = snapshot.feedbackKind === 'good' ? '✓' : '67';
    modeCueTitle.textContent = session.stage === 'PLAYING'
      ? snapshot.feedback || 'Palms up. Lift one hand, then switch their heights.'
      : 'Raise one hand · switch hands · one rep';
    modeCueScore.textContent = `${snapshot.cleared} REP${snapshot.cleared === 1 ? '' : 'S'}`;
    return;
  }
  if (selectedMode === 'dodge-arena') {
    const elapsed = session.game.elapsedMs;
    const nextWave = session.game.waves.find(wave => !wave.resolved);
    const warningAt = nextWave?.warningAtMs ?? (nextWave ? nextWave.atMs - C.wavePreviewMs : undefined);
    const warningActive = nextWave !== undefined && warningAt !== undefined && elapsed >= warningAt;
    const labels: Record<number, string> = { [-1]: 'left', 0: 'center', 1: 'right' };
    if (warningActive && nextWave) {
      const blocked = new Set(nextWave.obstacles.map(obstacle => obstacle.lane));
      const openLanes = ([-1, 0, 1] as const).filter(lane => !blocked.has(lane));
      modeCueTitle.textContent = blocked.size === 1
        ? `Move out of the ${labels[nextWave.obstacles[0].lane]} lane`
        : openLanes.length === 1 ? `Move to the ${labels[openLanes[0]]} lane` : 'Choose a clear lane';
    } else if (nextWave && warningAt !== undefined) {
      const seconds = Math.max(0, Math.ceil((warningAt - elapsed) / 1000));
      modeCueTitle.textContent = `${seconds}s until the next warning`;
    } else {
      modeCueTitle.textContent = 'Arena clear · keep your combo alive';
    }
    modeCue.dataset.tone = warningActive ? 'warning' : 'neutral';
    modeCueIcon.textContent = warningActive ? '!' : '⚡';
    modeCueScore.textContent = `${snapshot.cleared} WAVES · ${snapshot.combo} COMBO`;
    return;
  }
  if (selectedMode === 'beat-blaster') {
    const target = snapshot.blasterHighlight;
    modeCue.dataset.tone = snapshot.feedbackKind;
    modeCueIcon.textContent = snapshot.feedbackKind === 'good' ? '✓' : '✦';
    modeCueTitle.textContent = snapshot.feedback && session.stage === 'PLAYING'
      ? snapshot.feedback
      : target ? `Reach with your ${target.side} hand` : 'Get ready for the next target';
    modeCueScore.textContent = `${snapshot.cleared} / ${modeEngine.chart.length} TARGETS · ${snapshot.combo} COMBO`;
    return;
  }
  if (selectedMode === 'mirror-challenge' || selectedMode === 'dance-party' || selectedMode === 'dance-duo') {
    modeCue.dataset.tone = snapshot.feedbackKind;
    modeCueIcon.textContent = snapshot.feedbackKind === 'good' ? '✓' : selectedMode === 'dance-duo' ? 'Ⅱ' : selectedMode === 'mirror-challenge' ? '◉' : '✺';
    const cueName = snapshot.poseCueName ?? 'Get ready for the next pose';
    modeCueTitle.textContent = snapshot.feedback && session.stage === 'PLAYING'
      ? snapshot.feedback
      : selectedMode === 'mirror-challenge' && snapshot.posePhase === 'demo'
        ? `Watch: ${cueName}`
        : `Copy the pose · ${cueName}`;
    modeCueScore.textContent = selectedMode === 'dance-duo'
      ? `P1 ${snapshot.playerOneScore} · P2 ${snapshot.playerTwoScore} · ${snapshot.synchronizedCueCount} SYNC`
      : `${snapshot.poseCueIndex === null ? snapshot.poseCueCount : snapshot.poseCueIndex + 1} / ${snapshot.poseCueCount} · ${snapshot.combo} STREAK`;
    return;
  }
  const cue = snapshot.activeCue ?? modeEngine.chart.find(item => !item.resolved);
  modeCueIcon.textContent = snapshot.feedbackKind === 'good' ? '✓' : '♫';
  modeCueTitle.textContent = snapshot.feedback && session.stage === 'PLAYING'
    ? snapshot.feedback
    : cue ? `${snapshot.activeCue ? 'MOVE NOW · ' : 'GET READY · '}${cueTitle(cue.move)}` : 'Level complete';
  modeCueScore.textContent = snapshot.combo > 1 ? `${snapshot.combo}× COMBO` : `${snapshot.cleared} / ${modeEngine.chart.length}`;
}

function updateDanceGuide() {
  const isDanceMode = selectedMode === 'dance-party' || selectedMode === 'dance-duo';
  danceGuide.hidden = !isDanceMode || (session.stage !== 'PLAYING' && session.stage !== 'PAUSED');
  if (!isDanceMode) return;

  const snapshot = modeEngine.snapshot(session.game.elapsedMs);
  const state = danceGuideState(snapshot, selectedMode === 'dance-duo' ? 'dance-duo' : 'dance-party');
  danceModeLabel.textContent = state.isDuo ? 'DANCE PARTY · DUO' : 'DANCE PARTY · SOLO';
  danceGuide.dataset.cueIndex = state.cueIndex === null ? '' : String(state.cueIndex);
  danceGuide.dataset.cueId = state.cueId ?? '';
  danceTarget.dataset.cueIndex = danceGuide.dataset.cueIndex;
  danceTarget.dataset.cueId = danceGuide.dataset.cueId;
  danceTarget.textContent = state.targetInstruction;
  danceCueCounter.textContent = state.cueCounter;
  danceProgress.setAttribute('aria-valuemax', String(state.poseCount));
  danceProgress.setAttribute('aria-valuenow', String(state.completedCueCount));
  danceProgress.setAttribute('aria-valuetext', `${state.completedCueCount} of ${state.poseCount} poses completed`);
  danceProgress.querySelector<HTMLElement>('i')!.style.width = `${state.progressPercent}%`;
  danceProgressLabel.textContent = `${state.completedCueCount} ${state.completedCueCount === 1 ? 'POSE' : 'POSES'} COMPLETED`;
  danceSoloCorrection.hidden = state.isDuo;
  danceDuoCorrections.hidden = !state.isDuo;
  danceSoloCorrection.textContent = state.feedback;
  dancePlayerOneCorrection.textContent = state.playerOneFeedback;
  dancePlayerTwoCorrection.textContent = state.playerTwoFeedback;
}

function drawSkeleton(analysis: GestureAnalysis | null) {
  const context = skeletonCanvas.getContext('2d');
  if (!context) return;
  const box = cameraView.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(box.width * pixelRatio));
  const height = Math.max(1, Math.floor(box.height * pixelRatio));
  if (skeletonCanvas.width !== width || skeletonCanvas.height !== height) {
    skeletonCanvas.width = width;
    skeletonCanvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  skeletonCanvas.style.width = `${box.width}px`;
  skeletonCanvas.style.height = `${box.height}px`;
  const poseMode = selectedMode === 'mirror-challenge' || selectedMode === 'dance-party' || selectedMode === 'dance-duo';
  const poseSnapshot = poseMode ? modeEngine.snapshot(session.game.elapsedMs) : null;
  const primaryLandmarks = analysis?.landmarks ?? [];
  const secondaryLandmarks = selectedMode === 'dance-duo' ? partnerAnalysis?.landmarks ?? [] : [];
  const hasPrimary = primaryLandmarks.length >= 33;
  const hasSecondary = secondaryLandmarks.length >= 33;
  if (!hasPrimary && !hasSecondary) {
    cameraView.classList.remove('has-pose');
    highlight.style.display = 'none';
    return;
  }
  cameraView.classList.add('has-pose');
  context.save();
  context.lineCap = 'round';
  drawingUtils ??= new DrawingUtils(context);
  const drawUtils = drawingUtils;
  // DrawingUtils uses backing-canvas pixels. Match the video's centered cover crop
  // without applying devicePixelRatio again to its coordinates.
  const frameWidth = latestSample?.frameWidth || video.videoWidth || width;
  const frameHeight = latestSample?.frameHeight || video.videoHeight || height;
  const scale = Math.max(width / frameWidth, height / frameHeight);
  const transformLandmarks = (source: readonly Landmark[]) => source.map(point => ({
    ...point,
    x: (point.x * frameWidth * scale + (width - frameWidth * scale) / 2) / width,
    y: (point.y * frameHeight * scale + (height - frameHeight * scale) / 2) / height,
  }));
  const drawPose = (source: readonly Landmark[], activeIndexes: readonly number[], tint: string) => {
    const landmarks = transformLandmarks(source);
    const active = new Set(activeIndexes);
    context.shadowColor = active.size ? 'rgba(249, 183, 105, .6)' : tint;
    context.shadowBlur = 9;
    const visiblePoint = (i: number) => {
      const p = landmarks[i];
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.visibility >= C.confidence && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
    };
    drawUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS.filter(connection => visiblePoint(connection.start) && visiblePoint(connection.end)), {
      color: active.size ? 'rgba(251, 191, 128, .88)' : tint,
      lineWidth: Math.max(1.3, box.width * 0.006) * pixelRatio,
    });
    const radius = Math.max(1.6, box.width * 0.008) * pixelRatio;
    drawUtils.drawLandmarks(landmarks.filter((_, index) => visiblePoint(index) && !active.has(index)), {
      color: '#ecfff7', fillColor: tint, radius, lineWidth: 1.4 * pixelRatio,
    });
    drawUtils.drawLandmarks(landmarks.filter((_, index) => visiblePoint(index) && active.has(index)), {
      color: '#fff8ea', fillColor: '#f3b978', radius: radius * 1.28, lineWidth: 1.6 * pixelRatio,
    });
    return landmarks;
  };
  const primaryHighlights = selectedMode === 'dance-duo'
    ? poseSnapshot?.playerOneHighlights ?? []
    : poseMode ? poseSnapshot?.highlightedLandmarkIndexes ?? [] : analysis?.correction?.highlightLandmarks ?? [];
  const secondaryHighlights = poseSnapshot?.playerTwoHighlights ?? [];
  const landmarks = hasPrimary ? drawPose(primaryLandmarks, primaryHighlights, 'rgba(161, 233, 210, .84)') : [];
  if (hasSecondary) drawPose(secondaryLandmarks, secondaryHighlights, 'rgba(132, 208, 237, .88)');
  if (selectedMode === 'beat-blaster') {
    const target = placeBlasterOverlayTarget(modeEngine.snapshot(session.game.elapsedMs).blasterHighlight, {
      width, height, frameWidth, frameHeight,
    });
    drawBlasterTarget(context, target, width, height);
  }
  context.restore();
  const active = primaryHighlights.length ? primaryHighlights : secondaryHighlights;
  const activeLandmarks = primaryHighlights.length ? landmarks : hasSecondary ? transformLandmarks(secondaryLandmarks) : [];
  if (active.length) {
    const critical = activeLandmarks[active.at(-1)!];
    if (critical && Number.isFinite(critical.x) && Number.isFinite(critical.y)) {
      highlight.style.left = `${(1 - critical.x) * 100}%`;
      highlight.style.top = `${critical.y * 100}%`;
      highlight.style.display = 'block';
    }
    else highlight.style.display = 'none';
  } else highlight.style.display = 'none';
}

function updateUI(now: number, force = false) {
  const key = currentUiKey(now);
  if (force || key !== previousUiKey) {
    previousUiKey = key;
    renderOverlay(now);
    setPipeline(latestAnalysis);
    if (session.stage === 'COUNTDOWN') playCue('ready');
  }
  if (now - previousUiAt > 85 || force) {
    previousUiAt = now;
    if (session.stage === 'CALIBRATION') {
      const progress = Math.round((latestAnalysis?.calibrationProgress ?? 0) * 100);
      const bar = overlay.querySelector<HTMLElement>('.calibration-track i');
      const label = overlay.querySelector<HTMLElement>('.overlay-foot');
      if (bar) bar.style.width = `${progress}%`;
      if (label) label.textContent = `${progress}% CALIBRATED`;
    }
    const remaining = Math.max(0, duration - session.game.elapsedMs);
    const seconds = Math.ceil(remaining / 1000);
    timerLabel.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    scoreCaption.textContent = selectedMode === 'six-seven' ? 'REPS' : 'SCORE';
    const score = selectedMode === 'six-seven' ? String(runScore()) : String(runScore()).padStart(3, '0');
    scoreLabel.textContent = score;
    distanceFill.style.transform = `scaleX(${duration > 0 ? session.game.elapsedMs / duration : 0})`;
    const chapter = sampleRoute(session.game.elapsedMs, duration).chapter;
    routeName.textContent = `0${chapter + 1} / ${BIOMES[chapter].name.toUpperCase()} · ${BIOMES[chapter].subtitle.toUpperCase()}`;
    if (runScore() !== previousScore) {
      if (previousScore >= 0) void animate(scoreLabel, { transform: ['scale(1)', 'scale(1.13)', 'scale(1)'] }, { duration: 0.38, ease: 'easeOut' });
      previousScore = runScore();
    }
    const isPoseMode = selectedMode === 'mirror-challenge' || selectedMode === 'dance-party' || selectedMode === 'dance-duo';
    const modeFeedback = isPoseMode ? modeEngine.snapshot(session.game.elapsedMs) : null;
    const correctionText = isPoseMode && modeFeedback?.feedbackKind === 'hint'
      ? modeFeedback.feedback
      : latestAnalysis?.correction?.text;
    const danceGuideOwnsCorrections = (selectedMode === 'dance-party' || selectedMode === 'dance-duo')
      && (session.stage === 'PLAYING' || session.stage === 'PAUSED');
    if (!danceGuideOwnsCorrections && latestAnalysis && now - latestAnalysis.timestampMs <= C.staleMs && correctionText && (session.stage === 'TUTORIAL' || session.stage === 'PLAYING')) {
      toastText.textContent = correctionText;
      toast.hidden = false;
      toast.classList.add('is-visible');
    } else {
      toast.classList.remove('is-visible');
      toast.hidden = true;
    }
    drawSkeleton(latestAnalysis);
    updateModeHud();
    const replayButton = overlay.querySelector<HTMLButtonElement>('#replay-run');
    if (replayButton) replayButton.disabled = !hasFreshBody(now);
    const startButton = overlay.querySelector<HTMLButtonElement>('#start-run');
    if (startButton) startButton.disabled = !hasFreshBody(now) || !latestAnalysis?.calibrated || !latestAnalysis.handsTracked || !latestAnalysis.handsDown;
    refreshModePicker();
    if (selectedMode === 'dance-duo' && session.stage !== 'WELCOME' && session.stage !== 'ERROR' && session.stage !== 'LOADING') {
      cameraStatus.dataset.playerCount = String(duoVisiblePlayers);
      cameraEmpty.hidden = duoVisiblePlayers > 0;
      const status = duoPlayersReady ? 'TWO PLAYERS TRACKED' : duoVisiblePlayers === 1 ? 'ONE PLAYER · BRING YOUR PARTNER IN' : 'WAITING FOR BOTH PLAYERS';
      cameraStatus.innerHTML = `<span class="status-dot ${duoPlayersReady ? 'status-live' : 'status-warning'}"></span><span>${status}</span>`;
    } else if (hasFreshBody(now) && latestAnalysis) {
      delete cameraStatus.dataset.playerCount;
      const status = !latestAnalysis.handsTracked ? (latestAnalysis.calibrated ? 'HANDS OUT OF VIEW · LEAN ACTIVE' : 'KEEP BOTH HANDS IN VIEW') : latestAnalysis.calibrated ? 'BODY TRACKED'
        : !latestAnalysis.handsDown ? 'LOWER BOTH HANDS'
          : latestAnalysis.correction ? 'STAND UPRIGHT AND STILL' : 'HOLD STILL · CALIBRATING';
      cameraStatus.innerHTML = `<span class="status-dot ${latestAnalysis.handsTracked ? 'status-live' : 'status-warning'}"></span><span>${status}</span>`;
      cameraEmpty.hidden = true;
    } else if (session.stage === 'WELCOME' || session.stage === 'ERROR' || session.stage === 'LOADING') {
      delete cameraStatus.dataset.playerCount;
      cameraStatus.innerHTML = `<span class="status-dot"></span><span>${session.stage === 'ERROR' ? 'CAMERA NEEDS ATTENTION' : 'WAITING FOR CAMERA'}</span>`;
    } else {
      delete cameraStatus.dataset.playerCount;
      cameraStatus.innerHTML = '<span class="status-dot status-warning"></span><span>SHOW HEAD, SHOULDERS AND HIPS</span>';
    }
  }
}

function onPoseTick(now: number) {
  if (!latestAnalysis) return;
  const stageBefore = session.stage;
  if (stageBefore === 'CALIBRATION' || stageBefore === 'TUTORIAL' || stageBefore === 'PLAYING' || stageBefore === 'COUNTDOWN' || stageBefore === 'READY' || stageBefore === 'RESULTS' || stageBefore === 'PAUSED') {
    session.tick(now, latestAnalysis);
  }
  syncModeStage(stageBefore);
  if (stageBefore === 'PLAYING' && selectedMode !== 'classic-run' && selectedMode !== 'party-race') {
    const frameElapsedMs = session.game.elapsedMs - Math.max(0, now - latestAnalysis.timestampMs);
    const events = modeEngine.update(
      selectedMode === 'rhythm-run' ? session.game.elapsedMs : frameElapsedMs,
      latestAnalysis,
      null,
      selectedMode === 'beat-blaster' ? makeBeatBlasterInput(latestSample) : undefined,
      selectedMode === 'mirror-challenge' || selectedMode === 'dance-party' || selectedMode === 'dance-duo' ? latestSample ?? undefined : undefined,
      selectedMode === 'rhythm-run' ? { lane:session.game.lane,jumpHeight:session.game.jumpHeight,trackingValid:latestAnalysis.trackingValid } : undefined,
    );
    if (events.includes('clear')) playCue('clear');
  }
  if (stageBefore !== session.stage && session.stage === 'PLAYING') {
    playCue('ready');
    activeRunId++;
    leaderboardSubmissionMessage = '';
  }
  if (stageBefore !== session.stage && session.stage === 'RESULTS') {
    modeEngine.finish();
    void submitCompletedRun();
  }
  playGameCues();
  if (session.stage === 'RESULTS') persistPersonalBest();
  setPipeline(latestAnalysis);
}

function handlePoseSample(sample: PoseSample) {
  const expected = session.stage === 'TUTORIAL' && selectedMode !== 'six-seven' ? session.tutorialTarget : undefined;
  let sessionSample = sample;
  if (selectedMode === 'dance-duo') {
    const detections = sample.players ?? (sample.landmarks.length > 0 ? [sample.landmarks] : []);
    const identified = playerIdentity.update(detections);
    const playerOne = identified.players[0] ? [...identified.players[0].landmarks] : [];
    const playerTwo = identified.players[1] ? [...identified.players[1].landmarks] : [];
    duoVisiblePlayers = Number(isDuoPlayerTracked(playerOne)) + Number(isDuoPlayerTracked(playerTwo));
    duoPlayersReady = duoVisiblePlayers === 2;
    sessionSample = { ...sample, landmarks: playerOne, players: [playerOne, playerTwo] };
    partnerAnalysis = partnerGesture.update({ ...sessionSample, landmarks: playerTwo }, expected);
  } else {
    duoVisiblePlayers = 0;
    duoPlayersReady = false;
    partnerAnalysis = null;
  }
  latestSample = sessionSample;
  let analysis = gesture.update(sessionSample, expected);
  if (selectedMode === 'dance-duo') {
    const bothGestureStates = duoPlayersReady && partnerAnalysis?.trackingValid;
    analysis = {
      ...analysis,
      trackingValid: analysis.trackingValid && !!bothGestureStates,
      handsTracked: analysis.handsTracked && !!partnerAnalysis?.handsTracked,
      handsDown: analysis.handsDown && !!partnerAnalysis?.handsDown,
      handsUp: analysis.handsUp && !!partnerAnalysis?.handsUp,
      correction: duoPlayersReady ? analysis.correction
        : { code: 'duo-player-missing', text: trackingInstruction(performance.now()), highlightLandmarks: [] },
    };
  } else if (selectedMode === 'dance-party') {
    const missing = missingPoseLandmarks(sessionSample.landmarks, DUO_REQUIRED_LANDMARKS);
    if (missing.length > 0) {
      analysis = {
        ...analysis,
        trackingValid: false,
        correction: { code: 'dance-full-body-framing', text: 'Keep your elbows, wrists, hips and feet inside the camera frame.', highlightLandmarks: missing },
      };
    }
  } else if (selectedMode === 'mirror-challenge') {
    const missing = missingPoseLandmarks(sessionSample.landmarks, MIRROR_REQUIRED_LANDMARKS);
    if (missing.length > 0) {
      analysis = {
        ...analysis,
        trackingValid: false,
        correction: { code: 'mirror-arm-framing', text: 'Keep both elbows, wrists, shoulders and hips inside the camera frame.', highlightLandmarks: missing },
      };
    }
  }
  // Six Seven requires one raised hand. Generic jump coaching would request the
  // opposite hand too and hide this mode's own next-step cue during a valid move.
  if ((selectedMode === 'six-seven' && ['TUTORIAL', 'PLAYING'].includes(session.stage)
    || selectedMode === 'mirror-challenge' && session.stage === 'PLAYING')
    && analysis.correction && ['left-hand', 'right-hand', 'both-hands', 'lean-left', 'lean-right'].includes(analysis.correction.code)) {
    analysis = { ...analysis, correction: null };
  }
  latestAnalysis = analysis;
  const now = performance.now();
  onPoseTick(now);
  if (latestAnalysis.jumpTriggered) playCue('jump');
  if (session.game.lane !== previousLane) {
    tone(260 + session.game.lane * 65, 0.07, 'sine', 0.018);
    previousLane = session.game.lane;
  }
  updateUI(now);
}

let collisionFeedbackUntil = -Infinity;
function playGameCues() {
  if (session.game.cleared > previousCleared) playCue('clear');
  if (session.game.collisions > previousCollisions) {
    playCue('hit');
    collisionFeedbackUntil = session.game.elapsedMs + 1000;
  }
  previousCleared = session.game.cleared;
  previousCollisions = session.game.collisions;
}

function loop(now: number) {
  const dt = previousAnimationTime ? Math.min(100, now - previousAnimationTime) : 0;
  previousAnimationTime = now;
  if (latestAnalysis && ['PLAYING', 'COUNTDOWN', 'READY', 'RESULTS', 'PAUSED'].includes(session.stage)) {
    const stageBefore = session.stage;
    session.tick(now, latestAnalysis);
    syncModeStage(stageBefore);
    if (stageBefore !== session.stage && session.stage === 'PLAYING') {
      playCue('ready');
      activeRunId++;
      leaderboardSubmissionMessage = '';
    }
    if (stageBefore !== session.stage && session.stage === 'RESULTS') {
      modeEngine.finish();
      void submitCompletedRun();
    }
    playGameCues();
    if (session.stage === 'RESULTS') persistPersonalBest();
  }
  const previewPose = latestAnalysis && now - latestAnalysis.timestampMs <= C.staleMs ? latestAnalysis : undefined;
  const mirrorState = selectedMode === 'mirror-challenge' ? mirrorCoachState(modeEngine.snapshot(session.game.elapsedMs).mirror, session.game.elapsedMs) : undefined;
  mirrorVoice.update(mirrorState ?? null, session.stage === 'PLAYING' && !session.game.paused && !document.hidden);
  const danceCueIndex = selectedMode === 'dance-party' || selectedMode === 'dance-duo'
    ? dancePresentationCueIndex(session.stage, modeEngine.snapshot(session.game.elapsedMs).poseCueIndex)
    : undefined;
  world?.update(session.stage, session.game, dt, previewPose, modeEngine.rhythm?.snapshot(session.game.elapsedMs), mirrorState,
    selectedMode === 'six-seven' ? { elapsedMs: session.game.elapsedMs, count: modeEngine.sixSevenCount } : undefined,
    danceCueIndex);
  updateUI(now);
  requestAnimationFrame(loop);
}

window.addEventListener('visibilitychange', () => {
  const previousStage = session.stage;
  session.setTabHidden(document.visibilityState === 'hidden');
  if (document.hidden) mirrorVoice.update(null, false);
  syncModeStage(previousStage);
  updateUI(performance.now(), true);
});
window.addEventListener('beforeunload', () => { tracker?.stop(); world?.dispose(); mirrorVoice.dispose(); audio?.close(); });
window.addEventListener('resize', () => drawSkeleton(latestAnalysis));
void refreshLeaderboard();
requestAnimationFrame(loop);
