const revision = 'f8206b38e4355a8b2a490e3032000d2a84883a0f';
const remote = `https://media.githubusercontent.com/media/series-ai/jam-ready-assets/${revision}/`;
const nature = 'kaykit-forest-nature/3D/nature/Assets/gltf/Color1/';
const medieval = 'kaykit-medieval-hexagon/3D/strategy-hex/Assets/gltf/';
const dungeon = 'kaykit-dungeon/3D/dungeon/Assets/gltf/';
const selection = [
  ['oak', nature + 'Tree_1_A_Color1.gltf'],
  ['pine', nature + 'Tree_2_A_Color1.gltf'],
  ['bush', nature + 'Bush_1_A_Color1.gltf'],
  ['rock', nature + 'Rock_1_A_Color1.gltf'],
  ['grass', nature + 'Grass_1_A_Color1.gltf'],
  ['cloud', medieval + 'decoration/nature/cloud_big.gltf'],
  ['mountain', medieval + 'decoration/nature/mountain_A_grass.gltf'],
  ['hill', medieval + 'decoration/nature/hills_A.gltf'],
  ['house', medieval + 'buildings/blue/building_home_A_blue.gltf'],
  ['houseTall', medieval + 'buildings/blue/building_home_B_blue.gltf'],
  ['windmill', medieval + 'buildings/blue/building_windmill_blue.gltf'],
  ['castle', medieval + 'buildings/blue/building_castle_blue.gltf'],
  ['column', dungeon + 'column.gltf'],
  ['arch', dungeon + 'wall_arched.gltf'],
  ['banner', dungeon + 'banner_blue.gltf'],
  ['torch', dungeon + 'torch_lit.gltf'],
  ['woodFloor', dungeon + 'floor_wood_large.gltf'],
  ['stoneFloor', dungeon + 'floor_tile_large.gltf'],
];

export async function prepareEnvironment(download) {
  const catalog = [];
  const seen = new Set();
  for (const [id, source] of selection) {
    const local = `assets/environment/${source}`;
    const data = await download(remote + source, local);
    const gltf = JSON.parse(data);
    for (const resource of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (!resource.uri || resource.uri.startsWith('data:')) continue;
      const url = new URL(resource.uri, remote + source).href;
      if (seen.has(url)) continue;
      seen.add(url);
      const destination = 'assets/environment/' + decodeURIComponent(url.slice(remote.length));
      await download(url, destination);
    }
    catalog.push({ id, path: local });
  }
  for (const pack of ['kaykit-forest-nature/3D/nature', 'kaykit-medieval-hexagon/3D/strategy-hex', 'kaykit-dungeon/3D/dungeon']) {
    await download(`https://raw.githubusercontent.com/series-ai/jam-ready-assets/${revision}/${pack}/License.txt`, `assets/environment/${pack}/License.txt`);
  }
  return catalog;
}
