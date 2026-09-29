import * as THREE from 'three';
import { CONFIG as C } from '@motion-runner/game';
import { RHYTHM_PICKUP_WINDOW_MS, RHYTHM_PREVIEW_MS } from '../../../../packages/game/src/core/rhythm-types';
import type { RhythmSnapshot, RhythmStar } from '../../../../packages/game/src/core/rhythm-types';

const LANE_X = [-2.75, 0, 2.75] as const;
const LOW_STAR_Y = 1.02;
const HIGH_STAR_Y = 3.05;
const COLLECTED_BURST_MS = 520;
const MISSED_TAIL_MS = 1_700;

export interface RhythmStarsRenderState {
  visibleStars: number;
  collected: number;
  nextStar: RhythmStar | null;
  nextZ: number | null;
}

interface StarView {
  root: THREE.Group;
  shape: THREE.Object3D;
  highRing: THREE.Mesh | null;
  collectionBurst: THREE.Mesh;
}

/**
 * Three.js-only Rhythm Run visuals. This class deliberately owns no renderer so
 * the approaching-star and pickup-plane state can be tested without WebGL.
 */
export class RhythmStarsPresentation {
  readonly group = new THREE.Group();
  private readonly guides = new THREE.Group();
  private readonly views = new Map<number, StarView>();
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private readonly ownedMaterials = new Set<THREE.Material>();
  private starModel: THREE.Object3D | null = null;
  private elapsedMs: number | null = null;
  private disposed = false;

  constructor(starModel: THREE.Object3D | null = null) {
    this.starModel = starModel;
    this.group.name = 'rhythm-stars-layer';
    this.guides.name = 'rhythm-pickup-guides';
    this.buildPickupGuides();
    this.group.add(this.guides);
    this.group.visible = false;
  }

  /** Updates actual scene objects and returns values suitable for canvas data attributes. */
  update(
    snapshot: RhythmSnapshot | null,
    visible: boolean,
    frozen = false,
    starModel?: THREE.Object3D | null,
  ): RhythmStarsRenderState {
    if (this.disposed) return emptyState(snapshot);
    if (starModel !== undefined && starModel !== this.starModel) {
      this.starModel = starModel;
      this.clearStars();
    }

    if (snapshot && (!frozen || this.elapsedMs === null)) this.elapsedMs = snapshot.elapsedMs;
    const now = this.elapsedMs ?? snapshot?.elapsedMs ?? 0;
    const nextStar = snapshot?.stars
      .filter(star => star.status === 'upcoming')
      .sort((left, right) => left.atMs - right.atMs || left.id - right.id)[0] ?? null;
    const baseState: RhythmStarsRenderState = {
      visibleStars: 0,
      collected: snapshot?.cleared ?? 0,
      nextStar,
      nextZ: nextStar ? this.zAt(nextStar, now) : null,
    };

    if (!snapshot || !visible) {
      this.group.visible = false;
      this.clearStars();
      return baseState;
    }

    this.group.visible = true;
    const activeIds = new Set<number>();
    for (const star of snapshot.stars) {
      const status = this.statusAt(star, now);
      if (!status.visible) continue;
      activeIds.add(star.id);
      let view = this.views.get(star.id);
      if (!view) {
        view = this.createStarView(star);
        this.views.set(star.id, view);
        this.group.add(view.root);
      }
      this.updateStarView(view, star, now, status.opacity, status.collectedProgress);
    }

    for (const [id, view] of this.views) {
      if (!activeIds.has(id)) this.removeStarView(id, view);
    }
    baseState.visibleStars = this.views.size;
    return baseState;
  }

  /** Clears all per-run star visuals while retaining the reusable pickup guide. */
  reset(): void {
    if (this.disposed) return;
    this.clearStars();
    this.elapsedMs = null;
    this.group.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.group.remove(this.guides);
    this.disposeOwnedResources(this.guides);
    this.disposed = true;
  }

  private buildPickupGuides(): void {
    const lineMaterial = this.ownMaterial(new THREE.MeshBasicMaterial({
      color: 0xffd94e,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const line = new THREE.Mesh(this.ownGeometry(new THREE.BoxGeometry(9.25, 0.045, 0.13)), lineMaterial);
    line.name = 'rhythm-pickup-line';
    line.position.set(0, 0.075, C.runnerZ);
    this.guides.add(line);

    for (let lane = -1; lane <= 1; lane++) {
      const outer = new THREE.Mesh(
        this.ownGeometry(new THREE.TorusGeometry(1.02, 0.055, 8, 48)),
        this.ownMaterial(new THREE.MeshBasicMaterial({
          color: 0xffe265,
          transparent: true,
          opacity: 0.98,
          depthWrite: false,
          side: THREE.DoubleSide,
        })),
      );
      outer.name = `rhythm-pickup-ring-${lane + 1}`;
      outer.rotation.x = Math.PI / 2;
      outer.position.set(LANE_X[lane + 1], 0.075, C.runnerZ);
      this.guides.add(outer);

      const inner = new THREE.Mesh(
        this.ownGeometry(new THREE.TorusGeometry(0.76, 0.027, 6, 40)),
        this.ownMaterial(new THREE.MeshBasicMaterial({
          color: 0xffb927,
          transparent: true,
          opacity: 0.83,
          depthWrite: false,
          side: THREE.DoubleSide,
        })),
      );
      inner.name = `rhythm-pickup-inner-ring-${lane + 1}`;
      inner.rotation.x = Math.PI / 2;
      inner.position.set(LANE_X[lane + 1], 0.078, C.runnerZ);
      this.guides.add(inner);
    }
  }

  private createStarView(star: RhythmStar): StarView {
    const root = new THREE.Group();
    root.name = `rhythm-star-${star.id}`;
    root.userData.rhythmStarId = star.id;
    root.userData.rhythmStarHeight = star.height;

    let shape: THREE.Object3D;
    if (this.starModel) {
      shape = this.starModel.clone(true);
      shape.name = `rhythm-star-shape-${star.id}`;
      this.normalizeStarModel(shape);
    } else {
      const material = this.ownMaterial(new THREE.MeshStandardMaterial({
        color: 0xffd33f,
        emissive: 0xffac16,
        emissiveIntensity: 0.9,
        roughness: 0.3,
        metalness: 0.16,
        side: THREE.DoubleSide,
      }));
      const mesh = new THREE.Mesh(this.createStarGeometry(), material);
      mesh.name = `rhythm-star-shape-${star.id}`;
      mesh.castShadow = true;
      shape = mesh;
    }
    root.add(shape);

    let highRing: THREE.Mesh | null = null;
    if (star.height === 'high') {
      highRing = new THREE.Mesh(
        this.ownGeometry(new THREE.TorusGeometry(0.91, 0.068, 10, 56)),
        this.ownMaterial(new THREE.MeshBasicMaterial({
          color: 0xffe761,
          transparent: true,
          opacity: 0.97,
          depthWrite: false,
          side: THREE.DoubleSide,
        })),
      );
      highRing.name = `rhythm-high-ring-${star.id}`;
      highRing.position.z = 0.12;
      root.add(highRing);
    }

    const collectionBurst = new THREE.Mesh(
      this.ownGeometry(new THREE.TorusGeometry(0.59, 0.075, 8, 40)),
      this.ownMaterial(new THREE.MeshBasicMaterial({
        color: 0x9cf5c7,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })),
    );
    collectionBurst.name = `rhythm-collection-burst-${star.id}`;
    collectionBurst.position.z = 0.19;
    collectionBurst.visible = false;
    root.add(collectionBurst);

    return { root, shape, highRing, collectionBurst };
  }

  private updateStarView(
    view: StarView,
    star: RhythmStar,
    now: number,
    opacity: number,
    collectedProgress: number | null,
  ): void {
    const low = star.height === 'low';
    const targetLane = low ? star.lane : 0;
    const targetTime = collectedProgress === null ? now : star.resolvedAtMs ?? star.atMs;
    view.root.position.set(
      LANE_X[targetLane + 1],
      low ? LOW_STAR_Y : HIGH_STAR_Y,
      this.zAt(star, targetTime),
    );
    view.root.userData.rhythmStarStatus = star.status;
    view.root.userData.rhythmStarHeight = star.height;

    if (collectedProgress === null) {
      view.root.scale.setScalar(1.12);
      view.shape.rotation.z = now * 0.00135;
      setOpacity(view.shape, opacity, this.ownedMaterials);
      if (view.highRing) {
        view.highRing.visible = true;
        (view.highRing.material as THREE.MeshBasicMaterial).opacity = 0.78 + Math.sin(now * 0.005 + star.id) * 0.12;
        view.highRing.scale.setScalar(0.95 + Math.sin(now * 0.004 + star.id) * 0.045);
      }
      view.collectionBurst.visible = false;
      return;
    }

    const scale = Math.max(0.02, 1 - collectedProgress);
    view.root.scale.setScalar(1.12 * scale);
    view.shape.rotation.z = now * 0.00135;
    setOpacity(view.shape, 1 - collectedProgress, this.ownedMaterials);
    if (view.highRing) {
      view.highRing.visible = true;
      (view.highRing.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.92 * (1 - collectedProgress));
      view.highRing.scale.setScalar(0.95 + collectedProgress * 0.45);
    }
    view.collectionBurst.visible = true;
    view.collectionBurst.scale.setScalar(0.45 + collectedProgress * 1.4);
    (view.collectionBurst.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - collectedProgress);
  }

  private statusAt(star: RhythmStar, now: number): { visible: boolean; opacity: number; collectedProgress: number | null } {
    const startsAt = star.atMs - RHYTHM_PREVIEW_MS;
    if (star.status === 'collected') {
      const resolvedAt = star.resolvedAtMs ?? star.atMs;
      const age = now - resolvedAt;
      if (age < 0 || age > COLLECTED_BURST_MS) return { visible: false, opacity: 0, collectedProgress: null };
      return { visible: true, opacity: 1, collectedProgress: Math.min(1, age / COLLECTED_BURST_MS) };
    }
    if (now < startsAt) return { visible: false, opacity: 0, collectedProgress: null };
    if (star.status === 'missed') {
      if (now > star.atMs + MISSED_TAIL_MS) return { visible: false, opacity: 0, collectedProgress: null };
      return { visible: true, opacity: 0.38, collectedProgress: null };
    }
    if (now > star.atMs + RHYTHM_PICKUP_WINDOW_MS) return { visible: false, opacity: 0, collectedProgress: null };
    return { visible: true, opacity: 1, collectedProgress: null };
  }

  private zAt(star: RhythmStar, atMs: number): number {
    const travelMs = atMs - (star.atMs - RHYTHM_PREVIEW_MS);
    const progress = travelMs / RHYTHM_PREVIEW_MS;
    return C.obstacleSpawnZ + progress * (C.runnerZ - C.obstacleSpawnZ);
  }

  private normalizeStarModel(shape: THREE.Object3D): void {
    shape.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(shape);
    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const largest = Math.max(size.x, size.y, size.z, 0.001);
      shape.position.sub(center);
      shape.scale.multiplyScalar(1.65 / largest);
    } else {
      shape.scale.setScalar(1.1);
    }
    shape.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = true;
      child.material = cloneBrightMaterials(child.material, this.ownedMaterials);
    });
  }

  private createStarGeometry(): THREE.ExtrudeGeometry {
    const points = new THREE.Shape();
    for (let index = 0; index < 10; index++) {
      const angle = -Math.PI / 2 + index * Math.PI / 5;
      const radius = index % 2 === 0 ? 0.88 : 0.39;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) points.moveTo(x, y);
      else points.lineTo(x, y);
    }
    points.closePath();
    const geometry = new THREE.ExtrudeGeometry(points, {
      depth: 0.2,
      bevelEnabled: true,
      bevelThickness: 0.065,
      bevelSize: 0.045,
      bevelSegments: 2,
      steps: 1,
    });
    geometry.translate(0, 0, -0.1);
    return this.ownGeometry(geometry);
  }

  private removeStarView(id: number, view: StarView): void {
    this.views.delete(id);
    this.group.remove(view.root);
    this.disposeOwnedResources(view.root);
  }

  private clearStars(): void {
    for (const [id, view] of this.views) this.removeStarView(id, view);
  }

  private ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.ownedGeometries.add(geometry);
    return geometry;
  }

  private ownMaterial<T extends THREE.Material>(material: T): T {
    this.ownedMaterials.add(material);
    return material;
  }

  private disposeOwnedResources(root: THREE.Object3D): void {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (this.ownedGeometries.delete(object.geometry)) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (this.ownedMaterials.delete(material)) material.dispose();
      }
    });
  }
}

function cloneBrightMaterials(
  materials: THREE.Material | THREE.Material[],
  ownedMaterials: Set<THREE.Material>,
): THREE.Material | THREE.Material[] {
  const brighten = (source: THREE.Material) => {
    const material = source.clone();
    if ('color' in material && material.color instanceof THREE.Color) material.color.set(0xffdc48);
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(0xffb51b);
      material.emissiveIntensity = Math.max(0.72, material.emissiveIntensity);
      material.roughness = 0.34;
      material.metalness = 0.15;
    }
    ownedMaterials.add(material);
    return material;
  };
  return Array.isArray(materials) ? materials.map(brighten) : brighten(materials);
}

function setOpacity(object: THREE.Object3D, opacity: number, ownedMaterials: Set<THREE.Material>): void {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!ownedMaterials.has(material)) continue;
      material.transparent = opacity < 0.999;
      material.opacity = opacity;
      material.depthWrite = opacity >= 0.999;
    }
  });
}

function emptyState(snapshot: RhythmSnapshot | null): RhythmStarsRenderState {
  return {
    visibleStars: 0,
    collected: snapshot?.cleared ?? 0,
    nextStar: snapshot?.stars.filter(star => star.status === 'upcoming')
      .sort((left, right) => left.atMs - right.atMs || left.id - right.id)[0] ?? null,
    nextZ: null,
  };
}
