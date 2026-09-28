import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect } from 'postprocessing';
import { BatchedRenderer, ConstantColor, ConstantValue, ParticleEmitter, ParticleSystem, PointEmitter, Vector4 } from 'three.quarks';
import { CONFIG as C } from '@motion-runner/game';
import type { GameEngine, Stage } from '@motion-runner/game';
import { CHARACTERS } from './characters';
import type { CharacterId } from './characters';

const laneX = [-2.75, 0, 2.75];
const trackTileLength = 5.2;

function asset(path: string) { return `${import.meta.env.BASE_URL}${path}`; }

export class RunnerWorld {
  readonly ready: Promise<void>;
  private readonly characterModels = new Map<CharacterId, { scene: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  private characterClips: THREE.AnimationClip[] = [];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private readonly loader = new GLTFLoader();
  private readonly root = new THREE.Group();
  private readonly floor = new THREE.Group();
  private readonly moving = new THREE.Group();
  private readonly actor = new THREE.Group();
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
    new THREE.MeshStandardMaterial({ color: 0xf17663, roughness: 0.4 }),
  );
  private platformModel: THREE.Object3D | null = null;
  private lowModel: THREE.Object3D | null = null;
  private highModel: THREE.Object3D | null = null;
  private archModel: THREE.Object3D | null = null;
  private flagModel: THREE.Object3D | null = null;
  private starModel: THREE.Object3D | null = null;
  private character: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentActionName = '';
  private currentJumpMs = -Infinity;
  private reactionUntilMs = -Infinity;
  private elapsedMs = 0;
  private targetX = 0;
  private destroyed = false;
  private lastSuccessCount = 0;
  private lastHitCount = 0;
  private readonly scratch = new THREE.Vector3();

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
    this.root.add(this.floor, this.moving, this.actor, this.particleBatch);
    this.buildLights();
    this.buildBackdrop();
    this.buildTrackFallback();
    this.buildOverhead();
    this.buildParticles();
    this.camera.position.set(0, 5.4, 10.2);
    this.camera.lookAt(0, 0.65, -4.6);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.ready = this.loadModels();
    this.render();
  }

  update(stage: Stage, game: GameEngine, frameDeltaMs: number): void {
    if (this.destroyed) return;
    if (this.character) this.character.rotation.y = stage === 'WELCOME' ? 0 : Math.PI;
    this.elapsedMs = game.elapsedMs;
    const gotHit = game.collisions > this.lastHitCount;
    if (gotHit) {
      const hitDuration = this.actions.get('Hit_A')?.getClip().duration ?? 0.55;
      this.reactionUntilMs = game.elapsedMs + hitDuration * 1000;
    }
    this.targetX = laneX[game.lane + 1];
    this.actor.position.x = THREE.MathUtils.damp(this.actor.position.x, this.targetX, 6.5, Math.min(frameDeltaMs, 100) / 1000);
    this.actor.position.y = game.jumpHeight;
    if (game.jumpStartedMs !== this.currentJumpMs && game.jumpAgeMs >= 0 && game.jumpAgeMs < C.jumpMs) {
      this.currentJumpMs = game.jumpStartedMs;
      this.playAction('Jump_Full_Short', true, C.jumpMs / 1000);
      this.burst(this.actor.position.x, 0.04, 2.9, 14);
    } else if ((stage === 'PLAYING' || stage === 'PAUSED') && game.elapsedMs < this.reactionUntilMs) {
      this.playAction('Hit_A', true);
    } else if ((stage === 'PLAYING' || stage === 'PAUSED') && game.jumpHeight === 0 && this.currentActionName.startsWith('Jump_')) {
      this.playAction('Running_A');
    } else if (stage === 'RESULTS') {
      this.playAction('Cheer');
    } else if ((stage === 'PLAYING' || stage === 'PAUSED') && !this.currentActionName.startsWith('Jump_')) {
      this.playAction('Running_A');
    } else {
      this.playAction('Idle');
    }

    const dt = Math.min(0.1, Math.max(0, frameDeltaMs / 1000));
    this.mixer?.update(dt);
    this.updateTrack(stage === 'PLAYING' || stage === 'PAUSED' ? game.elapsedMs : 0);
    this.updateObstacles(stage, game);
    this.particleBatch.update(dt);
    if (game.cleared > this.lastSuccessCount) {
      this.burst(0, 0.15, -1.2, 10);
      this.lastSuccessCount = game.cleared;
    }
    if (gotHit) {
      this.burst(this.actor.position.x, 0.55, 2.8, 7);
      this.lastHitCount = game.collisions;
    }
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

  async selectCharacter(id: CharacterId): Promise<void> {
    await this.ready;
    if (this.destroyed) throw new Error('The runner scene has closed.');
    const model = this.characterModels.get(id);
    if (!model) throw new Error(`The ${id} runner could not load.`);
    const names = new Set(this.characterClips.map(clip => clip.name));
    this.mountCharacter(model.scene, model.animations.filter(clip => !names.has(clip.name)).concat(this.characterClips));
    this.canvas.dataset.character = id;
    const name = CHARACTERS.find(character => character.id === id)!.name;
    this.onAssetProgress(`${name} runner + KayKit track + animations loaded`, this.characterClips.map(clip => clip.name));
  }

  dispose(): void {
    this.destroyed = true;
    this.resizeObserver.disconnect();
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
    resources.forEach(resource => resource.dispose());
    this.characterModels.clear();
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xdaf5ee, 0x344858, 2.15));
    const key = new THREE.DirectionalLight(0xffd2a2, 3.25);
    key.position.set(-7, 12, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.blurSamples = 4;
    key.shadow.radius = 2;
    key.shadow.camera.left = -13; key.shadow.camera.right = 13;
    key.shadow.camera.top = 13; key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.045;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7ad6d1, 1.05);
    fill.position.set(8, 5, -11);
    this.scene.add(fill);
  }

  private buildBackdrop() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x22363a, roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.55, -65);
    ground.receiveShadow = true;
    this.floor.add(ground);

    const palette = [0x3c5558, 0x536864, 0x6b7161, 0x36545e, 0x8b7768];
    let seed = 23;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 46; i++) {
      const side = i % 2 ? 1 : -1;
      const depth = -7 - Math.floor(i / 2) * 2.5 - random() * 5;
      const width = 1.4 + random() * 2.5;
      const height = 1.3 + random() * 5;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, 1.8 + random() * 2),
        new THREE.MeshStandardMaterial({ color: palette[Math.floor(random() * palette.length)], roughness: 0.86 }),
      );
      building.position.set(side * (7.8 + random() * 7), height / 2 - 0.55, depth);
      building.castShadow = true;
      building.receiveShadow = true;
      this.floor.add(building);
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.65, 0.13, 0.16),
        new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0xf28a71 : 0xe4c37e, roughness: 0.54 }),
      );
      awning.position.set(building.position.x, building.position.y + height * 0.17, building.position.z + 0.92);
      this.floor.add(awning);
    }
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 80),
      new THREE.MeshBasicMaterial({ color: 0x314f50 }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.58, -108);
    this.floor.add(sea);
  }

  private buildTrackFallback() {
    for (let z = 4; z > -24; z -= trackTileLength) {
      for (const x of laneX) {
        const tile = this.platformFallback.clone();
        tile.position.set(x, -0.28, z);
        tile.castShadow = true;
        tile.receiveShadow = true;
        this.moving.add(tile);
        this.tiles.push(tile);
      }
    }
    for (const x of [-1.375, 1.375]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.035, 38),
        new THREE.MeshStandardMaterial({ color: 0xc8eee0, emissive: 0x36685f, emissiveIntensity: 0.18, roughness: 0.3 }),
      );
      stripe.position.set(x, -0.015, -8);
      this.moving.add(stripe);
    }
    for (const x of [-5.65, 5.65]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.68, 36),
        new THREE.MeshStandardMaterial({ color: 0x41686a, roughness: 0.48, metalness: 0.12 }),
      );
      rail.position.set(x, 0.12, -8);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.moving.add(rail);
    }
  }

  private buildOverhead() {
    for (const z of [-5, -15, -25]) {
      const arch = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: 0x7fc7b5, roughness: 0.54, metalness: 0.05 });
      for (const x of [-5.15, 5.15]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.23, 4.3, 0.23), material);
        post.position.set(x, 1.9, z);
        post.castShadow = true;
        arch.add(post);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(10.55, 0.24, 0.34), material);
      cap.position.set(0, 4.08, z);
      arch.add(cap);
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.78, 0.16),
        new THREE.MeshStandardMaterial({ color: 0xf3bd6f, roughness: 0.4 }),
      );
      sign.position.set(0, 3.56, z);
      sign.castShadow = true;
      arch.add(sign);
      this.moving.add(arch);
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
      ['arch_wide_blue', 'assets/platformer/blue/arch_wide_blue.gltf'],
      ['flag_A_blue', 'assets/platformer/blue/flag_A_blue.gltf'],
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
    this.archModel = models.get('arch_wide_blue')?.scene ?? null;
    this.flagModel = models.get('flag_A_blue')?.scene ?? null;
    this.starModel = models.get('star_yellow')?.scene ?? null;
    this.applyTrackModel();
    this.applyOverheadModels();
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
      this.canvas.dataset.character = 'rogue';
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
      platform.scale.set(1, 0.5, 1.3);
      platform.traverse(object => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      fallback.parent?.remove(fallback);
      this.moving.add(platform);
      this.tiles[i] = platform;
    }
  }

  private applyOverheadModels() {
    for (const object of this.moving.children) {
      if (!(object instanceof THREE.Group) || object.children.length !== 3) continue;
      if (!this.archModel && !this.flagModel) break;
      const z = object.children[0].position.z;
      const arch = this.archModel?.clone(true);
      if (arch) {
        arch.position.set(0, 0, z);
        arch.scale.set(1.42, 1.12, 1);
        arch.traverse(child => { if (child instanceof THREE.Mesh) child.castShadow = true; });
        object.visible = false;
        this.moving.add(arch);
      }
      const flag = this.flagModel?.clone(true);
      if (flag) {
        flag.position.set(4.76, 1.5, z);
        flag.scale.set(0.8, 0.8, 0.8);
        this.moving.add(flag);
      }
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
    const scroll = (elapsed * 0.00145) % trackTileLength;
    const ringLength = Math.ceil(this.tiles.length / laneX.length) * trackTileLength;
    for (let i = 0; i < this.tiles.length; i++) {
      const lane = i % laneX.length;
      const segment = Math.floor(i / laneX.length);
      const z = 4 - ((segment * trackTileLength + scroll) % ringLength);
      this.tiles[i].position.set(laneX[lane], -0.28, z);
    }
    for (const object of this.moving.children) {
      if (object.userData.scrollingOverhead !== true) continue;
      const z0 = object.userData.baseZ as number;
      object.position.z = z0 + scroll;
      if (object.position.z > 8) object.position.z -= ringLength;
    }
  }

  private updateObstacles(stage: Stage, game: GameEngine) {
    const visible = stage === 'PLAYING' || stage === 'PAUSED';
    const active = new Set<number>();
    for (const wave of game.waves) {
      if (wave.resolved || !visible) continue;
      const start = wave.atMs - C.wavePreviewMs;
      if (game.elapsedMs < start || game.elapsedMs > wave.atMs) continue;
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
          model.position.set(laneX[obstacle.lane + 1], obstacle.kind === 'low' ? 0.28 : 1.12, 0);
          model.scale.multiplyScalar(obstacle.kind === 'low' ? 0.82 : 0.73);
          model.userData.obstacleIndex = index;
          model.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
          group!.add(model);
          if (this.starModel && wave.id % 3 === 1 && index === 0) {
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
      const progress = THREE.MathUtils.clamp((game.elapsedMs - start) / C.wavePreviewMs, 0, 1);
      group.position.z = -14 + progress * 17;
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
    if (!this.composer && this.renderer.capabilities.isWebGL2) {
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
