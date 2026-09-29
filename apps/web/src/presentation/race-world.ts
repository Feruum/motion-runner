import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { RaceObstacle, RacePlayer, RaceSnapshot } from '../../../../packages/game/src/core/race-types';
import { RACE_TRACK, obstacleOffset } from '../../../../packages/game/src/core/race-track';
import { CHARACTERS } from './characters';

export interface RacePosition { x: number; y: number; z: number }

export function sweeperVisualRotation(collisionAngle: number): number {
  return collisionAngle;
}

export function interpolateRacePosition(from: RacePosition, to: RacePosition, alpha: number): RacePosition {
  const amount = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

export function selectRaceCameraTarget(players: RacePlayer[], localPlayerId: string): RacePlayer | null {
  const local = players.find(player => player.id === localPlayerId);
  if (local && (local.status === 'racing' || local.status === 'falling')) return local;

  const active = players
    .filter(player => player.status === 'racing' || player.status === 'falling')
    .sort((a, b) => b.z - a.z || a.rank - b.rank);
  return active[0] ?? local ?? [...players].sort((a, b) => b.z - a.z || a.rank - b.rank)[0] ?? null;
}

const halfTrack = RACE_TRACK.width / 2;
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const runnerColor = (id: string) => {
  const found = CHARACTERS.find(character => character.id === id);
  return found?.color ?? '#f4a77d';
};

interface TrackObstacleView {
  obstacle: RaceObstacle;
  group: THREE.Group;
  leftPanel?: THREE.Mesh;
  rightPanel?: THREE.Mesh;
  beam?: THREE.Group;
}

interface RacerView {
  id: string;
  characterId: string;
  actor: THREE.Group;
  body: THREE.Group;
  shadow: THREE.Mesh;
  marker: THREE.Mesh;
  tag: THREE.Sprite;
  tagTexture: THREE.CanvasTexture;
  mixer: THREE.AnimationMixer | null;
  model: THREE.Object3D | null;
  actions: Map<string, THREE.AnimationAction>;
  currentAction: THREE.AnimationAction | null;
  currentActionName: string;
  tagValue: string;
}

type GltfAsset = Awaited<ReturnType<GLTFLoader['loadAsync']>>;
type CharacterAsset = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function roundedLabel(text: string, width: number, height: number, fontSize: number, accent = '#55e2bf') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) {
    const radius = Math.min(18, height * .22);
    context.beginPath();
    context.roundRect(2, 2, width - 4, height - 4, radius);
    context.fillStyle = 'rgba(19, 39, 55, 0.88)';
    context.fill();
    context.strokeStyle = accent;
    context.lineWidth = Math.max(3, height * .045);
    context.stroke();
    context.fillStyle = '#fffaf0';
    context.font = `700 ${fontSize}px Outfit, Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2, width - 24);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makeSign(text: string, color: string, width = 5.2, height = .86) {
  const texture = roundedLabel(text, 768, 144, 58, color);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 2;
  return { sprite, texture };
}

/**
 * Owns only the WebGL scene. The caller controls the frame loop and supplies
 * authoritative snapshots; this class never starts a requestAnimationFrame.
 */
export class RaceWorld {
  readonly ready: Promise<void>;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(55, 1, .1, 700);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly loader = new GLTFLoader();
  private readonly resizeObserver: ResizeObserver;
  private readonly models = new Map<string, CharacterAsset>();
  private readonly sourceScenes: THREE.Object3D[] = [];
  private readonly sharedClips = new Map<string, THREE.AnimationClip>();
  private readonly racers = new Map<string, RacerView>();
  private readonly obstacleViews: TrackObstacleView[] = [];
  private readonly sceneResources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  private readonly shadowGeometry = new THREE.CircleGeometry(.8, 18);
  private readonly shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x173048, transparent: true, opacity: .25, depthWrite: false });
  private readonly markerGeometry = new THREE.TorusGeometry(.64, .055, 6, 24);
  private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: 0x64f5d0, transparent: true, opacity: .92 });
  private readonly fallbackBodyGeometry = new THREE.CapsuleGeometry(.39, .78, 5, 10);
  private readonly fallbackHeadGeometry = new THREE.SphereGeometry(.3, 14, 12);
  private readonly fallbackSashGeometry = new THREE.BoxGeometry(.73, .12, .11);
  private readonly targetPosition = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private previousSnapshot: RaceSnapshot | null = null;
  private latestSnapshot: RaceSnapshot | null = null;
  private renderClockMs = 0;
  private destroyed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene.background = new THREE.Color(0x97cde0);
    this.scene.fog = new THREE.Fog(0x97cde0, 170, 610);
    this.scene.add(new THREE.HemisphereLight(0xe6f7ff, 0x587b68, 2.15));
    const sun = new THREE.DirectionalLight(0xffefd0, 2.5);
    sun.position.set(-24, 44, -32);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x81d8ef, .72);
    fill.position.set(26, 18, 310);
    this.scene.add(fill);
    this.camera.position.set(0, 7.5, -20);
    this.camera.lookAt(0, 1.5, 22);

    this.buildTrack();
    this.buildLandmarks();
    this.buildDecor();
    this.buildObstacles();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.ready = this.loadAssets();
  }

  update(snapshot: RaceSnapshot, localPlayerId: string, deltaMs: number): void {
    if (this.destroyed) return;
    const dtMs = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, 100);
    this.acceptSnapshot(snapshot, dtMs);
    const latest = this.latestSnapshot!;
    const previousById = new Map((this.previousSnapshot?.players ?? []).map(player => [player.id, player]));
    const sampleSpan = Math.max(0, latest.elapsedMs - (this.previousSnapshot?.elapsedMs ?? latest.elapsedMs));
    const alpha = sampleSpan > 0
      ? clamp((this.renderClockMs - (this.previousSnapshot?.elapsedMs ?? latest.elapsedMs)) / sampleSpan, 0, 1)
      : 1;
    const present = new Set<string>();
    const players = latest.players;
    const target = selectRaceCameraTarget(players, localPlayerId);

    for (const player of players) {
      present.add(player.id);
      const view = this.ensureRacer(player);
      if (view.characterId !== player.characterId) this.mountCharacter(view, player.characterId);
      const before = previousById.get(player.id);
      const position = before ? interpolateRacePosition(before, player, alpha) : player;
      this.updateRacer(view, player, position, dtMs / 1000, latest.elapsedMs, player.id === localPlayerId);
    }
    for (const [id, view] of this.racers) {
      if (!present.has(id)) {
        view.actor.visible = false;
        view.shadow.visible = false;
      }
    }

    this.updateObstacles(latest.elapsedMs);
    this.updateTagVisibility(players, localPlayerId, target?.id ?? localPlayerId);
    if (target) {
      const old = previousById.get(target.id);
      const targetPose = old ? interpolateRacePosition(old, target, alpha) : target;
      this.targetPosition.set(targetPose.x, targetPose.y, targetPose.z);
    } else {
      this.targetPosition.set(0, 0, 0);
    }
    const dt = dtMs / 1000;
    this.cameraDesired.set(this.targetPosition.x * .58, this.targetPosition.y + 7.2, this.targetPosition.z - 18.5);
    this.camera.position.lerp(this.cameraDesired, 1 - Math.exp(-2.7 * dt));
    this.cameraLook.set(this.targetPosition.x * .65, this.targetPosition.y + 1.05, this.targetPosition.z + 23);
    this.camera.lookAt(this.cameraLook);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (this.destroyed) return;
    const host = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    for (const view of this.racers.values()) {
      view.mixer?.stopAllAction();
      if (view.model && view.mixer) view.mixer.uncacheRoot(view.model);
    }
    for (const source of this.sourceScenes) this.collectResources(source);
    this.collectResources(this.scene);
    for (const resource of this.sceneResources) resource.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.racers.clear();
    this.models.clear();
  }

  private acceptSnapshot(snapshot: RaceSnapshot, deltaMs: number) {
    if (!this.latestSnapshot) {
      this.previousSnapshot = snapshot;
      this.latestSnapshot = snapshot;
      this.renderClockMs = snapshot.elapsedMs;
    } else if (snapshot.elapsedMs < this.latestSnapshot.elapsedMs) {
      this.previousSnapshot = snapshot;
      this.latestSnapshot = snapshot;
      this.renderClockMs = snapshot.elapsedMs;
    } else if (snapshot.elapsedMs > this.latestSnapshot.elapsedMs) {
      this.previousSnapshot = this.latestSnapshot;
      this.latestSnapshot = snapshot;
      this.renderClockMs = this.previousSnapshot.elapsedMs;
    } else {
      this.latestSnapshot = snapshot;
    }
    this.renderClockMs += deltaMs;
  }

  private buildTrack() {
    const road = new THREE.MeshStandardMaterial({ color: 0x376b79, roughness: .83, metalness: .03 });
    const sideGround = new THREE.MeshStandardMaterial({ color: 0x68a579, roughness: 1 });
    const startZ = -30;
    const finishZ = RACE_TRACK.length + 24;
    const gaps = RACE_TRACK.obstacles.filter(obstacle => obstacle.kind === 'gap').sort((a, b) => a.z - b.z);
    let cursor = startZ;
    for (const gap of gaps) {
      const before = gap.z - gap.depth / 2;
      this.addDeck(cursor, before, road);
      this.addGap(gap);
      cursor = gap.z + gap.depth / 2;
    }
    this.addDeck(cursor, finishZ, road);

    const terrainLength = finishZ - startZ;
    for (const side of [-1, 1]) {
      const terrain = new THREE.Mesh(new THREE.BoxGeometry(58, .34, terrainLength), sideGround);
      terrain.position.set(side * (halfTrack + 29), -.31, (startZ + finishZ) / 2);
      terrain.receiveShadow = true;
      this.scene.add(terrain);
    }

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x80f1d1, emissive: 0x1a7666, emissiveIntensity: .26, roughness: .38 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.13, .085, RACE_TRACK.length + 18), edgeMaterial);
      rail.position.set(side * (halfTrack - .12), .045, RACE_TRACK.length / 2);
      this.scene.add(rail);
    }
    this.buildPathMarks(gaps);

    const startStripe = new THREE.Mesh(new THREE.BoxGeometry(RACE_TRACK.width, .045, .34), new THREE.MeshStandardMaterial({ color: 0xffefbd, emissive: 0xe79839, emissiveIntensity: .18 }));
    startStripe.position.set(0, .025, 0);
    this.scene.add(startStripe);
  }

  private addDeck(fromZ: number, toZ: number, material: THREE.Material) {
    if (toZ <= fromZ) return;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(RACE_TRACK.width, .36, toZ - fromZ), material);
    deck.position.set(0, -.18, (fromZ + toZ) / 2);
    deck.receiveShadow = true;
    this.scene.add(deck);
  }

  private addGap(gap: RaceObstacle) {
    const glow = new THREE.MeshStandardMaterial({ color: 0x302c5e, emissive: 0x65296a, emissiveIntensity: .45, roughness: .9, side: THREE.DoubleSide });
    const wallHeight = 2.5;
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.16, wallHeight, gap.depth), glow);
      wall.position.set(side * (halfTrack - .08), -wallHeight / 2, gap.z);
      this.scene.add(wall);
    }
    const lipMaterial = new THREE.MeshStandardMaterial({ color: 0xffc456, emissive: 0xa95f18, emissiveIntensity: .25, roughness: .55 });
    for (const side of [-1, 1]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(gap.width, .095, .12), lipMaterial);
      lip.position.set(0, .025, gap.z + side * (gap.depth / 2 + .055));
      this.scene.add(lip);
      for (const edge of [-1, 1]) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(.16, .13, gap.depth), new THREE.MeshStandardMaterial({ color: edge < 0 ? 0xf4889e : 0x61e9ce, emissive: edge < 0 ? 0x6c2543 : 0x1b6c57, emissiveIntensity: .28 }));
        dash.position.set(edge * (halfTrack - .08), .075, gap.z);
        this.scene.add(dash);
      }
    }
  }

  private buildPathMarks(gaps: RaceObstacle[]) {
    const positions: THREE.Vector3[] = [];
    for (const x of [-2, 2]) {
      for (let z = 8; z < RACE_TRACK.length - 4; z += 12) {
        if (gaps.some(gap => z + 1.5 >= gap.z - gap.depth / 2 && z - 1.5 <= gap.z + gap.depth / 2)) continue;
        positions.push(new THREE.Vector3(x, .012, z));
      }
    }
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(.075, .025, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xd6f4d6, emissive: 0x498877, emissiveIntensity: .18, roughness: .5 }),
      positions.length,
    );
    const temp = new THREE.Object3D();
    positions.forEach((position, index) => {
      temp.position.copy(position);
      temp.updateMatrix();
      mesh.setMatrixAt(index, temp.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildLandmarks() {
    const marks = RACE_TRACK.checkpoints.filter(z => z > 0).map((z, index) => ({ z, label: `CHECKPOINT ${index + 1}`, color: ['#70edcb', '#fac866'][index % 2] }));
    marks.push({ z: RACE_TRACK.length, label: 'FINISH', color: '#ff779b' });
    const postHeight = 6.25;
    const beamY = 6.08;
    const postGeometry = new THREE.BoxGeometry(.78, postHeight, .78);
    const beamGeometry = new THREE.BoxGeometry(RACE_TRACK.width - .8, .78, .84);
    for (const mark of marks) {
      const color = new THREE.Color(mark.color);
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .17, roughness: .46, metalness: .05 });
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeometry, material);
        post.position.set(side * (halfTrack - .55), postHeight / 2, mark.z);
        this.scene.add(post);
      }
      const beam = new THREE.Mesh(beamGeometry, material);
      beam.position.set(0, beamY, mark.z);
      this.scene.add(beam);
      const { sprite, texture } = makeSign(mark.label, mark.color, mark.label === 'FINISH' ? 4.3 : 5.3, .82);
      sprite.position.set(0, beamY, mark.z + .46);
      this.scene.add(sprite);
      this.sceneResources.add(texture);
    }
    const startMaterial = new THREE.MeshStandardMaterial({ color: 0x81f3d6, emissive: 0x229782, emissiveIntensity: .14, roughness: .5 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeometry, startMaterial);
      post.position.set(side * (halfTrack - .55), postHeight / 2, 9);
      this.scene.add(post);
    }
    const startBeam = new THREE.Mesh(beamGeometry, startMaterial);
    startBeam.position.set(0, beamY, 9);
    this.scene.add(startBeam);
    const { sprite, texture } = makeSign('PARTY RACE', '#81f3d6');
    sprite.position.set(0, beamY, 9.46);
    this.scene.add(sprite);
    this.sceneResources.add(texture);
  }

  private buildDecor() {
    const pedestalGeometry = new THREE.BoxGeometry(.48, 2.7, .48);
    const orbGeometry = new THREE.IcosahedronGeometry(.67, 1);
    const pedestals = new THREE.InstancedMesh(pedestalGeometry, new THREE.MeshStandardMaterial({ color: 0xf3c36c, roughness: .62 }), 36);
    const orbs = new THREE.InstancedMesh(orbGeometry, new THREE.MeshStandardMaterial({ color: 0xf585aa, roughness: .42, metalness: .03 }), 36);
    const palette = [0xf585aa, 0xf3c36c, 0x56cfb5, 0x84aef5, 0xa699e8];
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let z = 18; z < RACE_TRACK.length; z += 27) {
      for (const side of [-1, 1]) {
        const x = side * 8.25;
        dummy.position.set(x, 1.3, z);
        dummy.rotation.set(0, (index % 4) * .3, 0);
        dummy.updateMatrix();
        pedestals.setMatrixAt(index, dummy.matrix);
        pedestals.setColorAt(index, new THREE.Color(palette[index % palette.length]));
        dummy.position.set(x, 3.12 + (index % 3) * .16, z);
        dummy.scale.setScalar(.82 + (index % 2) * .18);
        dummy.updateMatrix();
        orbs.setMatrixAt(index, dummy.matrix);
        orbs.setColorAt(index, new THREE.Color(palette[(index + 2) % palette.length]));
        dummy.scale.setScalar(1);
        index++;
      }
    }
    pedestals.instanceMatrix.needsUpdate = true;
    orbs.instanceMatrix.needsUpdate = true;
    this.scene.add(pedestals, orbs);
  }

  private buildObstacles() {
    const gateMaterial = new THREE.MeshStandardMaterial({ color: 0xf18c72, emissive: 0x7d371f, emissiveIntensity: .2, roughness: .45, metalness: .06 });
    const beamMaterial = new THREE.MeshStandardMaterial({ color: 0xffd05d, emissive: 0x90661f, emissiveIntensity: .24, roughness: .38, metalness: .08 });
    const hubMaterial = new THREE.MeshStandardMaterial({ color: 0x5b74d8, emissive: 0x2d3475, emissiveIntensity: .27, roughness: .33, metalness: .1 });
    for (const obstacle of RACE_TRACK.obstacles) {
      const group = new THREE.Group();
      group.position.z = obstacle.z;
      const view: TrackObstacleView = { obstacle, group };
      if (obstacle.kind === 'gate') {
        const gateHeight = 4.55;
        const geometry = new THREE.BoxGeometry(1, gateHeight, obstacle.depth);
        view.leftPanel = new THREE.Mesh(geometry, gateMaterial);
        view.rightPanel = new THREE.Mesh(geometry, gateMaterial);
        view.leftPanel.position.y = gateHeight / 2;
        view.rightPanel.position.y = gateHeight / 2;
        group.add(view.leftPanel, view.rightPanel);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(RACE_TRACK.width, .12, obstacle.depth + .08), new THREE.MeshStandardMaterial({ color: 0xffd582, emissive: 0x885329, emissiveIntensity: .19, roughness: .5 }));
        trim.position.y = gateHeight + .06;
        group.add(trim);
      } else if (obstacle.kind === 'sweeper') {
        const beam = new THREE.Group();
        beam.position.y = .525;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(obstacle.width, 1.05, obstacle.depth), beamMaterial);
        bar.position.y = 0;
        beam.add(bar);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(.44, .44, .3, 14), hubMaterial);
        beam.add(hub);
        view.beam = beam;
        group.add(beam);
      }
      this.scene.add(group);
      this.obstacleViews.push(view);
    }
  }

  private updateObstacles(elapsedMs: number) {
    for (const view of this.obstacleViews) {
      const { obstacle } = view;
      if (obstacle.kind === 'gate' && view.leftPanel && view.rightPanel) {
        const center = obstacleOffset(obstacle, elapsedMs);
        const openingLeft = center - obstacle.width / 2;
        const openingRight = center + obstacle.width / 2;
        const leftWidth = Math.max(0, halfTrack + openingLeft);
        const rightWidth = Math.max(0, halfTrack - openingRight);
        view.leftPanel.scale.x = leftWidth;
        view.leftPanel.position.x = -halfTrack + leftWidth / 2;
        view.rightPanel.scale.x = rightWidth;
        view.rightPanel.position.x = openingRight + rightWidth / 2;
      } else if (obstacle.kind === 'sweeper' && view.beam) {
        view.beam.rotation.y = sweeperVisualRotation(obstacleOffset(obstacle, elapsedMs));
      }
    }
  }

  private ensureRacer(player: RacePlayer): RacerView {
    const existing = this.racers.get(player.id);
    if (existing) {
      existing.actor.visible = true;
      existing.shadow.visible = true;
      return existing;
    }
    const actor = new THREE.Group();
    actor.name = `racer-${player.id}`;
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = .012;
    actor.add(shadow);
    const markerMaterial = this.markerMaterial.clone();
    markerMaterial.color.set(runnerColor(player.characterId));
    const marker = new THREE.Mesh(this.markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = .025;
    actor.add(marker);
    const body = new THREE.Group();
    body.position.y = .9;
    actor.add(body);
    const tagTexture = roundedLabel('', 512, 104, 46, runnerColor(player.characterId));
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture, transparent: true, depthTest: true }));
    tag.scale.set(3.65, .74, 1);
    tag.position.set(0, 2.45, 0);
    tag.renderOrder = 3;
    actor.add(tag);
    const view: RacerView = {
      id: player.id,
      characterId: '',
      actor,
      body,
      shadow,
      marker,
      tag,
      tagTexture,
      mixer: null,
      model: null,
      actions: new Map(),
      currentAction: null,
      currentActionName: '',
      tagValue: '',
    };
    this.racers.set(player.id, view);
    this.scene.add(actor);
    this.makeFallback(view, player.characterId);
    this.mountCharacter(view, player.characterId);
    this.updateTag(view, player);
    return view;
  }

  private makeFallback(view: RacerView, characterId: string) {
    this.clearCharacter(view);
    view.body.clear();
    const color = new THREE.Color(runnerColor(characterId));
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: .68 });
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffd4a4, roughness: .7 });
    const torso = new THREE.Mesh(this.fallbackBodyGeometry, bodyMaterial);
    torso.position.y = -.06;
    torso.castShadow = true;
    const head = new THREE.Mesh(this.fallbackHeadGeometry, headMaterial);
    head.position.y = .93;
    head.castShadow = true;
    const sash = new THREE.Mesh(this.fallbackSashGeometry, new THREE.MeshStandardMaterial({ color: 0x233c53, roughness: .58 }));
    sash.position.set(0, .08, .33);
    view.body.add(torso, head, sash);
    view.model = null;
    view.actions.clear();
    view.mixer = null;
    view.currentAction = null;
    view.currentActionName = '';
  }

  private mountCharacter(view: RacerView, characterId: string) {
    if (view.characterId === characterId && (view.model || !this.models.has(characterId))) return;
    view.characterId = characterId;
    const source = this.models.get(characterId);
    if (!source) {
      this.makeFallback(view, characterId);
      return;
    }
    this.clearCharacter(view);
    view.body.clear();
    const clone = cloneSkinned(source.scene);
    clone.rotation.y = 0;
    clone.scale.setScalar(.84);
    const weapons = new Set(['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable']);
    clone.traverse(object => {
      if (weapons.has(object.name)) object.visible = false;
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    const bounds = new THREE.Box3().setFromObject(clone);
    clone.position.y -= (bounds.min.y + bounds.max.y) / 2;
    view.body.add(clone);
    view.model = clone;
    view.mixer = new THREE.AnimationMixer(clone);
    view.actions.clear();
    view.currentAction = null;
    view.currentActionName = '';
    for (const clip of source.animations) view.actions.set(clip.name, view.mixer.clipAction(clip));
  }

  private clearCharacter(view: RacerView) {
    view.mixer?.stopAllAction();
    if (view.model && view.mixer) view.mixer.uncacheRoot(view.model);
    if (view.model) {
      view.model.traverse(object => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      });
    } else {
      view.body.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
        if (object.geometry !== this.fallbackBodyGeometry && object.geometry !== this.fallbackHeadGeometry && object.geometry !== this.fallbackSashGeometry) object.geometry.dispose();
      });
    }
    view.model = null;
    view.mixer = null;
    view.actions.clear();
    view.currentAction = null;
    view.currentActionName = '';
  }

  private updateRacer(view: RacerView, player: RacePlayer, position: RacePosition, dt: number, elapsedMs: number, isLocal: boolean) {
    const verticalPosition = clamp(position.y, -4.5, 5.5);
    view.actor.position.set(clamp(position.x, -5.5, 5.5), verticalPosition, position.z);
    view.actor.rotation.y = 0;
    view.shadow.position.y = -verticalPosition + .012;
    view.marker.position.y = -verticalPosition + .025;
    view.shadow.scale.setScalar(clamp(1 - Math.max(0, position.y) * .1, .45, 1));
    view.marker.material instanceof THREE.MeshBasicMaterial && (view.marker.material.opacity = player.invulnerableMs > 0 ? .42 + Math.sin(elapsedMs * .026) * .32 : .92);
    const fallen = player.status === 'falling';
    const side = (player.id.charCodeAt(0) % 2 ? 1 : -1);
    view.body.position.y = fallen ? .52 : .9;
    view.body.rotation.z = fallen ? side * 1.14 : player.stunMs > 0 ? side * .12 : 0;
    const state = player.status === 'finished' ? 'Cheer'
      : fallen ? 'Hit_A'
        : player.stunMs > 0 ? 'Hit_A'
          : position.y > .12 ? 'Jump_Full_Short'
            : elapsedMs === 0 ? 'Idle' : 'Running_A';
    this.playAction(view, state);
    view.mixer?.update(dt);
    this.updateTag(view, player, isLocal);
  }

  private playAction(view: RacerView, name: string) {
    const action = view.actions.get(name)
      ?? view.actions.get(name === 'Cheer' ? 'Idle' : 'Running_A')
      ?? view.actions.get('Idle');
    if (!action || view.currentAction === action) return;
    action.reset();
    action.setLoop(name === 'Jump_Full_Short' || name === 'Hit_A' ? THREE.LoopOnce : THREE.LoopRepeat, name === 'Jump_Full_Short' || name === 'Hit_A' ? 1 : Infinity);
    action.clampWhenFinished = name === 'Jump_Full_Short' || name === 'Hit_A';
    action.fadeIn(.13).play();
    view.currentAction?.fadeOut(.13);
    view.currentAction = action;
    view.currentActionName = name;
  }

  private updateTag(view: RacerView, player: RacePlayer, full = true) {
    const name = player.name || 'Runner';
    const compactName = name.length > 6 ? `${name.slice(0, 5)}…` : name;
    const value = `#${player.rank > 0 ? player.rank : '•'}  ${full ? `${name}${player.isBot ? '  BOT' : ''}` : compactName}`;
    const cacheKey = `${full ? 'full' : 'compact'}\u0000${value}`;
    view.tag.scale.set(full ? 3.65 : 1.72, full ? .74 : .48, 1);
    view.tag.position.y = full ? 2.45 : 2.26;
    if (cacheKey === view.tagValue) return;
    view.tagValue = cacheKey;
    const canvas = view.tagTexture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 20);
    context.fillStyle = 'rgba(19, 39, 55, 0.88)';
    context.fill();
    context.strokeStyle = runnerColor(player.characterId);
    context.lineWidth = 4;
    context.stroke();
    context.fillStyle = '#fffaf0';
    context.font = `700 ${full ? 46 : 34}px Outfit, Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(value, canvas.width / 2, canvas.height / 2, canvas.width - 22);
    view.tagTexture.needsUpdate = true;
  }

  private updateTagVisibility(players: RacePlayer[], localPlayerId: string, focusId: string) {
    const focus = players.find(player => player.id === focusId) ?? players.find(player => player.id === localPlayerId);
    const shown = new Set<string>([localPlayerId]);
    if (!focus) {
      for (const view of this.racers.values()) view.tag.visible = shown.has(view.id);
      return;
    }
    const candidates = players
      .filter(player => player.id !== localPlayerId && player.id !== focus.id)
      .filter(player => Math.abs(player.z - focus.z) <= 42)
      .sort((a, b) => Math.hypot(a.x - focus.x, (a.z - focus.z) * .42) - Math.hypot(b.x - focus.x, (b.z - focus.z) * .42));
    const separated: RacePlayer[] = [];
    if (focus.id !== localPlayerId) shown.add(focus.id);
    for (const candidate of candidates) {
      if (separated.length >= 2) break;
      const apartFromFocus = Math.abs(candidate.x - focus.x) >= 2.05 || Math.abs(candidate.z - focus.z) >= 8;
      const apartFromOtherTags = separated.every(other => Math.abs(candidate.x - other.x) >= 2.05 || Math.abs(candidate.z - other.z) >= 8);
      if (!apartFromFocus || !apartFromOtherTags) continue;
      separated.push(candidate);
      shown.add(candidate.id);
    }
    for (const view of this.racers.values()) view.tag.visible = shown.has(view.id);
  }

  private async loadAssets(): Promise<void> {
    const jobs: [string, string][] = [
      ...CHARACTERS.map(character => [character.model, `assets/character/${character.model}.glb`] as [string, string]),
      ['animation_movement', 'assets/animations/Rig_Medium_MovementBasic.glb'],
      ['animation_general', 'assets/animations/Rig_Medium_General.glb'],
      ['animation_simulation', 'assets/animations/Rig_Medium_Simulation.glb'],
    ];
    const results = await Promise.allSettled(jobs.map(async ([name, path]) => [name, await this.loader.loadAsync(asset(path))] as const));
    const loaded = new Map<string, GltfAsset>();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') loaded.set(result.value[0], result.value[1]);
      else console.warn(`Race scene asset ${jobs[index][0]} failed to load; using a fallback runner where needed.`, result.reason);
    });
    if (this.destroyed) {
      for (const gltf of loaded.values()) this.collectResources(gltf.scene);
      for (const resource of this.sceneResources) resource.dispose();
      return;
    }
    this.sourceScenes.push(...[...loaded.values()].map(gltf => gltf.scene));
    const shared: [string, string, string][] = [
      ['animation_general', 'Idle_A', 'Idle'],
      ['animation_movement', 'Running_A', 'Running_A'],
      ['animation_movement', 'Jump_Full_Short', 'Jump_Full_Short'],
      ['animation_general', 'Hit_A', 'Hit_A'],
      ['animation_simulation', 'Cheering', 'Cheer'],
    ];
    for (const [setName, sourceName, actionName] of shared) {
      const clip = loaded.get(setName)?.animations.find(candidate => candidate.name === sourceName);
      if (clip) {
        const named = clip.clone();
        named.name = actionName;
        this.sharedClips.set(actionName, named);
      }
    }
    for (const character of CHARACTERS) {
      const gltf = loaded.get(character.model);
      if (!gltf) continue;
      const importedNames = new Set(this.sharedClips.keys());
      const animations = gltf.animations.filter(clip => !importedNames.has(clip.name)).concat([...this.sharedClips.values()]);
      this.models.set(character.id, { scene: gltf.scene, animations });
    }
    for (const [id, view] of this.racers) {
      const player = this.latestSnapshot?.players.find(candidate => candidate.id === id);
      if (player) this.mountCharacter(view, player.characterId);
    }
    if (this.latestSnapshot) this.renderer.render(this.scene, this.camera);
  }

  private collectResources(root: THREE.Object3D) {
    root.traverse(object => {
      if (object instanceof THREE.Mesh) this.sceneResources.add(object.geometry);
      const renderable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) {
        this.sceneResources.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) this.sceneResources.add(value);
      }
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    });
  }
}
