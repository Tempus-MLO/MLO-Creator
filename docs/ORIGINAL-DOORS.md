> Current catalogue: [Alla props](ALL-PROPS.md) adds full-index paged searching and more categories. The previous 1,573-item furniture subset remains available as Inredningsurval.

> Current update: the ten-prop selection limit is lifted for interior candidates. Original furniture now has a per-placement **Frys på plats** option. See [Expanded furniture](FROZEN-PROPS.md). Older counts and limits below describe the previous test build.

# Original doors, gates and windows — test build

The import-project navigation is now **Import → Build → Inredning → Paint → Export**.
Furniture/props live in Inredning. Build → Models / doors & windows contains imported door/window/frame models and a separate **Local GTA V** source. Existing project placements and GLB/YDR imports are retained.

## Use

1. Open an imported-building project. In Build select the door/window models tool and open its catalogue.
2. Choose Local GTA V, set your GTA installation folder and click Index local GTA / Refresh local index. Existing metadata caches are reused; no full archive extraction occurs.
3. Search a model name or filter Doors, Gates & Garages, Windows. Geometry and textures load when a model is selected. These categories are name-based candidates, not a verified list of usable standalone doors/windows. Gate posts, plugs, facade sections and similar parts can appear.
4. Place a model. Original size is fixed. Move/rotate it; set a door's type, hinge, direction, distance/angle, speed, collision and automatic opening as appropriate. Default type is Hinged: a garage-looking name does not automatically select its motion.
5. Export normally. Original doors always use the existing server-authoritative Lua controller. Original windows are static MLO archetype references. No original GTA geometry/textures are copied into the project or exported resource.

## Origins, collision and synchronization

The editor displays centered geometry, while the game spawns the original asset around its original origin. Export records an offset from the chosen side hinge or upper-edge tilt pivot to that original origin. Client transforms rotate the offset and the same original collision-bearing object together. Translation, tilt lift and forward/back offset use the same server transition. Managed native doors are omitted from MLO entities, preventing duplicate stationary doors/collision. The controller waits for original model/collision streaming before creating an object with collision enabled.

The existing shared logical state, revision checks, snapshots, stream-in restoration, auto-open logic and optional ox lock-state bridge are reused. This uses local objects on each client with synchronized logical state, not a competing network object owner. Do not register these same objects with a second movement controller. The existing ox integration reads lock state; it does not create doorlock entries or UI.

Original models retain their archetypes, physics dictionaries and collision; they are not rebuilt. A model without usable standalone collision cannot be made collision-safe by this catalogue. Missing/unmounted DLC models or collision may prevent spawning; investigate the resource log. Physics dictionary loading is delegated to game model/collision streaming. Windows retain game collision and behavior; breakability is not guaranteed. Skinned/multibone drawables remain unsupported by the preview importer and produce an error rather than an incorrect rigid preview.

Original door leaves cannot be mirrored/resized. Place left/right originals separately; they currently have separate controller groups. The existing automatic double-door feature remains available for imported models. Hinged original doors also use the built-in controller in this version.

## Validation and limits

Local test installation: 86,690 YDR archive records; 2,099 unique building candidates, including 311 window candidates. These counts depend on installation. Metadata indexing loads zero drawables. The ten interior pilot props still load; prop_gar_door_01 loads and exports in all four motion modes using original references and offsets. Binary export contains only our generated floor assets, no copied GTA assets and no duplicate native door MLO entities. RPF sizes/timestamps remain unchanged.

Regression tests cover existing imports/doors, editor catalogue separation and immutable original sizes. Lua tests cover native offsets for all four modes, identical transforms on two mocked clients and collision calls. These are **not actual FiveM physics or multiplayer tests**. Validate each selected original model with a player, vehicle and two real clients, including late join/stream-in and locked auto-opening. Until then this remains a test build.

Native API reference: [CreateObjectNoOffset](https://github.com/citizenfx/natives/blob/master/OBJECT/CreateObjectNoOffset.md).
