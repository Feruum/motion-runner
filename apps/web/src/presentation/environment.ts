import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Stage } from '@motion-runner/game';
import { BIOMES, sampleRoute, wrapSceneryZ } from './route';

type Placement = { x: number; z: number; height: number; yaw?: number; y?: number };
type Batch = { mesh: THREE.InstancedMesh; local: THREE.Matrix4; origin: THREE.Matrix4; size: number; placements: Placement[]; sway: boolean; road: boolean };
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/** The scenery uses active time, while each loaded model/material is shared. */
export class JourneyEnvironment {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  readonly groups = BIOMES.map(() => new THREE.Group());
  private readonly models = new Map<string, THREE.Group>();
  private readonly batches: Batch[][] = BIOMES.map(() => []);
  private readonly fades = BIOMES.map(() => new Set<THREE.Material>());
  private readonly materials = BIOMES.map(() => new Map<string, THREE.Material>());
  private readonly groundMaterial = new THREE.MeshStandardMaterial({ color: BIOMES[0].ground, roughness: 1 });
  private readonly waterMaterial = new THREE.MeshStandardMaterial({ color: 0x67c5cb, roughness: .32, metalness: .12, transparent: true, opacity: .9 });
  private readonly gate = new THREE.Group();
  private readonly clouds: THREE.Object3D[] = [];
  private readonly ripples: THREE.Mesh[] = [];
  private readonly fireflies: THREE.Points;
  private readonly sun = new THREE.DirectionalLight(BIOMES[0].sun, 3);
  private readonly sky: THREE.Mesh;
  private readonly dummy = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly nextColor = new THREE.Color();
  private fan: THREE.Object3D | undefined;
  private windmill: THREE.Group | undefined;
  private destroyed = false;
  private seconds = 0;
  private qualityReduced = false;

  constructor(private readonly scene: THREE.Scene, private readonly canvas: HTMLCanvasElement) {
    this.root.name = 'journey-environment';
    this.root.add(...this.groups, this.gate);
    scene.add(this.root);
    scene.fog = new THREE.Fog(BIOMES[0].sky, 48, 145);
    scene.background = new THREE.Color(BIOMES[0].sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), this.groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -.62, -65);
    ground.receiveShadow = true;
    this.root.add(ground);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(10, 240), this.waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(17, -.59, -80);
    this.root.add(water);
    for (let i = 0; i < 16; i++) {
      const ripple = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + i % 4, .12), new THREE.MeshBasicMaterial({ color: 0xdcffff, transparent: true, opacity: .22, depthWrite: false }));
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(14 + i % 5, -.57, 4 - i * 7);
      this.ripples.push(ripple); this.root.add(ripple);
    }
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(190, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { horizon: { value: new THREE.Color(BIOMES[0].sky) }, zenith: { value: new THREE.Color(0x6dbedb) } },
      vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 direction; uniform vec3 horizon;uniform vec3 zenith;void main(){float h=max(0.,normalize(direction).y);gl_FragColor=vec4(mix(horizon,zenith,pow(h,.6)),1.);}',
    }));
    this.root.add(this.sky);
    this.root.add(new THREE.HemisphereLight(0xe5faff, 0x6a8256, 2));
    this.sun.position.set(-18, 28, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 85 });
    this.sun.shadow.normalBias = .045;
    this.sun.shadow.bias = -.0003;
    this.sun.target.position.set(0, 0, -14);
    this.root.add(this.sun, this.sun.target);
    const dust = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      dust[i * 3] = (i % 2 ? 1 : -1) * (5 + (i * 7 % 19));
      dust[i * 3 + 1] = .6 + (i * 3 % 11) * .45;
      dust[i * 3 + 2] = -(i * 13 % 90);
    }
    this.fireflies = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dust, 3)), new THREE.PointsMaterial({ color: 0xffe9ac, size: .09, transparent: true, opacity: .65, depthWrite: false }));
    this.root.add(this.fireflies);
    this.ready = this.load();
  }

  private async load() {
    try {
      const response = await fetch(asset('assets/environment/catalog.json'));
      if (!response.ok) throw new Error('The landscape catalog could not load.');
      const catalog = await response.json() as { id: string; path: string }[];
      const loader = new GLTFLoader();
      const loaded = await Promise.all(catalog.map(async item => [item.id, (await loader.loadAsync(asset(item.path))).scene] as const));
      for (const [id, model] of loaded) { model.updateMatrixWorld(true); this.models.set(id, model); }
      if (this.destroyed) { this.dispose(); return; }
      this.buildBiomes();
      this.buildHorizon();
      this.buildGate();
      this.canvas.dataset.environment = 'ready';
      this.canvas.dataset.environmentModels = String(this.models.size);
    } catch (error) {
      this.canvas.dataset.environment = 'unavailable';
      console.warn('Landscape details are unavailable. The course remains playable.', error);
    }
  }

  private material(source: THREE.Material, biome: number) {
    let material = this.materials[biome].get(source.uuid);
    if (!material) {
      material = source.clone();
      this.materials[biome].set(source.uuid, material);
      this.fades[biome].add(material);
    }
    return material;
  }

  private batch(id: string, placements: Placement[], biome: number, sway = false, road = false) {
    const model = this.models.get(id);
    if (!model) return;
    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const origin = new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z);
    if (road) origin.premultiply(new THREE.Matrix4().makeScale(2.72 / size.x, .065 / size.y, 5.2 / size.z));
    // Keep complete model bounds outside the playable lane corridor.
    if (!road) for (const p of placements) {
      const radius = Math.hypot(size.x, size.z) * p.height / Math.max(.01, size.y) / 2;
      p.x = Math.sign(p.x || 1) * Math.max(Math.abs(p.x), 4.8 + radius);
    }
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material.map(m => this.material(m, biome)) : this.material(object.material, biome);
      const mesh = new THREE.InstancedMesh(object.geometry, materials, placements.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = !road && !['grass', 'bush'].includes(id);
      mesh.receiveShadow = true;
      this.groups[biome].add(mesh);
      const local = object.matrixWorld.clone();
      // Road modules cover a lane exactly while preserving their authored texture.
      this.batches[biome].push({ mesh, local, origin: origin.clone(), size: Math.max(.01, size.y), placements, sway, road });
    });
  }

  private buildBiomes() {
    for (let biome = 0; biome < 3; biome++) {
      const scatter = (count: number, offset: number, height: number, spacing: number): Placement[] => Array.from({ length: count }, (_, i) => ({
        x: (i % 2 ? -1 : 1) * (offset + (i * 11 % 7)), z: 2 - Math.floor(i / 2) * spacing,
        height: height * (.82 + (i * 3 % 7) * .065), yaw: i * 1.71,
      }));
      this.batch('grass', scatter(64, 5, .4, 3.1), biome, true);
      this.batch('rock', scatter(16, 7, 1.1, 12), biome);
      this.batch('bush', scatter(20, 6, .9, 10), biome, true);
      const road = Array.from({ length: 57 }, (_, i) => ({ x: (i % 3 - 1) * 2.75, z: 4 - Math.floor(i / 3) * 5.2, height: 1, y: -.035 }));
      this.batch(biome === 1 ? 'woodFloor' : 'stoneFloor', road, biome, false, true);
      if (biome === 0) {
        this.batch('oak', scatter(12, 9, 5.5, 16), biome, true);
        this.batch('house', [{ x: -15, z: -17, height: 5, yaw: .4 }, { x: 27, z: -63, height: 5.5, yaw: -.4 }], biome);
        this.batch('houseTall', [{ x: -23, z: -42, height: 7, yaw: .6 }], biome);
        this.windmill = this.place('windmill', this.groups[0], -25, -.6, -66, 12, 0);
        this.fan = this.windmill?.getObjectByName('building_windmill_top_fan_blue');
      } else if (biome === 1) {
        this.batch('pine', scatter(24, 10, 8, 8), biome, true);
        this.batch('oak', scatter(14, 8, 6.5, 14), biome, true);
      } else {
        this.batch('pine', scatter(10, 16, 6, 18), biome, true);
        this.batch('column', scatter(12, 7, 5.5, 16), biome);
        this.batch('arch', [{ x: -15, z: -30, height: 7, yaw: .6 }, { x: 15, z: -60, height: 8, yaw: -.4 }], biome);
        this.batch('banner', scatter(10, 6.5, 2.1, 18).map(p => ({ ...p, y: 1.3 })), biome, true);
        this.batch('torch', scatter(10, 5.5, 1.8, 18), biome);
      }
    }
  }

  private place(id: string, parent: THREE.Group, x: number, y: number, z: number, height: number, biome?: number) {
    const source = this.models.get(id);
    if (!source) return undefined;
    const model = source.clone(true);
    const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
    const scale = height / Math.max(.01, size.y);
    model.scale.setScalar(scale);
    model.position.set(x, y - bounds.min.y * scale, z);
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.receiveShadow = true;
      object.castShadow = height < 14;
      if (biome !== undefined) object.material = Array.isArray(object.material) ? object.material.map(m => this.material(m, biome)) : this.material(object.material, biome);
    });
    parent.add(model);
    return model;
  }

  private buildHorizon() {
    for (let i = 0; i < 9; i++) {
      const mountain = this.place('mountain', this.root, -104 + i * 26, -1, -103 - (i % 3) * 13, 22 + i % 3 * 9);
      if (mountain) mountain.rotation.y = i * .7;
    }
    for (const x of [-42, 38]) this.place('hill', this.root, x, -.6, -55, 11);
    for (let i = 0; i < 7; i++) {
      const cloud = this.place('cloud', this.root, -66 + i * 21, 19 + i % 3 * 5, -70 - i % 2 * 35, 3 + i % 3);
      if (cloud) { cloud.userData.baseX = cloud.position.x; this.clouds.push(cloud); }
    }
    this.place('castle', this.root, 42, -.6, -88, 17);
  }

  private buildGate() {
    this.place('column', this.gate, -6, -.4, 0, 9);
    this.place('column', this.gate, 6, -.4, 0, 9);
    const lintel = this.place('stoneFloor', this.gate, 0, 8.2, 0, .7);
    if (lintel) {
      const size = new THREE.Box3().setFromObject(lintel).getSize(new THREE.Vector3());
      lintel.scale.x *= 14 / size.x;
      lintel.scale.z *= 1.5 / size.z;
    }
    for (const x of [-6, 6]) this.place('banner', this.gate, x, 4, .8, 3);
    const crest = new THREE.Mesh(new THREE.OctahedronGeometry(.7), new THREE.MeshStandardMaterial({ color: 0xffd474, emissive: 0xffb743, emissiveIntensity: 1.6, roughness: .4 }));
    crest.position.set(0, 8.8, .5);
    this.gate.add(crest);
    this.gate.position.z = -88;
  }

  setReducedQuality(reduced: boolean) {
    this.qualityReduced = reduced;
    this.fireflies.visible = !reduced;
    this.sun.castShadow = !reduced;
  }

  update(stage: Stage, elapsed: number, duration: number, dt: number) {
    if (this.destroyed) return;
    const active = ['PLAYING', 'PAUSED', 'COUNTDOWN', 'RESULTS'].includes(stage);
    const time = active ? elapsed : 0;
    const route = sampleRoute(time, duration);
    if (stage !== 'PAUSED') this.seconds += dt;
    const from = BIOMES[route.from], to = BIOMES[route.to];
    const sky = this.color.setHex(from.sky).lerp(this.nextColor.setHex(to.sky), route.blend);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    ((this.sky.material as THREE.ShaderMaterial).uniforms.horizon.value as THREE.Color).copy(sky);
    this.groundMaterial.color.setHex(from.ground).lerp(this.nextColor.setHex(to.ground), route.blend);
    this.sun.color.setHex(from.sun).lerp(this.nextColor.setHex(to.sun), route.blend);
    this.canvas.dataset.biome = BIOMES[route.chapter].name;
    const distance = time * .0055;
    for (let i = 0; i < 3; i++) {
      const weight = route.from === route.to ? Number(i === route.from) : i === route.from ? 1 - route.blend : i === route.to ? route.blend : 0;
      this.groups[i].visible = weight > .001;
      if (!this.groups[i].visible) continue;
      for (const material of this.fades[i]) {
        const transparent = weight < .999;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = weight;
        material.depthWrite = !transparent;
      }
      for (const batch of this.batches[i]) {
        for (let j = 0; j < batch.placements.length; j++) {
          const p = batch.placements[j];
          const z = batch.road ? wrapSceneryZ(p.z, distance, 9.2, 9.2 - 19 * 5.2) : wrapSceneryZ(p.z, distance);
          this.dummy.position.set(p.x, p.y ?? -.6, z);
          this.dummy.rotation.set(0, p.yaw ?? 0, batch.sway && !this.qualityReduced ? Math.sin(this.seconds * 1.1 + j) * .018 : 0);
          this.dummy.scale.setScalar(batch.road ? 1 : p.height / batch.size);
          this.dummy.updateMatrix();
          this.matrix.copy(this.dummy.matrix).multiply(batch.origin).multiply(batch.local);
          batch.mesh.setMatrixAt(j, this.matrix);
        }
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.fan) this.fan.rotation.z = -this.seconds * .7;
    if (this.windmill) this.windmill.position.z = wrapSceneryZ(-66, distance * .25, 20, -130);
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x = this.clouds[i].userData.baseX + Math.sin(this.seconds * .045 + i) * 4;
    for (let i = 0; i < this.ripples.length; i++) {
      this.ripples[i].position.z = wrapSceneryZ(4 - i * 7, distance + this.seconds * .2);
      this.ripples[i].visible = route.chapter !== 2;
    }
    this.waterMaterial.opacity = route.chapter === 2 ? .55 : .9;
    this.fireflies.rotation.y = Math.sin(this.seconds * .1) * .035;
    this.gate.position.z = -88 + route.finish * 82;
  }

  dispose() {
    this.destroyed = true;
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
    const collect = (object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) resources.add(value);
      }
    };
    this.root.traverse(collect);
    for (const model of this.models.values()) model.traverse(collect);
    for (const resource of resources) resource.dispose();
    this.sun.dispose();
    this.root.removeFromParent();
    this.models.clear();
  }
}
