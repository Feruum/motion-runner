import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { DANCE_CUES, type DanceFeatureId } from '../../../../packages/game/src/core/dance';
import type { MirrorCoachState } from './mirror-coach-state';

type MirrorAction = MirrorCoachState['action'];
type ArmKey = 'l' | 'r';
type ScreenSide = 'left' | 'right';

interface ArmRig {
  upper: THREE.Bone;
  lower: THREE.Bone;
  hand: THREE.Bone;
}

interface ArmPose {
  upper: THREE.Vector3;
  forearm: THREE.Vector3;
}

interface LegRig {
  upper: THREE.Bone;
  lower: THREE.Bone;
  foot: THREE.Bone;
}

type DanceTargets = Record<DanceFeatureId, number>;

const DANCE_NEUTRAL_TARGETS: DanceTargets = {
  leftWristOut: 0.36,
  leftWristY: 0.82,
  leftElbowAngleDeg: 180,
  rightWristOut: 0.36,
  rightWristY: 0.82,
  rightElbowAngleDeg: 180,
  torsoLeanDeg: 0,
  leftFootOut: 0.27,
  rightFootOut: 0.27,
};
const STEP_KNEE_FLEX_REACH = 0.02;

function rigBone(model: THREE.Object3D, name: string, side: ArmKey): THREE.Bone | null {
  for (const candidate of [name + side, name + '.' + side]) {
    const object = model.getObjectByName(candidate);
    if (object instanceof THREE.Bone) return object;
  }
  return null;
}

const NEUTRAL_DIRECTION = (screenSide: ScreenSide) => new THREE.Vector3(screenSide === 'left' ? -0.2 : 0.2, -0.98, 0);
const UP_DIRECTION = (screenSide: ScreenSide) => new THREE.Vector3(screenSide === 'left' ? -0.62 : 0.62, 0.78, 0);
const OUT_DIRECTION = (screenSide: ScreenSide) => new THREE.Vector3(screenSide === 'left' ? -1 : 1, 0.06, 0);

function material(color: number, roughness = 0.65, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh<T extends THREE.BufferGeometry>(
  parent: THREE.Object3D,
  name: string,
  geometry: T,
  surface: THREE.Material,
  position = new THREE.Vector3(),
): THREE.Mesh<T, THREE.Material> {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function normalized(vector: THREE.Vector3): THREE.Vector3 {
  return vector.lengthSq() > 1e-8 ? vector.normalize() : new THREE.Vector3(0, -1, 0);
}

/** Displays the selected KayKit character as a front-facing Mirror coach and SixSeven demonstrator. */
export class MirrorCoachPresentation {
  readonly group = new THREE.Group();
  private readonly avatar = new THREE.Group();
  private readonly ownedResources = new Set<THREE.BufferGeometry | THREE.Material>();
  private readonly currentPoses = new Map<ArmKey, ArmPose>();
  private readonly arms = new Map<ArmKey, ArmRig | null>();
  private readonly legs = new Map<ArmKey, LegRig | null>();
  private readonly legRestRotations = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly danceFootTargets = new Map<ArmKey, THREE.Vector3>();
  private character: THREE.Object3D | null = null;
  private hips: THREE.Bone | null = null;
  private hipsRestPosition: THREE.Vector3 | null = null;
  private spine: THREE.Bone | null = null;
  private spineRestRotation: THREE.Quaternion | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private elapsedSeconds = 0;
  private lean = 0;
  private bob = 0;
  private poseReady = false;
  private danceModeActive = false;
  private disposed = false;

  constructor() {
    this.group.name = 'mirror-coach';
    this.group.position.set(0, 0, -1.45);
    this.group.visible = false;
    this.avatar.name = 'mirror-coach-avatar';
    this.group.add(this.avatar);
    this.currentPoses.set('r', { upper: NEUTRAL_DIRECTION('left'), forearm: NEUTRAL_DIRECTION('left') });
    this.currentPoses.set('l', { upper: NEUTRAL_DIRECTION('right'), forearm: NEUTRAL_DIRECTION('right') });
    this.buildPlatform();
  }

  setCharacter(model: THREE.Object3D, clips: THREE.AnimationClip[] = [], characterId = 'selected'): void {
    if (this.disposed) return;
    this.clearCharacter();

    const clone = cloneSkinned(model);
    clone.name = 'mirror-coach-character';
    clone.scale.multiplyScalar(1.18);
    const weapons = new Set([
      'Knife', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Throwable',
      '1H_Sword_Offhand', '1H_Axe_Offhand',
    ]);
    clone.traverse(object => {
      if (weapons.has(object.name)) object.visible = false;
      if (object.name === 'handslotl' || object.name === 'handslotr' || object.name === 'handslot.l' || object.name === 'handslot.r') {
        for (const attachment of object.children) attachment.visible = false;
      }
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const bounds = new THREE.Box3().setFromObject(clone);
    clone.position.y -= bounds.min.y;
    this.avatar.add(clone);
    this.character = clone;
    this.group.userData.characterId = characterId;
    this.arms.set('l', this.makeArm(clone, 'l'));
    this.arms.set('r', this.makeArm(clone, 'r'));
    this.legs.set('l', this.makeLeg(clone, 'l'));
    this.legs.set('r', this.makeLeg(clone, 'r'));
    this.hips = this.findBone(clone, 'hips');
    this.spine = this.findBone(clone, 'spine');

    const availableClips = clips.length > 0 ? clips : (model as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations ?? [];
    const idle = availableClips.find(clip => clip.name === 'Idle' || clip.name === 'Idle_A');
    if (idle) {
      this.mixer = new THREE.AnimationMixer(clone);
      const action = this.mixer.clipAction(idle);
      action.setLoop(THREE.LoopRepeat, Infinity).play();
      this.mixer.update(0);
    }

    this.captureDanceRestPose();

    this.lean = 0;
    this.bob = 0;
    this.poseReady = false;
    this.applyArmPose('NEUTRAL', false);
  }

  update(state: MirrorCoachState | null, dtSeconds: number, frozen = false): void {
    if (this.disposed) return;
    if (!state) {
      this.reset();
      return;
    }

    const action = state.awaitingNeutral || state.phase === 'complete' ? 'NEUTRAL' : state.action;
    this.animate(action, dtSeconds, frozen, false, 0);
  }

  /** Alternates two bent-arm, one-hand-up poses while the runner stays in place. */
  updateMeme(elapsedMs: number, dtSeconds: number, frozen = false): ScreenSide {
    if (this.disposed) return 'left';
    const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
    const raisedSide: ScreenSide = Math.floor(safeElapsedMs / 650) % 2 === 0 ? 'left' : 'right';
    const action: MirrorAction = raisedSide === 'left' ? 'LEFT_HAND_UP' : 'RIGHT_HAND_UP';
    this.animate(action, dtSeconds, frozen, true, safeElapsedMs);
    return raisedSide;
  }

  /** Enables the full-body dancer while keeping the selected KayKit character in view. */
  setDanceMode(enabled: boolean): void {
    if (this.disposed) return;
    this.danceModeActive = enabled;
    this.reset();
    if (enabled) {
      this.group.visible = true;
      this.group.userData.danceCueIndex = null;
      this.group.userData.danceCueId = null;
      this.group.userData.danceCueName = null;
      this.group.userData.danceTargets = null;
      return;
    }
    delete this.group.userData.danceCueIndex;
    delete this.group.userData.danceCueId;
    delete this.group.userData.danceCueName;
    delete this.group.userData.danceTargets;
  }

  /** Applies the exact authored cue used by Dance Solo/Duo scoring. A null index shows neutral. */
  updateDance(cueIndex: number | null, dtSeconds: number, frozen = false): void {
    if (this.disposed || !this.danceModeActive) return;

    const cue = cueIndex !== null && Number.isInteger(cueIndex) ? DANCE_CUES[cueIndex] ?? null : null;
    const targets: DanceTargets = cue
      ? { ...DANCE_NEUTRAL_TARGETS, ...Object.fromEntries(cue.features.map(item => [item.id, item.target])) } as DanceTargets
      : DANCE_NEUTRAL_TARGETS;
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtSeconds) ? dtSeconds : 0));
    this.group.visible = true;
    this.avatar.position.y = 0.22;

    if (cue) {
      this.group.userData.danceCueIndex = cueIndex;
      this.group.userData.danceCueId = cue.id;
      this.group.userData.danceCueName = cue.name;
      this.group.userData.danceTargets = Object.fromEntries(cue.features.map(item => [item.id, item.target]));
      if (!frozen && dt > 0) {
        this.lean = THREE.MathUtils.damp(this.lean, targets.torsoLeanDeg * Math.PI / 180, 8, dt);
      }
    } else {
      this.group.userData.danceCueIndex = null;
      this.group.userData.danceCueId = null;
      this.group.userData.danceCueName = null;
      this.group.userData.danceTargets = null;
      this.lean = 0;
      this.bob = 0;
    }

    if (!frozen) this.mixer?.update(dt);
    if (!this.character) return;

    this.character.rotation.z = 0;
    this.restoreDanceRestPose();
    if (this.spine && this.spineRestRotation) {
      this.spine.quaternion.copy(this.spineRestRotation).multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean),
      );
    }
    if (cue) {
      this.lowerPelvisForStep(targets);
      this.applyDancePose(targets);
    } else {
      this.poseReady = false;
      this.applyArmPose('NEUTRAL', false, 0, true);
    }
  }

  reset(): void {
    if (this.disposed) return;
    this.group.visible = false;
    this.elapsedSeconds = 0;
    this.lean = 0;
    this.bob = 0;
    this.poseReady = false;
    if (this.character) {
      this.character.rotation.z = 0;
      this.mixer?.update(0);
      this.restoreDanceRestPose();
      this.applyArmPose('NEUTRAL', false);
    }
    this.avatar.position.y = 0.22;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCharacter();
    for (const resource of this.ownedResources) resource.dispose();
    this.ownedResources.clear();
    this.group.removeFromParent();
    this.group.clear();
  }

  private animate(action: MirrorAction, dtSeconds: number, frozen: boolean, meme: boolean, elapsedMs: number): void {
    this.group.visible = true;
    const dt = Math.max(0, Math.min(0.1, dtSeconds));
    const targetLean = action === 'LEFT' ? 0.22 : action === 'RIGHT' ? -0.22 : 0;
    if (!frozen && dt > 0) {
      this.elapsedSeconds += dt;
      this.lean = THREE.MathUtils.damp(this.lean, targetLean, 8, dt);
      this.bob = meme
        ? Math.abs(Math.sin(this.elapsedSeconds * 9)) * 0.045
        : Math.sin(this.elapsedSeconds * 2.2) * 0.018;
    }
    if (!this.character) {
      this.avatar.position.y = 0.22 + this.bob;
      return;
    }

    this.avatar.position.y = 0.22 + this.bob;
    this.character.rotation.z = this.lean;
    if (!frozen) this.mixer?.update(dt);
    const poseAction = meme
      ? Math.floor(elapsedMs / 650) % 2 === 0 ? 'LEFT_HAND_UP' : 'RIGHT_HAND_UP'
      : action;
    this.applyArmPose(poseAction, meme, dt, frozen);
  }

  private makeArm(model: THREE.Object3D, side: ArmKey): ArmRig | null {
    const upper = rigBone(model, 'upperarm', side);
    const lower = rigBone(model, 'lowerarm', side);
    const hand = rigBone(model, 'hand', side);
    if (!(upper instanceof THREE.Bone) || !(lower instanceof THREE.Bone) || !(hand instanceof THREE.Bone)) {
      console.warn('The selected KayKit character is missing its ' + side + ' arm bones.');
      return null;
    }
    return { upper, lower, hand };
  }

  private makeLeg(model: THREE.Object3D, side: ArmKey): LegRig | null {
    const upper = rigBone(model, 'upperleg', side);
    const lower = rigBone(model, 'lowerleg', side);
    const foot = rigBone(model, 'foot', side);
    if (!upper || !lower || !foot) {
      console.warn('The selected KayKit character is missing its ' + side + ' leg bones.');
      return null;
    }
    return { upper, lower, foot };
  }

  private findBone(model: THREE.Object3D, name: string): THREE.Bone | null {
    const object = model.getObjectByName(name);
    return object instanceof THREE.Bone ? object : null;
  }

  private captureDanceRestPose(): void {
    this.hipsRestPosition = this.hips?.position.clone() ?? null;
    this.spineRestRotation = this.spine?.quaternion.clone() ?? null;
    this.legRestRotations.clear();
    for (const leg of this.legs.values()) {
      if (!leg) continue;
      for (const bone of [leg.upper, leg.lower, leg.foot]) this.legRestRotations.set(bone, bone.quaternion.clone());
    }
  }

  private restoreDanceRestPose(): void {
    if (this.hips && this.hipsRestPosition) this.hips.position.copy(this.hipsRestPosition);
    if (this.spine && this.spineRestRotation) this.spine.quaternion.copy(this.spineRestRotation);
    for (const [bone, rotation] of this.legRestRotations) bone.quaternion.copy(rotation);
    this.danceFootTargets.clear();
    this.character?.updateMatrixWorld(true);
  }

  private lowerPelvisForStep(targets: DanceTargets): void {
    if (!this.character || !this.hips) return;
    this.character.updateMatrixWorld(true);
    const hipsPosition = this.hips.getWorldPosition(new THREE.Vector3());
    const shoulderPositions = (['l', 'r'] as const)
      .map(side => this.arms.get(side)?.upper?.getWorldPosition(new THREE.Vector3()))
      .filter((position): position is THREE.Vector3 => !!position);
    if (shoulderPositions.length !== 2) return;
    const shoulderCenter = shoulderPositions[0].add(shoulderPositions[1]).multiplyScalar(0.5);
    const torsoLength = shoulderCenter.distanceTo(hipsPosition);
    if (torsoLength < 1e-5) return;

    let pelvisDrop = 0;
    for (const featureSide of ['left', 'right'] as const) {
      const rigSide: ArmKey = featureSide === 'left' ? 'r' : 'l';
      const sign = featureSide === 'left' ? -1 : 1;
      const footFeature: DanceFeatureId = featureSide === 'left' ? 'leftFootOut' : 'rightFootOut';
      const leg = this.legs.get(rigSide);
      if (!leg) continue;
      const upper = leg.upper.getWorldPosition(new THREE.Vector3());
      const lower = leg.lower.getWorldPosition(new THREE.Vector3());
      const foot = leg.foot.getWorldPosition(new THREE.Vector3());
      const footTarget = new THREE.Vector3(
        hipsPosition.x + sign * targets[footFeature] * torsoLength,
        foot.y,
        foot.z,
      );
      this.danceFootTargets.set(rigSide, footTarget);

      // Small stance shifts stay in the authored leg pose. Pelvis lowering is only
      // needed for the wide, one-foot step cues; applying it to a reach cue can
      // flatten a simultaneous torso lean.
      if (targets[footFeature] <= 0.45) continue;

      const reach = upper.distanceTo(lower) + lower.distanceTo(foot);
      const flexReach = targets[footFeature] > 0.45 ? Math.max(1e-5, reach - STEP_KNEE_FLEX_REACH) : reach;
      const dx = footTarget.x - upper.x;
      const dz = footTarget.z - upper.z;
      const horizontal = Math.hypot(dx, dz);
      if (horizontal >= flexReach) continue;
      const maxVertical = Math.sqrt(Math.max(0, flexReach * flexReach - horizontal * horizontal));
      const currentVertical = Math.abs(footTarget.y - upper.y);
      pelvisDrop = Math.max(pelvisDrop, currentVertical - maxVertical);
    }

    if (pelvisDrop > 0 && this.hipsRestPosition) {
      const parentScale = this.hips.parent?.getWorldScale(new THREE.Vector3()).y ?? 1;
      this.hips.position.y = this.hipsRestPosition.y - pelvisDrop / Math.max(parentScale, 1e-5);
      this.character.updateMatrixWorld(true);
    }
  }

  private applyDancePose(targets: DanceTargets): void {
    if (!this.character || !this.hips) return;
    this.character.updateMatrixWorld(true);
    const hipsPosition = this.hips.getWorldPosition(new THREE.Vector3());
    const shoulderPositions = (['l', 'r'] as const)
      .map(side => this.arms.get(side)?.upper?.getWorldPosition(new THREE.Vector3()))
      .filter((position): position is THREE.Vector3 => !!position);
    if (shoulderPositions.length !== 2) return;
    const shoulderCenter = shoulderPositions[0].add(shoulderPositions[1]).multiplyScalar(0.5);
    const torsoLength = shoulderCenter.distanceTo(hipsPosition);
    if (torsoLength < 1e-5) return;

    // Dance landmarks are resolved in a mirrored camera view: anatomical left appears at screen-left.
    for (const featureSide of ['left', 'right'] as const) {
      const rigSide: ArmKey = featureSide === 'left' ? 'r' : 'l';
      const sign = featureSide === 'left' ? -1 : 1;
      const outFeature: DanceFeatureId = featureSide === 'left' ? 'leftWristOut' : 'rightWristOut';
      const wristYFeature: DanceFeatureId = featureSide === 'left' ? 'leftWristY' : 'rightWristY';
      const arm = this.arms.get(rigSide);
      if (!arm) continue;
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const raised = targets[wristYFeature] < 0;
      const wristTarget = new THREE.Vector3(
        hipsPosition.x + sign * targets[outFeature] * torsoLength,
        shoulderCenter.y - targets[wristYFeature] * torsoLength,
        shoulderCenter.z,
      );
      // KayKit's hooded heads are much wider than a human head relative to the
      // arms. Keep an overhead hand outside that silhouette so the gesture reads
      // on the selected asset instead of disappearing inside its hood.
      const direction = raised
        ? UP_DIRECTION(featureSide)
        : normalized(wristTarget.sub(shoulder));
      this.orientBone(arm.upper, arm.lower, direction);
      this.character.updateMatrixWorld(true);
      this.orientBone(arm.lower, arm.hand, direction);
      this.character.updateMatrixWorld(true);
    }

    for (const featureSide of ['left', 'right'] as const) {
      const rigSide: ArmKey = featureSide === 'left' ? 'r' : 'l';
      const sign = featureSide === 'left' ? -1 : 1;
      const footOutFeature: DanceFeatureId = featureSide === 'left' ? 'leftFootOut' : 'rightFootOut';
      const leg = this.legs.get(rigSide);
      if (!leg) continue;
      const upper = leg.upper.getWorldPosition(new THREE.Vector3());
      const lower = leg.lower.getWorldPosition(new THREE.Vector3());
      const foot = leg.foot.getWorldPosition(new THREE.Vector3());
      const footTarget = this.danceFootTargets.get(rigSide) ?? new THREE.Vector3(
        hipsPosition.x + sign * targets[footOutFeature] * torsoLength,
        foot.y,
        foot.z,
      );
      const upperLength = upper.distanceTo(lower);
      const lowerLength = lower.distanceTo(foot);
      const restingFootWorldRotation = leg.foot.getWorldQuaternion(new THREE.Quaternion());
      const toFoot = footTarget.clone().sub(upper);
      const distance = Math.max(1e-5, toFoot.length());
      const axis = toFoot.multiplyScalar(1 / distance);
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      const bend = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      const knee = upper.clone().addScaledVector(axis, along).add(new THREE.Vector3(0, 0, bend));
      const upperDirection = normalized(knee.clone().sub(upper));
      const lowerDirection = normalized(footTarget.clone().sub(knee));
      this.orientBone(leg.upper, leg.lower, upperDirection);
      this.character.updateMatrixWorld(true);
      this.orientBone(leg.lower, leg.foot, lowerDirection);
      this.character.updateMatrixWorld(true);
      const parentWorldRotation = leg.foot.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      leg.foot.quaternion.copy(parentWorldRotation.invert().multiply(restingFootWorldRotation));
      this.character.updateMatrixWorld(true);
    }
  }

  private applyArmPose(action: MirrorAction, meme: boolean, dtSeconds = 0, frozen = false): void {
    if (!this.character) return;
    const goals = new Map<ArmKey, ArmPose>();
    for (const side of ['r', 'l'] as const) {
      const screenSide: ScreenSide = side === 'r' ? 'left' : 'right';
      const down = NEUTRAL_DIRECTION(screenSide);
      let upper = down.clone();
      let forearm = down.clone();
      const raised = action === 'BOTH_HANDS_UP'
        || (action === 'LEFT_HAND_UP' && screenSide === 'left')
        || (action === 'RIGHT_HAND_UP' && screenSide === 'right');
      if (raised) {
        if (meme) {
          const sign = screenSide === 'left' ? -1 : 1;
          upper = new THREE.Vector3(sign * 0.45, -1, 0.1);
          forearm = new THREE.Vector3(sign * -0.2, 0.05, 0.96);
        } else {
          upper = UP_DIRECTION(screenSide);
          forearm = UP_DIRECTION(screenSide);
        }
      } else if (action === 'ARMS_OUT') {
        upper = OUT_DIRECTION(screenSide);
        forearm = OUT_DIRECTION(screenSide);
      } else if (meme) {
        const sign = screenSide === 'left' ? -1 : 1;
        upper = new THREE.Vector3(sign * 0.42, -0.9, 0.12);
        forearm = new THREE.Vector3(sign * -0.2, -0.82, 0.53);
      }
      goals.set(side, { upper: normalized(upper), forearm: normalized(forearm) });
    }

    const blend = frozen || dtSeconds <= 0 ? 1 : 1 - Math.exp(-12 * Math.min(0.1, dtSeconds));
    for (const side of ['r', 'l'] as const) {
      const current = this.currentPoses.get(side)!;
      const goal = goals.get(side)!;
      if (!this.poseReady) {
        current.upper.copy(goal.upper);
        current.forearm.copy(goal.forearm);
      } else {
        current.upper.lerp(goal.upper, blend).normalize();
        current.forearm.lerp(goal.forearm, blend).normalize();
      }
    }
    this.poseReady = true;

    this.character.updateMatrixWorld(true);
    const modelWorldRotation = this.character.getWorldQuaternion(new THREE.Quaternion());
    for (const side of ['r', 'l'] as const) {
      const arm = this.arms.get(side);
      if (!arm) continue;
      const pose = this.currentPoses.get(side)!;
      const upperDirection = pose.upper.clone().applyQuaternion(modelWorldRotation).normalize();
      const forearmDirection = pose.forearm.clone().applyQuaternion(modelWorldRotation).normalize();
      this.orientBone(arm.upper, arm.lower, upperDirection);
      this.character.updateMatrixWorld(true);
      this.orientBone(arm.lower, arm.hand, forearmDirection);
      this.character.updateMatrixWorld(true);
    }
  }

  private orientBone(bone: THREE.Bone, child: THREE.Bone, targetWorldDirection: THREE.Vector3): void {
    bone.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const endpoint = child.getWorldPosition(new THREE.Vector3());
    const currentDirection = normalized(endpoint.sub(origin));
    const delta = new THREE.Quaternion().setFromUnitVectors(currentDirection, targetWorldDirection);
    const desiredWorldRotation = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    const parentWorldRotation = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    bone.quaternion.copy(parentWorldRotation.invert().multiply(desiredWorldRotation));
  }

  private clearCharacter(): void {
    this.mixer?.stopAllAction();
    if (this.character) {
      this.mixer?.uncacheRoot(this.character);
      this.character.traverse(object => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      });
      this.avatar.remove(this.character);
    }
    this.mixer = null;
    this.character = null;
    this.hips = null;
    this.hipsRestPosition = null;
    this.spine = null;
    this.spineRestRotation = null;
    this.arms.clear();
    this.legs.clear();
    this.legRestRotations.clear();
    this.danceFootTargets.clear();
  }

  private buildPlatform(): void {
    const base = material(0x263b50, 0.36, 0.3);
    const top = material(0x37576c, 0.52, 0.12);
    const mint = new THREE.MeshStandardMaterial({ color: 0x48d0bd, roughness: 0.32, metalness: 0.18, emissive: 0x0a4a47, emissiveIntensity: 0.35 });
    const gold = material(0xf3b45d, 0.32, 0.42);
    const baseMesh = addMesh(this.group, 'coach-platform-base', new THREE.CylinderGeometry(1.16, 1.24, 0.2, 56), base, new THREE.Vector3(0, 0.03, 0));
    const topMesh = addMesh(this.group, 'coach-platform', new THREE.CylinderGeometry(1.1, 1.16, 0.08, 56), top, new THREE.Vector3(0, 0.17, 0));
    const rim = addMesh(this.group, 'coach-platform-rim', new THREE.TorusGeometry(1.1, 0.025, 8, 56), mint, new THREE.Vector3(0, 0.214, 0));
    rim.rotation.x = Math.PI / 2;
    const innerRim = addMesh(this.group, 'coach-platform-inner-rim', new THREE.TorusGeometry(0.92, 0.012, 6, 48), gold, new THREE.Vector3(0, 0.215, 0));
    innerRim.rotation.x = Math.PI / 2;
    for (const mesh of [baseMesh, topMesh, rim, innerRim]) {
      this.ownedResources.add(mesh.geometry);
      for (const surface of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.ownedResources.add(surface);
    }
    this.avatar.position.y = 0.22;
  }
}
