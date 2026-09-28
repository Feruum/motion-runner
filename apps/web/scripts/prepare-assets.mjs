import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(webRoot, 'public');
const kay = 'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/672074b73ba276876a19e8816ecdc5241817ab47/';
const platform = 'https://media.githubusercontent.com/media/series-ai/jam-ready-assets/f8206b38e4355a8b2a490e3032000d2a84883a0f/kaykit-platformer/3D/platformer/';
const kayAnimations = 'https://media.githubusercontent.com/media/series-ai/jam-ready-assets/f8206b38e4355a8b2a490e3032000d2a84883a0f/kaykit-character-animations/3D/characters/Animations/gltf/Rig_Medium/';
const kayAnimationsLicense = 'https://raw.githubusercontent.com/series-ai/jam-ready-assets/f8206b38e4355a8b2a490e3032000d2a84883a0f/kaykit-character-animations/3D/characters/License.txt';
const records = [];
async function download(url, relative) {
  const dest = path.join(root, relative);
  await mkdir(path.dirname(dest), { recursive: true });
  let data;
  try { data = await readFile(dest); } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.toString('utf8', 0, 80).includes('git-lfs.github.com')) throw new Error(`LFS pointer, not asset: ${url}`);
    await writeFile(dest, data);
    console.log(`Downloaded ${relative} (${Math.round(data.length / 1024)} KB)`);
  }
  records.push({ path: relative, source: url, sha256: createHash('sha256').update(data).digest('hex') });
  return data;
}
const mediaPipeWasm = path.resolve(webRoot, '../../node_modules/@mediapipe/tasks-vision/wasm');
await cp(mediaPipeWasm, path.join(root, 'wasm'), { recursive: true });
await download('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', 'models/pose_landmarker_lite.task');
for (const [model, texture] of [['Rogue_Hooded', 'rogue'], ['Knight', 'knight'], ['Mage', 'mage'], ['Barbarian', 'barbarian']]) {
  for (const file of [`${model}.glb`, `${texture}_texture.png`]) {
    await download(kay + `addons/kaykit_character_pack_adventures/Characters/gltf/${file}`, `assets/character/${file}`);
  }
}
await download(kay + 'LICENSE.txt', 'assets/character/LICENSE.txt');
for (const set of ['MovementBasic', 'General', 'Simulation']) {
  const file = `Rig_Medium_${set}.glb`;
  await download(kayAnimations + file, `assets/animations/${file}`);
}
await download(kayAnimationsLicense, 'assets/animations/LICENSE.txt');
const models = [
  'blue/platform_4x4x1_blue', 'blue/arch_wide_blue', 'blue/flag_A_blue',
  'red/barrier_3x1x1_red', 'red/barrier_3x1x4_red', 'yellow/star_yellow',
];
for (const model of models) {
  const relative = `assets/platformer/${model}.gltf`;
  const data = await download(platform + `Assets/gltf/${model}.gltf`, relative);
  const gltf = JSON.parse(data);
  const resources = [...(gltf.buffers ?? []), ...(gltf.images ?? [])];
  for (const { uri } of resources) {
    if (uri && !uri.startsWith('data:')) {
      const source = new URL(uri, platform + `Assets/gltf/${model}.gltf`).href;
      await download(source, path.posix.join(path.posix.dirname(relative), uri));
    }
  }
}
await download('https://raw.githubusercontent.com/series-ai/jam-ready-assets/f8206b38e4355a8b2a490e3032000d2a84883a0f/kaykit-platformer/3D/platformer/License.txt', 'assets/platformer/LICENSE.txt');
await writeFile(path.join(root, 'assets/manifest.json'), JSON.stringify(records, null, 2) + '\n');
console.log('Assets ready. Models, textures and MediaPipe run from this origin.');
