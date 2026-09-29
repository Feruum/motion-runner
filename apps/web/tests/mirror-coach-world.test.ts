import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { MirrorCoachState } from '../src/presentation/mirror-coach-state';
import { MirrorCoachPresentation } from '../src/presentation/mirror-coach';
import { DANCE_CUES } from '../../../packages/game/src/core/dance';

function state(action: MirrorCoachState['action'], overrides: Partial<MirrorCoachState> = {}): MirrorCoachState {
  return {
    action,
    phase: 'demo',
    taskIndex: 0,
    elementIndex: 0,
    elapsedMs: 0,
    holdingMs: 0,
    awaitingNeutral: false,
    successful: false,
    instruction: 'Follow the coach',
    ...overrides,
  };
}

/** Mirrors the bundled KayKit GLB bind transforms: its unanimated arms point up. */
function selectedCharacterRig(actualKayKitProportions = false): THREE.Group {
  const model = new THREE.Group();
  model.name = 'selected-kaykit-character';
  const hips = new THREE.Bone();
  hips.name = 'hips';
  if (actualKayKitProportions) hips.position.y = 0.405663;
  model.add(hips);
  const spine = new THREE.Bone();
  spine.name = 'spine';
  if (actualKayKitProportions) spine.position.y = 0.191978;
  hips.add(spine);
  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.y = actualKayKitProportions ? 0.374988 : 1;
  spine.add(chest);
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = 0.268797;
  chest.add(head);

  for (const side of ['l', 'r'] as const) {
    const upper = new THREE.Bone();
    upper.name = 'upperarm' + side;
    upper.position.set(side === 'l' ? 0.212 : -0.212, 0.134, 0);
    upper.quaternion.set(
      -0.5141215,
      side === 'l' ? -0.4854678 : 0.4854678,
      side === 'l' ? -0.4854678 : 0.4854678,
      0.5141219,
    );
    chest.add(upper);

    const lower = new THREE.Bone();
    lower.name = 'lowerarm' + side;
    lower.position.y = 0.2418973;
    lower.quaternion.set(0, side === 'l' ? -0.00000006 : 0.00000006, side === 'l' ? -0.0552855 : 0.0552855, 0.9984706);
    upper.add(lower);

    const wrist = new THREE.Bone();
    wrist.name = 'wrist' + side;
    wrist.position.y = 0.2418973;
    lower.add(wrist);
    const hand = new THREE.Bone();
    hand.name = 'hand' + side;
    hand.position.y = 0.0738258;
    wrist.add(hand);

    const upperLeg = new THREE.Bone();
    upperLeg.name = 'upperleg' + side;
    upperLeg.position.set(side === 'l' ? 0.170945 : -0.170945, 0.113587, 0);
    upperLeg.quaternion.set(side === 'l' ? 0.999849 : 0.999849, 0, 0, 0.017373);
    hips.add(upperLeg);

    const lowerLeg = new THREE.Bone();
    lowerLeg.name = 'lowerleg' + side;
    lowerLeg.position.y = 0.227077;
    lowerLeg.quaternion.set(0.106225, 0, 0, 0.994342);
    upperLeg.add(lowerLeg);

    const foot = new THREE.Bone();
    foot.name = 'foot' + side;
    foot.position.y = 0.149437;
    lowerLeg.add(foot);
  }

  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.2), new THREE.MeshBasicMaterial());
  marker.name = 'selected-kaykit-mesh';
  hips.add(marker);
  return model;
}

function withCharacter(actualKayKitProportions = false): MirrorCoachPresentation {
  const presentation = new MirrorCoachPresentation();
  presentation.setCharacter(selectedCharacterRig(actualKayKitProportions), [], 'knight');
  return presentation;
}

function settle(presentation: MirrorCoachPresentation, action: MirrorCoachState['action']): void {
  const pose = state(action);
  for (let i = 0; i < 150; i++) presentation.update(pose, 1 / 60);
  presentation.group.updateMatrixWorld(true);
}

function position(presentation: MirrorCoachPresentation, name: string): THREE.Vector3 {
  const part = presentation.group.getObjectByName(name);
  if (!part) throw new Error('Expected Mirror coach part ' + name + ' to exist.');
  return part.getWorldPosition(new THREE.Vector3());
}

describe('MirrorCoachPresentation', () => {
  it('clones the selected KayKit asset and does not create a second character', () => {
    const presentation = new MirrorCoachPresentation();
    const source = selectedCharacterRig();
    const originalRotation = source.getObjectByName('upperarml')!.quaternion.clone();
    presentation.setCharacter(source, [], 'knight');

    const character = presentation.group.getObjectByName('mirror-coach-character');
    expect(character).toBeTruthy();
    expect(character).not.toBe(source);
    expect(presentation.group.getObjectByName('selected-kaykit-mesh')).toBeInstanceOf(THREE.Mesh);
    expect(presentation.group.getObjectByName('coach-face')).toBeUndefined();
    expect(presentation.group.getObjectByName('coach-torso')).toBeUndefined();
    expect(presentation.group.userData.characterId).toBe('knight');

    settle(presentation, 'LEFT_HAND_UP');
    expect(source.getObjectByName('upperarml')!.quaternion.angleTo(originalRotation)).toBeCloseTo(0);
    presentation.dispose();
  });

  it('maps Mirror hand cues to the existing screen-side convention using rig bones', () => {
    const presentation = withCharacter();

    settle(presentation, 'LEFT_HAND_UP');
    const leftUp = position(presentation, 'handr');
    const rightDown = position(presentation, 'handl');
    expect(leftUp.x).toBeLessThan(0);
    expect(leftUp.x).toBeLessThan(position(presentation, 'head').x - 0.25);
    expect(leftUp.y).toBeGreaterThan(rightDown.y + 0.6);

    settle(presentation, 'RIGHT_HAND_UP');
    const leftDown = position(presentation, 'handr');
    const rightUp = position(presentation, 'handl');
    expect(rightUp.x).toBeGreaterThan(0);
    expect(rightUp.x).toBeGreaterThan(position(presentation, 'head').x + 0.25);
    expect(rightUp.y).toBeGreaterThan(leftDown.y + 0.6);
    presentation.dispose();
  });

  it('keeps both Mirror arms straight when raised or extended', () => {
    const presentation = withCharacter();

    settle(presentation, 'BOTH_HANDS_UP');
    for (const side of ['l', 'r'] as const) {
      const shoulder = position(presentation, 'upperarm' + side);
      const elbow = position(presentation, 'lowerarm' + side);
      const hand = position(presentation, 'hand' + side);
      expect(hand.y).toBeGreaterThan(shoulder.y + 0.35);
      expect(elbow.clone().sub(shoulder).normalize().angleTo(hand.clone().sub(elbow).normalize())).toBeLessThan(0.08);
    }

    settle(presentation, 'ARMS_OUT');
    for (const side of ['l', 'r'] as const) {
      const shoulder = position(presentation, 'upperarm' + side);
      const hand = position(presentation, 'hand' + side);
      expect(Math.abs(hand.x - shoulder.x)).toBeGreaterThan(0.4);
      expect(hand.y).toBeCloseTo(shoulder.y, 1);
    }
    presentation.dispose();
  });

  it('leans in each requested screen direction and returns to neutral between combo poses', () => {
    const presentation = withCharacter();

    settle(presentation, 'NEUTRAL');
    const neutralHeadX = position(presentation, 'head').x;
    const feetX = position(presentation, 'hips').x;
    settle(presentation, 'LEFT');
    const leftHeadX = position(presentation, 'head').x;
    settle(presentation, 'RIGHT');
    const rightHeadX = position(presentation, 'head').x;
    expect(leftHeadX).toBeLessThan(feetX - 0.1);
    expect(rightHeadX).toBeGreaterThan(feetX + 0.1);
    expect(Math.abs(neutralHeadX - feetX)).toBeLessThan(0.1);

    settle(presentation, 'LEFT_HAND_UP');
    const raisedHandY = position(presentation, 'handr').y;
    for (let i = 0; i < 150; i++) presentation.update(state('LEFT_HAND_UP', { awaitingNeutral: true }), 1 / 60);
    presentation.group.updateMatrixWorld(true);
    expect(position(presentation, 'handr').y).toBeLessThan(raisedHandY - 0.6);
    presentation.dispose();
  });

  it('freezes the selected rig pose while paused, resets it, and disposes only owned platform resources', () => {
    const presentation = withCharacter();
    const leftPose = state('LEFT_HAND_UP');
    settle(presentation, 'LEFT_HAND_UP');
    const raised = position(presentation, 'handr');

    for (let i = 0; i < 30; i++) presentation.update(leftPose, 1 / 60, true);
    presentation.group.updateMatrixWorld(true);
    expect(position(presentation, 'handr').distanceTo(raised)).toBeCloseTo(0);

    presentation.reset();
    presentation.group.updateMatrixWorld(true);
    expect(presentation.group.visible).toBe(false);
    expect(position(presentation, 'handr').y).toBeLessThan(raised.y - 0.6);

    const platform = presentation.group.getObjectByName('coach-platform') as THREE.Mesh;
    const disposeGeometry = vi.spyOn(platform.geometry, 'dispose');
    presentation.dispose();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(presentation.group.children).toHaveLength(0);
  });

  it('alternates two stationary waist-to-chest hand poses for the SixSeven meme demo', () => {
    const presentation = withCharacter();

    for (let i = 0; i < 30; i++) presentation.updateMeme(0, 1 / 60);
    presentation.group.updateMatrixWorld(true);
    const firstLeft = position(presentation, 'handr');
    const firstRight = position(presentation, 'handl');
    expect(firstLeft.x).toBeLessThan(0);
    expect(firstRight.x).toBeGreaterThan(0);

    const shoulders = (position(presentation, 'upperarml').y + position(presentation, 'upperarmr').y) / 2;
    const hips = position(presentation, 'hips').y;
    const torso = shoulders - hips;
    const zoneTop = shoulders - torso * 0.2;
    const zoneBottom = hips + torso * 0.2;
    for (const handY of [firstLeft.y, firstRight.y]) {
      expect(handY).toBeLessThan(shoulders);
      expect(handY).toBeLessThanOrEqual(zoneTop + 0.04);
      expect(handY).toBeGreaterThanOrEqual(zoneBottom - 0.04);
    }
    expect(firstLeft.y).toBeGreaterThan(firstRight.y + 0.2);

    for (let i = 0; i < 30; i++) presentation.updateMeme(700, 1 / 60);
    presentation.group.updateMatrixWorld(true);
    const secondLeft = position(presentation, 'handr');
    const secondRight = position(presentation, 'handl');
    expect(secondRight.y).toBeGreaterThan(secondLeft.y + 0.2);
    expect(presentation.group.visible).toBe(true);
    presentation.dispose();
  });

  it('maps all eight authored Dance cues onto mirrored arm, torso, and leg targets', () => {
    const presentation = withCharacter(true);
    presentation.setDanceMode(true);
    const neutralFootY = [position(presentation, 'footr').y, position(presentation, 'footl').y];

    for (const [cueIndex, cue] of DANCE_CUES.entries()) {
      for (let frame = 0; frame < 150; frame++) presentation.updateDance(cueIndex, 1 / 60, false);
      presentation.group.updateMatrixWorld(true);
      expect(presentation.group.userData.danceCueIndex).toBe(cueIndex);
      expect(presentation.group.userData.danceCueId).toBe(cue.id);
      expect(presentation.group.userData.danceTargets).toEqual(Object.fromEntries(cue.features.map(item => [item.id, item.target])));

    const hips = position(presentation, 'hips');
      const leftWrist = position(presentation, 'handr');
      const rightWrist = position(presentation, 'handl');
      const leftFoot = position(presentation, 'footr');
      const rightFoot = position(presentation, 'footl');
    const target = Object.fromEntries(cue.features.map(item => [item.id, item.target])) as Record<string, number>;
    const tolerance = (id: keyof typeof target) => cue.features.find(item => item.id === id)!.tolerance;
    const shouldersY = (position(presentation, 'upperarml').y + position(presentation, 'upperarmr').y) / 2;
    const shouldersX = (position(presentation, 'upperarml').x + position(presentation, 'upperarmr').x) / 2;
    const torsoLength = Math.hypot(shouldersX - hips.x, shouldersY - hips.y);

      // Overhead arm cues use the Mirror UP_DIRECTION to clear KayKit's head silhouette.
      // That visible lateral adaptation is renderer-only; cue metadata remains authored.
      const leftOutTolerance = target.leftWristY < 0 ? 0.55 : tolerance('leftWristOut');
      const rightOutTolerance = target.rightWristY < 0 ? 0.55 : tolerance('rightWristOut');
      expect(Math.abs((hips.x - leftWrist.x) / torsoLength - target.leftWristOut)).toBeLessThanOrEqual(leftOutTolerance);
      expect(Math.abs((rightWrist.x - hips.x) / torsoLength - target.rightWristOut)).toBeLessThanOrEqual(rightOutTolerance);
      expect(Math.abs((shouldersY - leftWrist.y) / torsoLength - target.leftWristY)).toBeLessThanOrEqual(tolerance('leftWristY'));
      expect(Math.abs((shouldersY - rightWrist.y) / torsoLength - target.rightWristY)).toBeLessThanOrEqual(tolerance('rightWristY'));
      expect(Math.abs((hips.x - leftFoot.x) / torsoLength - target.leftFootOut)).toBeLessThan(0.35);
      expect(Math.abs((rightFoot.x - hips.x) / torsoLength - target.rightFootOut)).toBeLessThan(0.35);
      expect(Math.abs(leftFoot.y - neutralFootY[0])).toBeLessThan(0.03);
      expect(Math.abs(rightFoot.y - neutralFootY[1])).toBeLessThan(0.03);
      const displayedLean = Math.atan2(hips.x - shouldersX, shouldersY - hips.y) * 180 / Math.PI;
      expect(Math.abs(displayedLean - target.torsoLeanDeg)).toBeLessThanOrEqual(tolerance('torsoLeanDeg'));
      if (target.torsoLeanDeg !== 0) {
        expect(Math.sign(displayedLean)).toBe(Math.sign(target.torsoLeanDeg));
        expect(Math.abs(displayedLean)).toBeGreaterThan(Math.min(10, Math.abs(target.torsoLeanDeg) * 0.5));
      }

      expect(leftWrist.x).toBeLessThan(hips.x);
      expect(rightWrist.x).toBeGreaterThan(hips.x);
      expect(leftFoot.x).toBeLessThan(hips.x);
      expect(rightFoot.x).toBeGreaterThan(hips.x);
      for (const side of ['l', 'r'] as const) {
        const upper = position(presentation, 'upperarm' + side);
        const elbow = position(presentation, 'lowerarm' + side);
        const wrist = position(presentation, 'hand' + side);
        expect(elbow.clone().sub(upper).normalize().angleTo(wrist.clone().sub(elbow).normalize())).toBeLessThan(0.08);
      }

      if (target.leftWristY < 0) {
        expect(leftWrist.y).toBeGreaterThan(shouldersY + 0.25);
        expect(leftWrist.y).toBeGreaterThan(position(presentation, 'head').y);
        expect((hips.x - leftWrist.x) / torsoLength).toBeGreaterThanOrEqual(0.54);
        expect((hips.x - leftWrist.x) / torsoLength).toBeLessThanOrEqual(target.leftWristOut + 0.55);
      }
      if (target.rightWristY < 0) {
        expect(rightWrist.y).toBeGreaterThan(shouldersY + 0.25);
        expect(rightWrist.y).toBeGreaterThan(position(presentation, 'head').y);
        expect((rightWrist.x - hips.x) / torsoLength).toBeGreaterThanOrEqual(0.54);
        expect((rightWrist.x - hips.x) / torsoLength).toBeLessThanOrEqual(target.rightWristOut + 0.55);
      }
      if ((target.leftFootOut ?? 0.27) > 0.3) expect(leftFoot.x).toBeLessThan(hips.x - 0.05);
      if ((target.rightFootOut ?? 0.27) > 0.3) expect(rightFoot.x).toBeGreaterThan(hips.x + 0.05);
      if ((target.torsoLeanDeg ?? 0) > 0) expect(position(presentation, 'head').x).toBeLessThan(hips.x - 0.05);
      if ((target.torsoLeanDeg ?? 0) < 0) expect(position(presentation, 'head').x).toBeGreaterThan(hips.x + 0.05);

      const frozenParts = ['head', 'handr', 'handl', 'footr', 'footl'] as const;
      const beforeFreeze = frozenParts.map(name => position(presentation, name));
      for (let frame = 0; frame < 20; frame++) presentation.updateDance(cueIndex, 1 / 30, true);
      frozenParts.forEach((name, index) => {
        expect(position(presentation, name).distanceTo(beforeFreeze[index])).toBeLessThan(1e-7);
      });
    }

    presentation.updateDance(null, 1 / 60, true);
    expect(presentation.group.visible).toBe(true);
    expect(presentation.group.userData.danceCueIndex).toBeNull();
    presentation.setDanceMode(false);
    expect(presentation.group.visible).toBe(false);
    presentation.dispose();
  });

  it.each([[6, 'footr'], [7, 'footl']] as const)('keeps the stepping foot planted for Dance cue %i', (cueIndex, footName) => {
    const presentation = withCharacter(true);
    presentation.setDanceMode(true);
    const restingY = position(presentation, footName).y;
    for (let frame = 0; frame < 150; frame++) presentation.updateDance(cueIndex, 1 / 60, false);
    expect(position(presentation, footName).y).toBeCloseTo(restingY, 2);
    presentation.dispose();
  });

  it.each([[6, 'footr'], [7, 'footl']] as const)('keeps the stepping boot level for Dance cue %i', (cueIndex, footName) => {
    const presentation = withCharacter(true);
    presentation.setDanceMode(true);
    const foot = presentation.group.getObjectByName(footName)!;
    presentation.group.updateMatrixWorld(true);
    const restingRotation = foot.getWorldQuaternion(new THREE.Quaternion());
    for (let frame = 0; frame < 150; frame++) presentation.updateDance(cueIndex, 1 / 60, false);
    presentation.group.updateMatrixWorld(true);
    expect(foot.getWorldQuaternion(new THREE.Quaternion()).angleTo(restingRotation)).toBeLessThan(0.08);
    presentation.dispose();
  });
});
