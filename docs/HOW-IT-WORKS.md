# How MLO Creator works

*Leia em português: [HOW-IT-WORKS.pt-BR.md](HOW-IT-WORKS.pt-BR.md)*

This is the reference for what each part of the program does and how it is built. The README covers installing and running it.

## Contents

1. [Architecture](#architecture)
2. [Project types](#project-types)
3. [Workflow for an interior in an imported model](#workflow-for-an-interior-in-an-imported-model)
4. [Coordinates](#coordinates)
5. [Cutting the model and its collision](#cutting-the-model-and-its-collision)
6. [Doors and windows](#doors-and-windows)
7. [Props and plants](#props-and-plants)
8. [Several buildings in one project](#several-buildings-in-one-project)
9. [Export](#export)
10. [Limits](#limits)
11. [Whole new building](#whole-new-building)
12. [Controls](#controls)
13. [Code map](#code-map)

## Architecture

- `MloCreator.exe` is a C# 5 program (.NET Framework, built with the `csc.exe` that ships with Windows). It starts a small HTTP server on `127.0.0.1` with a random token and serves the editor from `ui\` on disk.
- The editor is a WebGL page. It is shown in a native window (`AppWindow.cs`, WinForms with Microsoft's WebView2). If WebView2 is missing it falls back to an Edge or Chrome `--app` window; `logs\window.log` says why.
- The page keeps the project (a JSON file in `projects\`), runs all the editing tools, builds the interior's meshes and collision, and sends a description of the result to the host on Export.
- The host does everything that needs game files: reading `.ydr`, `.yft`, `.ybn`, `.ytd`, `.ytyp`, `.ymap` and the game's archives through CodeWalker's library, cutting models and collision, and writing the resource.
- The window closes the program; unsaved work is saved first. Projects also autosave.

Because the UI is served from disk, a change in `ui\` only needs a reload of the page; a change in `src\` needs a rebuild.

## Project types

- **Interior in an imported model.** Import the files of a building, cut openings, draw rooms, finish, export. This is the main workflow and is described below.
- **Whole new building.** Build a house on a grid with walls, rooms, doors, windows, stairs, levels and a roof.
- **Interior for an existing house (older).** Projects made with the early automatic mode still open and export as they did.

## Workflow for an interior in an imported model

The Build tab shows a route of nine stages that open like dropdowns; a card above it says how far along you are and what to do next.

1. **Import the model.** Add `.ydr`, `.ytd`, `.ybn` and `.ymap` files, or look them up in the game files. The biggest `.ydr` is the model. Say where the model stands in the game (take it from an imported `.ymap`, look it up, or type x, y, z and heading).
2. **Set up the building.** A model is often a whole block. *Select building* finds the separate objects of the model (vertices that coincide belong together), hides the rest, squares the grid to its walls and moves the camera to it. *Frame* squares the grid to a wall you click; Shift+click sets the floor height, Alt+click moves the corner.
3. **Draw the rooms.** *Add room* drags a rectangle (floor, walls, ceiling); *Cut out* removes a rectangle; *Partition* draws an inner wall; *Select* edits any of them with handles. Edges snap to the model's walls and to 5 cm. *Fit rooms to the walls* snaps every room edge to the building's wall faces.
4. **Doors and windows.** Door, Window and Archway tools cut through the model; the Models tool places door and window models from your own `.glb` files.
5. **Clean up the model.** Delete faces, model parts, edges (fill holes), collision pieces, and your own collision boxes. The model's parts that stick into the rooms are cleared automatically.
6. **Props and small removals.** Bushes, trees and other props the map places around the building, and small pieces of the model.
7. **Finish the inside.** Floor and wall paint, ceiling lights.
8. **Check it.** The checklist and the walk check.
9. **Export.**

### Room settings

- **Ceiling height** and **wall depth** are in the right panel. *Match the building* picks the ceiling top that most of the building's own wall area has.
- **Wall thickness** moves the inner face of every wall into the room, so parts of the building that stick through the wall by less than that are covered. Corners meet at the moved faces and openings get reveals.
- **Interior walls** can be built from the room edges (default) or from the building's own wall faces turned round to look into the rooms (experimental).

### Tools at a glance

| Tool | Does |
|---|---|
| Select building | Pick the objects of one building out of the model |
| Frame | Square the grid to a wall; set floor height and corner |
| Raise / lower rooms | Move all rooms up or down against the model |
| Add room, Cut out, Partition | Draw the interior |
| Fill gaps | Fill empty floor between rooms |
| Door, Window, Archway | Cut an opening through the model, collision and interior walls |
| Window / door models | Place `.glb` models by hand |
| Delete faces | Select and delete faces of the model, like edit mode in Blender |
| Model parts | List the model's parts (one per texture) and remove or select a whole part |
| Edges | Show open edges and fill holes |
| Collision | Select and delete the building's invisible collision pieces |
| Collision box | Draw your own collision boxes |
| Props and plants | Pick and remove map props, plants and small pieces |
| Floor paint, Light | Finish the inside |
| Walk check | Walk a player-sized capsule through the result |
| Scale figure | A 1.8 m figure to judge heights against |
| Cutaway | Hide the model above a height to see inside |

## Coordinates

There are three frames and the program converts between them:

- **Grid (shell) frame:** the grid the rooms are drawn on, with the floor at z = 0.
- **Model frame:** the building model's own coordinates. Every model file of a map (the building and each detail file) is centred on its own entity, so each file has its own origin.
- **World frame:** the position and heading of the model's entity in the game.

A project with detail files (grilles, vents, bushes and props of the block) stores where each one stands (`import.detailPlace`); the editor moves every detail file into the building's coordinates and gives the host the rooms in each file's own frame.

## Cutting the model and its collision

- **Openings.** A cutter is a box. The triangles of the model inside it are removed and the triangles it crosses are split along its faces. The same box opens the interior walls and cuts the model's collision files: boxes that line up are split around the opening, other shapes are removed when their centre is inside.
- **Clearing the model out of the rooms.** Everything of the model that lies inside a room is cut at the room's walls: window boxes and frames, vegetation cards, vents, anything else. The three kinds (windows, vegetation, everything else) have ticks and counts. The outside surface of the building is kept: a face that looks out of the room through one of its walls and lies within 15 cm of it is not cut. Windows get a further depth (default 10 cm) so their frames stay.
- **Clearing the collision.** The building's collision often fills its rooms with invisible slabs and blocks. With *Clear the building's collision inside the rooms* (on by default) every room volume is cut out of the collision files. The count of what is left is shown all the time, and the Collision overlay draws it in red.
- **Detail models.** Faces deleted from detail files are stored per file (`import.mdeletes`) and the export writes those files again with the faces taken out. A geometry left with no faces is removed.
- **Fills.** Holes filled with the Edges tool are added to the model when it is cut and are written into the exported model.

## Doors and windows

### Cut openings (Door, Window, Archway)

Click the faces of a door or window of the model (the flat patch lights up) and click. The faces are deleted, the interior wall behind it and the collision are opened, and a window gets glass at the plane of the faces. A plain frame is built around cut-out windows and doors, or you can keep the model's own frame, or have none. Gaps in the model's wall beside a cut-out are measured and closed with trim.

### Door and window models from `.glb` files

Models you bring (for example from Sketchfab) go into the project like other files. The host reads each mesh with its node transform; a file with several windows is split into one model per window. Animations are not used.

- **Placing:** choose a model, click a wall. Nothing is cut for you: *Select the wall faces behind it* and *Select the building's collision there* select what you probably want to delete.
- **Gizmo:** arrows move along width, depth and height; cubes resize; a ring turns in 15 degree steps. Positions snap to 1 cm.
- **A window's hole** in the room wall is the model's size minus 1 cm all round. **A door's hole** can match the size of the building's own door-shaped opening; the door is centred in it.
- **Frames** are a third kind, placed in an opening to hold a door.
- **Setting a model up:** a model can come out of its file lying down or facing the wrong way, so each model has a stored turn; doors and frames are stood up automatically when none is stored.
- **Double doors:** a door placement can be two leaves hinged on the outer edges and meeting in the middle. The leaf whose knob would sit on its hinge side is the model mirrored left to right.

### How a door is exported

Each door is a prop of its own made like the game's own doors: archetype flags `0x24020000` with special attribute 7, a composite collision bound with one box child, the hinge at mid height as the origin, and a physics dictionary entry of its own name. The README of the export lists each door's model name, hash, hinge position and heading, which is what a door script such as ox_doorlock asks for. The game ignores the scale of an entity, so the size you give a model is baked into its vertices.

Windows are merged by material into extra parts of the interior; their glass uses the interior's glass shader.

## Props and plants

Bushes, hedges, trees and props that stand around a building are not in the model's files: the game's map files (`.ymap`) place them. The Props and plants tool finds them and lets you hide the ones you choose.

- **Lookup.** The host reads every map file that covers the model's extent plus 8 m (`Vanilla.PropsInBox`) and lists the props. A prop counts as a plant by its name, by the archive that holds its model (`bush`, `veg`, `tree`...), by its foliage shader or by leaf and branch textures. Fragment props (`.yft`) are read too. Copies of the same prop in several map files are merged. Results depend only on the model, not on one building.
- **Rules.** A plant is hidden by the rule when at least 3 of its triangles and at least a set percentage (5 by default) lie inside a room, or when it stands right in front of a window or door and is bush-sized. Anything else is only hidden if you pick it. Other props are never hidden by a rule.
- **In the view.** *Show the models* draws the game's own meshes where the map places them: orange = will be removed, green = stays, blue-grey = other props, cyan = bushes made of cards inside the model files, lilac = small pieces of the model.
- **Picking.** Click a model to select it, Shift adds, **A** all, **Alt+A** none, **Ctrl+I** invert, **X** or Delete removes, **R** keeps, Esc deselects, Ctrl+Z undoes.
- **Model-file bushes and small pieces.** Their triangles are deleted from the file they are in (the same way as the Delete faces tool).
- **Export.** `client/plants.lua` calls `CreateModelHide(x, y, z, 0.6, GetHashKey(model), true)` once for each hidden prop (the exact spot of that one prop) and `RemoveModelHide` when the resource stops. No map file is replaced.

Not covered: procedural grass (drawn by the game on the ground) and props wider than 16 m (road pieces).

## Several buildings in one project

A block holds many buildings but only one resource can replace the model's files, so all of them are made in one project. Each building has its own grid, rooms, partitions, lights, openings, collision boxes, ceiling height, wall settings and textures. The model, deleted faces, removed parts, deleted collision and the model's placement are shared. The model is cut by the openings of all buildings. On export each building becomes its own interior (`<prefix>int.ydr`, `<prefix>mlo.ybn`, ...) with the building's number added to the prefix for the second and later ones.

## Export

Press Export on the Export tab; the folder goes to `output\<folder>` (or the folder you set). Upload it to the server's resources, `refresh`, `ensure <folder>`. The log and the README in the folder give a test spot inside the interior.

| File | Content |
|---|---|
| `<prefix>_int.ydr` | The interior: floors, walls, ceiling, trim, lights |
| `<prefix>_glass.ydr` | Window glass |
| `<prefix>_mlo.ybn` | Collision for floors, walls and your boxes |
| `<prefix>_tex.ytd` | Only the textures you used |
| `<prefix>_types.ytyp` | The MLO: limbo room + interior room, one portal for each door or window that reaches the outside, and the door props |
| `<prefix>_milo_.ymap`, `_manifest_<prefix>.ymf` | Where it stands, and the interior marker |
| the model's `.ydr` | The building model with your cuts, written under its original name so it replaces the game's one while the resource runs |
| the imported `.ybn` files | The collision with the same cuts |
| the occlusion `.ymap` files | The same files without the boxes inside your interior (only when some were inside) |
| `_fm*.ydr`, `_fd*.ydr` | Window parts and door props from `.glb` models |
| `client/plants.lua` | Hides the props you removed |
| `fxmanifest.lua`, `client/ipl.lua`, `README.md` | The resource itself and a list of the game files it replaces |

## Limits

- Never assume it works in game without testing. Streaming, lighting, portals, collision and door behaviour have to be seen in the game.
- Only one resource can replace a given game file.
- Rooms are axis-aligned rectangles in the grid, one level, one interior room for the whole interior.
- A cutter opens the interior walls only when it is square to the grid (within 1.5 degrees); the model and the collision are cut at any angle.
- Spheres, capsules and cylinders of the collision are not clipped.
- Collision boxes you draw are boxes only and are not checked against anything.
- The walk check tests the files' collision with a flat capsule on one level, not the game's character controller.
- Door props are static: wire them to your door script by model and coordinates.
- Textures that are not in the files you import are shown in plain colours in the editor; the game uses its own.
- The model's tilt is ignored (only the turn about the vertical is used); the model's scale must be 1.

## Whole new building

| Tool | Does |
|---|---|
| Wall | Drag grid corner to grid corner |
| Room | Drag a rectangle: four walls and the floor |
| Floor | Drag cells: floor without walls |
| Door, Window, Archway | Click a wall; click again to remove |
| Stairs | Click a cell; steps, run, width, direction, railings |
| Roof | Drag cells: flat roof slab |
| Light | Click a cell for a ceiling light |
| Entrance | The door whose in-game position places the house |
| Eraser | Remove walls and cells |

Stand in the entrance doorway in the game and paste `vec4(x, y, z, heading)` to place the house.

## Controls

**Camera:** middle-drag orbits (Shift pans, Ctrl zooms), right-drag also orbits, wheel zooms, keypad 1 / 3 / 7 for front / right / top (Ctrl for the opposite side), Home frames everything, WASD moves, Q / E turn 90 degrees, T is top-down.

**General:** Ctrl+Z / Ctrl+Y undo and redo, Esc or right-click cancels a drag, Ctrl+S saves. The hint bar above the status line shows the active tool's keys.

**Tool keys:** Add room 1, Cut out 2, Partition 3, Door 4, Window 5, Archway 6, Floor paint 7, Light L, Select V, Eraser X, Select building B, Frame O, Raise / lower G, Fill gaps J, Delete faces F, Model parts P, Edges K, Collision M, Collision box N, Window / door models I, Props and plants Y, Walk check U, Scale figure H, Cutaway C.

## Code map

| Path | Content |
|---|---|
| `src\Program.cs` | Local server, routes, settings, window start |
| `src\AppWindow.cs` | The native window (WebView2) |
| `src\ImportHost.cs` | Import, lookups, placement, props routes |
| `src\ModelCut.cs`, `src\CollisionCut.cs` | Cutting the model and its collision |
| `src\Vanilla.cs` | Reading the game's archives and map files |
| `src\Exporter.cs`, `src\FitExport.cs` | Writing the resource, door and window props |
| `src\GlbModels.cs` | Reading `.glb` models |
| `ui\js\importmodel.js`, `importtools.js`, `importui.js` | The import workflow: model, tools, side panels |
| `ui\js\plants.js` | Props and plants |
| `ui\js\shell.js`, `mesher.js` | Building the interior's meshes and collision |
| `ui\js\fitmodels.js` | Placing `.glb` models |
| `ui\js\walk.js` | The walk check |
