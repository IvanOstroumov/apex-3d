/**
 * Meshopt .GLB Optimizer & LOD Simplifier Pipeline
 * Preserves ALL material slot names (deduplicates only accessors/meshes/textures, NEVER materials!)
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsEmissiveStrength } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const MODELS_DIR = '/home/antigravity/f1-apex-3d-fh6/public/assets/models';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, KHRMaterialsEmissiveStrength])
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

const specs = [
  { raw: 'f1_hero_lod0_raw.glb', out: 'f1_hero_lod0.glb', simplifyRatio: null },
  { raw: 'f1_ai_lod1_raw.glb', out: 'f1_ai_lod1.glb', simplifyRatio: 0.28 },
  { raw: 'gt_safety_car_raw.glb', out: 'gt_safety_car.glb', simplifyRatio: null },
  { raw: 'tv_helicopter_h135_raw.glb', out: 'tv_helicopter_h135.glb', simplifyRatio: null },
  { raw: 'scenery_nature_raw.glb', out: 'scenery_nature.glb', simplifyRatio: null },
];

for (const s of specs) {
  const rawPath = path.join(MODELS_DIR, s.raw);
  const outPath = path.join(MODELS_DIR, s.out);
  const doc = await io.read(rawPath);

  await doc.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    weld(),
    ...(s.simplifyRatio
      ? [simplify({ simplifier: MeshoptSimplifier, ratio: s.simplifyRatio, error: 0.008 })]
      : []),
    prune({ keepLeaves: true, propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' })
  );

  await io.write(outPath, doc);
  fs.unlinkSync(rawPath);

  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      tris += idx ? idx.getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    }
  }
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  const mats = doc.getRoot().listMaterials().map((m) => m.getName());
  console.log(`[MESHOPT] ${s.out}: ${Math.round(tris)} tris, ${kb} KB, mats=[${mats.join(', ')}]`);
}
