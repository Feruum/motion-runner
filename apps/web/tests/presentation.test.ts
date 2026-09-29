import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RunnerWorld } from '../src/presentation/world';
import { RhythmStarsPresentation } from '../src/presentation/rhythm-stars';
import { MirrorCoachPresentation } from '../src/presentation/mirror-coach';
import { CONFIG as C, GameEngine } from '@motion-runner/game';
import { analysis } from './fixtures';

function harness() {
  const world = Object.create(RunnerWorld.prototype) as RunnerWorld;
  const actor = new THREE.Group(), moving = new THREE.Group();
  const mixer = { update: vi.fn(), stopAllAction: vi.fn(), uncacheRoot: vi.fn() };
  const camera = new THREE.PerspectiveCamera(44, 0.6, 0.1, 240);
  camera.position.set(0, 4.8, 10.8);
  camera.lookAt(0, 1.4, -18);
  const playAction = vi.fn((name: string) => Object.assign(world, { currentActionName: name }));
  const burst = vi.fn();
  Object.assign(world, {
    actor, moving, mixer, actions: new Map(), obstacleGroups: new Map(),
    rhythmStars: new RhythmStarsPresentation(),
    mirrorCoach: new MirrorCoachPresentation(), camera, cameraCoachMix: 0,
    currentJumpMs: -Infinity, reactionUntilMs: -Infinity, currentActionName: 'Idle',
    lastSuccessCount: 0, lastHitCount: 0, elapsedMs: 0, previousStage: 'WELCOME',
    previewTimeMs: 0, previewJumpStartedMs: -Infinity, previewPoseTime: -1,
    particleBatch: { update: vi.fn() }, playAction, burst,
    updateTrack: vi.fn(), render: vi.fn(), environment: { update: vi.fn() }, canvas: { dataset: {} },
    lowFallback: new THREE.Mesh(new THREE.BoxGeometry(2.5, .52, .75)),
    tallFallback: new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, .7)),
  });
  return { world, actor, moving, mixer, playAction, burst, camera };
}

describe('Runner presentation', () => {
  it('keeps the jump animation for the entire airborne interval', () => {
    const { world, playAction } = harness();
    const game = new GameEngine();
    game.update(0, { lane: 0, jump: true });
    world.update('PLAYING', game, 16);
    for (const dt of [16, 200, 300]) {
      game.update(dt, { lane: 0, jump: false });
      world.update('PLAYING', game, dt);
      expect(playAction.mock.lastCall?.[0]).toBe('Jump_Full_Short');
    }
    game.update(400, { lane: 0, jump: false });
    world.update('PLAYING', game, 16);
    expect(playAction.mock.lastCall?.[0]).toBe('Running_A');
  });

  it('places an obstacle at the runner exactly when the wave is scored', () => {
    const { world, moving, actor } = harness();
    const game = new GameEngine();
    game.update(C.firstWaveMs - 1, { lane: -1, jump: false });
    world.update('PLAYING', game, 16);
    expect(moving.getObjectByName('wave-0')!.position.z).toBeLessThan(actor.position.z);
    game.update(1, { lane: -1, jump: false });
    world.update('PLAYING', game, 16);
    expect(game.cleared).toBe(1);
    expect(moving.getObjectByName('wave-0')?.position.z).toBeCloseTo(actor.position.z);
    game.update(200, { lane: -1, jump: false });
    world.update('PLAYING', game, 16);
    expect(moving.getObjectByName('wave-0')!.position.z).toBeGreaterThan(actor.position.z);
    game.update(2000, { lane: -1, jump: false });
    world.update('PLAYING', game, 16);
    expect(moving.getObjectByName('wave-0')).toBeUndefined();
  });

  it('rests both authored barriers and centered fallback meshes on the track', () => {
    for (const authored of [false, true]) {
      const { world, moving } = harness();
      if (authored) Object.assign(world, {
        highModel: new THREE.Mesh(new THREE.BoxGeometry(3, 4, 1).translate(0, 2, 0)),
        lowModel: new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1).translate(0, .5, 0)),
      });
      const game = new GameEngine();
      game.update(5000, { lane: 0, jump: false });
      world.update('PLAYING', game, 16);
      for (const model of moving.getObjectByName('wave-1')!.children) {
        expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(0);
      }
    }
  });

  it('freezes animation while tracking is paused', () => {
    const { world, mixer } = harness();
    const game = new GameEngine();
    game.paused = true;
    world.update('PAUSED', game, 80);
    expect(mixer.update).toHaveBeenCalledWith(0);
  });

  it('shows tutorial leans and a single jump without advancing the scored game', () => {
    const { world, actor, playAction } = harness();
    const game = new GameEngine();
    const jump = analysis(100, { lane: -1, jumpTriggered: true, handsUp: true, handsDown: false });
    world.update('TUTORIAL', game, 100, jump);
    world.update('TUTORIAL', game, 100, jump);
    expect(actor.position.x).toBeLessThan(0);
    expect(actor.position.y).toBeGreaterThan(0);
    expect(playAction.mock.lastCall?.[0]).toBe('Jump_Full_Short');
    for (let i = 0; i < 10; i++) world.update('TUTORIAL', game, 100, jump);
    expect(actor.position.y).toBe(0);
    expect(game.elapsedMs).toBe(0);
    expect(game.score).toBe(0);
  });

  it('hides weapon meshes without removing animation targets or the cape', () => {
    const { world, actor } = harness();
    const model = new THREE.Group();
    for (const name of ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable', 'Rogue_Body', 'Rogue_Cape']) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      mesh.name = name; model.add(mesh);
    }
    (world as unknown as { mountCharacter(model: THREE.Object3D, clips: THREE.AnimationClip[]): void }).mountCharacter(model, []);
    for (const name of ['Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable']) expect(actor.getObjectByName(name)?.visible).toBe(false);
    expect(actor.getObjectByName('Rogue_Cape')?.visible).toBe(true);
  });
});
