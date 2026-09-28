import { animate } from 'motion';
import { DrawingUtils, PoseLandmarker } from '@mediapipe/tasks-vision';
import { CONFIG as C, GestureEngine, SessionController } from '@motion-runner/game';
import type { Correction, GestureAnalysis, PoseSample, Stage } from '@motion-runner/game';
import { RunnerWorld } from './presentation/world';
import { CharacterPicker } from './presentation/character-picker';
import { PoseTracker } from './vision/pose-tracker';

const BEST_KEY = 'motion-runner-best';
const root = document.querySelector<HTMLElement>('#app')!;
const duration = import.meta.env.DEV && new URLSearchParams(location.search).get('dev') === '1'
  ? C.developmentDurationMs
  : C.durationMs;
const session = new SessionController(duration);
const gesture = new GestureEngine();
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
    <div class="topbar-right"><span class="edition">FIELD TEST 001</span><span class="edition-dev" id="dev-badge"></span></div>
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

    <section class="experience" aria-label="Motion Runner game">
      <div class="game-panel">
        <canvas id="game-world" aria-label="Three-dimensional runner track"></canvas>
        <div class="scene-vignette" aria-hidden="true"></div>
        <div class="game-topline">
          <div class="game-wordmark"><span class="runner-glyph">MR</span><span>SKYWAY<br><small>ENDLESS CITY RUN</small></span></div>
          <div class="run-hud" aria-label="Game status">
            <div class="hud-chip"><span class="hud-label">TIME</span><strong id="timer">01:00</strong></div>
            <div class="hud-chip score-chip"><span class="hud-label">SCORE</span><strong id="score">000</strong></div>
          </div>
        </div>
        <div class="lane-guide" aria-hidden="true"><span>01</span><i></i><span>02</span><i></i><span>03</span></div>
        <div class="game-bottomline">
          <div class="distance-track"><span id="distance-fill"></span></div>
          <div class="world-caption"><span class="world-caption-dot"></span><span>UPTOWN · MORNING LOOP</span><span id="fps-label">POSE 20HZ</span></div>
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
        <div class="privacy-foot"><span class="privacy-lock">▣</span><span>Video stays on this device.<br>Only your best score is saved.</span></div>
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
const timerLabel = root.querySelector<HTMLElement>('#timer')!;
const distanceFill = root.querySelector<HTMLElement>('#distance-fill')!;
const cameraStatus = root.querySelector<HTMLElement>('#camera-status')!;
const cameraEmpty = root.querySelector<HTMLElement>('#camera-empty')!;
const coachCount = root.querySelector<HTMLElement>('#coach-count')!;
const coachCopy = root.querySelector<HTMLElement>('#coach-copy')!;
const toast = root.querySelector<HTMLElement>('#correction-toast')!;
const toastText = root.querySelector<HTMLElement>('#correction-text')!;
const highlight = root.querySelector<HTMLElement>('#skeleton-highlight')!;
const devBadge = root.querySelector<HTMLElement>('#dev-badge')!;
const cameraView = root.querySelector<HTMLElement>('#camera-view')!;

const durationMinutesLabel = duration === C.developmentDurationMs ? 'DEV RUN' : '60 SEC RUN';
if (duration !== C.durationMs) devBadge.textContent = durationMinutesLabel;
try {
  const storedBest = Number(localStorage.getItem(BEST_KEY));
  session.bestScore = Number.isFinite(storedBest) && storedBest > 0 ? storedBest : 0;
} catch { /* Storage can be disabled; the round remains playable. */ }
let persistedBest = session.bestScore;

let world: RunnerWorld | null = null;
let tracker: PoseTracker | null = null;
let latestAnalysis: GestureAnalysis | null = null;
let latestSample: PoseSample | null = null;
let drawingUtils: DrawingUtils | null = null;
let audio: AudioContext | null = null;
let previousAnimationTime = 0;
let previousUiAt = 0;
let previousUiKey = '';
let previousScore = -1;
let previousLane = 0;
let setupError = '';
let setupFailure: 'camera' | 'model' = 'camera';
let assetMessage = 'Loading the city';
let previousCleared = 0;
let previousCollisions = 0;

function isLoading() { return session.stage === 'LOADING'; }

function persistPersonalBest() {
  // SessionController has already updated bestScore when it enters RESULTS.
  if (session.bestScore <= persistedBest) return;
  try { localStorage.setItem(BEST_KEY, String(session.bestScore)); } catch { /* Storage is optional. */ }
  persistedBest = session.bestScore;
}

try {
  world = new RunnerWorld(sceneCanvas, (message, animations = []) => {
    assetMessage = message;
    document.body.dataset.runnerAssets = message;
    document.body.dataset.runnerAnimations = animations.join(',');
  });
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
  initialiseAudio();
  gesture.reset();
  latestAnalysis = null;
  latestSample = null;
  setupError = '';
  setupFailure = 'camera';
  session.restartSetup();
  session.startLoading();
  cameraView.classList.remove('camera-live');
  updateUI(performance.now(), true);
  const preview = document.querySelector<HTMLElement>('.camera-preview-placeholder');
  preview?.remove();
  tracker = new PoseTracker(video, sample => {
    handlePoseSample(sample);
  }, message => {
    setupFailure = 'model';
    setupError = message;
    session.cameraFailed();
    tracker?.stop();
    cameraView.classList.remove('camera-live');
    updateUI(performance.now(), true);
  });
  try {
    await tracker.start();
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

function transitionCopy(stage: Stage, now: number) {
  const analysis = latestAnalysis;
  if (stage === 'WELCOME') return {
    kicker: 'BEFORE YOU RUN', title: 'A little room to move.',
    copy: 'We use your laptop camera to read a few body landmarks. Stand back so your head, shoulders and hips are in view.',
    action: 'Enable camera', foot: 'CAMERA + SOUND START TOGETHER', icon: '◎', actionId: 'enable-camera',
  };
  if (stage === 'LOADING') return {
    kicker: 'GETTING THE COURSE READY', title: 'Warming up the city.',
    copy: `${assetMessage}. Camera frames are analysed on this device and never uploaded.`,
    action: '', foot: 'FIRST LOAD MAY TAKE A FEW SECONDS', icon: '✳', actionId: '',
  };
  if (stage === 'CALIBRATION') return {
    kicker: '01 / FIND YOUR NEUTRAL', title: 'Stand tall and easy.',
    copy: analysis?.correction?.text ?? 'Lower your hands, stand upright and hold still for two seconds. Calibration starts automatically, then we will practise three moves.',
    action: '', foot: `${Math.round((analysis?.calibrationProgress ?? 0) * 100)}% CALIBRATED`, icon: '⌁', actionId: '',
  };
  if (stage === 'TUTORIAL') {
    if (session.awaitingNeutral) return {
      kicker: 'MOVE RECOGNIZED', title: 'Return to neutral.',
      copy: 'Stand upright in the center and lower both hands to continue to the next move.',
      action: '', foot: 'HANDS DOWN · SHOULDERS ABOVE HIPS', icon: '✓', actionId: '',
    };
    const titles = ['Lean into the left lane.', 'Now find the right lane.', 'Lift off with both hands.'];
    const copies = [
      'Move your shoulders a little to your left. Follow the cue in your camera preview.',
      'Shift back through center, then lean your shoulders to the right.',
      'Bring both hands above your head. Make space above your head in the camera frame.',
    ];
    const corrections = analysis?.correction?.text;
    return {
      kicker: `MOVEMENT LAB · 0${session.tutorialIndex + 1} / 03`,
      title: session.tutorialSuccess ? 'That is the move.' : titles[session.tutorialIndex],
      copy: session.tutorialSuccess ? 'Nice and clear. Return to neutral to continue.' : corrections ?? copies[session.tutorialIndex],
      action: '', foot: session.tutorialSuccess ? '✓ MOVE RECOGNIZED' : 'TRY IT WHEN YOU ARE READY', icon: session.tutorialSuccess ? '✓' : '↗', actionId: '',
    };
  }
  if (stage === 'READY') return {
    kicker: 'ALL SET · HOLD TO START',
    title: session.startArmed ? 'Great. Hands down.' : 'Raise both hands.',
    copy: session.startArmed ? 'Lower your hands when you are ready. We will count you in.' : 'Hold them up together for one second. Your run begins only when you lower them.',
    action: '', foot: session.startArmed ? 'LOWER HANDS TO COUNT IN' : `${startHoldPercent(now)}% · HOLD BOTH HANDS HIGH`, icon: '↑', actionId: '',
  };
  if (stage === 'COUNTDOWN') {
    const count = Math.max(1, Math.ceil((session.countdownEndsAt - now) / 1000));
    return { kicker: 'GET INTO POSITION', title: `${count}`, copy: 'Keep your hands down. Find your lane.', action: '', foot: 'RUN STARTING', icon: '◷', actionId: '' };
  }
  if (stage === 'PAUSED') return {
    kicker: 'QUICK RESET', title: 'Find your frame again.',
    copy: document.visibilityState === 'hidden' ? 'Come back to this tab. Your run is safely paused.' : 'Step into view and lower both hands. We will hold your place and count you back in.',
    action: '', foot: 'SCORE + COURSE PAUSED', icon: '⌑', actionId: '',
  };
  if (stage === 'RESULTS') return {
    kicker: `RUN COMPLETE · PERSONAL BEST ${session.bestScore}`,
    title: 'One more for the road?',
    copy: `You cleared ${session.game.cleared} waves, with ${session.game.collisions} collisions. Raise both hands for one second and lower to run again.`,
    action: '', foot: `SCORE ${session.game.score} · PERSONAL BEST ${session.bestScore}`, icon: '✦', actionId: '',
  };
  if (stage === 'ERROR') return {
    kicker: setupFailure === 'model' ? 'POSE MODEL SETUP' : 'CAMERA SETUP',
    title: setupFailure === 'model' ? 'The pose tracker did not load.' : 'We could not get you on course.',
    copy: setupError || 'Check camera permissions, close other camera apps, then try again.',
    action: 'Try again', foot: 'YOUR CAMERA IMAGE STAYS ON THIS DEVICE', icon: '!', actionId: 'retry-camera',
  };
  return { kicker: '', title: '', copy: '', action: '', foot: '', icon: '', actionId: '' };
}

function startHoldPercent(now: number) {
  return session.startSince < 0 ? 0 : Math.min(100, Math.floor(Math.max(0, now - session.startSince) / C.startHoldMs * 100));
}

function currentUiKey(now: number) {
  const countdown = session.stage === 'COUNTDOWN' ? Math.ceil((session.countdownEndsAt - now) / 1000) : 0;
  const correctionCode = latestAnalysis?.correction?.code ?? '';
  const holdProgress = session.stage === 'READY' && !session.startArmed
    ? Math.floor(startHoldPercent(now) / 10)
    : 0;
  return [session.stage, session.tutorialIndex, session.tutorialSuccess, session.awaitingNeutral, session.startArmed, holdProgress, countdown, correctionCode].join(':');
}

function renderOverlay(now: number) {
  const stage = session.stage;
  const copy = transitionCopy(stage, now);
  if (stage === 'PLAYING') { overlay.innerHTML = ''; overlay.classList.add('is-hidden'); return; }
  overlay.classList.remove('is-hidden');
  const progress = stage === 'CALIBRATION' ? Math.round((latestAnalysis?.calibrationProgress ?? 0) * 100) : 0;
  const holdPercent = stage === 'READY' && !session.startArmed ? startHoldPercent(now) : 0;
  const stateClass = stage.toLowerCase();
  overlay.className = `stage-overlay stage-${stateClass}`;
  overlay.innerHTML = `
    <div class="overlay-inner">
      <span class="overlay-icon ${stage === 'COUNTDOWN' ? 'countdown-icon' : ''}" aria-hidden="true">${copy.icon}</span>
      <span class="overlay-kicker">${copy.kicker}</span>
      <h2>${copy.title}</h2>
      <p>${copy.copy}</p>
      ${stage === 'RESULTS' ? `<div class="results-metrics"><div><strong>${session.game.score}</strong><span>SCORE</span></div><div><strong>${session.game.cleared}</strong><span>WAVES CLEARED</span></div><div><strong>${session.game.collisions}</strong><span>COLLISIONS</span></div><div><strong>${session.bestScore}</strong><span>PERSONAL BEST</span></div></div>` : ''}
      ${stage === 'CALIBRATION' ? `<div class="calibration-track"><i style="width:${progress}%"></i></div>` : ''}
      ${stage === 'READY' && !session.startArmed ? `<div class="hold-track"><i style="width:${holdPercent}%"></i></div>` : ''}
      ${copy.action ? `<button class="primary-action" id="${copy.actionId}"><span>${copy.action}</span><span class="action-arrow">↗</span></button>` : ''}
      <span class="overlay-foot">${copy.foot}</span>
    </div>`;
  if (stage === 'WELCOME') overlay.querySelector('#enable-camera')?.before(characterPicker.element);
  overlay.querySelector<HTMLButtonElement>('#enable-camera')?.addEventListener('click', () => void beginSetup());
  overlay.querySelector<HTMLButtonElement>('#retry-camera')?.addEventListener('click', () => void beginSetup());
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
    coachCount.textContent = `STEP ${session.tutorialIndex + 1} OF 3`;
    coachCopy.textContent = session.awaitingNeutral ? 'Stand upright and lower both hands to continue.' : analysis.correction?.text ?? 'Follow the prompt above, then return to neutral.';
  } else if (session.stage === 'CALIBRATION') {
    coachCount.textContent = 'CALIBRATION · HANDS DOWN';
    coachCopy.textContent = analysis?.correction?.text ?? 'Keep your head, hips and hands visible. Stand still with both hands down for two seconds.';
  } else if (session.stage === 'PLAYING') {
    coachCount.textContent = 'LIVE · YOU ARE IN CONTROL';
    coachCopy.textContent = 'Lean to choose your lane. Raise both hands to jump.';
  } else if (session.stage === 'PAUSED') {
    coachCount.textContent = 'WAITING FOR YOUR FRAME';
    coachCopy.textContent = 'Your score and course are paused. Step back into view.';
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
  if (!analysis?.trackingValid || analysis.landmarks.length < 33) {
    cameraView.classList.remove('has-pose');
    highlight.style.display = 'none';
    return;
  }
  cameraView.classList.add('has-pose');
  context.save();
  context.lineCap = 'round';
  drawingUtils ??= new DrawingUtils(context);
  // DrawingUtils uses backing-canvas pixels. Match the video's centered cover crop
  // without applying devicePixelRatio again to its coordinates.
  const frameWidth = latestSample?.frameWidth || video.videoWidth || width;
  const frameHeight = latestSample?.frameHeight || video.videoHeight || height;
  const scale = Math.max(width / frameWidth, height / frameHeight);
  const landmarks = analysis.landmarks.map(point => ({
    ...point,
    x: (point.x * frameWidth * scale + (width - frameWidth * scale) / 2) / width,
    y: (point.y * frameHeight * scale + (height - frameHeight * scale) / 2) / height,
  }));
  const active = analysis.correction?.highlightLandmarks ?? [];
  context.shadowColor = active.length ? 'rgba(249, 183, 105, .6)' : 'rgba(148, 239, 212, .45)';
  context.shadowBlur = 9;
  drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: active.length ? 'rgba(251, 191, 128, .88)' : 'rgba(161, 233, 210, .82)',
    lineWidth: Math.max(1.3, box.width * 0.006) * pixelRatio,
  });
  drawingUtils.drawLandmarks(landmarks, {
    color: '#ecfff7', fillColor: active.length ? '#f3b978' : '#a4e8cc',
    radius: Math.max(1.6, box.width * 0.008) * pixelRatio, lineWidth: 1.4 * pixelRatio,
  });
  context.restore();
  if (active.length) {
    const critical = landmarks[active.at(-1)!];
    if (critical) {
      highlight.style.left = `${(1 - critical.x) * 100}%`;
      highlight.style.top = `${critical.y * 100}%`;
      highlight.style.display = 'block';
    }
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
    const score = String(session.game.score).padStart(3, '0');
    scoreLabel.textContent = score;
    distanceFill.style.transform = `scaleX(${duration > 0 ? session.game.elapsedMs / duration : 0})`;
    if (session.game.score !== previousScore) {
      if (previousScore >= 0) void animate(scoreLabel, { transform: ['scale(1)', 'scale(1.13)', 'scale(1)'] }, { duration: 0.38, ease: 'easeOut' });
      previousScore = session.game.score;
    }
    if (latestAnalysis?.trackingValid && now - latestAnalysis.timestampMs <= C.staleMs && latestAnalysis.correction && (session.stage === 'TUTORIAL' || session.stage === 'PLAYING')) {
      toastText.textContent = latestAnalysis.correction.text;
      toast.hidden = false;
      toast.classList.add('is-visible');
    } else {
      toast.classList.remove('is-visible');
      toast.hidden = true;
    }
    drawSkeleton(latestAnalysis);
    if (latestAnalysis?.trackingValid) {
      const status = latestAnalysis.calibrated ? 'BODY TRACKED'
        : !latestAnalysis.handsDown ? 'LOWER BOTH HANDS'
          : latestAnalysis.correction ? 'STAND UPRIGHT AND STILL' : 'HOLD STILL · CALIBRATING';
      cameraStatus.innerHTML = `<span class="status-dot status-live"></span><span>${status}</span>`;
      cameraEmpty.hidden = true;
    } else if (session.stage === 'WELCOME' || session.stage === 'ERROR' || session.stage === 'LOADING') {
      cameraStatus.innerHTML = `<span class="status-dot"></span><span>${session.stage === 'ERROR' ? 'CAMERA NEEDS ATTENTION' : 'WAITING FOR CAMERA'}</span>`;
    } else {
      cameraStatus.innerHTML = '<span class="status-dot status-warning"></span><span>STEP BACK INTO FRAME</span>';
    }
  }
}

function onPoseTick(now: number) {
  if (!latestAnalysis) return;
  const stageBefore = session.stage;
  if (stageBefore === 'CALIBRATION' || stageBefore === 'TUTORIAL' || stageBefore === 'PLAYING' || stageBefore === 'COUNTDOWN' || stageBefore === 'READY' || stageBefore === 'RESULTS' || stageBefore === 'PAUSED') {
    session.tick(now, latestAnalysis);
  }
  if (stageBefore !== session.stage && session.stage === 'PLAYING') playCue('ready');
  playGameCues();
  if (session.stage === 'RESULTS') persistPersonalBest();
  setPipeline(latestAnalysis);
}

function handlePoseSample(sample: PoseSample) {
  const expected = session.stage === 'TUTORIAL' ? session.tutorialTarget : undefined;
  latestSample = sample;
  latestAnalysis = gesture.update(sample, expected);
  const now = performance.now();
  onPoseTick(now);
  if (latestAnalysis.jumpTriggered) playCue('jump');
  if (session.game.lane !== previousLane) {
    tone(260 + session.game.lane * 65, 0.07, 'sine', 0.018);
    previousLane = session.game.lane;
  }
  updateUI(now);
}

function playGameCues() {
  if (session.game.cleared > previousCleared) playCue('clear');
  if (session.game.collisions > previousCollisions) playCue('hit');
  previousCleared = session.game.cleared;
  previousCollisions = session.game.collisions;
}

function loop(now: number) {
  const dt = previousAnimationTime ? Math.min(100, now - previousAnimationTime) : 0;
  previousAnimationTime = now;
  if (latestAnalysis && ['PLAYING', 'COUNTDOWN', 'READY', 'RESULTS', 'PAUSED'].includes(session.stage)) {
    const stageBefore = session.stage;
    session.tick(now, latestAnalysis);
    if (stageBefore !== session.stage && session.stage === 'PLAYING') playCue('ready');
    playGameCues();
    if (session.stage === 'RESULTS') persistPersonalBest();
  }
  const previewPose = latestAnalysis && now - latestAnalysis.timestampMs <= C.staleMs ? latestAnalysis : undefined;
  world?.update(session.stage, session.game, dt, previewPose);
  updateUI(now);
  requestAnimationFrame(loop);
}

window.addEventListener('visibilitychange', () => {
  session.setTabHidden(document.visibilityState === 'hidden');
  updateUI(performance.now(), true);
});
window.addEventListener('beforeunload', () => { tracker?.stop(); world?.dispose(); audio?.close(); });
window.addEventListener('resize', () => drawSkeleton(latestAnalysis));
requestAnimationFrame(loop);
