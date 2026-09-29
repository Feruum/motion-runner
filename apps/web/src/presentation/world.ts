import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing';
import { BatchedRenderer, ConstantColor, ConstantValue, ParticleEmitter, ParticleSystem, PointEmitter, Vector4 } from 'three.quarks';
import { CONFIG as C } from '@motion-runner/game';
import type { GameEngine, GestureAnalysis, Stage } from '@motion-runner/game';
import { CHARACTERS } from './characters';
import type { CharacterId } from './characters';
import { JourneyEnvironment } from './environment';
import { wrapSceneryZ } from './route';
import { RhythmStarsPresentation } from './rhythm-stars';
import type { RhythmSnapshot } from '../../../../packages/game/src/core/rhythm-types';
import { MirrorCoachPresentation } from './mirror-coach';
import type { MirrorCoachState } from './mirror-coach-state';

const laneX = [-2.75, 0, 2.75];
const trackTileLength = 5.2;

function asset(path: string) { return `${import.meta.env.BASE_URL}${path}`; }

export class RunnerWorld {
  readonly ready: Promise<void>;
  private readonly characterModels = new Map<CharacterId, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  private characterClips: THREE.AnimationClip[] = [];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 240);
  private readonly environment: JourneyEnvironment;
  private readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private readonly loader = new GLTFLoader();
  private readonly root = new THREE.Group();
  private readonly floor = new THREE.Group();
  private readonly moving = new THREE.Group();
  private readonly actor = new THREE.Group();
  private readonly rhythmStars = new RhythmStarsPresentation();
  private readonly mirrorCoach = new MirrorCoachPresentation();
  private readonly tiles: THREE.Object3D[] = [];
  private readonly obstacleGroups = new Map<number, THREE.Group>();
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly resizeObserver: ResizeObserver;
  private readonly particleBatch = new BatchedRenderer();
  private readonly particles: { emitter: ParticleEmitter; system: ParticleSystem }[] = [];
  private readonly platformFallback = new THREE.Mesh(
    new THREE.BoxGeometry(4, 0.45, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x3b9d9b, roughness: 0.62, metalness: 0.05 }),
  );
  private readonly tallFallback = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 2.2, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xf17663, roughness: 0.4 }),
  );
  private readonly lowFallback = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.52, 0.75),
    new THREE.MeshStandardMaterial({ color: 0x55e2bf, roughness: 0.4 }),
  );
  private platformModel: THREE.Object3D | null = null;
  private lowModel: THREE.Object3D | null = null;
  private highModel: THREE.Object3D | null = null;
  private starModel: THREE.Object3D | null = null;
  private character: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentActionName = '';
  private currentJumpMs = -Infinity;
  private reactionUntilMs = -Infinity;
  private elapsedMs = 0;
  private targetX = 0;
  private cameraCoachMix = 0;
  private danceModeSelected = false;
  private dancePresentationActive = false;
  private destroyed = false;
  private lastSuccessCount = 0;
  private lastHitCount = 0;
  private previousStage: Stage = 'WELCOME';
  private wasAirborne = false;
  private lastFootstepMs = 0;
  private reducedQuality = false;
  private qualityFrames = 0;
  private qualityFrameTime = 0;
  private previewTimeMs = 0;
  private previewJumpStartedMs = -Infinity;
  private previewPoseTime = -1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onAssetProgress: (label: string, animationNames?: string[]) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene.background = new THREE.Color(0x20333c);
    this.scene.fog = new THREE.Fog(0x20333c, 25, 60);
    this.scene.add(this.root);
    this.root.add(this.floor, this.moving, this.actor, this.particleBatch, this.rhythmStars.group, this.mirrorCoach.group);
    this.environment = new JourneyEnvironment(this.scene, canvas);
    this.buildTrackFallback();
    this.buildParticles();
    this.camera.position.set(0, 4.8, 10.8);
    this.camera.lookAt(0, 1.4, -18);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.ready = Promise.all([this.loadModels(), this.environment.ready]).then(() => undefined);
    this.render();
  }

  update(
    stage: Stage,
    game: GameEngine,
    frameDeltaMs: number,
    pose?: GestureAnalysis,
    rhythm?: RhythmSnapshot,
    mirrorCoachState?: MirrorCoachState,
    sixSevenPresentation?: { elapsedMs: number; count: number },
    danceCueIndex?: number | null,
  ): void {
    if (this.destroyed) return;
    const mirrorMode = mirrorCoachState !== undefined
      && (stage === 'COUNTDOWN' || stage === 'PLAYING' || stage === 'PAUSED' || stage === 'RESULTS');
    const sixSevenMode = sixSevenPresentation !== undefined
      && (stage === 'COUNTDOWN' || stage === 'PLAYING' || stage === 'PAUSED' || stage === 'RESULTS');
    const danceMode = this.danceModeSelected
      && (stage === 'COUNTDOWN' || stage === 'PLAYING' || stage === 'PAUSED' || stage === 'RESULTS');
    if (danceMode !== this.dancePresentationActive) {
      this.dancePresentationActive = danceMode;
      this.mirrorCoach.setDanceMode(danceMode);
    }
    const presenterMode = mirrorMode || sixSevenMode || danceMode;
    const visibleMirrorState = mirrorMode
      ? stage === 'COUNTDOWN'
        ? { ...mirrorCoachState, action: 'NEUTRAL' as const, awaitingNeutral: true }
        : mirrorCoachState
      : null;
    const visibleCoachAction = visibleMirrorState && !visibleMirrorState.awaitingNeutral && visibleMirrorState.phase !== 'complete'
      ? visibleMirrorState.action
      : mirrorMode ? 'NEUTRAL' : '';
    this.actor.visible = !presenterMode;
    this.canvas.dataset.mirrorCoachVisible = String(mirrorMode);
    this.canvas.dataset.mirrorCoachAction = visibleCoachAction;
    this.canvas.dataset.mirrorCoachPhase = visibleMirrorState?.phase ?? '';
    this.canvas.dataset.sixSevenVisible = String(sixSevenMode);
    this.canvas.dataset.sixSevenCount = sixSevenMode ? String(sixSevenPresentation.count) : '';
    this.canvas.dataset.danceVisible = String(danceMode);
    this.canvas.dataset.danceCueIndex = danceMode && danceCueIndex !== null && danceCueIndex !== undefined ? String(danceCueIndex) : '';
    if (this.character) this.character.rotation.y = stage === 'WELCOME' || stage === 'RESULTS' ? 0 : Math.PI;
    if (game.elapsedMs < this.elapsedMs || (stage === 'COUNTDOWN' && this.previousStage !== stage && game.elapsedMs === 0)) {
      this.rhythmStars.reset();
      this.currentJumpMs = -Infinity;
      this.reactionUntilMs = -Infinity;
      this.lastHitCount = 0;
      this.lastSuccessCount = 0;
      this.lastFootstepMs = 0;
      this.wasAirborne = false;
    }
    if (!presenterMode && stage === 'RESULTS' && this.previousStage !== stage) this.burst(0, 2, C.runnerZ, 36);
    this.previousStage = stage;
    this.elapsedMs = game.elapsedMs;
    const frozen = stage === 'PAUSED' || ((stage === 'COUNTDOWN' || stage === 'PLAYING') && game.paused);
    const dt = frozen ? 0 : Math.min(0.1, Math.max(0, frameDeltaMs / 1000));
    if (danceMode) this.mirrorCoach.updateDance(danceCueIndex ?? null, dt, frozen);
    else if (mirrorMode) this.mirrorCoach.update(visibleMirrorState, dt, frozen);
    else if (sixSevenMode) {
      this.canvas.dataset.sixSevenDemoHand = this.mirrorCoach.updateMeme(sixSevenPresentation.elapsedMs, dt, frozen);
    } else {
      this.mirrorCoach.update(null, dt, frozen);
      this.canvas.dataset.sixSevenDemoHand = '';
    }
    const rhythmVisible = rhythm !== undefined && (
      stage === 'PLAYING' || stage === 'PAUSED' || (stage === 'COUNTDOWN' && game.paused)
    );
    const rhythmState = this.rhythmStars.update(rhythm ?? null, rhythmVisible, frozen, this.starModel);
    this.canvas.dataset.rhythmVisibleStars = String(rhythmState.visibleStars);
    this.canvas.dataset.rhythmCollected = String(rhythmState.collected);
    this.canvas.dataset.rhythmNextId = rhythmState.nextStar ? String(rhythmState.nextStar.id) : '';
    this.canvas.dataset.rhythmNextAt = rhythmState.nextStar ? String(rhythmState.nextStar.atMs) : '';
    this.canvas.dataset.rhythmNextLane = rhythmState.nextStar ? String(rhythmState.nextStar.lane) : '';
    this.canvas.dataset.rhythmNextHeight = rhythmState.nextStar?.height ?? '';
    this.canvas.dataset.rhythmNextZ = rhythmState.nextZ === null ? '' : rhythmState.nextZ.toFixed(3);
    if (!this.reducedQuality && this.canvas.dataset.environment === 'ready' && frameDeltaMs > 0 && !document.hidden) {
      this.qualityFrames++;
      this.qualityFrameTime += Math.min(100, frameDeltaMs);
      if (this.qualityFrames >= 180) {
        if (this.qualityFrameTime / this.qualityFrames > 40) {
          this.reducedQuality = true;
          this.composer?.dispose();
          this.composer = null;
          this.renderer.setPixelRatio(1);
          this.environment.setReducedQuality(true);
          this.canvas.dataset.quality = 'performance';
          this.resize();
        }
        this.qualityFrames = 0;
        this.qualityFrameTime = 0;
      }
    }
    const preview = stage === 'TUTORIAL' || stage === 'READY';
    if (preview) {
      this.previewTimeMs += dt * 1000;
      if (stage === 'TUTORIAL' && pose?.trackingValid && pose.jumpTriggered && pose.timestampMs !== this.previewPoseTime) {
        this.previewPoseTime = pose.timestampMs;
        if (this.previewTimeMs - this.previewJumpStartedMs >= C.jumpMs) this.previewJumpStartedMs = this.previewTimeMs;
      }
    } else {
      this.previewTimeMs = 0;
      this.previewJumpStartedMs = -Infinity;
      this.previewPoseTime = -1;
    }
    const running = stage === 'PLAYING' || stage === 'PAUSED' || (stage === 'COUNTDOWN' && game.paused);
    const jumpAge = preview ? this.previewTimeMs - this.previewJumpStartedMs : running ? game.jumpAgeMs : Infinity;
    const airborne = jumpAge >= 0 && jumpAge < C.jumpMs;
    const gotHit = game.collisions > this.lastHitCount;
    if (gotHit) {
      const hitDuration = this.actions.get('Hit_A')?.getClip().duration ?? 0.55;
      this.reactionUntilMs = game.elapsedMs + hitDuration * 1000;
    }
    const lane = stage === 'TUTORIAL' && pose?.trackingValid ? pose.lane : game.lane;
    this.targetX = laneX[lane + 1];
    this.actor.position.x = THREE.MathUtils.damp(this.actor.position.x, this.targetX, 6.5, dt);
    this.actor.position.z = C.runnerZ;
    this.actor.position.y = airborne ? Math.sin(Math.PI * jumpAge / C.jumpMs) * 2.2 : 0;
    if (airborne) {
      const jumpStart = preview ? this.previewJumpStartedMs : game.jumpStartedMs;
      if (jumpStart !== this.currentJumpMs) {
        this.currentJumpMs = jumpStart;
        this.burst(this.actor.position.x, 0.04, C.runnerZ, 14);
      }
      this.playAction('Jump_Full_Short', true, C.jumpMs / 1000);
    } else if (running && game.elapsedMs < this.reactionUntilMs) {
      this.playAction('Hit_A', true);
    } else if (stage === 'RESULTS') {
      this.playAction('Cheer');
    } else if (running) {
      this.playAction('Running_A');
    } else {
      this.playAction('Idle');
    }

    this.mixer?.update(dt);
    this.environment.update(stage, presenterMode ? 0 : game.elapsedMs, game.durationMs, presenterMode ? 0 : dt);
    this.updateTrack(!presenterMode && (running || stage === 'RESULTS') ? game.elapsedMs : 0);
    if (!presenterMode && this.wasAirborne && !airborne && !frozen) this.burst(this.actor.position.x, .08, C.runnerZ, 12);
    this.wasAirborne = airborne;
    if (!presenterMode && stage === 'PLAYING' && !airborne && game.elapsedMs - this.lastFootstepMs > 330) {
      this.burst(this.actor.position.x, .05, C.runnerZ, 2);
      this.lastFootstepMs = game.elapsedMs;
    }
    this.updateObstacles(stage, game, rhythm !== undefined, presenterMode);
    this.particleBatch.update(presenterMode ? 0 : dt);
    if (!presenterMode && game.cleared > this.lastSuccessCount) {
      this.burst(0, 0.15, -1.2, 10);
      this.lastSuccessCount = game.cleared;
    }
    if (gotHit && !presenterMode) {
      this.burst(this.actor.position.x, 0.55, C.runnerZ, 7);
      this.lastHitCount = game.collisions;
    }
    this.updateCoachCamera(presenterMode, dt);
    this.render();
  }

  resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
  }

  setDanceMode(enabled: boolean): void {
    this.danceModeSelected = enabled;
    if (!enabled && this.dancePresentationActive) {
      this.dancePresentationActive = false;
      this.mirrorCoach.setDanceMode(false);
      this.canvas.dataset.danceVisible = 'false';
      this.canvas.dataset.danceCueIndex = '';
    }
  }

  private updateCoachCamera(visible: boolean, dt: number): void {
    this.cameraCoachMix = THREE.MathUtils.damp(this.cameraCoachMix, visible ? 1 : 0, 5, dt);
    const distanceForWidth = 2.7 / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * Math.max(0.28, this.camera.aspect) * 0.88);
    const distance = Math.max(9.1, distanceForWidth);
    const coachZ = this.mirrorCoach.group.position.z;
    const targetY = 1.68;
    const amount = this.cameraCoachMix;
    this.camera.position.set(
      0,
      THREE.MathUtils.lerp(4.8, targetY + distance * 0.12, amount),
      THREE.MathUtils.lerp(10.8, coachZ + distance, amount),
    );
    this.camera.lookAt(
      0,
      THREE.MathUtils.lerp(1.4, targetY, amount),
      THREE.MathUtils.lerp(-18, coachZ, amount),
    );
  }

  async selectCharacter(id: CharacterId): Promise<void> {
    await this.ready;
    if (this.destroyed) throw new Error('The runner scene has closed.');
    const model = this.characterModels.get(id);
    if (!model) throw new Error(`The ${id} runner could not load.`);
    const names = new Set(this.characterClips.map(clip => clip.name));
    const clips = model.animations.filter(clip => !names.has(clip.name)).concat(this.characterClips);
    this.mountCharacter(model.scene, clips);
    this.mirrorCoach.setCharacter(model.scene, clips, id);
    this.canvas.dataset.character = id;
    this.canvas.dataset.mirrorCoachCharacter = id;
    const name = CHARACTERS.find(character => character.id === id)!.name;
    this.onAssetProgress(`${name} runner + KayKit track + animations loaded`, this.characterClips.map(clip => clip.name));
  }

  dispose(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.environment.dispose();
    this.rhythmStars.dispose();
    this.mirrorCoach.dispose();
    this.composer?.dispose();
    for (const effect of this.particles) effect.system.dispose();
    this.particleBatch.dispose();
    this.mixer?.stopAllAction();
    this.renderer.dispose();
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
    const collect = (object: THREE.Object3D) => {
      if (object instanceof THREE.Mesh) {
        resources.add(object.geometry);
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          resources.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
        }
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      }
    };
    this.root.traverse(collect);
    for (const model of this.characterModels.values()) model.scene.traverse(collect);
    this.starModel?.traverse(collect);
    resources.forEach(resource => resource.dispose());
    this.characterModels.clear();
  }

  private buildTrackFallback() {
    for (let z = 4; z > -94; z -= trackTileLength) {
      for (const x of laneX) {
        const tile = this.platformFallback.clone();
        tile.position.set(x, -0.225, z);
        tile.castShadow = true;
        tile.receiveShadow = true;
        this.moving.add(tile);
        this.tiles.push(tile);
      }
    }
    for (const x of [-1.375, 1.375]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.04, 104),
        new THREE.MeshStandardMaterial({ color: 0xc8eee0, emissive: 0x36685f, emissiveIntensity: 0.18, roughness: 0.3 }),
      );
      stripe.position.set(x, .04, -42);
      this.moving.add(stripe);
    }
    for (const x of [-4.4, 4.4]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.22, 104),
        new THREE.MeshStandardMaterial({ color: 0x719894, roughness: 0.8 }),
      );
      rail.position.set(x, -.07, -42);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.moving.add(rail);
    }
  }

  private buildParticles() {
    const warm = this.makeParticleEmitter(0xf3bd6f, 0.08);
    const mint = this.makeParticleEmitter(0xa8ebbe, 0.07);
    this.particles.push(warm, mint);
    this.particleBatch.addSystem(warm.system);
    this.particleBatch.addSystem(mint.system);
    this.root.add(warm.emitter, mint.emitter);
  }

  private makeParticleEmitter(color: number, size: number) {
    const system = new ParticleSystem({
      autoDestroy: false, looping: false, duration: 0.38,
      shape: new PointEmitter(), startLife: new ConstantValue(0.24),
      startSpeed: new ConstantValue(1.25), startSize: new ConstantValue(size),
      startColor: new ConstantColor(new Vector4(...new THREE.Color(color).toArray(), 1)),
      emissionOverTime: new ConstantValue(0),
      emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0, probability: 1 }],
      material: new THREE.PointsMaterial({ color, size: 0.075, transparent: true, opacity: 0.88, depthWrite: false }),
      worldSpace: true,
    });
    return { emitter: new ParticleEmitter(system), system };
  }

  private burst(x: number, y: number, z: number, count: number) {
    for (const [index, effect] of this.particles.entries()) {
      const { emitter, system } = effect;
      emitter.position.set(x, y, z);
      system.emissionBursts = [{ time: 0, count: new ConstantValue(count), cycle: 1, interval: 0, probability: 1 }];
      system.restart();
      if (index === 1) emitter.rotation.y = Math.PI / 8;
    }
  }

  private async loadModels() {
    const jobs: [string, string][] = [
      ['platform_4x4x1_blue', 'assets/platformer/blue/platform_4x4x1_blue.gltf'],
      ['barrier_3x1x1_red', 'assets/platformer/red/barrier_3x1x1_red.gltf'],
      ['barrier_3x1x4_red', 'assets/platformer/red/barrier_3x1x4_red.gltf'],
      ['star_yellow', 'assets/platformer/yellow/star_yellow.gltf'],
      ['Rogue_Hooded', 'assets/character/Rogue_Hooded.glb'],
      ...CHARACTERS.filter(character => character.id !== 'rogue').map(character => [character.model, `assets/character/${character.model}.glb`] as [string, string]),
      ['animation_movement', 'assets/animations/Rig_Medium_MovementBasic.glb'],
      ['animation_general', 'assets/animations/Rig_Medium_General.glb'],
      ['animation_simulation', 'assets/animations/Rig_Medium_Simulation.glb'],
    ];
    const loaded = await Promise.allSettled(jobs.map(async ([name, path]) => [name, await this.loader.loadAsync(asset(path))] as const));
    if (this.destroyed) return;
    const models = new Map<string, Awaited<ReturnType<GLTFLoader['loadAsync']>>>();
    for (let i = 0; i < loaded.length; i++) {
      const result = loaded[i];
      if (result.status === 'fulfilled') models.set(result.value[0], result.value[1]);
      else console.warn(`The ${jobs[i][0]} scene asset failed to load.`, result.reason);
    }
    this.platformModel = models.get('platform_4x4x1_blue')?.scene ?? null;
    this.lowModel = models.get('barrier_3x1x1_red')?.scene ?? null;
    this.highModel = models.get('barrier_3x1x4_red')?.scene ?? null;
    this.starModel = models.get('star_yellow')?.scene ?? null;
    this.applyTrackModel();
    const characterGltf = models.get('Rogue_Hooded');
    for (const character of CHARACTERS) {
      const model = models.get(character.model);
      if (model) this.characterModels.set(character.id, model);
    }
    const selectedAnimations: [string, string, string][] = [
      ['animation_general', 'Idle_A', 'Idle'],
      ['animation_movement', 'Running_A', 'Running_A'],
      ['animation_movement', 'Jump_Full_Short', 'Jump_Full_Short'],
      ['animation_general', 'Hit_A', 'Hit_A'],
      ['animation_simulation', 'Cheering', 'Cheer'],
    ];
    const importedClips: THREE.AnimationClip[] = [];
    for (const [set, sourceName, actionName] of selectedAnimations) {
      const source = models.get(set)?.animations.find(clip => clip.name === sourceName);
      if (!source) {
        console.warn(`The KayKit animation ${sourceName} was not found in ${set}.`);
        continue;
      }
      const clip = source.clone();
      clip.name = actionName;
      importedClips.push(clip);
    }
    this.characterClips = importedClips;
    if (characterGltf) {
      const importedNames = new Set(importedClips.map(clip => clip.name));
      const clips = characterGltf.animations.filter(clip => !importedNames.has(clip.name)).concat(importedClips);
      this.mountCharacter(characterGltf.scene, clips);
      this.mirrorCoach.setCharacter(characterGltf.scene, clips, 'rogue');
      this.canvas.dataset.character = 'rogue';
      this.canvas.dataset.mirrorCoachCharacter = 'rogue';
    }
    else this.makeCharacterFallback();
    const assetsLabel = !characterGltf
      ? 'Track ready · using fallback runner'
      : importedClips.length === selectedAnimations.length
        ? 'Rogue runner + KayKit track + animations loaded'
        : 'Rogue runner + KayKit track loaded';
    this.onAssetProgress(assetsLabel, importedClips.map(clip => clip.name));
  }

  private applyTrackModel() {
    if (!this.platformModel) return;
    for (let i = 0; i < this.tiles.length; i++) {
      const fallback = this.tiles[i];
      const platform = this.platformModel.clone(true);
      platform.position.copy(fallback.position);
      platform.scale.set(.69, .18, 1.3);
      platform.position.y -= new THREE.Box3().setFromObject(platform).max.y;
      platform.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      fallback.parent?.remove(fallback);
      this.moving.add(platform);
      this.tiles[i] = platform;
    }
  }

  private mountCharacter(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer?.stopAllAction();
    if (this.character) {
      this.mixer?.uncacheRoot(this.character);
      this.character.traverse(object => { if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose(); });
    }
    this.actor.clear();
    this.actions.clear();
    this.currentAction = null;
    this.currentActionName = '';
    const clone = cloneSkinned(model);
    clone.rotation.y = Math.PI;
    clone.scale.setScalar(0.92);
    const weapons = new Set(['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable']);
    clone.traverse(object => { if (weapons.has(object.name)) object.visible = false; });
    clone.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    const bounds = new THREE.Box3().setFromObject(clone);
    clone.position.y -= bounds.min.y;
    this.character = clone;
    this.actor.add(clone);
    this.mixer = new THREE.AnimationMixer(clone);
    for (const clip of clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.playAction(this.actions.has('Idle') ? 'Idle' : 'Idle_A');
  }

  private makeCharacterFallback() {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.9, 5, 9),
      new THREE.MeshStandardMaterial({ color: 0xeee6d5, roughness: 0.7 }),
    );
    body.position.y = 0.92;
    body.castShadow = true;
    this.actor.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xe7b27e, roughness: 0.78 }),
    );
    head.position.y = 1.65;
    head.castShadow = true;
    this.actor.add(head);
  }

  private playAction(name: string, oneShot = false, duration?: number) {
    const action = this.actions.get(name) ?? this.actions.get('Running_A') ?? this.actions.get('Idle');
    if (!action || this.currentAction === action) return;
    if (duration) action.setDuration(duration);
    action.reset();
    action.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    action.clampWhenFinished = oneShot;
    action.fadeIn(0.16).play();
    this.currentAction?.fadeOut(0.16);
    this.currentAction = action;
    this.currentActionName = name;
  }

  private updateTrack(elapsed: number) {
    const scroll = elapsed * .0055;
    const ringLength = Math.ceil(this.tiles.length / laneX.length) * trackTileLength;
    for (let i = 0; i < this.tiles.length; i++) {
      const lane = i % laneX.length;
      const segment = Math.floor(i / laneX.length);
      const z = wrapSceneryZ(4 - segment * trackTileLength, scroll, 9.2, 9.2 - ringLength);
      this.tiles[i].position.x = laneX[lane];
      this.tiles[i].position.z = z;
    }
    for (const object of this.moving.children) {
      if (object.userData.scrollingOverhead !== true) continue;
      const z0 = object.userData.baseZ as number;
      object.position.z = z0 + scroll;
      if (object.position.z > 8) object.position.z -= ringLength;
    }
  }

  private updateObstacles(stage: Stage, game: GameEngine, rhythmMode: boolean, mirrorMode: boolean) {
    const visible = !mirrorMode && (stage === 'PLAYING' || stage === 'PAUSED' || (stage === 'COUNTDOWN' && game.paused));
    const active = new Set<number>();
    for (const wave of game.waves) {
      if (!visible) continue;
      const start = wave.warningAtMs ?? wave.atMs - C.wavePreviewMs;
      if (game.elapsedMs < start || game.elapsedMs > wave.atMs + C.obstacleExitMs) continue;
      active.add(wave.id);
      let group = this.obstacleGroups.get(wave.id);
      if (!group) {
        group = new THREE.Group();
        group.name = `wave-${wave.id}`;
        group.userData.lanes = wave.obstacles.map(obstacle => obstacle.lane);
        wave.obstacles.forEach((obstacle, index) => {
          let model: THREE.Object3D;
          if (obstacle.kind === 'low') model = this.lowModel ? this.lowModel.clone(true) : this.lowFallback.clone();
          else model = this.highModel ? this.highModel.clone(true) : this.tallFallback.clone();
          model.position.set(laneX[obstacle.lane + 1], 0, 0);
          model.scale.multiplyScalar(obstacle.kind === 'low' ? 0.82 : 0.73);
          model.position.y -= new THREE.Box3().setFromObject(model).min.y;
          model.userData.obstacleIndex = index;
          model.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
          if (obstacle.kind === 'low') model.traverse(child => {
            if (child instanceof THREE.Mesh) child.material = this.lowFallback.material;
          });
          group!.add(model);
          if (this.starModel && !rhythmMode && wave.id % 3 === 1 && index === 0) {
            const star = this.starModel.clone(true);
            star.scale.setScalar(0.43);
            star.position.set(laneX[obstacle.lane + 1], 2.25, 0);
            star.userData.pickup = true;
            group!.add(star);
          }
        });
        this.moving.add(group);
        this.obstacleGroups.set(wave.id, group);
      }
      if (!group) continue;
      const previewDuration = wave.atMs - start;
      const progress = (game.elapsedMs - start) / previewDuration;
      group.position.z = C.obstacleSpawnZ + progress * (C.runnerZ - C.obstacleSpawnZ);
      group.children.forEach((child, index) => {
        if (child.userData.pickup) {
          child.rotation.y += 0.012;
          child.position.y = 2.2 + Math.sin(this.elapsedMs * 0.003 + wave.id) * 0.12;
        }
        if (index % 2 === 0) child.rotation.y = Math.sin(progress * Math.PI) * 0.025;
      });
    }
    for (const [id, group] of this.obstacleGroups) {
      if (!active.has(id)) {
        this.moving.remove(group);
        this.obstacleGroups.delete(id);
      }
    }
  }

  private render() {
    if (this.destroyed) return;
    if (!this.composer && !this.reducedQuality && this.renderer.capabilities.isWebGL2) {
      try {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.composer.addPass(new EffectPass(this.camera,
          new SMAAEffect(),
          new BloomEffect({ intensity: 0.22, luminanceThreshold: 0.87, mipmapBlur: true, levels: 4 }),
        ));
      } catch (error) {
        console.warn('Postprocessing is disabled on this graphics device.', error);
        this.composer?.dispose();
        this.composer = null;
      }
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
