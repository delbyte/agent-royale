'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

/* ──────────────────────────────────────────────
   Model paths
   ────────────────────────────────────────────── */

const E = '/assets/models/environment/';
const C = '/assets/models/characters/';

const M = {
  tree: `${E}tree.glb`,
  treeTall: `${E}tree-tall.glb`,
  treeAutumn: `${E}tree-autumn.glb`,
  treeAutumnTall: `${E}tree-autumn-tall.glb`,
  treeLog: `${E}tree-log-small.glb`,
  treeTrunk: `${E}tree-trunk.glb`,
  rockA: `${E}rock-a.glb`,
  rockB: `${E}rock-b.glb`,
  rockC: `${E}rock-c.glb`,
  rockFlat: `${E}rock-flat-grass.glb`,
  rockSandA: `${E}rock-sand-a.glb`,
  rockSandB: `${E}rock-sand-b.glb`,
  grass: `${E}grass-large.glb`,
  patchGrass: `${E}patch-grass-large.glb`,
  patchGrassSmall: `${E}patch-grass.glb`,
  campfire: `${E}campfire-pit.glb`,
  campfireStand: `${E}campfire-stand.glb`,
  tent: `${E}tent-canvas.glb`,
  tentHalf: `${E}tent-canvas-half.glb`,
  bedroll: `${E}bedroll.glb`,
  bedrollPacked: `${E}bedroll-packed.glb`,
  bedrollFrame: `${E}bedroll-frame.glb`,
  signpost: `${E}signpost-single.glb`,
  signpostDouble: `${E}signpost.glb`,
  chest: `${E}chest.glb`,
  barrel: `${E}barrel.glb`,
  barrelOpen: `${E}barrel-open.glb`,
  box: `${E}box.glb`,
  boxOpen: `${E}box-open.glb`,
  boxLarge: `${E}box-large.glb`,
  bucket: `${E}bucket.glb`,
  bottle: `${E}bottle.glb`,
  bottleLarge: `${E}bottle-large.glb`,
  workbench: `${E}workbench.glb`,
  anvil: `${E}workbench-anvil.glb`,
  grind: `${E}workbench-grind.glb`,
  axe: `${E}tool-axe.glb`,
  axeUp: `${E}tool-axe-upgraded.glb`,
  pickaxe: `${E}tool-pickaxe.glb`,
  pickaxeUp: `${E}tool-pickaxe-upgraded.glb`,
  hammer: `${E}tool-hammer.glb`,
  hammerUp: `${E}tool-hammer-upgraded.glb`,
  shovel: `${E}tool-shovel.glb`,
  hoe: `${E}tool-hoe.glb`,
  wood: `${E}resource-wood.glb`,
  stone: `${E}resource-stone.glb`,
  stoneLarge: `${E}resource-stone-large.glb`,
  planks: `${E}resource-planks.glb`,
  fence: `${E}fence.glb`,
  fenceFort: `${E}fence-fortified.glb`,
  fenceDoor: `${E}fence-doorway.glb`,
  structure: `${E}structure.glb`,
  structureCanvas: `${E}structure-canvas.glb`,
  structureFloor: `${E}structure-floor.glb`,
  structureRoof: `${E}structure-roof.glb`,
  structureMetal: `${E}structure-metal.glb`,
  fish: `${E}fish.glb`,
  maleA: `${C}character-male-a.glb`,
  maleB: `${C}character-male-b.glb`,
  maleC: `${C}character-male-c.glb`,
  maleD: `${C}character-male-d.glb`,
  maleE: `${C}character-male-e.glb`,
  maleF: `${C}character-male-f.glb`,
  femaleA: `${C}character-female-a.glb`,
  femaleB: `${C}character-female-b.glb`,
  femaleC: `${C}character-female-c.glb`,
  femaleD: `${C}character-female-d.glb`,
  femaleE: `${C}character-female-e.glb`,
  femaleF: `${C}character-female-f.glb`,
};

Object.values(M).forEach((p) => useGLTF.preload(p));

/* ── Clone hooks ── */

function useClone(path: string, scale: number) {
  const { scene } = useGLTF(path);
  return useMemo(() => {
    const c = scene.clone();
    c.scale.set(scale, scale, scale);
    c.traverse((ch) => {
      if ((ch as THREE.Mesh).isMesh) {
        (ch as THREE.Mesh).castShadow = true;
        (ch as THREE.Mesh).receiveShadow = true;
      }
    });
    return c;
  }, [scene, scale]);
}

function useChar(path: string, scale = 0.4) {
  const { scene } = useGLTF(path);
  return useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    c.scale.set(scale, scale, scale);
    c.traverse((ch) => {
      if ((ch as THREE.Mesh).isMesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
        const mat = (ch as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.map) { mat.map.colorSpace = THREE.SRGBColorSpace; mat.needsUpdate = true; }
      }
    });
    return c;
  }, [scene, scale]);
}

/* ── Organic island platform ── */

function Island({ radius = 3.5, color = '#5c9c54', height = 0.6 }: { radius?: number; color?: string; height?: number }) {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(radius, radius * 0.82, height, 48, 4);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -height / 2 + 0.05) {
        pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.18);
        pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.18);
      }
    }
    g.computeVertexNormals();
    return g;
  }, [radius, height]);

  return (
    <mesh geometry={geo} receiveShadow castShadow position={[0, -height / 2, 0]}>
      <meshStandardMaterial color={color} roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

/* ── Campfire with flickering light ── */

function Fire({ position, scale = 0.36 }: { position: [number, number, number]; scale?: number }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const grpRef = useRef<THREE.Group>(null);
  const obj = useClone(M.campfire, scale);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (lightRef.current) lightRef.current.intensity = 2.2 + Math.sin(t * 8) * 0.5 + Math.sin(t * 13) * 0.2;
    if (grpRef.current) { const s = 1 + Math.sin(t * 6) * 0.02; grpRef.current.scale.set(s, s, s); }
  });

  return (
    <group ref={grpRef} position={position}>
      <primitive object={obj} />
      <pointLight ref={lightRef} color="#ff9f43" intensity={2.2} distance={7} decay={2} position={[0, 0.8, 0]} />
    </group>
  );
}

/* ── Character with idle bob ── */

function Char({ path, position, rotation = [0, 0, 0] as [number, number, number], scale = 0.4 }: {
  path: string; position: [number, number, number]; rotation?: [number, number, number]; scale?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const clone = useChar(path, scale);
  const baseY = position[1];
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);
  useFrame(({ clock }) => { if (ref.current) ref.current.position.y = baseY + Math.sin(clock.getElapsedTime() * 1.6 + phase) * 0.03; });
  return <group ref={ref} position={position} rotation={rotation}><primitive object={clone} /></group>;
}

/* ── Slow-rotate wrapper ── */

function Spin({ children, speed = 0.06 }: { children: React.ReactNode; speed?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * speed; });
  return <group ref={ref}>{children}</group>;
}

/* ══════════════════════════════════════════════
   SCENE 1 — THE CAMP
   Dense cozy survival camp, packed like the
   Kenney preview. Campfire center, tent, bedrolls,
   storage crates, characters, trees & rocks tight.
   ══════════════════════════════════════════════ */

function CampScene() {
  const tent = useClone(M.tent, 0.48);
  const tentH = useClone(M.tentHalf, 0.42);
  const bed1 = useClone(M.bedroll, 0.38);
  const bed2 = useClone(M.bedrollPacked, 0.32);
  const bedF = useClone(M.bedrollFrame, 0.36);
  const sign = useClone(M.signpost, 0.36);
  const signD = useClone(M.signpostDouble, 0.34);
  const chest = useClone(M.chest, 0.38);
  const barrel1 = useClone(M.barrel, 0.34);
  const barrel2 = useClone(M.barrelOpen, 0.32);
  const box1 = useClone(M.box, 0.3);
  const box2 = useClone(M.boxLarge, 0.28);
  const bucket = useClone(M.bucket, 0.28);
  const bottle = useClone(M.bottle, 0.22);
  const bottleL = useClone(M.bottleLarge, 0.24);
  const t1 = useClone(M.tree, 0.65);
  const t2 = useClone(M.treeTall, 0.72);
  const t3 = useClone(M.treeAutumn, 0.6);
  const t4 = useClone(M.tree, 0.5);
  const t5 = useClone(M.treeAutumnTall, 0.68);
  const t6 = useClone(M.treeTall, 0.55);
  const t7 = useClone(M.treeAutumn, 0.52);
  const t8 = useClone(M.tree, 0.58);
  const r1 = useClone(M.rockA, 0.45);
  const r2 = useClone(M.rockB, 0.42);
  const r3 = useClone(M.rockC, 0.38);
  const r4 = useClone(M.rockFlat, 0.5);
  const r5 = useClone(M.rockSandA, 0.35);
  const g1 = useClone(M.grass, 0.4);
  const g2 = useClone(M.patchGrass, 0.45);
  const g3 = useClone(M.patchGrassSmall, 0.5);
  const g4 = useClone(M.grass, 0.35);
  const g5 = useClone(M.patchGrass, 0.38);
  const log1 = useClone(M.treeLog, 0.4);
  const log2 = useClone(M.treeLog, 0.32);
  const trunk = useClone(M.treeTrunk, 0.35);
  const fish = useClone(M.fish, 0.22);
  const wood = useClone(M.wood, 0.3);

  return (
    <group position={[0, 0, 0]}>
      <Island radius={4.2} />
      <Fire position={[0, 0, 0]} scale={0.4} />
      <Char path={M.maleA} position={[-0.9, 0, -0.7]} rotation={[0, 0.8, 0]} scale={0.42} />
      <Char path={M.femaleB} position={[1.0, 0, 0.7]} rotation={[0, -2.3, 0]} scale={0.42} />
      <Char path={M.maleC} position={[0.4, 0, -1.2]} rotation={[0, 1.6, 0]} scale={0.4} />
      <primitive object={tent} position={[-2.2, 0, -1.8]} rotation={[0, 0.6, 0]} />
      <primitive object={tentH} position={[2.4, 0, -2.0]} rotation={[0, -0.4, 0]} />
      <primitive object={bed1} position={[-1.4, 0.02, -0.9]} rotation={[0, 0.3, 0]} />
      <primitive object={bed2} position={[1.8, 0.02, -1.2]} rotation={[0, -0.8, 0]} />
      <primitive object={bedF} position={[-2.8, 0.02, 0.5]} rotation={[0, 1.2, 0]} />
      <primitive object={chest} position={[2.0, 0.02, 0.0]} rotation={[0, -0.5, 0]} />
      <primitive object={barrel1} position={[2.6, 0.02, 0.8]} />
      <primitive object={barrel2} position={[2.8, 0.02, -0.3]} rotation={[0, 1.0, 0]} />
      <primitive object={box1} position={[1.6, 0.02, 1.5]} rotation={[0, 0.3, 0]} />
      <primitive object={box2} position={[3.0, 0.02, 1.2]} rotation={[0, -0.7, 0]} />
      <primitive object={bucket} position={[2.2, 0.02, 1.8]} />
      <primitive object={bottle} position={[0.6, 0.08, 0.3]} />
      <primitive object={bottleL} position={[-0.3, 0.08, 1.0]} />
      <primitive object={sign} position={[3.2, 0, -1.5]} rotation={[0, -1.0, 0]} />
      <primitive object={signD} position={[-3.0, 0, -2.2]} rotation={[0, 0.8, 0]} />
      <primitive object={t1} position={[-3.2, 0, -2.8]} />
      <primitive object={t2} position={[3.4, 0, -2.5]} />
      <primitive object={t3} position={[-3.8, 0, 1.0]} />
      <primitive object={t4} position={[3.5, 0, 2.0]} />
      <primitive object={t5} position={[0, 0, -3.5]} />
      <primitive object={t6} position={[-2.0, 0, 3.0]} />
      <primitive object={t7} position={[1.5, 0, 3.2]} />
      <primitive object={t8} position={[-3.8, 0, -1.0]} />
      <primitive object={r1} position={[-3.0, 0, 2.2]} rotation={[0, 1.5, 0]} />
      <primitive object={r2} position={[3.0, 0, -0.8]} rotation={[0, 2.3, 0]} />
      <primitive object={r3} position={[-1.5, 0, 2.8]} rotation={[0, 0.9, 0]} />
      <primitive object={r4} position={[0.5, 0, 3.0]} />
      <primitive object={r5} position={[-3.5, 0, -0.2]} rotation={[0, 0.5, 0]} />
      <primitive object={g1} position={[-1.8, 0, 1.5]} />
      <primitive object={g2} position={[1.0, 0, 2.5]} />
      <primitive object={g3} position={[-2.5, 0, -1.5]} />
      <primitive object={g4} position={[2.5, 0, -1.8]} />
      <primitive object={g5} position={[0, 0, -2.5]} />
      <primitive object={log1} position={[-0.5, 0.02, 1.8]} rotation={[0, 0.6, 0]} />
      <primitive object={log2} position={[2.8, 0.02, 2.4]} rotation={[0, -0.3, 0]} />
      <primitive object={trunk} position={[-2.8, 0, 1.8]} rotation={[0, 1.5, 0]} />
      <primitive object={fish} position={[-1.0, 0.08, 0.5]} rotation={[0, 2.1, 0]} />
      <primitive object={wood} position={[0.8, 0.02, -0.5]} rotation={[0, 0.7, 0]} />
    </group>
  );
}

/* ══════════════════════════════════════════════
   SCENE 2 — THE FORGE
   Crafting workshop island. Workbenches, anvil,
   tools everywhere, resource piles, structures.
   ══════════════════════════════════════════════ */

function ForgeScene() {
  const wb = useClone(M.workbench, 0.5);
  const anv = useClone(M.anvil, 0.48);
  const grd = useClone(M.grind, 0.45);
  const s1 = useClone(M.structure, 0.45);
  const s2 = useClone(M.structureCanvas, 0.42);
  const sF = useClone(M.structureFloor, 0.4);
  const axe = useClone(M.axe, 0.24);
  const axeU = useClone(M.axeUp, 0.22);
  const pick = useClone(M.pickaxe, 0.22);
  const pickU = useClone(M.pickaxeUp, 0.22);
  const ham = useClone(M.hammer, 0.2);
  const hamU = useClone(M.hammerUp, 0.22);
  const shov = useClone(M.shovel, 0.2);
  const hoe = useClone(M.hoe, 0.2);
  const pl1 = useClone(M.planks, 0.35);
  const pl2 = useClone(M.planks, 0.3);
  const w1 = useClone(M.wood, 0.32);
  const w2 = useClone(M.wood, 0.28);
  const st1 = useClone(M.stone, 0.3);
  const st2 = useClone(M.stoneLarge, 0.28);
  const ch = useClone(M.chest, 0.36);
  const bar = useClone(M.barrel, 0.32);
  const bx = useClone(M.boxOpen, 0.3);
  const bkt = useClone(M.bucket, 0.26);
  const t1 = useClone(M.treeTall, 0.65);
  const t2 = useClone(M.treeAutumn, 0.55);
  const t3 = useClone(M.tree, 0.5);
  const t4 = useClone(M.treeTall, 0.58);
  const r1 = useClone(M.rockA, 0.48);
  const r2 = useClone(M.rockB, 0.4);
  const r3 = useClone(M.rockC, 0.35);
  const g1 = useClone(M.grass, 0.38);
  const g2 = useClone(M.patchGrass, 0.42);
  const lg = useClone(M.treeLog, 0.38);

  return (
    <group position={[14, 0, 0]}>
      <Island radius={4.0} color="#6b8a5e" />
      <primitive object={wb} position={[0, 0.02, 0]} rotation={[0, -0.3, 0]} />
      <primitive object={anv} position={[1.5, 0.02, -0.5]} rotation={[0, 0.5, 0]} />
      <primitive object={grd} position={[-1.3, 0.02, -0.8]} rotation={[0, 1.0, 0]} />
      <primitive object={s1} position={[-2.0, 0, -1.5]} rotation={[0, 0.4, 0]} />
      <primitive object={s2} position={[2.2, 0, -1.8]} rotation={[0, -0.3, 0]} />
      <primitive object={sF} position={[0, 0.01, -2.2]} />
      <primitive object={axe} position={[-0.6, 0.15, 0.6]} rotation={[0.4, 0.2, -1.3]} />
      <primitive object={axeU} position={[0.8, 0.02, -1.5]} rotation={[-0.1, 1.5, -0.2]} />
      <primitive object={pick} position={[1.8, 0.15, 0.5]} rotation={[0.3, -0.5, -1.1]} />
      <primitive object={pickU} position={[-1.8, 0.02, 0.3]} rotation={[0, 0.8, -0.3]} />
      <primitive object={ham} position={[0.5, 0.12, 1.0]} rotation={[0, 1.0, -1.4]} />
      <primitive object={hamU} position={[-0.4, 0.02, -1.8]} rotation={[0.2, -0.6, -0.5]} />
      <primitive object={shov} position={[2.5, 0.12, 0.8]} rotation={[0.2, 0, -1.2]} />
      <primitive object={hoe} position={[-2.5, 0.12, -0.2]} rotation={[-0.1, 1.2, -1.3]} />
      <primitive object={pl1} position={[-2.2, 0.02, 1.0]} rotation={[0, 0.5, 0]} />
      <primitive object={pl2} position={[-1.8, 0.02, 1.6]} rotation={[0, -0.3, 0]} />
      <primitive object={w1} position={[2.0, 0.02, 1.5]} rotation={[0, 0.8, 0]} />
      <primitive object={w2} position={[1.2, 0.02, 2.0]} rotation={[0, -0.5, 0]} />
      <primitive object={st1} position={[-0.5, 0.02, 2.2]} />
      <primitive object={st2} position={[0.8, 0.02, 1.8]} rotation={[0, 1.5, 0]} />
      <primitive object={ch} position={[2.5, 0.02, -1.0]} rotation={[0, -0.8, 0]} />
      <primitive object={bar} position={[-2.8, 0.02, -0.8]} />
      <primitive object={bx} position={[0, 0.02, 2.5]} rotation={[0, 0.3, 0]} />
      <primitive object={bkt} position={[2.8, 0.02, 0.2]} />
      <Char path={M.maleD} position={[-0.3, 0, 0.5]} rotation={[0, 0.3, 0]} scale={0.42} />
      <Char path={M.femaleC} position={[1.2, 0, 0.2]} rotation={[0, -1.5, 0]} scale={0.4} />
      <primitive object={t1} position={[-3.2, 0, 2.2]} />
      <primitive object={t2} position={[3.2, 0, 2.4]} />
      <primitive object={t3} position={[-3.5, 0, -2.0]} />
      <primitive object={t4} position={[3.0, 0, -2.5]} />
      <primitive object={r1} position={[3.2, 0, 0.5]} rotation={[0, 1.2, 0]} />
      <primitive object={r2} position={[-3.2, 0, 1.5]} rotation={[0, 0.6, 0]} />
      <primitive object={r3} position={[0, 0, -3.0]} rotation={[0, 2.0, 0]} />
      <primitive object={g1} position={[-1.5, 0, 2.5]} />
      <primitive object={g2} position={[2.0, 0, 2.8]} />
      <primitive object={lg} position={[1.5, 0.02, -2.5]} rotation={[0, 0.7, 0]} />
      <Fire position={[-2, 0, 2]} scale={0.3} />
    </group>
  );
}

/* ══════════════════════════════════════════════
   SCENE 3 — THE BATTLEFIELD
   ══════════════════════════════════════════════ */

function BattleScene() {
  const f1 = useClone(M.fenceFort, 0.48);
  const f2 = useClone(M.fenceFort, 0.48);
  const f3 = useClone(M.fence, 0.44);
  const f4 = useClone(M.fence, 0.44);
  const fd = useClone(M.fenceDoor, 0.46);
  const bar1 = useClone(M.barrel, 0.32);
  const barO = useClone(M.barrelOpen, 0.32);
  const bx1 = useClone(M.box, 0.3);
  const bxO = useClone(M.boxOpen, 0.3);
  const ch = useClone(M.chest, 0.36);
  const bot = useClone(M.bottle, 0.22);
  const axe = useClone(M.axeUp, 0.2);
  const ham = useClone(M.hammerUp, 0.2);
  const pik = useClone(M.pickaxeUp, 0.2);
  const wod = useClone(M.wood, 0.28);
  const stn = useClone(M.stone, 0.26);
  const plk = useClone(M.planks, 0.28);
  const t1 = useClone(M.tree, 0.58);
  const t2 = useClone(M.treeTall, 0.62);
  const t3 = useClone(M.treeAutumn, 0.52);
  const t4 = useClone(M.treeAutumnTall, 0.6);
  const t5 = useClone(M.tree, 0.48);
  const r1 = useClone(M.rockA, 0.5);
  const r2 = useClone(M.rockB, 0.45);
  const r3 = useClone(M.rockC, 0.4);
  const r4 = useClone(M.rockSandB, 0.35);
  const g1 = useClone(M.grass, 0.38);
  const g2 = useClone(M.patchGrass, 0.4);
  const g3 = useClone(M.patchGrassSmall, 0.45);

  return (
    <group position={[28, 0, 0]}>
      <Island radius={4.5} color="#5a8a4e" />
      <Fire position={[0, 0, 0]} scale={0.42} />
      <Char path={M.maleB} position={[-2.2, 0, 0]} rotation={[0, 1.2, 0]} scale={0.45} />
      <Char path={M.femaleD} position={[2.2, 0, 0]} rotation={[0, -1.9, 0]} scale={0.45} />
      <Char path={M.maleF} position={[-1.0, 0, 2.2]} rotation={[0, -0.3, 0]} scale={0.38} />
      <Char path={M.femaleE} position={[1.0, 0, -2.0]} rotation={[0, 2.5, 0]} scale={0.38} />
      <primitive object={f1} position={[-3.2, 0, -2.0]} rotation={[0, 0.3, 0]} />
      <primitive object={f2} position={[3.2, 0, -2.0]} rotation={[0, -0.3, 0]} />
      <primitive object={f3} position={[-3.2, 0, 2.0]} rotation={[0, -0.3, 0]} />
      <primitive object={f4} position={[3.2, 0, 2.0]} rotation={[0, 0.3, 0]} />
      <primitive object={fd} position={[0, 0, -3.5]} />
      <primitive object={bar1} position={[-2.8, 0.02, -0.5]} />
      <primitive object={barO} position={[2.8, 0.02, 1.0]} />
      <primitive object={bx1} position={[-1.5, 0.02, 2.5]} rotation={[0, 0.8, 0]} />
      <primitive object={bxO} position={[1.5, 0.02, -2.5]} rotation={[0, -0.5, 0]} />
      <primitive object={ch} position={[0, 0.02, 3.2]} rotation={[0, Math.PI, 0]} />
      <primitive object={bot} position={[-0.6, 0.08, 1.2]} />
      <primitive object={axe} position={[-1.2, 0.12, -0.8]} rotation={[0.5, 0.2, -1.2]} />
      <primitive object={ham} position={[1.2, 0.12, 0.9]} rotation={[-0.3, 1.2, -1.0]} />
      <primitive object={pik} position={[0.3, 0.12, -1.5]} rotation={[0.2, -0.8, -1.1]} />
      <primitive object={wod} position={[1.8, 0.02, 1.8]} rotation={[0, 1.5, 0]} />
      <primitive object={stn} position={[-1.8, 0.02, -1.8]} />
      <primitive object={plk} position={[2.5, 0.02, -1.0]} rotation={[0, 0.7, 0]} />
      <primitive object={t1} position={[-3.8, 0, 0]} />
      <primitive object={t2} position={[3.8, 0, 0]} />
      <primitive object={t3} position={[0, 0, 3.8]} />
      <primitive object={t4} position={[-2.5, 0, -3.2]} />
      <primitive object={t5} position={[2.5, 0, 3.2]} />
      <primitive object={r1} position={[-3.5, 0, 1.2]} rotation={[0, 1.5, 0]} />
      <primitive object={r2} position={[3.5, 0, -1.2]} rotation={[0, 0.5, 0]} />
      <primitive object={r3} position={[0, 0, -3.0]} rotation={[0, 2.0, 0]} />
      <primitive object={r4} position={[-2.0, 0, 3.0]} rotation={[0, 0.8, 0]} />
      <primitive object={g1} position={[-1.0, 0, -2.8]} />
      <primitive object={g2} position={[2.0, 0, 2.8]} />
      <primitive object={g3} position={[-3.0, 0, -2.8]} />
    </group>
  );
}

/* ══════════════════════════════════════════════
   SCENE 4 — THE OUTPOST
   ══════════════════════════════════════════════ */

function OutpostScene() {
  const s1 = useClone(M.structure, 0.48);
  const s2 = useClone(M.structureCanvas, 0.45);
  const sR = useClone(M.structureRoof, 0.42);
  const sM = useClone(M.structureMetal, 0.4);
  const sF = useClone(M.structureFloor, 0.44);
  const tent = useClone(M.tent, 0.45);
  const bed = useClone(M.bedroll, 0.36);
  const sgn = useClone(M.signpostDouble, 0.36);
  const ch = useClone(M.chest, 0.38);
  const bar1 = useClone(M.barrel, 0.34);
  const bar2 = useClone(M.barrel, 0.32);
  const bx1 = useClone(M.boxLarge, 0.32);
  const bx2 = useClone(M.box, 0.28);
  const bkt = useClone(M.bucket, 0.26);
  const f1 = useClone(M.fenceFort, 0.46);
  const f2 = useClone(M.fenceFort, 0.46);
  const f3 = useClone(M.fence, 0.42);
  const t1 = useClone(M.treeTall, 0.68);
  const t2 = useClone(M.tree, 0.55);
  const t3 = useClone(M.treeAutumnTall, 0.62);
  const t4 = useClone(M.treeAutumn, 0.5);
  const t5 = useClone(M.treeTall, 0.6);
  const r1 = useClone(M.rockA, 0.5);
  const r2 = useClone(M.rockB, 0.42);
  const r3 = useClone(M.rockFlat, 0.48);
  const g1 = useClone(M.grass, 0.4);
  const g2 = useClone(M.patchGrass, 0.38);
  const wod = useClone(M.wood, 0.3);
  const plk = useClone(M.planks, 0.32);

  return (
    <group position={[42, 0, 0]}>
      <Island radius={4.3} color="#4e7a44" />
      <primitive object={s1} position={[0, 0, -1.2]} rotation={[0, 0.2, 0]} />
      <primitive object={s2} position={[-1.8, 0, -0.5]} rotation={[0, 0.8, 0]} />
      <primitive object={sR} position={[0, 1.4, -1.2]} rotation={[0, 0.2, 0]} />
      <primitive object={sM} position={[1.8, 0, -1.5]} rotation={[0, -0.4, 0]} />
      <primitive object={sF} position={[0, 0.01, 0]} />
      <primitive object={tent} position={[-2.5, 0, 1.5]} rotation={[0, 0.5, 0]} />
      <primitive object={bed} position={[-1.5, 0.02, 2.0]} rotation={[0, 0.3, 0]} />
      <primitive object={sgn} position={[3.0, 0, 0.5]} rotation={[0, -0.8, 0]} />
      <Fire position={[0.5, 0, 1.2]} scale={0.35} />
      <primitive object={ch} position={[2.2, 0.02, 1.8]} rotation={[0, -0.6, 0]} />
      <primitive object={bar1} position={[-2.8, 0.02, -1.5]} />
      <primitive object={bar2} position={[2.8, 0.02, -0.5]} />
      <primitive object={bx1} position={[-0.5, 0.02, 2.5]} rotation={[0, 0.4, 0]} />
      <primitive object={bx2} position={[1.5, 0.02, 2.2]} rotation={[0, -0.2, 0]} />
      <primitive object={bkt} position={[2.5, 0.02, 1.0]} />
      <primitive object={f1} position={[-3.0, 0, -2.5]} rotation={[0, 0.2, 0]} />
      <primitive object={f2} position={[3.0, 0, -2.5]} rotation={[0, -0.2, 0]} />
      <primitive object={f3} position={[0, 0, 3.5]} rotation={[0, Math.PI / 2, 0]} />
      <Char path={M.maleE} position={[0.8, 0, 0.5]} rotation={[0, -1.0, 0]} scale={0.42} />
      <Char path={M.femaleA} position={[-1.0, 0, 1.0]} rotation={[0, 0.5, 0]} scale={0.4} />
      <Char path={M.femaleF} position={[2.0, 0, 0.2]} rotation={[0, -2.2, 0]} scale={0.38} />
      <primitive object={wod} position={[-1.8, 0.02, -2.2]} rotation={[0, 0.5, 0]} />
      <primitive object={plk} position={[1.5, 0.02, -2.5]} rotation={[0, -0.3, 0]} />
      <primitive object={t1} position={[-3.5, 0, 2.5]} />
      <primitive object={t2} position={[3.5, 0, 2.5]} />
      <primitive object={t3} position={[-3.8, 0, -0.5]} />
      <primitive object={t4} position={[3.5, 0, -1.0]} />
      <primitive object={t5} position={[0, 0, -3.5]} />
      <primitive object={r1} position={[-3.2, 0, 0.8]} rotation={[0, 1.2, 0]} />
      <primitive object={r2} position={[3.0, 0, 1.5]} rotation={[0, 0.5, 0]} />
      <primitive object={r3} position={[0, 0, 3.2]} />
      <primitive object={g1} position={[-2.0, 0, 2.8]} />
      <primitive object={g2} position={[2.0, 0, 3.0]} />
    </group>
  );
}

/* ══════════════════════════════════════════════
   BACKGROUND FLOATING ISLANDS (decor)
   ~24 extra islands at varied elevations
   ══════════════════════════════════════════════ */

function MiniIsland({
  position,
  radius,
  tint,
  spin = 0.03,
  floatAmp = 0.2,
  variant = 0,
}: {
  position: [number, number, number];
  radius: number;
  tint: string;
  spin?: number;
  floatAmp?: number;
  variant?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const baseY = position[1];
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  const tree = useClone(
    variant % 3 === 0 ? M.treeTall : variant % 3 === 1 ? M.tree : M.treeAutumn,
    0.34 + (variant % 4) * 0.05,
  );
  const rock = useClone(
    variant % 2 === 0 ? M.rockA : M.rockB,
    0.22 + (variant % 3) * 0.05,
  );
  const grass = useClone(
    variant % 2 === 0 ? M.patchGrassSmall : M.grass,
    0.2 + (variant % 4) * 0.04,
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.rotation.y += spin * 0.0035;
    ref.current.position.y = baseY + Math.sin(t * 0.65 + phase) * floatAmp;
  });

  return (
    <group ref={ref} position={position}>
      <Island radius={radius} color={tint} height={0.46} />
      <primitive object={tree} position={[-radius * 0.2, 0, -radius * 0.15]} />
      <primitive object={rock} position={[radius * 0.3, 0.02, radius * 0.15]} rotation={[0, 1.2, 0]} />
      <primitive object={grass} position={[-radius * 0.1, 0, radius * 0.3]} />
    </group>
  );
}

function ExtraFloatingIslands() {
  const islands = useMemo(
    () => [
      // A few above the main layer
      [-12, 4.0, -9], [-9, 6.6, -2], [-6, 3.2, 8], [-2, 7.2, -12], [3, 5.8, 10], [6, 2.6, -10],
      [10, 7.5, 11], [12, 3.0, -8], [16, 6.4, -11], [18, 2.8, 9], [21, 7.8, -3], [24, 4.4, 12],

      // Dense lower layer (just below)
      [-15, -1.8, -14], [-11, -2.4, -6], [-8, -1.1, 2], [-4, -2.9, 10], [0, -1.5, -15], [4, -2.2, -7],
      [8, -1.2, 5], [12, -2.7, 13], [16, -1.6, -14], [20, -2.4, -5], [24, -1.3, 4], [28, -2.8, 12],
      [32, -1.7, -13], [36, -2.5, -4], [40, -1.4, 6], [44, -2.9, 14], [48, -1.6, -12], [52, -2.3, -3],
      [56, -1.1, 7], [60, -2.6, 15],

      // Mid-deep layer
      [-17, -4.2, -10], [-13, -5.1, -1], [-9, -4.6, 9], [-5, -5.4, -13], [-1, -4.3, -4], [3, -5.0, 6],
      [7, -4.4, 14], [11, -5.2, -11], [15, -4.7, -2], [19, -5.5, 8], [23, -4.1, -14], [27, -5.0, -6],
      [31, -4.6, 5], [35, -5.3, 13], [39, -4.2, -10], [43, -5.1, -1], [47, -4.5, 9], [51, -5.4, -13],
      [55, -4.3, -4], [59, -5.0, 6],

      // Deep abyss layer (way below)
      [-14, -8.5, -15], [-10, -9.6, -7], [-6, -8.9, 1], [-2, -9.8, 9], [2, -8.4, -16], [6, -9.4, -8],
      [10, -8.7, 0], [14, -9.9, 8], [18, -8.3, -15], [22, -9.5, -7], [26, -8.8, 1], [30, -9.7, 9],
      [34, -8.5, -16], [38, -9.6, -8], [42, -8.9, 0], [46, -9.8, 8], [50, -8.4, -15], [54, -9.4, -7],
      [58, -8.7, 1], [62, -9.9, 9],

      // Extra deep accents
      [-7, -12.2, -12], [5, -11.4, 11], [17, -12.8, -9], [29, -11.6, 10], [41, -12.5, -11], [53, -11.7, 12],
    ] as [number, number, number][],
    [],
  );

  return (
    <group>
      {islands.map((p, i) => (
        <MiniIsland
          key={`extra-island-${i}`}
          position={[p[0], p[1], p[2]]}
          radius={p[1] < -8 ? 0.75 + (i % 3) * 0.18 : p[1] < -4 ? 0.92 + (i % 4) * 0.2 : 1.15 + (i % 4) * 0.22}
          tint={i % 3 === 0 ? '#547e49' : i % 3 === 1 ? '#667f54' : '#4b6f42'}
          spin={0.02 + (i % 5) * 0.007}
          floatAmp={p[1] < -8 ? 0.06 + (i % 2) * 0.04 : 0.12 + (i % 3) * 0.08}
          variant={i}
        />
      ))}
    </group>
  );
}

/* ══════════════════════════════════════════════
   MAIN EXPORT
   ══════════════════════════════════════════════ */

export default function LandingWorld() {
  return (
    <>
      {/* Warm dramatic lighting */}
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[15, 25, 15]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
      />
      <directionalLight position={[-10, 15, -10]} intensity={0.25} />
      <pointLight position={[0, -2, 0]} color="#ff9f43" intensity={0.3} distance={20} />

      {/* Dark background */}
      <color attach="background" args={['#0a0a0f']} />

      {/* Scenes — each slowly rotating on its own island */}
      <Spin speed={0.06}><CampScene /></Spin>
      <Spin speed={-0.05}><ForgeScene /></Spin>
      <Spin speed={0.04}><BattleScene /></Spin>
      <Spin speed={-0.045}><OutpostScene /></Spin>

      {/* Additional background islands for depth */}
      <ExtraFloatingIslands />
    </>
  );
}
