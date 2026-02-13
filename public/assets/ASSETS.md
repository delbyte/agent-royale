# Asset Manifest — Protocol: SURVIVAL

> All models are Kenney GLB format, optimized for Three.js / React Three Fiber.  
> Source packs: `kenney_survival-kit`, `kenney_mini-characters`

---

## Folder Structure

```
public/assets/models/
├── characters/          # 26 models — player avatars + accessories
│   ├── character-male-[a-f].glb      (6 male variants)
│   ├── character-female-[a-f].glb    (6 female variants)
│   ├── aid-*.glb                     (accessories)
│   └── wheelchair*.glb               (accessories)
│
└── environment/         # 80 models — world objects, tools, terrain
    ├── tree*.glb                     (trees, trunks, logs)
    ├── rock-*.glb                    (rock variants)
    ├── barrel*.glb, chest.glb        (loot containers)
    ├── workbench*.glb                (crafting stations)
    ├── tool-*.glb                    (weapons/tools)
    ├── fence*.glb                    (barricades)
    ├── resource-*.glb, bottle*.glb   (pickup items)
    ├── grass*.glb, floor*.glb        (terrain tiles)
    ├── campfire-*.glb                (decorations)
    ├── structure*.glb, tent*.glb     (world dressing)
    └── misc (signpost, box, bucket, fish, metal-panel, bedroll, patch-grass)
```

---

## Game Entity → Model Mapping

These are the **primary** models used for core game entities. All other models are available as aesthetic/decorative elements.

| Game Entity | Type | Primary Model(s) | Path |
|---|---|---|---|
| **Player** | PLAYER | `character-male-[a-f].glb`, `character-female-[a-f].glb` | `characters/` |
| **Tree** | RESOURCE | `tree.glb`, `tree-tall.glb` | `environment/` |
| **Rock** | RESOURCE | `rock-a.glb`, `rock-b.glb`, `rock-c.glb` | `environment/` |
| **Crate** | LOOT | `chest.glb` | `environment/` |
| **Barrel** | LOOT | `barrel.glb` | `environment/` |
| **Workbench** | WORKBENCH | `workbench.glb` | `environment/` |
| **Barricade** | BARRICADE | `fence-fortified.glb` | `environment/` |
| **Stone Axe** | WEAPON | `tool-axe.glb` | `environment/` |
| **Stone Hammer** | WEAPON | `tool-hammer.glb` | `environment/` |
| **Stone Pickaxe** | WEAPON | `tool-pickaxe.glb` | `environment/` |
| **Health Potion** | ITEM | `bottle.glb` | `environment/` |
| **Wood** | RESOURCE_DROP | `resource-wood.glb` | `environment/` |
| **Stone** | RESOURCE_DROP | `resource-stone.glb` | `environment/` |
| **Ground** | TERRAIN | `grass.glb`, `floor.glb` | `environment/` |

### Decorative / Atmosphere Models

| Model | Potential Use |
|---|---|
| `campfire-pit.glb` | Zone center marker, lobby decoration |
| `signpost.glb` | Points of interest, zone boundary markers |
| `tree-autumn*.glb` | Zone edge visual variety |
| `tent*.glb`, `structure*.glb` | Abandoned camp sites, map decoration |
| `rock-flat*.glb`, `rock-sand-*.glb` | Terrain variety |
| `box*.glb` | Additional loot container variants |
| `tool-*-upgraded.glb` | Visual upgrade for crafted weapons |
| `bedroll*.glb` | Camp decoration |
| `fish*.glb`, `bucket.glb` | World flavor objects |

---

## Loading Notes for Phase 4

```javascript
// Three.js GLB loading pattern (useGLTF from @react-three/drei)
import { useGLTF } from '@react-three/drei'

// Preload frequently used models
useGLTF.preload('/assets/models/characters/character-male-a.glb')
useGLTF.preload('/assets/models/environment/tree.glb')

// For instanced meshes (many trees/rocks), extract geometry:
const { scene } = useGLTF('/assets/models/environment/tree.glb')
// Clone for InstancedMesh usage
```

- Use **InstancedMesh** for trees, rocks, grass (many copies, same geometry)
- Use **individual meshes** for characters, chests, barrels (unique state per entity)
- 12 character variants map well to up to 20 players (assign randomly, allow repeats)
