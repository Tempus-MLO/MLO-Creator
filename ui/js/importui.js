// Panels for projects built inside an imported model: Import tab, Build tab, view options and Export.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, TEX, Model, Shell, Mesher } = M, S = Model.state, bus = Model.bus;
    const IM = M.ImportModel, IT = M.ImportTools;
    const UI2 = M.ImportUI = {};
    const kit = () => M.UI.kit;
    const imp = () => S.project.import;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const encName = () => encodeURIComponent(Model.safeName(S.project.name));
    const kb = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

    const TOOLS = [['building', 'Select building', 'B'], ['frame', 'Frame', 'O'], ['level', 'Raise / lower rooms', 'G'], ['room', 'Add room', '1'], ['cut', 'Cut out', '2'], ['fill', 'Fill gaps', 'J'], ['part', 'Partition', '3'], ['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6'], ['fit', 'Window / door models', 'I'], ['plants', 'Props and plants', 'Y'],
        ['floor', 'Floor paint', '7'], ['light', 'Light', 'L'], ['figure', 'Scale figure', 'H'], ['faces', 'Delete faces', 'F'], ['edges', 'Edges (fill holes)', 'K'], ['parts', 'Model parts', 'P'], ['collision', 'Collision', 'M'], ['cbox', 'Collision box', 'N'], ['walk', 'Walk check', 'U'], ['select', 'Select', 'V'], ['eraser', 'Eraser', 'X']];
    // What each tool does in one line (the tool list shows it; the long text is in HELP).
    const SUM = {
        building: 'Pick one building out of the block.', frame: 'Square the grid to a wall and set the floor.', level: 'Raise or lower the rooms against the model.',
        room: 'Draw a rectangle: floor, walls and ceiling.', cut: 'Take a rectangle out of a room (a column, a closet).', part: 'Draw a straight interior wall.', fill: 'Close narrow gaps between your rooms.',
        door: 'Cut a door out of the model and put the door in.', window: 'Cut a window out of the model and put glass in.', arch: 'Cut a wide opening with a box.', fit: 'Place window and door models (.glb) by hand with a move / size / turn gizmo.', plants: 'Click props, plants and small model pieces in the view and remove them.',
        faces: 'Select faces like in Blender (click, box, A, L), then delete them: fake doors, painted windows, grilles.', parts: 'See each texture of the model and remove or restore a whole one.', collision: 'Pick pieces of the building\'s invisible collision and delete them.', cbox: 'Build your own collision: boxes with a surface type.', walk: 'Walk a player through the interior and list what blocks or leaks.', edges: 'Select the rim of a hole in the wall and fill it with faces.',
        floor: 'Paint a floor texture on part of the floor.', light: 'Hang a ceiling light.',
        select: 'Select a room or opening to move, resize or edit it.', eraser: 'Remove a cutter, light, wall or opening.', figure: 'Stand a person in the room to judge sizes.'
    };
    // ---- The route: the stages in the order you do them. A row of the list is one job; where a job has a few ways to do it (a door, a window or an archway; add a room
    // or cut one out) the ways are one row with a switch, so the list is short. `vars` = [tool, label, key]; `steps` = the checklist steps (see steps()) that belong to a stage.
    const ROWS = {
        building: { name: 'Select building', vars: [['building', 'Select building', 'B']] },
        frame: { name: 'Grid and floor', sum: 'Square the grid to a wall and set the floor.', vars: [['frame', 'Grid and floor', 'O']] },
        level: { name: 'Raise / lower rooms', vars: [['level', 'Raise / lower rooms', 'G']] },
        room: { name: 'Rooms', sum: 'Draw a rectangle for a room, or cut one out of a room (a column, a closet).', vars: [['room', 'Add room', '1'], ['cut', 'Cut out', '2']] },
        part: { name: 'Partition', vars: [['part', 'Partition', '3']] },
        fill: { name: 'Fill gaps', vars: [['fill', 'Fill gaps', 'J']] },
        opening: { name: 'Cut an opening', sum: 'Cut a door, window or archway out of the building\'s wall and fill it.', vars: [['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6']] },
        models: { name: 'Window / door models', vars: [['fit', 'Window / door models', 'I']] },
        faces: { name: 'Delete faces', vars: [['faces', 'Delete faces', 'F']] },
        plants: { name: 'Props and plants', sum: 'Click props, plants and small model pieces in the view and remove them.', vars: [['plants', 'Props and plants', 'Y']] },
        parts: { name: 'Model parts', vars: [['parts', 'Model parts', 'P']] },
        edges: { name: 'Fill holes', sum: 'Select the rim of a hole in the wall and fill it with faces.', vars: [['edges', 'Fill holes', 'K']] },
        collision: { name: 'Collision', sum: 'The invisible part: delete the building\'s collision that blocks you, or build your own boxes.', vars: [['collision', 'Delete pieces', 'M'], ['cbox', 'Build boxes', 'N']] },
        floor: { name: 'Floor paint', vars: [['floor', 'Floor paint', '7']] },
        light: { name: 'Lights', sum: 'Hang a ceiling light.', vars: [['light', 'Lights', 'L']] },
        walk: { name: 'Walk check', vars: [['walk', 'Walk check', 'U']] },
        figure: { name: 'Scale figure', vars: [['figure', 'Scale figure', 'H']] }
    };
    const rowOf = (tool) => Object.keys(ROWS).map(k => Object.assign({ id: k }, ROWS[k])).find(r => r.vars.some(v => v[0] === tool)) || null;
    const STAGES = [
        { id: 'import', name: 'Import the model', note: 'Add the building\'s model files and say where it stands in the game. Done in the Import tab.', tab: 'import', rows: [], steps: ['model', 'place'] },
        { id: 'set', name: 'Set up the building', note: 'Pick the building out of the block and put the grid on its floor. Everything else is measured from the grid.', rows: ['building', 'frame', 'level'], steps: ['building', 'grid'] },
        { id: 'rooms', name: 'Draw the rooms', note: 'The interior is rectangles: floor, walls and ceiling. Their edges have to lie on the building\'s own walls.', rows: ['room', 'part', 'fill'], steps: ['rooms', 'fit'] },
        { id: 'open', name: 'Doors and windows', note: 'Cut the doors and windows out of the building\'s wall so you can walk in and see out. Nothing is cut for you: you pick the faces, or place a model with the gizmo.', rows: ['opening', 'models'], steps: ['open', 'portal'] },
        { id: 'repair', name: 'Clean up the model', note: 'Take out what is in the way: fake doors, painted-on windows, vents, solid collision. Then close the holes that leaves.', rows: ['faces', 'parts', 'edges', 'collision'], steps: ['col', 'colclear'] },
        { id: 'props', name: 'Props and small removals', note: 'Props, plants and small model pieces that are in the way. Click one in the view and remove it.', rows: ['plants'], steps: ['plants'] },
        { id: 'finish', name: 'Finish the inside', note: 'Paint the floor and hang the lights. Nothing is lit unless you place a light.', rows: ['floor', 'light'], steps: ['lights'] },
        { id: 'check', name: 'Check it', note: 'Walk a player-sized capsule through the interior before you export, and judge sizes with a person.', rows: ['walk', 'figure'], steps: ['walk'] },
        { id: 'export', name: 'Export', note: 'Name the resource and export it. The Export tab says how to put it on your server.', tab: 'export', rows: [], steps: ['prefix'] }
    ];
    const stageOfTool = (tool) => { const r = rowOf(tool); return r ? (STAGES.find(s => s.rows.indexOf(r.id) >= 0) || {}).id : null; };
    // How to use each tool, in a few lines (shown open under the tool's name; HELP has the long text)
    const HOW = {
        building: ['Click the building you want to work in: the others are hidden.', 'Small parts attached to it come along. Shift+click adds or takes away a part.', 'The grid is squared to its walls and the camera goes to it.'],
        frame: ['Click a flat floor of the model: sets the corner and the floor height.', 'Click a straight wall: squares the grid to it.', 'Shift+click a wall: the floor is its bottom edge. Alt+click: moves the corner (0, 0) there.'],
        level: ['Drag the blue arrow up or down until the rooms\' floor matches the building\'s floor.', 'Ctrl snaps to 5 cm, Shift moves finely, Esc cancels.', 'Or click a floor of the model to put the rooms\' floor at its height.'],
        room: ['Drag a rectangle in the building: it becomes floor, walls and ceiling.', 'Edges snap to the model\'s walls and to 5 cm (Shift: no snapping).', 'Move or resize a room afterwards with the Select tool (V).'],
        cut: ['Drag a rectangle over a room: that part is taken out (a column, a closet).', 'Same snapping as Add room.'],
        part: ['Drag a straight line to build a wall inside the interior.', 'Doors and windows in it come from the opening tools.'],
        fill: ['Green areas are gaps between your rooms. Click one to fill it.', 'Shift+click fills a closed hole of any size; "Fill all" does every green area.'],
        door: ['Click the faces of a door on the building: the flat patch under the pointer lights up (Shift: just one triangle).', 'The faces are cut out and the opening is filled with the door model.', 'Delete in the panel gives the faces back.'],
        window: ['Click the faces of a window on the building: the flat patch under the pointer lights up (Shift: just one triangle).', 'The faces are cut out and the opening is filled with glass and a frame.', 'Delete in the panel gives the faces back.'],
        arch: ['Click a wall: a wide, tall opening (1.6 x 2.3 m) is cut with a box, like a boolean in Blender.', 'Select the box afterwards to change its size.'],
        fit: ['Add a .glb window or door (drag it onto the window), choose it in the list and click the wall to put it there.', 'Drag the arrows to move it, the cubes to size it, the ring to turn it. R turns it 90°, X removes it. A door can be a double door (tick it in the panel).', 'Nothing is cut from the building: select the wall faces behind it with the button and delete them in Delete faces.'],
        faces: ['Click selects the flat patch under the pointer (Ctrl+click one triangle, Alt+click a whole piece); drag a box to select what you see.', 'Shift adds, Ctrl takes away. A selects all, L the piece under the pointer.', 'X or Delete removes the selection; Ctrl+Z brings it back. Use it for fake doors, painted windows, grilles.'],
        parts: ['Every texture of the model is a part. Click a part in the view or in the list.', 'Remove takes all its faces out of the model and the export; Restore gives them back.'],
        edges: ['Orange lines are the rims of holes that deleting faces left in the wall.', 'Click an edge (Alt+click: the whole rim), then press F to fill the hole.'],
        collision: ['The orange lines are the building\'s invisible collision. Click a piece, or drag a box to select the pieces in it (Shift adds).', 'X deletes the selection, Ctrl+Z brings it back.', 'Rooms are already cleared of collision: use this for what is left.'],
        cbox: ['Drag on the floor to draw a collision box; click one to select it, drag to move, white handles to resize.', 'Pick the material in the panel: it decides the sound and what bullets do.', 'A box only makes collision, nothing is drawn for it.'],
        plants: ['Look up first (button in the panel): every prop and plant of the model is drawn.', 'Click one to select it (Shift adds, A all), X removes it, R keeps it.'],
        floor: ['Pick the floor texture in the Paint tab.', 'Drag a rectangle to give that part of the floor the texture.'],
        light: ['Click the floor to hang a ceiling light there; click a light again to remove it.', 'Only the lights you place are exported: put at least one in every room.'],
        walk: ['Press "Run the check": a player-sized capsule is walked through every room and doorway.', 'Click a line of the result to see where the problem is; "Select it" picks collision that blocks you.'],
        figure: ['Click the floor to stand a 1.8 m person there; drag to move, R turns.', 'Only a view aid: never saved or exported.'],
        select: ['Click a room or an opening: drag its edges to resize, the inside to move.', 'Edit the numbers in the panel. Del or X removes it, Esc deselects.'],
        eraser: ['Click a cutter, light, partition or opening to remove it.']
    };
    const HELP = {
        building: 'The model holds a whole block. Click one building: the others are hidden, the grid is squared to its walls and centered on it, and the camera goes to it. Small parts attached to it (porch, steps) come along. Shift+click adds or removes a part (set "Other buildings" to Ghost to see what else is near). Each building of the project has its own grid, rooms and openings: if the building you are working on already has rooms, clicking a different building starts a new building for it (the first keeps everything). Switch between them in the Buildings list.',
        frame: 'Set the grid first. Click a straight wall to turn the grid square to it. Shift+click a wall to put the floor at its bottom edge, Alt+click to move the corner (0, 0) there. A flat floor of the model sets the corner and the floor height in one click. You can also type the numbers in the Import tab.',
        level: 'Drag the blue arrow up or down to raise or lower all the rooms against the model, until the floor matches the building. Ctrl snaps to 5 cm, Shift moves finely, Esc or right-click cancels. Or click a floor of the model to put the rooms\' floor at that height. The cutters stay where they are on the model.',
        room: 'Drag a rectangle to add it to the interior (floor, walls, ceiling). Its edges snap to the model\'s own walls and to 5 cm.',
        cut: 'Drag a rectangle to take it out of the interior (a column, a closet).',
        fill: 'Green areas are gaps between your rooms (no wider than "Largest gap"). Click one to fill it as part of the interior. Shift+click a closed hole fills it whatever its size. "Fill all" fills every green area.',
        part: 'Drag a straight line to build an interior wall. Doors in it come from the Door tool.',
        door: 'Click the faces of a door on the model (the flat patch under the pointer lights up; Shift: just one triangle). The faces are cut out and the opening is filled with the door model you chose in the Import tab. In the panel: Double doors, Turn around, Across the wall. Delete gives the faces back.',
        window: 'Click the faces of a window on the model (the flat patch under the pointer lights up; Shift: just one triangle). The faces are cut out and the opening is filled with a pane of glass. Delete gives the faces back.',
        arch: 'Click a wall to cut a wide, tall opening (1.6 x 2.3 m by default) with a box, like a boolean in Blender.',
        fit: 'Window and door models from .glb files. Add a .glb to the project (Add .glb models, or drag it onto the window): a file with several windows becomes one model per window. Choose a model in the list and click a wall to put it there, then use the gizmo: drag the coloured arrows to move it along an axis (dragging the model itself slides it along the wall), the cubes on its faces to change its size (Alt: from the middle), the white cube on the corner to scale it all together, the yellow ring to turn it (15 degree steps). Shift = fine / no snapping. R turns it 90 degrees, Shift+R turns it around, Shift+D duplicates, X removes it. Nothing is cut from the building: select the faces behind the model with the button and delete them in the Delete faces tool.',
        plants: 'Every prop and plant of the whole model is drawn as its real model. Pick what to show: plants, props, model pieces (vents, pipes). Click selects, Shift+click adds, A selects all, Alt+A none, Ctrl+I inverts, X or Delete removes, R keeps, Ctrl+Z undoes. Props and plants are hidden in the game by a script; model bushes and pieces are taken out of their file. Plants in a room or at a window are removed by default.',
        floor: 'Drag a rectangle to give that part of the floor the floor texture chosen in the Paint tab.',
        light: 'Click the floor to hang a ceiling light there. Click a light again to remove it. Only the lights you place are exported.',
        figure: 'A person to judge heights against (1.8 m by default). Click the floor to stand the figure there, drag it to move it, R turns it by 45 degrees. It stays in view with the other tools until you remove it. It is only a view aid: it is never saved or exported.',
        faces: 'Works like Blender\'s edit mode: select, then act. Click selects the flat patch under the pointer (Ctrl+click: one triangle, Alt+click: the whole connected piece such as a grille or a vent), Shift+click adds or removes, and dragging draws a box that selects the faces you can see in it (Shift adds, Ctrl takes away). A selects all, Alt+A none, Ctrl+I inverts, L selects the piece under the pointer, Ctrl+L grows the selection to whole pieces, Shift+G selects everything with the same texture. X or Delete deletes the selection (Ctrl+Z brings it back). Use it for fake doors, painted-on windows, details that stick out and solid wall pieces. Turn on "Detail models" to reach the grilles, vents and bushes: they are separate files that go with the building and are changed in the export too. Deleting can leave a hole in a wall: the Edges tool fills it.',
        parts: 'Every model is made of parts: all the faces that share one texture. Click a part in the view, or a row in the list, to see it; Remove takes every face of it out of the model and out of the export, Restore gives them back. Use it for whole textures (decals, a window page, a detail file); for single pieces use Delete faces.',
        collision: 'The building\'s collision is what stops you in the game, and you cannot see it. The orange lines are its pieces (triangles and boxes) around your rooms. Click one to select it, Shift+click adds or removes, drag a box to select the pieces inside it (Shift adds, Ctrl takes away), A selects all, Alt+A none, Ctrl+I inverts, Shift+G the same material, X or Delete deletes the selection (Ctrl+Z brings it back). The three collision files of a building overlap, so a deleted piece takes the piece of about the same size at the same place in the other files with it (switch that off below). Rooms are already cleared of collision; use this for what is left, or for collision outside them (frames, ledges, props).',
        cbox: 'Collision you build yourself, for what has to stop you but has none (a ledge or step of the model whose collision you deleted, a railing, a counter). Drag on the floor to draw a box (on a ledge or step of the model it stands on that surface); the first box is 1 m tall, the height is set with the stem on top, or by typing it. Click a box to select it (Shift+click adds or removes), drag it to move it, drag a white handle to resize it. X or Delete removes the selection, Shift+D duplicates it, R turns it 90 degrees, A selects all. Pick the surface type (material) in the panel: it decides the sound, how bullets go through it and what it does to a ragdoll. A box only makes collision, nothing is drawn for it. The teal outlines are the collision the rooms already make by themselves (floor, ceiling, walls, window glass, door frames), so you can see what is missing. To wrap a box around a part of the model, select its faces in the Delete faces tool and press "Collision box around the selection".',
        walk: 'Tests the collision the game will have, before you go there. A player-sized capsule (set its width, height and step below) is put on the floor of the biggest room and walked everywhere it fits. It uses the interior\'s own collision (walls, floor, door frames, window glass), your collision boxes and what is left of the building\'s collision after the export\'s cuts. It finds: parts of the rooms it cannot reach, doorways it cannot pass (and what blocks them), gaps in the walls it can walk out through, pieces of the building\'s collision standing in your rooms, holes in the floor and boxes that float. Click the floor to start the walk somewhere else. Click a line of the result to see where it is. Green is where the player can stand, orange is closed off, red is an invisible piece of the building, pink is a hole. The door model itself is not part of this (it is a prop with its own collision that your door script moves).',
        edges: 'Like fixing a hole in Blender. The rims of the holes that deleting faces left in the model\'s walls are drawn in orange. Click an edge to select it, Shift+click adds or removes one, Alt+click (or double-click) takes the whole loop around the hole, A selects every edge shown. F fills the selected hole with faces that take their material from the wall around them. An open chain of edges closes with a straight line. Fills are saved with the project and exported with the model.',
        select: 'Click a room (or a cut-out) to select it: drag an edge or corner to resize it, drag the inside to move it. Edges snap to the model\'s walls, to other rooms and to 5 cm; hold Shift for no snapping. Del or X removes it, Esc deselects. Click a cutter to edit its size and position in the panel, or drag it along the wall. Click a partition or opening to edit it.',
        eraser: 'Click a cutter, a light, a partition or an opening to remove it.',
        paint: 'Click a wall to give it the chosen texture.'
    };
    UI2.TOOLS = TOOLS;
    UI2.addFiles = (mode) => addFiles(mode);

    function numField(label, get, set, step, unit) {
        return el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: step || '0.01', value: get(), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    }

    // ---------------- Import tab ----------------
    let gameStatus = '', gameBusy = false, gameEntities = null, gameError = '';

    const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
    // A dropdown section: a header row (arrow, title, a short summary) that opens and closes what is under it. What is open is remembered for the session; the body is only
    // built while it is open. opt: { sum: text at the right, open: open by default, panel: 'right' for the right panel }
    function sec(root, key, title, opt, build) {
        opt = opt || {}; const st = S.secOpen = S.secOpen || {}, isOpen = st[key] !== undefined ? st[key] : !!opt.open;
        const again = () => { if (opt.panel === 'right') M.UI.renderRight(); else M.UI.renderLeft(); };
        root.append(el('button', { class: 'sec' + (isOpen ? ' open' : ''), onclick: () => { st[key] = !isOpen; again(); } }, el('span', { class: 'arr' }, isOpen ? '▾' : '▸'), el('span', { class: 'st' }, title), opt.sum ? el('span', { class: 'ss' }, opt.sum) : null));
        if (isOpen) { const body = el('div', { class: 'secbody' }); build(body); root.append(body); }
    }
    async function afterFilesChanged() {
        await IM.load(); M.App.remesh(); UI2.refresh();
        if (IM.loaded) { M.App.frameAll(); }
        if (S.showCollision) IM.requestCollision();
    }
    // a model of the project used as the door
    function setDoor(f) {
        Model.edit(P => {
            const I = P.import;
            if (I.doorModel && I.doorModel.file === f.name) delete I.doorModel;
            else {
                I.doorModel = { file: f.name, name: f.name.replace(/\.ydr$/i, ''), include: false }; if (I.target === f.name) I.target = '';
                // door openings cut out before a door model existed get the door now (the ones you turned off yourself keep their choice)
                I.cutters.forEach(k => { if (k.type === 'door' && k.face && k.leaf === undefined) { k.leaf = true; k.flip = false; k.lo = 0; } });
            }
        });
        IM.rebuild(); M.App.remesh(); UI2.refresh();
    }
    // the way to choose the door: one button per imported model, shown wherever a door is being made or edited and none is chosen yet
    function doorChooser(root) {
        if (IM.doorModel()) return;
        // door-shaped models first (thin, about a person wide, taller than 1.7 m): the details of the block (bushes, props) are not offered unless nothing else is
        const I = imp(), all = (IM.files || []).filter(f => f.kind === 'model' && f.name !== I.target);
        const doorLike = all.filter(f => { const m = IM.models.find(x => x.file === f.name); if (!m) return false; const e = [0, 1, 2].map(a => m.bmax[a] - m.bmin[a]), th = Math.min(e[0], e[1]), wd = Math.max(e[0], e[1]); return th <= 0.5 && wd >= 0.5 && wd <= 3.5 && e[2] >= 1.7 && e[2] <= 3.5; });
        const cands = doorLike.length ? doorLike : all;
        root.append(el('div', { class: 'note', style: { color: '#f0d28a' } }, 'No door model chosen yet, so door openings stay empty.'));
        if (cands.length) cands.forEach(f => root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm primary', style: { whiteSpace: 'normal', textAlign: 'left' }, onclick: () => setDoor(f) }, 'Use ' + f.name + ' as the door'))));
        else root.append(el('div', { class: 'row' }, el('span', { class: 'note grow' }, 'Import a door model (.ydr) first.'), el('button', { class: 'btn sm', onclick: () => M.App.setTab('import') }, 'Import tab')));
    }
    // collision files of the game that belong to the model
    let colList = null, colErr = '';
    async function lookupCollision(statusEl, btn) {
        const I = imp(); btn.disabled = true; btn.textContent = 'Looking...';
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) statusEl.textContent = s.status; } catch (e) { } }, 500);
        try { const r = await Model.api('import/game-collision?name=' + encName(), 'POST', { target: I.target, gta: '', entity: I.entity || null }); colList = r.files || []; colErr = colList.length ? '' : 'The game has no collision file with that name.'; }
        catch (e) { colErr = e.message; }
        clearInterval(poll); UI2.refresh();
    }
    async function addGameFile(name) {
        try { await Model.api('import/game-add?name=' + encName(), 'POST', { names: [name], gta: '' }); toast('Added ' + name, 'ok'); await afterFilesChanged(); }
        catch (e) { toast(e.message, 'err'); }
    }
    const addCollision = addGameFile;
    const haveFile = (name) => (IM.files || []).some(f => f.name.toLowerCase() === name.toLowerCase());
    // every file of a lookup list in one go
    async function addAllGame(list, btn) {
        const names = list.map(c => c.name).filter(n => !haveFile(n)); if (!names.length) return;
        btn.disabled = true; btn.textContent = 'Adding...';
        try { const r = await Model.api('import/game-add?name=' + encName(), 'POST', { names, gta: '' }); toast('Added ' + (r.added || []).length + ' file(s).', 'ok'); await afterFilesChanged(); }
        catch (e) { toast(e.message, 'err'); UI2.refresh(); }
    }
    const addAllRow = (list) => {
        const pending = list.filter(c => !haveFile(c.name)); if (pending.length < 1) return null;
        const b = el('button', { class: 'btn sm primary', onclick: () => addAllGame(list, b) }, 'Add all (' + pending.length + ')');
        return el('div', { class: 'row' }, b);
    };
    // occlusion map files of the game (boxes that hide what is behind them, some sit inside houses)
    let occList = null, occErr = '';
    async function lookupOcclusion(statusEl, btn) {
        const I = imp(); btn.disabled = true; btn.textContent = 'Looking...';
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) statusEl.textContent = s.status; } catch (e) { } }, 500);
        try { const r = await Model.api('import/game-occlusion?name=' + encName(), 'POST', { target: I.target, gta: '', entity: I.entity || null }); occList = r.files || []; occErr = occList.length ? '' : 'No occlusion file has boxes around this building.'; }
        catch (e) { occErr = e.message; }
        clearInterval(poll); UI2.refresh();
    }
    async function addFiles(mode) {
        try { const r = await Model.api('import/browse?name=' + encName() + '&mode=' + mode, 'POST'); if (r.added && r.added.length) { toast('Imported ' + r.added.length + ' file(s).', 'ok'); await afterFilesChanged(); } }
        catch (e) { toast('Import failed: ' + e.message, 'err'); }
    }
    async function addTyped(path) {
        if (!path.trim()) return;
        try { const r = await Model.api('import/addpath?name=' + encName(), 'POST', { path: path.trim() }); toast('Imported ' + r.added.length + ' file(s).', 'ok'); await afterFilesChanged(); }
        catch (e) { toast(e.message, 'err'); }
    }
    UI2.dropFiles = async function (files) {
        if (S.project.kind !== 'import') return;
        let n = 0;
        for (const f of files) {
            if (!/\.(ydr|ytd|ybn|ymap|glb)$/i.test(f.name)) { toast(f.name + ': only .ydr, .ytd, .ybn, .ymap and .glb files can be imported.', 'warn'); continue; }
            try { await Model.apiRaw('import/upload?name=' + encName() + '&file=' + encodeURIComponent(f.name), await f.arrayBuffer()); n++; } catch (e) { toast(f.name + ': ' + e.message, 'err'); }
        }
        if (n) { toast('Imported ' + n + ' file(s).', 'ok'); await afterFilesChanged(); }
    };
    async function removeFile(name) {
        try { await Model.api('import/remove?name=' + encName() + '&file=' + encodeURIComponent(name), 'POST'); if (imp().target === name) Model.edit(P => { P.import.target = ''; }); await afterFilesChanged(); }
        catch (e) { toast(e.message, 'err'); }
    }
    async function gameLookup(statusEl, btn) {
        const I = imp(); if (!I.target || gameBusy) return;
        gameBusy = true; gameError = ''; btn.disabled = true; btn.textContent = 'Looking...';
        const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) statusEl.textContent = s.status; } catch (e) { } }, 500);
        try { const r = await Model.api('import/game-entity?name=' + encName(), 'POST', { target: I.target, gta: '' }); gameEntities = r.entities || []; if (!gameEntities.length) gameError = 'The game\'s map files do not place a model with that name.'; }
        catch (e) { gameError = e.message; }
        clearInterval(poll); gameBusy = false; UI2.refresh();
    }
    function useEntity(e, source) {
        Model.edit(P => { P.import.entity = { x: r3(e.x), y: r3(e.y), z: r3(e.z), heading: Math.round(e.heading * 1000) / 1000, ymap: e.ymap || '', source, tilted: !!e.tilted, scale: e.scale || 1 }; });
        IM.autoPlaces();                                                                              // (the detail models stand relative to it)
        UI2.refresh();
    }

    UI2.renderImport = function (root) {
        const P = S.project, I = P.import, k = kit();
        // the blocks of the tab; each one goes into a dropdown section at the end, in the order you need them
        const blkFiles = (root) => {
        root.append(el('div', { class: 'note' }, 'Import the model of the building you want to put an interior into: its .ydr, and if you have them its .ytd textures, .ybn collision and the .ymap that places it. Nothing is read from the game unless you press the lookup button below.'));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn primary', onclick: () => addFiles('files') }, 'Add files...'), el('button', { class: 'btn', onclick: () => addFiles('folder') }, 'Add a folder...')));
        const path = el('input', { type: 'text', class: 'grow', placeholder: 'or type a folder or file path', onkeydown: (e) => { if (e.key === 'Enter') { addTyped(path.value); path.value = ''; } } });
        root.append(el('div', { class: 'row' }, path, el('button', { class: 'btn sm', onclick: () => { addTyped(path.value); path.value = ''; } }, 'Add')));
        root.append(el('div', { class: 'dropzone' }, 'You can also drag files onto the window.'));
        const list = el('div', { class: 'plist', style: { maxHeight: '230px' } });
        const kindName = { model: 'model', textures: 'textures', collision: 'collision', map: 'placement', glb: 'window / door models' };
        (IM.files || []).forEach(f => {
            const isDoor = I.doorModel && I.doorModel.file === f.name, isTarget = f.name === I.target;
            list.append(el('div', { class: 'pitem', style: { padding: '4px 8px', gap: '6px' }, title: f.name, onclick: () => { if (f.kind === 'model' && !isDoor) { Model.edit(Q => { Q.import.target = f.name; }); IM.load().then(() => { M.App.remesh(); UI2.refresh(); }); } } },
                el('div', { style: { flex: '1', minWidth: '0' } },
                    el('b', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isTarget ? 700 : 500 } }, f.name),
                    el('span', { class: 'note', style: { margin: 0 } }, (kindName[f.kind] || f.kind) + ' · ' + kb(f.bytes) + (isTarget ? ' · the model' : (isDoor ? ' · the door' : '')))),
                f.kind === 'model' ? el('button', { class: 'btn sm' + (isDoor ? ' on' : ''), title: 'Use this model as the door', onclick: (e) => { e.stopPropagation(); setDoor(f); } }, 'Door') : null,
                el('button', { class: 'btn sm danger', onclick: (e) => { e.stopPropagation(); removeFile(f.name); } }, 'x')));
        });
        if (!(IM.files || []).length) list.append(el('div', { class: 'note' }, 'No files yet.'));
        root.append(list);
        if (IM.loading) root.append(el('div', { class: 'note' }, 'Reading the model files...'));
        if (IM.error) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, IM.error));
        (IM.log || []).forEach(l => root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, l)));
        const tm = IM.targetModel();
        if (tm) {
            root.append(el('div', { class: 'note' }, 'The model is ', el('b', null, tm.file), ': ' + tm.tris.toLocaleString() + ' triangles. Click another .ydr in the list to make that one the model. The other models are shown only as context.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => { M.App.frameAll(); } }, 'Frame the model'), el('button', { class: 'btn sm', onclick: () => M.App.setTab('build') }, 'Go to Build')));
            // the detail models are centred on their own entities: where each one stands (else it is drawn and cut on the building's centre)
            const dp = IM.detailsPlaced();
            if (dp.total) {
                const pst = el('div', { class: 'note', style: { minHeight: '16px' } });
                root.append(el('div', { class: 'note' }, dp.have + ' of ' + dp.total + ' detail models (hedges, weeds, bushes) are placed where the game puts them.' + (dp.have < dp.total ? ' The others are drawn on the building\'s centre, which is not where they stand: look them up.' : '')));
                if (I.entity) {
                    const pb = el('button', { class: 'btn sm' + (dp.have < dp.total ? ' primary' : ''), onclick: async () => {
                        pb.disabled = true; pb.textContent = 'Looking...'; const poll = setInterval(async () => { try { const s = await Model.api('vanilla/status'); if (s.status) pst.textContent = s.status; } catch (e) { } }, 500);
                        try { const r = await IM.lookupPlaces(true); const miss = (r.log || []); if (miss.length) toast(miss[0], 'warn'); } catch (e) { toast(e.message, 'err'); }
                        clearInterval(poll); UI2.refresh();
                    } }, 'Look up where the detail models stand');
                    root.append(el('div', { class: 'row wrap' }, pb), pst);
                } else root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'Set where the model stands first.'));
            }
        }
        };

        // the buildings of the project, and the part of the model that is the one being worked on
        const blkBuild = (root) => {
        if (I.target) buildingsBlock(root, true);
        root.append(el('div', { class: 'h' }, 'The part of the model that is the building'));
        if (!IM.comp) root.append(el('div', { class: 'note' }, 'Import the model first.'));
        else {
            const bi = IM.buildingInfo(), nobj = IM.comp.comps.length;
            root.append(el('div', { class: 'note' }, 'The model has ' + nobj + ' separate objects. Select the building you want to put the interior in: the others are hidden, and the grid is squared to its walls and centered on it.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn primary', onclick: () => { M.App.setTool('building'); M.App.setTab('build'); } }, 'Select a building'),
                bi ? el('button', { class: 'btn', title: 'Move the grid to the middle of the selected building and square it to the walls', onclick: () => { IM.centerOnBuilding(); M.App.frameAll(); } }, 'Center the grid on it') : null,
                bi ? el('button', { class: 'btn', onclick: () => { IM.clearBuilding(); M.App.frameAll(); } }, 'Show all buildings') : null));
            if (bi) {
                root.append(el('div', { class: 'note' }, 'Selected: ', el('b', null, bi.parts + ' part' + (bi.parts === 1 ? '' : 's')), ', ' + bi.tris.toLocaleString() + ' triangles, about ' + f2(bi.size[0], 1) + ' x ' + f2(bi.size[1], 1) + ' x ' + f2(bi.size[2], 1) + ' m.'));
                root.append(el('div', { class: 'row' }, el('label', null, 'Others'), k.seg([['hide', 'Hidden'], ['ghost', 'Ghost'], ['show', 'Shown']], IM.isoMode(), v => { Model.edit(Q => { Q.import.iso = v; }); M.UI.renderLeft(); })));
            }
        }

        };

        // door model (the older Door tool; doors from the Window / door models tool need none)
        const blkDoor = (root) => {
        const dm = I.doorModel, ds = IM.doorSize();
        if (!dm) root.append(el('div', { class: 'note' }, 'Mark one of the imported models as the door with its Door button. Door cutters then take its size, and can place the door in the opening.'));
        else {
            root.append(el('div', { class: 'note' }, el('b', null, dm.name), ds ? ': ' + f2(ds.w) + ' wide, ' + f2(ds.h) + ' high, ' + f2(ds.t) + ' thick' : ' (not loaded)'));
            root.append(chk('Place it in every new door cutter', () => I.placeDoors !== false, v => { Model.edit(Q => { Q.import.placeDoors = v; }); }));
            root.append(chk('Include the door model in the exported resource', () => !!dm.include, v => { Model.edit(Q => { if (Q.import.doorModel) Q.import.doorModel.include = v; }); }));
            root.append(el('div', { class: 'note' }, 'Leave this off for a prop the game already has (like a vanilla door): the interior then refers to it by name. Turn it on for a custom model.'));
        }
        };

        // collision
        const blkCol = (root) => {
        root.append(el('div', { class: 'note' }, 'The model blocks doorways with solid collision (.ybn). Import it, and the same cutters open it on export: triangles are clipped, wall boxes are split around the opening.'));
        const cstatus = el('div', { class: 'note', style: { minHeight: '16px' } });
        const cbtn = el('button', { class: 'btn sm', onclick: () => lookupCollision(cstatus, cbtn) }, 'Look up the collision in the game files');
        if (I.target) root.append(el('div', { class: 'row wrap' }, cbtn), cstatus);
        if (colErr) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, colErr));
        if (colList) {
            const all = addAllRow(colList); if (all) root.append(all);
            colList.forEach(c => root.append(el('div', { class: 'pitem', style: { padding: '4px 8px' } },
                el('span', { class: 'grow' }, c.name + ' · ' + c.polys.toLocaleString() + ' polygons' + (c.known ? (c.overlaps ? ' · covers the model' : ' · elsewhere') : '')),
                haveFile(c.name) ? el('span', { class: 'note' }, 'added') : el('button', { class: 'btn sm', onclick: () => addCollision(c.name) }, 'Add'))));
        }
        };

        // occluders
        const blkOcc = (root) => {
        root.append(el('div', { class: 'note' }, 'The game hides things behind invisible boxes placed inside some houses, which can hide your interior. Import the occlusion map files and the boxes inside your interior are removed on export (a copy of the file goes in the resource).'));
        const ostatus = el('div', { class: 'note', style: { minHeight: '16px' } });
        const obtn = el('button', { class: 'btn sm', onclick: () => lookupOcclusion(ostatus, obtn) }, 'Look up occlusion files in the game');
        if (I.target) root.append(el('div', { class: 'row wrap' }, obtn), ostatus);
        if (occErr) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, occErr));
        if (occList) {
            const all = addAllRow(occList); if (all) root.append(all);
            occList.forEach(c => root.append(el('div', { class: 'pitem', style: { padding: '4px 8px' } },
                el('span', { class: 'grow' }, c.name + ' · ' + c.near + ' box(es) around the building, ' + c.total + ' in the file'),
                haveFile(c.name) ? el('span', { class: 'note' }, 'added') : el('button', { class: 'btn sm', onclick: () => addGameFile(c.name) }, 'Add'))));
        }
        if ((IM.files || []).some(f => f.kind === 'map')) root.append(chk('Remove the occluders inside my interior', () => I.occluders !== false, v => { Model.edit(Q => { Q.import.occluders = v; }); }));
        };

        // frame
        const blkGrid = (root) => {
        root.append(el('div', { class: 'note' }, 'The grid your rooms are drawn on. Use the Frame tool (O) in the Build tab: click the floor inside the house for the corner and floor height, click a wall to turn the grid square to it. Or type the numbers.'));
        const F = I.frame, setF = (key, v) => Model.edit(Q => { Q.import.frame[key] = r3(v); });
        root.append(numField('Corner x', () => f2(F.x, 3), v => setF('x', v), '0.01', 'm'), numField('Corner y', () => f2(F.y, 3), v => setF('y', v), '0.01', 'm'), numField('Floor z', () => f2(F.z, 3), v => setF('z', v), '0.01', 'm'), numField('Turn', () => f2(F.heading, 2), v => setF('heading', v), '0.1', '°'));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.App.setTool('frame') }, 'Frame tool')));
        };

        // world placement
        const blkStand = (root) => {
        const E = I.entity;
        root.append(el('div', { class: 'note' }, 'The interior has to sit exactly where the model sits. Take it from an imported .ymap, look it up in the game files, or type it.'));
        if (IM.entities.length) {
            IM.entities.forEach(e => root.append(el('div', { class: 'pitem', style: { padding: '4px 8px' } }, el('span', { class: 'grow' }, e.ymap + ': ' + f2(e.x) + ', ' + f2(e.y) + ', ' + f2(e.z) + ' turned ' + f2(e.heading, 1) + '°'), el('button', { class: 'btn sm', onclick: () => useEntity(e, 'file') }, 'Use'))));
        } else if ((IM.files || []).some(f => f.kind === 'map')) root.append(el('div', { class: 'note' }, 'None of the imported .ymap files places ' + (I.target || 'the building') + '.'));
        const status = el('div', { class: 'note', style: { minHeight: '16px' } });
        const gbtn = el('button', { class: 'btn sm', onclick: () => gameLookup(status, gbtn) }, 'Look it up in the game files');
        if (I.target) root.append(el('div', { class: 'row wrap' }, gbtn), status);
        if (gameError) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, gameError));
        if (gameEntities && gameEntities.length) gameEntities.forEach(e => root.append(el('div', { class: 'pitem', style: { padding: '4px 8px' } }, el('span', { class: 'grow' }, 'Game: ' + e.ymap + ' ' + f2(e.x) + ', ' + f2(e.y) + ', ' + f2(e.z) + ' turned ' + f2(e.heading, 1) + '°'), el('button', { class: 'btn sm', onclick: () => useEntity(e, 'game') }, 'Use'))));
        const setE = (key, v) => Model.edit(Q => { const q = Q.import.entity || (Q.import.entity = { x: 0, y: 0, z: 0, heading: 0, source: 'manual', scale: 1 }); q[key] = r3(v); q.source = 'manual'; });
        const ev = (key) => E ? f2(E[key], key === 'heading' ? 3 : 3) : '0';
        root.append(numField('X', () => ev('x'), v => setE('x', v), '0.01'), numField('Y', () => ev('y'), v => setE('y', v), '0.01'), numField('Z', () => ev('z'), v => setE('z', v), '0.01'), numField('Heading', () => ev('heading'), v => setE('heading', v), '0.1', '°'));
        root.append(el('div', { class: 'note', style: E ? {} : { color: '#f0a4a3' } }, E ? ('Placement set' + (E.source === 'file' ? ' from ' + E.ymap : (E.source === 'game' ? ' from the game files' : ' by hand')) + '.' + (E.tilted ? ' This model is tilted; only its turn about the vertical is used.' : '')) : 'Not set yet: Export needs it.'));
        };

        // the sections, in the order you need them: the files, where the model stands, the building, the grid; then what is only needed sometimes
        const tm0 = IM.targetModel(), nf = (IM.files || []).length, np = ((I.plants && I.plants.list) || []).length;
        sec(root, 'i.files', 'Model files', { sum: nf + ' file' + (nf === 1 ? '' : 's'), open: !tm0 }, blkFiles);
        sec(root, 'i.stand', 'Where it stands in the game', { sum: I.entity ? 'set' : 'not set', open: !!tm0 && !I.entity }, blkStand);
        sec(root, 'i.bld', 'Buildings', { sum: Model.bldAll(P).length + '' }, blkBuild);
        sec(root, 'i.grid', 'The grid (frame)', { sum: (I.frame.x || I.frame.y || I.frame.z || I.frame.heading) ? 'set' : 'not set' }, blkGrid);
        sec(root, 'i.col', 'Collision files', { sum: (IM.files || []).filter(f => f.kind === 'collision').length + ' imported' }, blkCol);
        sec(root, 'i.occ', 'Occluders', { sum: (IM.files || []).filter(f => f.kind === 'map').length ? 'maps imported' : '' }, blkOcc);
        sec(root, 'i.plants', 'Props and plants', { sum: np ? np + ' looked up' : '' }, (b) => M.Plants.panel(b));
        sec(root, 'i.door', 'Door model (older Door tool)', { sum: I.doorModel ? I.doorModel.name : 'none' }, blkDoor);
    };

    // ---------------- the buildings of the project ----------------
    // Every building has its own grid, rooms, openings, lights, collision boxes, ceiling height and textures; the model and its deleted faces are shared. The one in
    // green is the one the tools work on: clicking another switches to it (its rooms replace the ones in the view).
    // the buildings as one dropdown row (the active one's name and what it holds); the list is inside
    function buildingPicker(root) {
        const P = S.project, list = Model.bldAll(P), act = list.find(b => b.active) || list[0], d = act.d, rooms = d.shell.ops.filter(o => o.op === 'add').length, opens = (d.import.cutters || []).length + (d.import.fits || []).length;
        sec(root, 'bld', act.name, { sum: (rooms ? rooms + ' room' + (rooms === 1 ? '' : 's') : 'no rooms') + (opens ? ' · ' + opens + ' opening' + (opens === 1 ? '' : 's') : '') + (list.length > 1 ? ' · 1 of ' + list.length : '') }, b => buildingsBlock(b, true));
    }
    function buildingsBlock(root, inSec) {
        const P = S.project, list = Model.bldAll(P), k = kit();
        if (!inSec) root.append(el('div', { class: 'h' }, 'Buildings (' + list.length + ')'));
        list.forEach(b => {
            const d = b.d, rooms = d.shell.ops.filter(o => o.op === 'add').length, opens = (d.import.cutters || []).length, boxes = (d.import.cboxes || []).length, sel = !!(d.import.building && d.import.building.parts && d.import.building.parts.length);
            const info = (rooms || opens || boxes) ? [rooms ? rooms + ' room' + (rooms === 1 ? '' : 's') : null, opens ? opens + ' opening' + (opens === 1 ? '' : 's') : null, boxes ? boxes + ' box' + (boxes === 1 ? '' : 'es') : null].filter(Boolean).join(', ') : (sel ? 'nothing built yet' : 'no building picked yet');
            const name = b.active
                ? el('input', { value: b.name, title: 'Rename', style: { width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid transparent', fontWeight: 600, color: 'inherit', padding: '1px 3px' }, onclick: (e) => e.stopPropagation(), onchange: (e) => { if (Model.renameBuilding(b.id, e.target.value)) M.UI.renderLeft(); else e.target.value = b.name; } })
                : el('div', { style: { fontWeight: 600, padding: '1px 4px' } }, b.name);
            root.append(el('div', { class: 'pitem', style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px', background: b.active ? 'rgba(80,200,130,0.18)' : '', cursor: b.active ? 'default' : 'pointer' }, title: b.active ? 'The building you are working on' : 'Work on this building', onclick: () => { if (!b.active) Model.switchBuilding(b.id); } },
                el('span', { style: { color: b.active ? '#9fd9a8' : '#8fa0bd', width: '12px', flex: 'none' } }, b.active ? '●' : '○'), el('div', { class: 'grow', style: { minWidth: 0 } }, name, el('div', { class: 'note', style: { padding: '0 4px' } }, info)),
                list.length > 1 ? el('button', { class: 'btn sm danger', title: 'Delete this building', style: { flex: 'none' }, onclick: async (e) => { e.stopPropagation(); if (await M.UI.confirm('Delete "' + b.name + '"?', 'Its rooms, openings, lights and collision boxes are removed (the faces its doors and windows cut out come back). The other buildings are not touched. Ctrl+Z brings it back.', 'Delete')) { Model.deleteBuilding(b.id); } } }, 'x') : null));
        });
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: () => { Model.addBuilding(); M.App.setTool('building'); toast('New building. Click its building in the model to pick it.', 'ok'); } }, '+ New building')));
        root.append(el('div', { class: 'note' }, 'Each building has its own grid, rooms, openings, lights and ceiling height; the model and the faces you deleted are shared. The green one is the one the tools work on. The export makes one interior per building.'));
    }

    // ---------------- Build tab ----------------
    UI2.renderFurnish = function (root) {
        buildingPicker(root);
        root.append(el('div', { class: 'h' }, 'Inredning'), el('div', { class: 'note' }, 'Choose furniture and props, then place them in the scene. Move, rotate, duplicate or remove placed items with the gizmo. Doors, windows and frames stay in Build.'));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: () => M.FitModels.openCatalog() }, 'Open prop catalogue'), el('button', { class: 'btn sm' + (IM.cutOn ? ' primary' : ''), onclick: () => IT.toggleCutaway() }, 'Cutaway')));
        M.FitModels.panel(root);
    };
    UI2.renderBuild = function (root) {
        const P = S.project, I = P.import, sh = P.shell, t = S.shellTool, k = kit();
        buildingPicker(root);
        // the route: numbered stages that open like dropdowns (the one with the active tool is open), then the pointer tools and the cutaway in one row
        const cr = rowOf(t); if (cr) (S.lastVar = S.lastVar || {})[cr.id] = t;
        root.append(el('div', { class: 'h' }, 'Route and tools'));
        stageList(root, t, steps());
        root.append(el('div', { class: 'row wrap', style: { marginTop: '8px' } },
            el('button', { class: 'btn sm' + (t === 'select' ? ' on' : ''), title: HELP.select, onclick: () => M.App.setTool('select') }, 'Select ', el('kbd', null, 'V')),
            el('button', { class: 'btn sm' + (t === 'eraser' ? ' on' : ''), title: HELP.eraser, onclick: () => M.App.setTool('eraser') }, 'Eraser ', el('kbd', null, 'X')),
            el('button', { class: 'btn sm' + (IM.cutOn ? ' primary' : ''), title: 'Hide the roof and the upper walls of the model so you can see the walls below (C)', onclick: () => { IT.toggleCutaway(); } }, 'Cutaway ', el('kbd', null, 'C'))));
        root.append(el('div', { class: 'note' }, IM.cutOn ? 'Model hidden above ' + IM.cutH().toFixed(2) + ' m' : (IM.cutByTool() ? 'Roof hidden while you use this tool' : 'Cutaway is off')));
        // the active tool: its name (with a switch between its ways when it has some), what it does, how to use it
        root.append(el('div', { class: 'h' }, cr ? cr.name : (TOOLS.filter(x => x[0] === t)[0] || ['', 'Tool'])[1]));
        if (cr && cr.vars.length > 1) root.append(k.seg(cr.vars.map(v => [v[0], v[1]]), t, v => M.App.setTool(v)));
        root.append(el('div', { class: 'note what' }, SUM[t] || ''));
        if (HOW[t]) sec(root, 'how', 'How to use it', { open: true }, b => b.append(el('ul', { class: 'how' }, ...HOW[t].map(x => el('li', null, x)))));
        if (HELP[t]) sec(root, 'more', 'More about it', {}, b => b.append(el('div', { class: 'note' }, HELP[t])));
        if (t === 'floor') root.append(el('div', { class: 'row' }, el('label', null, 'Floor'), k.swatchEl(S.brush.floor, 28), el('span', { class: 'grow' }, TEX.def(S.brush.floor).name), el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'floor'; M.App.setTab('paint'); } }, 'Change')));
        if (!IM.loaded && !IM.loading) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'No model imported yet. Go to the Import tab.'));
        if (t === 'level') {
            const raise = (d) => { if (IM.shiftLevel(d)) toast('The rooms are ' + (d > 0 ? 'raised ' : 'lowered ') + Math.abs(d).toFixed(2) + ' m.', 'ok'); M.UI.renderLeft(); };
            root.append(el('div', { class: 'row' }, el('label', null, 'Floor at'), el('span', { class: 'grow' }, f2(I.frame.z, 3) + ' m (height in the model)')));
            root.append(numField('Raise by', () => '0', v => raise(v), '0.05', 'm'));
            root.append(el('div', { class: 'row wrap' }, ...[-0.5, -0.1, -0.05, 0.05, 0.1, 0.5].map(d => el('button', { class: 'btn sm', onclick: () => raise(d) }, (d > 0 ? '+' : '') + d))));
        }
        if (t === 'door') doorChooser(root);
        if (t === 'fit') M.FitModels.panel(root);
        if (t === 'plants') M.Plants.toolPanel(root);
        if (t === 'figure') {
            const f = S.figure;
            if (!f) {
                root.append(el('div', { class: 'note' }, 'Click the floor to stand the figure there.'));
                root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: () => { const b = M.App.built && M.App.built.bounds, ok = b && b.mn[0] <= b.mx[0]; S.figure = { x: ok ? (b.mn[0] + b.mx[0]) / 2 : 0, y: ok ? (b.mn[1] + b.mx[1]) / 2 : 0, z: 0, yaw: M.App.renderer.camera.yaw - Math.PI / 2, h: M.Figure.DEFAULT_H }; M.UI.renderLeft(); } }, 'Put it in the middle of the rooms')));
            } else {
                root.append(numField('Height', () => f2(f.h), v => { f.h = Math.min(2.4, Math.max(1.0, v)); M.UI.renderLeft(); }, '0.05', 'm'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => { f.yaw -= Math.PI / 4; } }, 'Turn -45°'), el('button', { class: 'btn sm', onclick: () => { f.yaw += Math.PI / 4; } }, 'Turn +45°'), el('button', { class: 'btn sm danger', onclick: () => { S.figure = null; M.UI.renderLeft(); } }, 'Remove')));
                root.append(el('div', { class: 'note' }, 'Stands ' + f2(f.z) + ' m above the grid floor. Different heights (1.6 to 1.9 m) show how tall a door or ceiling feels.'));
            }
        }
        if (t === 'fill') {
            S.fillGap = S.fillGap || 0.5; const F = IT.gaps();
            root.append(numField('Largest gap', () => f2(S.fillGap), v => { S.fillGap = Math.max(0.05, Math.min(5, v)); M.UI.renderLeft(); }, '0.05', 'm'));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, F.comps.length + ' gap' + (F.comps.length === 1 ? '' : 's') + ' found'), F.comps.length ? el('button', { class: 'btn sm primary', onclick: () => { IT.fillAll(); M.UI.renderLeft(); } }, 'Fill all') : null));
            const wg = I.cutters.filter(c => c.face && IM.gapAround(c)), wgOpen = wg.filter(c => c.fill === false).length;
            root.append(el('div', { class: 'h' }, 'Gaps in the model\'s wall'));
            root.append(el('div', { class: 'note' }, wg.length
                ? wg.length + ' cut-out window(s) or door(s) have a see-through gap next to them (orange in the view)' + (wgOpen ? ', ' + wgOpen + ' left open' : ', all closed with trim') + '. Select an opening to see where; "Close gaps next to it" turns it off.'
                : 'No see-through gaps next to the cut-out windows and doors.'));
        }

        if (t === 'faces' || t === 'parts') {
            root.append(chk('Show the detail models (grilles, vents, bushes)', () => IM.showDetails, v => { IM.showDetails = v; IM.rebuild(); M.UI.renderLeft(); }));
            const nd = (I.mdeletes || []).length; if (nd) root.append(el('div', { class: 'note' }, nd + ' face(s) deleted from detail models.'));
        }
        if (t === 'faces') {
            const n = IT.faces.count();
            root.append(chk('See-through selection (X-ray): the box also selects faces you cannot see', () => !!S.faceXray, v => { S.faceXray = v; }));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, n + ' face' + (n === 1 ? '' : 's') + ' selected'),
                el('button', { class: 'btn sm', title: 'A', onclick: () => IT.faces.selectAll() }, 'All'), el('button', { class: 'btn sm', title: 'Alt+A', onclick: () => IT.faces.none() }, 'None'), el('button', { class: 'btn sm', title: 'Ctrl+I', onclick: () => IT.faces.invert() }, 'Invert')));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'Ctrl+L', onclick: () => IT.faces.linked() }, 'Grow to whole pieces'), el('button', { class: 'btn sm', title: 'Shift+G', onclick: () => IT.faces.similar() }, 'Same texture')));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm danger', disabled: n ? null : true, onclick: () => IT.faces.del() }, 'Delete selected ', el('kbd', null, 'X')),
                el('button', { class: 'btn sm', disabled: n ? null : true, title: 'A collision box around the selected faces: put the collision back where you deleted a solid part', onclick: () => IT.faces.toBox() }, 'Collision box around the selection')));
        }
        if (t === 'parts') {
            root.append(el('div', { class: 'note' }, 'Removed parts: ' + (I.parts || []).length + '. A removed part is gone from the editor and from the export.'));
            S.partOpen = S.partOpen || {};
            IM.partModels().forEach(m => {
                const open = S.partOpen[m.file] !== undefined ? S.partOpen[m.file] : (m.target || (S.partSel && S.partSel.f === m.file)), recs = (I.parts || []).filter(p => p.f === m.file).length;
                root.append(el('div', { class: 'h pm', style: { cursor: 'pointer' }, onclick: () => { S.partOpen[m.file] = !open; M.UI.renderLeft(); } }, (open ? '▾ ' : '▸ ') + (m.target ? 'Building: ' : 'Detail model: ') + m.file.replace(/\.ydr$/i, '') + ' (' + m.geoms.length + ' parts' + (recs ? ', ' + recs + ' removed' : '') + ')'));
                if (!open) return;
                m.geoms.forEach(geo => {
                    const rec = IM.partRecord(m.file, geo.g), c = IM.partCount(m, geo), sel = !!(S.partSel && S.partSel.f === m.file && S.partSel.g === geo.g);
                    root.append(el('div', { class: 'prow' + (sel ? ' on' : '') + (rec ? ' gone' : ''), onmouseenter: () => { S.partHover = { f: m.file, g: geo.g }; }, onmouseleave: () => { S.partHover = null; }, onclick: () => { S.partSel = { f: m.file, g: geo.g }; M.UI.renderLeft(); } },
                        IM.partThumb(geo, 32),
                        el('span', { class: 'ptxt' }, el('b', null, geo.texName || ('part ' + geo.g)), el('span', { class: 'note' }, c.left.toLocaleString() + ' of ' + c.total.toLocaleString() + ' faces left' + (geo.shader ? ' · ' + geo.shader : ''))),
                        rec ? null : el('button', { class: 'btn sm', title: 'Select all the faces of this part in the Delete faces tool', disabled: c.left === 0 ? true : null, onclick: (e) => { e.stopPropagation(); IT.faces.selectPart(m.file, geo.g); } }, 'Select'),
                        rec ? el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); IM.restorePart(m.file, geo.g); M.UI.renderLeft(); } }, 'Restore')
                            : el('button', { class: 'btn sm danger', disabled: c.left === 0 ? true : null, onclick: (e) => { e.stopPropagation(); if (IM.removePart(m.file, geo.g)) toast('Part removed: ' + (geo.texName || geo.g) + '. Restore gives it back.', 'ok'); M.UI.renderLeft(); } }, 'Remove')));
                });
            });
        }
        if (t === 'collision') {
            if (!IM.colPolys && !IM._colLoading) IM.colPolysLoad().then(() => M.UI.renderLeft());
            const nreg = IM.colPolys ? IT.col.region() : 0, nsel = IT.col.count(), ndel = (I.colDeletes || []).length;
            if (!I.entity) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'Set where the model stands in the game (Import tab) to see its collision.'));
            else if (!(IM.files || []).some(f => f.kind === 'collision')) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'No collision file imported.'));
            else if (!S.showCollision) root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm primary', onclick: () => { S.showCollision = true; IM.requestCollision(); M.UI.renderLeft(); M.UI.renderRight(); } }, 'Show the collision (orange lines)')));
            root.append(chk('The same place in the other collision files', () => S.colSame !== false, v => { S.colSame = v; }));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, IM.colPolys ? nreg + ' piece' + (nreg === 1 ? '' : 's') + ' near the rooms, ' + nsel + ' selected' : 'Reading the collision...'),
                el('button', { class: 'btn sm', title: 'A', onclick: () => IT.col.selectAll() }, 'All'), el('button', { class: 'btn sm', title: 'Alt+A', onclick: () => IT.col.none() }, 'None'), el('button', { class: 'btn sm', title: 'Ctrl+I', onclick: () => IT.col.invert() }, 'Invert')));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'Shift+G', onclick: () => IT.col.same() }, 'Same material'), el('button', { class: 'btn sm danger', disabled: nsel ? null : true, onclick: () => IT.col.del() }, 'Delete selected ', el('kbd', null, 'X'))));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, ndel + ' piece' + (ndel === 1 ? '' : 's') + ' deleted'), ndel ? el('button', { class: 'btn sm', onclick: () => { Model.edit(Q => { Q.import.colDeletes = []; }); M.UI.renderLeft(); } }, 'Restore all') : null));
        }
        if (t === 'cbox') {
            const CB = IT.cbox, ids = CB.selected(), one = CB.one(), list = CB.list(), MA = M.COLMATS, first = ids.length ? list.find(b => b.id === ids[0]) : null, cur = first ? first.mat : (S.cboxMat || 'concrete');
            const nGen = ((M.App.built && M.App.built.boxes) || []).filter(b => !(b[7] && b[7].user)).length;
            root.append(chk('Show the collision the game gets (teal), with my boxes', () => !!S.showMyCol, v => { S.showMyCol = v; M.UI.renderRight(); }));
            root.append(el('div', { class: 'row' }, el('label', null, 'Material'),
                el('select', { class: 'grow', onchange: (e) => CB.set({ mat: e.target.value }) }, ...MA.list.map(m => el('option', { value: m.id, selected: m.id === cur ? true : null }, m.name + ' (' + m.type + ')')))));
            root.append(el('div', { class: 'note' }, ids.length ? 'Applies to the ' + ids.length + ' selected box' + (ids.length === 1 ? '' : 'es') + ' and to the next boxes you draw.' : 'The material of the next boxes you draw.'));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, list.length + ' box' + (list.length === 1 ? '' : 'es') + ' of yours, ' + ids.length + ' selected. The rooms make ' + nGen + ' by themselves.'),
                el('button', { class: 'btn sm', title: 'A', onclick: () => CB.all() }, 'All'), el('button', { class: 'btn sm', title: 'Alt+A', onclick: () => CB.none() }, 'None'), el('button', { class: 'btn sm', title: 'Ctrl+I', onclick: () => CB.invert() }, 'Invert')));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => CB.addMiddle() }, 'Add a box'),
                el('button', { class: 'btn sm', disabled: ids.length ? null : true, title: 'Shift+D', onclick: () => CB.dup() }, 'Duplicate'),
                el('button', { class: 'btn sm', disabled: ids.length ? null : true, title: 'R', onclick: () => CB.turn(Math.PI / 2) }, 'Turn 90°'),
                el('button', { class: 'btn sm danger', disabled: ids.length ? null : true, onclick: () => CB.del() }, 'Delete ', el('kbd', null, 'X'))));
            if (one) {
                const up = (key, v) => CB.set({ [key]: key === 'yaw' ? Math.round(v * Math.PI / 180 * 1e6) / 1e6 : r3(v) });
                root.append(el('div', { class: 'h' }, 'Selected box'));
                root.append(numField('Width', () => f2(one.w, 3), v => up('w', Math.max(0.05, v)), '0.05', 'm'), numField('Depth', () => f2(one.d, 3), v => up('d', Math.max(0.05, v)), '0.05', 'm'), numField('Height', () => f2(one.h, 3), v => up('h', Math.max(0.05, v)), '0.05', 'm'),
                    numField('Bottom', () => f2(one.zb, 3), v => up('zb', v), '0.05', 'm'), numField('Centre x', () => f2(one.cx, 3), v => up('cx', v), '0.05', 'm'), numField('Centre y', () => f2(one.cy, 3), v => up('cy', v), '0.05', 'm'),
                    numField('Angle', () => f2(one.yaw * 180 / Math.PI, 1), v => up('yaw', v), '1', '°'));
                root.append(el('div', { class: 'note' }, 'Bottom is the height above the interior floor. The angle is measured from the grid; most boxes are square to it.'));
            }
            root.append(el('div', { class: 'h' }, 'My boxes (' + list.length + ')'));
            const bl = el('div', { class: 'plist', style: { maxHeight: '150px' } });
            list.forEach(b => { const m = MA.get(b.mat); bl.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: ids.indexOf(b.id) >= 0 ? 'rgba(80,200,130,0.18)' : '' }, onclick: (e) => CB.select(b.id, e.shiftKey) },
                el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', marginRight: '6px', background: 'rgb(' + m.col.map(c => Math.round(c * 255)).join(',') + ')' } }), el('b', null, m.name), el('span', { class: 'note' }, f2(b.w) + ' x ' + f2(b.d) + ' x ' + f2(b.h) + ' m'),
                el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); Model.edit(Q => { Q.import.cboxes = (Q.import.cboxes || []).filter(q => q.id !== b.id); }); M.UI.renderLeft(); } }, 'x'))); });
            if (!list.length) bl.append(el('div', { class: 'note' }, 'None yet. Drag on the floor to draw one.'));
            root.append(bl);
            root.append(el('div', { class: 'note' }, 'Boxes stand on the interior floor (height 0) and go to the game as part of the interior\'s own collision. Keep them in or next to the rooms. Set the floor height (Raise / lower rooms) before building boxes: they do not follow the model when it moves.'));
        }
        if (t === 'walk') {
            const WK = M.Walk, c = WK.cfg(), res = WK.result, mark = (s) => s === 'bad' ? '✗' : '!', colr = (s) => s === 'bad' ? '#f0a4a3' : '#f0d28a';
            root.append(numField('Player width', () => f2(c.r * 2), v => { c.r = Math.min(0.6, Math.max(0.2, v / 2)); M.UI.renderLeft(); }, '0.05', 'm'), numField('Player height', () => f2(c.h), v => { c.h = Math.min(2.2, Math.max(1.0, v)); M.UI.renderLeft(); }, '0.05', 'm'),
                numField('Step height', () => f2(c.step), v => { c.step = Math.min(0.6, Math.max(0.1, v)); M.UI.renderLeft(); }, '0.05', 'm'));
            root.append(el('div', { class: 'note' }, 'The player is a capsule that stands on the floor of the interior. Anything higher than the step height and lower than the player\'s height blocks it; what is lower is stepped over. A doorway must be at least as wide as the player.'));
            root.append(chk('Show the result in the view', () => S.showWalkOverlay !== false, v => { S.showWalkOverlay = v; }));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', disabled: WK.busy ? true : null, onclick: () => WK.run() }, res ? 'Run the check again' : 'Run the check'), res ? el('button', { class: 'btn sm', onclick: () => WK.clear() }, 'Clear') : null,
                WK.start ? el('button', { class: 'btn sm', title: 'Start from the middle of the biggest room again', onclick: () => { WK.start = null; if (WK.result) WK.run(); else M.UI.renderLeft(); } }, 'Start in the biggest room') : null));
            if (WK.busy || WK.note) root.append(el('div', { class: 'note' }, WK.note || 'Working...'));
            if (!res && !WK.busy) root.append(el('div', { class: 'note' }, 'Nothing checked yet. The check takes a second or two and reads the building\'s collision once.'));
            if (res && res.empty) root.append(el('div', { class: 'note bad' }, res.note));
            if (res && !res.empty) {
                if (WK.stale()) root.append(el('div', { class: 'note bad' }, 'The project changed after this check: run it again.'));
                const bad = res.problems.filter(p => p.sev === 'bad').length, warn = res.problems.length - bad;
                root.append(el('div', { class: 'note ' + (bad ? 'bad' : (warn ? '' : 'ok')) }, bad ? bad + ' problem' + (bad === 1 ? '' : 's') + (warn ? ' and ' + warn + ' warning' + (warn === 1 ? '' : 's') : '') + ' found.' : (warn ? warn + ' warning' + (warn === 1 ? '' : 's') + ', no problem found.' : 'Nothing found.')));
                root.append(el('div', { class: 'kv' }, 'Free floor you can reach', el('b', null, f2(res.stats.regionReach || 0) + ' of ' + f2(res.stats.regionFree || 0) + ' m2'), 'Doorways you can walk through', el('b', null, (res.nOk || 0) + ' of ' + (res.nDoors || 0)), 'Pieces of the building read', el('b', null, res.building != null ? res.building : 0), 'Took', el('b', null, res.ms + ' ms')));
                if (res.startNote) root.append(el('div', { class: 'note' }, res.startNote));
                if (res.finNote) root.append(el('div', { class: 'note bad' }, res.finNote));
                res.problems.forEach(p => root.append(el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '6px' } }, el('span', { style: { color: colr(p.sev), width: '12px', flex: 'none' } }, mark(p.sev)),
                    el('div', { class: 'grow' }, el('div', { style: { color: colr(p.sev) } }, p.text)),
                    el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } }, el('button', { class: 'btn sm', onclick: () => WK.show(p) }, 'Show'),
                        (p.act === 'selectCollision' && (p.bbox || p.box)) ? el('button', { class: 'btn sm', title: 'Select the building\'s collision pieces that overlap this spot in the Collision tool', onclick: () => IT.colSelectIn(p.bbox || p.box) }, 'Select it') : null))));
                const dl = res.overlay && res.overlay.doors || [];
                if (dl.length) root.append(el('details', null, el('summary', { class: 'note', style: { cursor: 'pointer' } }, 'Doorways (' + dl.length + ')'), ...dl.map(d => el('div', { class: 'note', style: { color: d.status === 'ok' ? '#9fd9a8' : (d.status === 'narrow' ? '#f0d28a' : '#f0a4a3') } }, (d.status === 'ok' ? '✓ ' : '✗ ') + d.text))));
                root.append(el('div', { class: 'note' }, 'Cells are ' + Math.round(res.stats.cell * 100) + ' cm: a thing counts as solid where it touches a cell, so the check is up to ' + Math.round(res.stats.cell * 100) + ' cm stricter than the real collision. It tests the files, not the game\'s own character controller (which can slide, climb and be pushed): a doorway it passes only just may still catch in the game.'));
            }
        }
        if (t === 'edges') {
            const view = IM.loaded ? IT.edges.view() : [], nsel = IT.edges.selected(), fills = I.fills || [];
            root.append(chk('Only holes made by deleting faces', () => !!S.edgeHolesOnly, v => { S.edgeHolesOnly = v; M.UI.renderLeft(); }));
            root.append(chk('Include the outlines of cut-out windows and doors', () => !!S.edgeOutlines, v => { S.edgeOutlines = v; M.UI.renderLeft(); }));
            root.append(el('div', { class: 'note' }, 'An open edge has a face on one side only. Shown: the open edges within 1.5 m of your rooms' + (S.edgeHolesOnly ? ', only where deleted faces left a hole' : '') + (S.edgeOutlines ? '' : ', without the outlines of cut-out windows and doors') + '. Some are just the ends of the model\'s walls, not holes.'));
            root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, view.length + ' edge' + (view.length === 1 ? '' : 's') + ' shown, ' + nsel + ' selected'),
                el('button', { class: 'btn sm', onclick: () => IT.edges.selectAll(true) }, 'Select all'), el('button', { class: 'btn sm', onclick: () => IT.edges.selectAll(false) }, 'Select none')));
            root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm primary', onclick: () => IT.edges.fill() }, 'Fill selected ', el('kbd', null, 'F'))));
            root.append(el('div', { class: 'h' }, 'Filled holes (' + fills.length + ')'));
            if (!fills.length) root.append(el('div', { class: 'note' }, 'None yet. Select the edges around a hole and press F.'));
            fills.forEach((f, i) => root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, 'Fill ' + (i + 1) + ': ' + f.tris.length + ' triangle' + (f.tris.length === 1 ? '' : 's') + ', ' + f2(IM.fillArea(f)) + ' m2'),
                el('button', { class: 'btn sm', title: 'Turn the faces around', onclick: () => { Model.edit(Q => { const q = (Q.import.fills || []).find(x => x.id === f.id); if (q) q.tris = q.tris.map(tr => [tr[0], tr[2], tr[1]]); }); M.UI.renderLeft(); } }, 'Flip'),
                el('button', { class: 'btn sm danger', title: 'Remove the fill: the hole comes back', onclick: () => { Model.edit(Q => { Q.import.fills = (Q.import.fills || []).filter(x => x.id !== f.id); }); M.UI.renderLeft(); } }, 'Delete'))));
            if (fills.length) root.append(el('div', { class: 'note' }, 'The new faces take their normals and texture from the wall around the hole. If a fill looks dark or is invisible from one side, Flip turns it around.'));
        }

        // the selected cutter
        const sel = S.cutSel ? IT.findCutter(S.cutSel) : null;
        if (sel) {
            root.append(el('div', { class: 'h' }, 'Selected ' + (IT.NAMES[sel.type] || 'cutter').toLowerCase()));
            const upd = (key, v) => IT.updateCutter(sel.id, q => { q[key] = key === 'yaw' ? r3(v * Math.PI / 180) : r3(v); });
            if (sel.face) {
                root.append(el('div', { class: 'note' }, (sel.type === 'window' ? 'Window' : 'Door') + ' cut out of ' + (sel.face.added || sel.face.tris).length + ' face(s) of the model: ' + f2(sel.w) + ' x ' + f2(sel.h) + ' m, bottom ' + f2(sel.zb) + ' m above the floor. Size and place come from the faces. '
                    + (sel.type === 'window' ? 'The opening is filled with glass.' : (sel.leaf ? 'The door model stands in it.' : ''))));
                root.append(numField('Depth in the wall', () => f2(IM.depthOf(sel), 3), v => upd('dd', Math.min(IM.DEPTH_MAX, Math.max(IM.DEPTH_MIN, v))), '0.01', 'm'));
                root.append(el('div', { class: 'note' }, 'Between ' + f2(IM.DEPTH_MIN * 100, 0) + ' cm (inside the wall) and +' + f2(IM.DEPTH_MAX * 100, 0) + ' cm (in front of the cut-out faces, for a window that is set back behind the siding).'));
                root.append(el('div', { class: 'note' }, 'Where the ' + (sel.type === 'window' ? 'glass' : 'door') + ' sits: 0 is the outside surface of the cut-out faces, negative is into the wall. It is set from the frame the model has left around the opening.'));
                if (sel.type === 'window' || sel.type === 'door') {
                    const gp = IM.gapAround(sel);
                    root.append(chk('Close gaps next to it', () => sel.fill !== false, v => { IT.updateCutter(sel.id, q => { q.fill = v; }); M.UI.renderLeft(); }));
                    root.append(el('div', { class: 'note' }, gp
                        ? 'The model\'s wall has a see-through gap beside this cut-out (' + [['left', gp.l], ['right', gp.r], ['below', gp.b], ['above', gp.t]].filter(g => g[1]).map(g => f2(g[1] * 100, 1) + ' cm ' + g[0]).join(', ') + (sel.fill !== false ? '): it is closed with trim.' : '): it is left open.')
                        : 'No see-through gap beside this cut-out.'));
                }
                if (sel.type === 'window') {
                    frameChoice(root, sel, k);
                    if (frameMode(sel) === 'built') {
                        root.append(chk('Cross bars', () => !!sel.bars, v => { IT.updateCutter(sel.id, q => { q.bars = v; }); }));
                        root.append(numField('Frame width', () => f2(sel.bw || 0.055, 3), v => upd('bw', Math.min(0.2, Math.max(0.02, v))), '0.005', 'm'));
                    }
                    root.append(el('div', { class: 'note' }, frameMode(sel) === 'vanilla'
                        ? 'No frame is built: the glass goes in the opening and the frame the model has left around it (the pieces of the window that are not the painted picture) is the frame. Check the window from outside and inside; if the model has little left there, use Built.'
                        : 'The model\'s window is one painted picture (frame, bars and glass together), so cutting it out removes that frame too. Built: a plain frame is put back around the glass.'));
                }
            } else {
                root.append(el('div', { class: 'row' }, el('label', null, 'Kind'), k.seg([['door', 'Door'], ['window', 'Window'], ['arch', 'Arch']], sel.type, v => { IT.updateCutter(sel.id, q => { q.type = v; }); M.UI.renderLeft(); })));
                root.append(numField('Width', () => f2(sel.w), v => upd('w', Math.max(0.2, v)), '0.05', 'm'), numField('Height', () => f2(sel.h), v => upd('h', Math.max(0.2, v)), '0.05', 'm'),
                    numField('Bottom', () => f2(sel.zb), v => upd('zb', v), '0.05', 'm'), numField('Depth', () => f2(sel.d), v => upd('d', Math.max(0.1, v)), '0.05', 'm'),
                    numField('Centre x', () => f2(sel.cx), v => upd('cx', v), '0.05', 'm'), numField('Centre y', () => f2(sel.cy), v => upd('cy', v), '0.05', 'm'), numField('Angle', () => f2(sel.yaw * 180 / Math.PI, 1), v => upd('yaw', v), '1', '°'));
            }
            if (sel.type === 'door' && !IM.doorModel()) doorChooser(root);
            if (sel.type === 'door' && IM.doorModel()) {
                root.append(chk('Place the door model here', () => !!sel.leaf, v => { IT.updateCutter(sel.id, q => { q.leaf = v; if (q.lo == null) q.lo = 0; }); M.UI.renderLeft(); }));
                if (sel.leaf) {
                    root.append(chk('Double doors', () => !!sel.double, v => { IT.updateCutter(sel.id, q => { q.double = v; }); M.UI.renderLeft(); }));
                    if (!sel.double) root.append(chk('Turn the door around', () => !!sel.flip, v => { IT.updateCutter(sel.id, q => { q.flip = v; }); }));
                    const dg = IM.doorGroup(sel);
                    root.append(el('div', { class: 'note' }, (sel.double ? 'Two leaves side by side, ' : 'The door ') + 'keeps its own size, ' + f2(dg.w) + ' x ' + f2(dg.h) + ' m (the game ignores the scale of a prop, so it is never stretched), in a ' + f2(sel.w) + ' x ' + f2(sel.h) + ' m opening'
                        + (dg.w > sel.w + 0.02 ? '. The door is wider than the opening: its sides disappear into the wall.' : '.') + (sel.double && dg.w < sel.w - 0.02 ? ' The frame closes the gap at the sides.' : '')));
                    if (sel.face) {
                        frameChoice(root, sel, k);
                        if (frameMode(sel) === 'built') {
                            root.append(numField('Frame width', () => f2(sel.bw || 0.05, 3), v => upd('bw', Math.min(0.2, Math.max(0.02, v))), '0.005', 'm'));
                            root.append(el('div', { class: 'note' }, 'The frame is built to the size of the door: its jambs and head run from the door out to the edges of the opening, so there is no gap beside or above the door. The width is the least it is; a bigger opening gets wider jambs. The model\'s wall is cut out to the middle of the frame\'s bars.'));
                        } else if (frameMode(sel) === 'vanilla') {
                            root.append(el('div', { class: 'note' }, 'No frame is built: the door model\'s own frame (the jambs and head that are part of it) is the frame, and the wall is cut out to the full size of the door model, so the frame sits in the wall. The model\'s frame has no collision of its own.'));
                        }
                    }
                    root.append(numField('Across the wall', () => f2(sel.lo || 0), v => upd('lo', v), '0.05', 'm'));
                }
                if (!sel.face) root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: () => { const dg = IM.doorGroup(sel); IT.updateCutter(sel.id, q => { q.w = r3(dg.w + 0.04); q.h = r3(dg.h + 0.02); q.zb = 0; }); M.UI.renderLeft(); } }, 'Fit to the door model')));
            }
            if (!sel.face) root.append(el('div', { class: 'note' }, 'The box cuts everything it overlaps: the model, your interior walls and the collision. Its depth is the line through the wall.'));
            root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm danger', onclick: () => { Model.edit(Q => { IM.removeCutterIn(Q, sel.id); }); S.cutSel = null; M.UI.renderLeft(); } }, sel.face ? 'Delete (the faces come back)' : 'Delete')));
        } else if (S.shellSel) {
            M.VanillaUI.renderSelected(root, k);
        } else if (S.opSel != null && sh.ops[S.opSel]) {
            const oi = S.opSel, o = sh.ops[oi], setR = (fn) => { Model.edit(Q => { fn(Q.shell.ops[oi].r); }); M.UI.renderLeft(); };
            root.append(el('div', { class: 'h' }, 'Selected ' + (o.op === 'cut' ? 'cut-out' : 'room')));
            root.append(el('div', { class: 'row' }, el('label', null, 'Kind'), k.seg([['add', 'Room'], ['cut', 'Cut out']], o.op, v => { Model.edit(Q => { Q.shell.ops[oi].op = v; }); M.UI.renderLeft(); })));
            root.append(numField('Left x', () => f2(o.r[0]), v => setR(r => { const w = r[2] - r[0]; r[0] = r3(v); r[2] = r3(v + w); }), '0.05', 'm'),
                numField('Back y', () => f2(o.r[1]), v => setR(r => { const d = r[3] - r[1]; r[1] = r3(v); r[3] = r3(v + d); }), '0.05', 'm'),
                numField('Width', () => f2(o.r[2] - o.r[0]), v => setR(r => { r[2] = r3(r[0] + Math.max(0.2, v)); }), '0.05', 'm'),
                numField('Depth', () => f2(o.r[3] - o.r[1]), v => setR(r => { r[3] = r3(r[1] + Math.max(0.2, v)); }), '0.05', 'm'));
            root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm danger', onclick: () => IT.deleteRoom() }, 'Delete')));
        }

        // lists, each one a dropdown
        sec(root, 'cutters', 'Openings (' + I.cutters.length + ')', { sum: I.deletes.length + ' faces deleted' }, (root) => {
        const cl = el('div', { class: 'plist', style: { maxHeight: '120px' } });
        I.cutters.forEach(c => cl.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: S.cutSel === c.id ? 'rgba(80,200,130,0.18)' : '' }, onclick: () => { IT.selectCutter(c.id); M.UI.renderLeft(); } },
            el('b', null, (IT.NAMES[c.type] || 'Cutter') + (c.double ? ' (double)' : '')), el('span', { class: 'note' }, f2(c.w) + ' x ' + f2(c.h) + ' m' + (c.face ? ', from faces' : '')),
            el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); Model.edit(Q => { IM.removeCutterIn(Q, c.id); }); if (S.cutSel === c.id) S.cutSel = null; M.UI.renderLeft(); } }, 'x'))));
        if (!I.cutters.length) cl.append(el('div', { class: 'note' }, 'None. Use the Door or Window tool on the faces of a door or window of the model.'));
        root.append(cl);
        root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, I.deletes.length + ' deleted face(s), ' + (sh.lights || []).length + ' light(s)'),
            I.deletes.length ? el('button', { class: 'btn sm', onclick: () => { Model.edit(Q => { Q.import.deletes = []; }); M.UI.renderLeft(); } }, 'Restore faces') : null,
            (sh.lights || []).length ? el('button', { class: 'btn sm', onclick: () => { Model.edit(Q => { Q.shell.lights = []; }); M.UI.renderLeft(); } }, 'Clear lights') : null));
        });

        // the room edges against the building's own walls: the interior only lines up with the outside when its edges lie exactly on the walls
        sec(root, 'rects', 'Rooms (' + sh.ops.filter(o => o.op === 'add').length + ')', { sum: (sh.lights || []).length + ' light' + ((sh.lights || []).length === 1 ? '' : 's') }, (root) => {
        if (IM.loaded && sh.ops.some(o => o.op === 'add')) {
            const fit = IM.fitRooms(), worst = fit.reduce((a, f) => Math.max(a, Math.abs(f.to - f.from)), 0);
            root.append(el('div', { class: 'h' }, 'Fit to the building'));
            root.append(el('div', { class: 'note' }, fit.length ? fit.length + ' room edge' + (fit.length === 1 ? ' is' : 's are') + ' not exactly on the building\'s wall next to ' + (fit.length === 1 ? 'it' : 'them') + ' (the biggest is off by ' + (worst * 100).toFixed(1) + ' cm). Floor and ceiling end at the room edge, so a gap or a step is left there.' : 'Every room edge that has one of the building\'s walls next to it lies exactly on it.'));
            root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm primary', disabled: fit.length ? null : true, title: 'Move each room edge onto the building\'s wall within 25 cm of it', onclick: () => { const r = IM.fitRooms(0.25, true); toast(r.length ? 'Moved ' + r.length + ' room edge' + (r.length === 1 ? '' : 's') + ' onto the walls.' : 'Nothing to move.', r.length ? 'ok' : 'warn'); M.UI.renderLeft(); } }, 'Fit rooms to the walls')));
        }
        root.append(el('div', { class: 'h' }, 'Interior rectangles'));
        const list = el('div', { class: 'plist', style: { maxHeight: '150px' } });
        sh.ops.forEach((o, i) => list.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: S.opSel === i ? 'rgba(80,200,130,0.18)' : '' }, title: 'Click to select it', onclick: () => { if (S.shellTool !== 'select') M.App.setTool('select'); S.opSel = i; S.shellSel = null; S.cutSel = null; M.UI.renderLeft(); }, onmouseenter: () => { S.hoverOp = i; }, onmouseleave: () => { S.hoverOp = null; } },
            el('b', null, o.op === 'add' ? 'Add' : 'Cut'), el('span', { class: 'note' }, f2(o.r[2] - o.r[0]) + ' x ' + f2(o.r[3] - o.r[1]) + ' m at ' + f2(o.r[0]) + ', ' + f2(o.r[1])),
            el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); S.hoverOp = null; S.opSel = null; Model.edit(Q => { Q.shell.ops.splice(i, 1); }); M.UI.renderLeft(); } }, 'x'))));
        if (!sh.ops.length) list.append(el('div', { class: 'note' }, 'Nothing yet. Draw with Add room.'));
        root.append(list);
        });
        sec(root, 'camera', 'Camera and keys', {}, b => b.append(el('div', { class: 'note' }, 'Like Blender: middle-drag orbits (Shift pans, Ctrl zooms), right-drag also orbits · wheel zoom · keypad 1 / 3 / 7 front / right / top (Ctrl: opposite), 4 6 8 2 step the orbit, Home frames everything · WASD move · Q/E turn · T top-down. Right-click or Esc cancels a drag.')));
    };

    // ---------------- the frame of a window or door: built by the program, the model's own, or none ----------------
    const frameMode = (c) => c.vframe ? 'vanilla' : (c.frame === false ? 'none' : 'built');
    function frameChoice(root, sel, k) {
        const set = (c, v) => { c.frame = v !== 'none'; if (v === 'vanilla') c.vframe = true; else delete c.vframe; };
        root.append(el('div', { class: 'row' }, el('label', null, 'Frame'), k.seg([['built', 'Built'], ['vanilla', 'The model\'s'], ['none', 'None']], frameMode(sel), v => { IT.updateCutter(sel.id, q => set(q, v)); M.UI.renderLeft(); })));
        const same = Model.bldAll(S.project).find(b => b.active).d.import.cutters.filter(c => c.face && c.type === sel.type && c.id !== sel.id && frameMode(c) !== frameMode(sel)).length;
        if (same) root.append(el('div', { class: 'row' }, el('button', { class: 'btn sm', title: 'Give every ' + sel.type + ' of this building the same frame choice', onclick: () => { Model.edit(Q => { Q.import.cutters.forEach(c => { if (c.face && c.type === sel.type) set(c, frameMode(sel)); }); }); M.UI.renderLeft(); } }, 'Same for the other ' + same + ' ' + sel.type + (same === 1 ? '' : 's') + ' of this building')));
    }

    // ---------------- clearing the model's parts out of the rooms (right panel) ----------------
    function clearBlock(root) {
        const P = S.project, I = P.import, on = IM.clearOn();
        root.append(chk('Clear the model\'s parts out of the rooms', () => IM.clearOn(), v => { Model.edit(Q => { Q.import.clearMesh = v; }); M.UI.renderRight(); }));
        if (!on) { root.append(el('div', { class: 'note' }, 'Off: parts of the model that stick into your rooms (window boxes, plants, vents) stay.')); return; }
        const cats = IM.clearCats(), cnt = IM.clearCnt, det = IM.clearDet || {}, n = (k) => ((cnt && cnt[k]) || 0) + (det[k] || 0);
        [['win', 'Windows: their boxes and frames that stick in'], ['veg', 'Vegetation: plants, weeds, bushes'], ['other', 'Everything else that sticks in']].forEach(c =>
            root.append(chk(c[1] + (cnt ? ' · ' + n(c[0]) + ' triangles cut' : ''), () => !!cats[c[0]], v => { Model.edit(Q => { Q.import.clearCats = Object.assign({}, IM.clearCats(), { [c[0]]: v }); }); M.UI.renderRight(); })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Margin'), el('input', { type: 'number', class: 'grow', step: '0.005', min: '0', max: '0.1', value: IM.clearMargin(), title: 'Where a side of a room is its edge, the cut stays this far inside the room\'s wall (on top of the wall thickness), so a wall the edge lies on is not cut', onchange: (e) => { const v = Math.min(0.1, Math.max(0, parseFloat(e.target.value))); Model.edit(Q => { Q.import.clearMargin = isNaN(v) ? 0.01 : v; }); M.UI.renderRight(); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Window depth'), el('input', { type: 'number', class: 'grow', step: '0.01', min: '0', max: '0.5', value: IM.clearWinDepth(), title: 'How far a window\'s own parts (its frame and box) may reach into the room, past the face of the wall, before they are cut. 0 cuts them at the wall\'s face.', onchange: (e) => { const v = Math.min(0.5, Math.max(0, parseFloat(e.target.value))); Model.edit(Q => { Q.import.clearWinDepth = isNaN(v) ? 0.10 : v; }); M.UI.renderRight(); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'note' }, 'Window depth: a window\'s frame and box may reach this far into the room, past the wall\'s face, before they are cut: that part of the window is kept (the cut-out still shows its frame from outside). 0 cuts them off flush with the wall\'s face.'));
        root.append(el('div', { class: 'note' }, 'Everything of the model that lies inside a room (from 30 cm under the floor to the ceiling) is cut away from the inner face of the room\'s walls (the room\'s edge plus the wall thickness: what is inside the thickness of the wall, like a window frame, stays), in the building and in the detail models: the window boxes that stick in, plants that reach in, vents. What is outside the rooms is not touched (a window stays a window from outside). A face that looks OUT of the room through a wall, close to that wall (within 15 cm), is the building\'s outside surface and stays; so does a roof above the ceiling. Rooms of every building count. A part is a window or vegetation by the name of its texture.'));
        // the outside surface is only protected within 15 cm of a room's wall or ceiling: rooms that are further out than that cut into it
        if (cats.other) {
            const off = IM.targetModel() ? IM.fitRooms().filter(f => Math.abs(f.to - f.from) > 0.12) : [], wt = IM.targetModel() ? IM.wallTop() : null;
            if (off.length) root.append(el('div', { class: 'note bad' }, off.length + ' room edge' + (off.length === 1 ? ' is' : 's are') + ' more than 12 cm off the building\'s wall: the wall can be cut there. Use "Fit rooms to the walls".'));
            if (wt != null && P.settings.ceilH > wt + 0.12) root.append(el('div', { class: 'note bad' }, 'The ceiling is ' + f2((P.settings.ceilH - wt) * 100, 0) + ' cm higher than the top of the building\'s walls: the roof can be cut. Use "Match the building" for the ceiling.'));
        }
        // the parts, one by one: untick a part to leave it alone
        const skip = new Set(I.clearSkip || []);
        const body = [];
        IM.models.filter(m => !m.target ? m.file !== (I.doorModel && I.doorModel.file) : true).forEach(m => {
            const gs = m.geoms.filter(g => g.tris > 0);
            body.push(el('div', { class: 'note', style: { marginTop: '4px', fontWeight: 600 } }, (m.target ? 'Building: ' : 'Detail: ') + m.file.replace(/\.ydr$/i, '')));
            gs.forEach(g => { const kind = IM.partKind(g.texName, g.shader), key = m.file + '|' + g.g;
                body.push(chk((g.texName || ('part ' + g.g)) + ' · ' + ({ win: 'window', veg: 'vegetation', other: 'other' })[kind] + ' · ' + g.tris + ' tris', () => !skip.has(key) && !!cats[kind], v => { Model.edit(Q => { const s = new Set(Q.import.clearSkip || []); if (v) s.delete(key); else s.add(key); Q.import.clearSkip = [...s]; if (v && !IM.clearCats()[kind]) Q.import.clearCats = Object.assign({}, IM.clearCats(), { [kind]: true }); }); M.UI.renderRight(); })); });
        });
        root.append(el('details', { open: S.clearPartsOpen ? true : null, ontoggle: (e) => { S.clearPartsOpen = e.target.open; } }, el('summary', { class: 'note', style: { cursor: 'pointer' } }, 'Parts (' + skip.size + ' left out)'), ...body));
    }

    // ---------------- right panel ----------------
    UI2.renderRight = function (root) {
        const P = S.project, k = kit();
        sec(root, 'v.view', 'View', { panel: 'right', open: true }, (root) => {
        root.append(el('div', { class: 'row' }, el('label', null, 'The model'), k.seg([['off', 'Off'], ['ghost', 'Ghost'], ['solid', 'Solid']], S.refMode, v => { S.refMode = v; IM.rebuild(); M.UI.renderRight(); })));
        if (IM.selComps) {
            root.append(el('div', { class: 'row' }, el('label', null, 'Other buildings'), k.seg([['hide', 'Hidden'], ['ghost', 'Ghost'], ['show', 'Shown']], IM.isoMode(), v => { Model.edit(Q => { Q.import.iso = v; }); M.UI.renderRight(); })));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => { IM.centerOnBuilding(); M.App.frameAll(); } }, 'Center the grid on it'), el('button', { class: 'btn sm', onclick: () => { IM.clearBuilding(); M.App.frameAll(); } }, 'Show all buildings')));
        }
        root.append(chk('Detail models (bushes, props)', () => IM.showDetails, v => { IM.showDetails = v; IM.rebuild(); }));
        root.append(chk('Only near the camera', () => IM.clipOn, v => { IM.clipOn = v; M.UI.renderRight(); }));
        if (IM.clipOn) root.append(el('div', { class: 'row' }, el('label', null, 'Radius'), el('input', { type: 'range', class: 'grow', min: 8, max: 150, step: 1, value: IM.clipR, oninput: (e) => { IM.clipR = +e.target.value; e.target.nextSibling.textContent = IM.clipR + ' m'; } }), el('span', { class: 'note', style: { minWidth: '44px' } }, IM.clipR + ' m')));
        root.append(chk('Cutaway: hide the roof and upper walls (C)', () => IM.cutOn, v => { IM.cutOn = v; IM.applyCut(); M.UI.renderRight(); M.UI.renderLeft(); }));
        root.append(chk('Also with the Door, Window and figure tools', () => IM.cutAuto, v => { IM.cutAuto = v; IM.applyCut(); M.UI.renderLeft(); }));
        if (IM.cutOn || IM.cutAuto) root.append(el('div', { class: 'row' }, el('label', null, 'Cut height'), el('input', { type: 'range', class: 'grow', min: 0.5, max: 12, step: 0.05, value: IM.cutH(), oninput: (e) => { IM.clipH = +e.target.value; IM.applyCut(); e.target.nextSibling.textContent = IM.clipH.toFixed(2) + ' m'; } }), el('span', { class: 'note', style: { minWidth: '44px' } }, IM.cutH().toFixed(2) + ' m')));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.App.toggleTopDown() }, 'Top-down (T)'), el('button', { class: 'btn sm', onclick: () => M.App.frameAll() }, IM.isolating() ? 'Frame the building' : 'Frame the model'), el('button', { class: 'btn sm', onclick: () => M.App.frameInterior() }, 'Frame the interior')));
        });
        sec(root, 'v.col', 'Collision', { panel: 'right', sum: P.import.clearCollision !== false ? 'cleared in rooms' : 'not cleared' }, (root) => {
        root.append(chk('Game collision (orange)', () => S.showCollision, v => { S.showCollision = v; IM.requestCollision(); M.UI.renderRight(); }));
        if (S.showCollision && IM.colNote) root.append(el('div', { class: 'note' }, IM.colNote));
        root.append(chk('My collision (teal: made by the rooms, coloured: my boxes)', () => !!S.showMyCol, v => { S.showMyCol = v; }));
        root.append(chk('Walk check result (green: you can stand, red: invisible pieces)', () => !!S.showWalk, v => { S.showWalk = v; }));
        root.append(chk('Clear the building\'s collision inside the rooms', () => P.import.clearCollision !== false, v => { Model.edit(Q => { Q.import.clearCollision = v; }); M.UI.renderRight(); }));
        root.append(el('div', { class: 'note' }, P.import.clearCollision !== false
            ? 'The building\'s own collision fills its rooms (solid blocks, wall slabs that reach into the room, frames and panels), which blocks you with nothing to see. Everything inside your rooms, from the floor up to the ceiling, is cut out of it; the floor and everything outside the room edges stay, and the interior\'s own walls stand at the room edges.'
            : 'The building\'s own collision is left inside the rooms: invisible blocks and walls can stop you there.'));
        { const info = el('div', { id: 'colinside' }); IM.colInsideFill(info); root.append(info); }
        });
        sec(root, 'v.clear', 'Clear the model out of the rooms', { panel: 'right', sum: IM.clearOn() ? 'on' : 'off' }, (root) => clearBlock(root));
        sec(root, 'v.show', 'Show or hide', { panel: 'right' }, (root) => {
        root.append(chk('Ceiling', () => S.view.roof, v => { S.view.roof = v; }), chk('Floor', () => S.view.floor, v => { S.view.floor = v; }), chk('Walls', () => S.view.walls, v => { S.view.walls = v; }), chk('Grid', () => S.view.grid, v => { S.view.grid = v; M.App.renderer.showGrid = v; }));
        });
        sec(root, 'v.room', 'Walls and ceiling', { panel: 'right', sum: f2(P.settings.ceilH) + ' m high' }, (root) => {
        root.append(el('div', { class: 'row', style: { marginTop: '6px' } }, el('label', null, 'Ceiling'), el('input', { type: 'number', class: 'grow', step: '0.05', min: '2.2', max: '6', value: P.settings.ceilH, onchange: (e) => { const v = Math.min(6, Math.max(2.2, parseFloat(e.target.value) || 2.45)); Model.edit(Q => { Q.settings.ceilH = v; }); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row' }, el('label', null, ''), el('button', { class: 'btn sm', title: 'Set the ceiling to the top of the building\'s own walls around your rooms', onclick: () => { const h = IM.wallTop(); if (h == null) { toast('Draw a room first: the height is measured from the building\'s walls around it.', 'warn'); return; } const v = Math.min(6, Math.max(2.2, h)); Model.edit(Q => { Q.settings.ceilH = v; }); toast('Ceiling set to ' + v.toFixed(2) + ' m: the top of the building\'s walls around your rooms.', 'ok'); M.UI.renderRight(); } }, 'Match the building'), el('span', { class: 'note grow' }, 'or type a height')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Wall depth'), el('input', { type: 'number', class: 'grow', step: '0.01', min: '0.04', max: '0.6', value: P.settings.wallDepth, title: 'How far the walls\' collision and the sides of openings reach out past the room edge towards the outside. Not used while a Wall thickness is set: the thickness only goes into the room', onchange: (e) => { const v = Math.min(0.6, Math.max(0.04, parseFloat(e.target.value) || 0.08)); Model.edit(Q => { Q.settings.wallDepth = v; }); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Wall thickness'), el('input', { type: 'number', class: 'grow', step: '0.01', min: '0', max: '0.5', value: P.settings.wallThick || 0, title: 'How far the inner face of the walls moves into the room, to cover what sticks through the building\'s walls (frames, vents)', onchange: (e) => { const v = Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)); Model.edit(Q => { Q.settings.wallThick = v; }); M.UI.renderRight(); } }), el('span', { class: 'note' }, 'm')));
        root.append(el('div', { class: 'note' }, (P.settings.wallThick || 0) > 0 ? 'The inner face of every wall is ' + f2((P.settings.wallThick || 0) * 100, 0) + ' cm further into the room than the building\'s wall, so frames, vents and other parts of the building that stick through the wall by less than that are covered. The rooms are that much smaller; the floor and ceiling do not change. It only goes into the room: nothing of the walls (collision, sides of openings) reaches out past the room edge, and Wall depth is not used while a thickness is set.' : 'The inner face of the walls is on the building\'s wall. If parts of the building stick through (thin dark lines, frames, vents), give the walls thickness: 0.10 m covers 10 cm.'));
        // where the interior walls come from
        const skin = P.settings.walls === 'skin';
        root.append(el('div', { class: 'h' }, 'Interior walls'));
        root.append(el('div', { class: 'row wrap' },
            el('button', { class: 'btn sm' + (skin ? '' : ' primary'), title: 'Walls are built along the edges of your rooms', onclick: () => { Model.edit(Q => { Q.settings.walls = 'build'; }); M.UI.renderRight(); } }, 'From the room edges'),
            el('button', { class: 'btn sm' + (skin ? ' primary' : ''), title: 'Walls are the building\'s own wall faces turned inwards', onclick: () => { Model.edit(Q => { Q.settings.walls = 'skin'; }); M.UI.renderRight(); } }, 'The building\'s own walls')));
        root.append(el('div', { class: 'note' }, skin
            ? 'The walls are the building\'s own wall faces, turned to look into the rooms, so they match the outside exactly (' + ((M.App.built && M.App.built.stats.skin) || 0) + ' faces now). The wall collision is still built from the room edges (the building\'s own collision inside the rooms is cleared). The floor and ceiling still come from your rooms, so fit the room edges to the walls (Rooms section of the Build tab).'
            : 'The walls are built along the edges of your rooms. They only match the outside as well as the room edges do: use "Fit rooms to the walls" in the Rooms section of the Build tab.'));
        });
        sec(root, 'v.num', 'Numbers', { panel: 'right' }, (root) => {
        const b = M.App.built, st = IM.stats, I = P.import;
        root.append(el('div', { class: 'kv' }, 'Interior triangles', el('b', null, b ? b.stats.tris.toLocaleString() : '0'), 'Model triangles', el('b', null, st ? st.after.toLocaleString() + ' (was ' + st.before.toLocaleString() + ')' : (IM.targetModel() ? IM.targetModel().tris.toLocaleString() : '0')),
            'Cutters', el('b', null, I.cutters.length), 'Deleted faces', el('b', null, I.deletes.length), 'Lights', el('b', null, (P.shell.lights || []).length)));
        });
        if (IM.busy) root.append(el('div', { class: 'note' }, 'Cutting...'));
    };

    // ---------------- the checklist ----------------
    // Every step says whether it is done, how much it matters (must: Export refuses or the result is useless, should: Export warns, opt: helps)
    // and where to go. The Build and Import tabs show the next one; the Export tab shows them all.
    function steps() {
        const P = S.project, I = P.import, f = I.frame, sh = P.shell, out = [];
        const ncol = (IM.files || []).filter(x => x.kind === 'collision').length, hasRooms = sh.ops.some(o => o.op === 'add'), lights = (sh.lights || []).length;
        const hasCut = I.cutters.length > 0 || (I.fits || []).length > 0, doors = I.cutters.some(k => k.type === 'door');
        const add = (id, sev, title, done, go, why) => out.push({ id, sev, title, done: !!done, go, why });
        add('model', 'must', 'Import the model', IM.targetModel(), { tab: 'import' }, 'Import tab: add the .ydr, .ytd and collision files of the building.');
        if (IM.comp && IM.comp.comps && IM.comp.comps.length > 1) add('building', 'opt', 'Select the building', IM.selComps, { tool: 'building' }, 'The model holds a whole block: pick the one building so the grid fits it.');
        add('place', 'must', 'Say where the model stands in the game', I.entity, { tab: 'import' }, 'Import tab, Placement. Export needs it.');
        add('grid', 'must', 'Set the grid on the building\'s floor', f.x || f.y || f.z || f.heading, { tool: 'frame' }, 'Frame tool: click a floor and a wall (Select building does it too).');
        add('rooms', 'must', 'Draw the rooms', hasRooms, { tool: 'room' }, 'Add room: drag rectangles inside the building.');
        add('open', 'must', 'Cut out a door or a window', hasCut || (Model.bldAll(P).length === 1 && I.deletes.length > 0), { tool: 'door' }, 'Door or Window tool: click the faces of a door or window. Otherwise the model stays closed.');
        // (no step for choosing a door model any more: doors come from the Window / door models tool; the old Door tool's doors stay open until a .ydr is chosen for them in the Import tab, and that is optional)
        if (hasCut) add('col', 'should', 'Import the building\'s collision', ncol > 0, { tab: 'import' }, 'Without it the walls stay solid and the openings cannot be walked through.');
        if (hasRooms && IM.targetModel() && IM.colInside) { const c = IM.colInside; add('colclear', 'should', 'The building\'s collision is out of the rooms', P.import.clearCollision !== false || c.now === 0, { tool: 'room' }, c.now + ' pieces of the building\'s own collision would block you inside the rooms: turn on "Clear the building\'s collision inside the rooms" in the right panel.'); }
        if (hasRooms && IM.targetModel()) { const off = IM.fitRooms(); add('fit', 'should', 'Room edges lie on the building\'s walls', off.length === 0, { tool: 'room' }, off.length + ' room edge(s) are not on a wall of the building: press "Fit rooms to the walls" in the Build tab.'); }
        if (hasRooms && IM.targetModel()) { const b = Shell.build(P, { mode: 'export', autoLights: false }); add('portal', 'should', 'Make the inside visible from outside', b.portals.length > 0, { tool: 'door' }, 'A door or window of your interior must meet an opening of the model.'); }
        add('lights', 'should', 'Place lights', lights > 0, { tool: 'light' }, 'Light tool: click the floor. Only the lights you place are exported.');
        if (hasRooms && IM.targetModel() && M.Walk) add('walk', 'opt', 'Walk through the interior (optional Walk check)', M.Walk.done(), { tool: 'walk' }, M.Walk.result ? (M.Walk.stale() ? 'The project changed since the last walk check: run it again.' : 'The walk check found problems: see the list in the Walk check tool.') : 'Walk check tool: tests that you can reach every room and pass every doorway, and that you cannot walk out through a gap.');
        if (hasRooms && IM.targetModel() && I.entity) add('plants', 'opt', 'Look for the map\'s bushes in the rooms (optional)', !!(I.plants && I.plants.list && I.plants.list.length) && !M.Plants.stale(), { tool: 'plants' }, (I.plants && I.plants.list && I.plants.list.length ? 'The rooms changed since the plants were looked up: look them up again. ' : '') + 'Props and plants tool (Y): click the ones you want gone.');
        add('prefix', 'must', 'Give the project a prefix', P.prefix, { tab: 'export' }, 'Export tab: every model of the pack starts with it.');
        return out;
    }
    const goStep = (s) => { if (s.go.tab) M.App.setTab(s.go.tab); else M.App.setTool(s.go.tool); };
    function stepRow(s) {
        const mark = s.done ? '✓' : (s.sev === 'must' ? '✗' : (s.sev === 'should' ? '!' : '○')), col = s.done ? '#9fd9a8' : (s.sev === 'must' ? '#f0a4a3' : (s.sev === 'should' ? '#f0d28a' : '#8fa0bd'));
        return el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '6px' } }, el('span', { style: { color: col, width: '12px', flex: 'none' } }, mark),
            el('div', { class: 'grow' }, el('div', { style: { color: col } }, s.title), s.done ? null : el('div', { class: 'note' }, s.why)), s.done ? null : el('button', { class: 'btn sm', onclick: () => goStep(s) }, 'Go'));
    }
    UI2.steps = steps;
    UI2.renderChecklist = function (root, compact) {
        // the progress counts what is needed; the optional steps (the walk check, picking the building) are listed under "All steps" and never block anything
        const list = steps(), need = list.filter(s => s.sev !== 'opt'), done = need.filter(s => s.done).length, next = list.find(s => !s.done && s.sev !== 'opt');
        if (!compact) { list.forEach(s => root.append(stepRow(s))); return; }
        // the card at the top: how far along, and the one thing to do next
        const card = el('div', { class: 'route' });
        card.append(el('div', { class: 'rtop' }, el('span', { class: 'rt' }, next ? 'Next step' : 'Ready to export'), el('span', { class: 'rn' }, done + ' of ' + need.length + ' done')));
        card.append(el('div', { class: 'rbar' }, el('i', { style: { width: (need.length ? Math.round(done / need.length * 100) : 0) + '%' } })));
        card.append(next
            ? el('div', { class: 'rnext' }, el('div', { class: 'grow' }, el('div', { style: { fontWeight: 600 } }, next.title), el('div', { class: 'note', style: { margin: '2px 0 0' } }, next.why)), el('button', { class: 'btn sm primary', onclick: () => goStep(next) }, 'Go'))
            : el('div', { class: 'rnext' }, el('div', { class: 'grow note', style: { margin: 0 } }, 'Everything that is needed is done. Run the Walk check if you have not, then export.'), el('button', { class: 'btn sm primary', onclick: () => M.App.setTab('export') }, 'Export')));
        root.append(card);
        sec(root, 'allsteps', 'All steps', { sum: list.filter(s => !s.done).length ? list.filter(s => !s.done).length + ' open' : 'all done' }, b => list.forEach(s => b.append(stepRow(s))));
    };
    // how a stage of the route stands: all its steps done, how many are still open, or only optional ones left (null: the stage has no step)
    function stageStatus(st, byId) {
        const ss = st.steps.map(id => byId[id]).filter(Boolean); if (!ss.length) return null;
        const open = ss.filter(s => !s.done), need = open.filter(s => s.sev !== 'opt');
        if (!open.length) return { txt: '✓', col: '#9fd9a8', open };
        if (need.length) return { txt: need.length + ' to do', col: need.some(s => s.sev === 'must') ? '#f0a4a3' : '#f0d28a', open };
        return { txt: 'optional', col: '#8fa0bd', open };
    }
    // The route as a list of numbered stages that open and close like dropdowns: the one with the active tool is open, with what it is for, what is still open in it and its tools.
    function stageList(root, t, list) {
        const byId = {}; list.forEach(s => { byId[s.id] = s; });
        const act = stageOfTool(t), pick = S.stagePick && S.stagePick.tool === t ? S.stagePick.stage : act;
        STAGES.forEach((st, i) => {
            const stat = stageStatus(st, byId), isOpen = pick === st.id && !st.tab;
            root.append(el('button', { class: 'stage' + (isOpen ? ' open' : '') + (act === st.id ? ' has' : ''), title: st.note, onclick: () => { if (st.tab) { M.App.setTab(st.tab); return; } S.stagePick = { stage: isOpen ? null : st.id, tool: t }; M.UI.renderLeft(); } },
                el('span', { class: 'sn' }, String(i + 1)), el('span', { class: 'st' }, st.name), stat ? el('span', { class: 'ss', style: { color: stat.col } }, stat.txt) : null, el('span', { class: 'arr' }, st.tab ? '›' : (isOpen ? '▾' : '▸'))));
            if (!isOpen) return;
            const body = el('div', { class: 'secbody' });
            body.append(el('div', { class: 'note', style: { margin: '2px 0 6px' } }, st.note));
            if (stat) stat.open.forEach(s => body.append(stepRow(s)));
            const rows = el('div', { class: 'toollist' });
            st.rows.forEach(id => {
                const r = ROWS[id], on = r.vars.some(v => v[0] === t), keys = r.vars.map(v => v[2]).join(' / ');
                rows.append(el('button', { class: 'tool' + (on ? ' on' : ''), title: r.vars.map(v => v[1] + ' (' + v[2] + ')').join(', '), onclick: () => M.App.setTool(on ? t : ((S.lastVar || {})[id] || r.vars[0][0])) },
                    el('span', { class: 'tn' }, el('span', { class: 'nm' }, r.name), el('span', { class: 'sub' }, r.sum || SUM[r.vars[0][0]] || '')), el('kbd', null, keys)));
            });
            body.append(rows); root.append(body);
        });
    }

    // ---------------- export ----------------
    // where a building's grid stands in the world: the model's placement plus the building's own grid (frame)
    function placement(P, frame) {
        const I = P.import, e = I.entity; if (!e) return null;
        const h = e.heading * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), f = frame || I.frame;
        return { x: e.x + f.x * c - f.y * s, y: e.y + f.x * s + f.y * c, z: e.z + f.z, heading: (((e.heading + f.heading) % 360) + 360) % 360, ex: e, h, c, s, frame: f };
    }
    function safeRes(s) { return (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
    // the prefix of a building's files: the project's prefix for the first building, the prefix and the building's number for the others (a building keeps its number)
    function prefixOf(P, rec) { const sfx = (rec && rec.sfx && P.import.buildings.length > 1) ? rec.sfx : '', base = (P.prefix || 'mlo').slice(0, 10 - sfx.length); return base + sfx; }       // (a project with one building uses the plain prefix)
    const hasRooms = (d) => d.shell.ops.some(o => o.op === 'add');
    let ex = {};
    UI2.renderExport = function (root) {
        const P = S.project, X = P.export, I = P.import, k = kit(); ex = {};
        const text = (key, ph) => el('input', { type: 'text', class: 'grow', value: X[key] || '', placeholder: ph || '', oninput: (e) => { X[key] = e.target.value; Model.touch(); } });
        root.append(el('div', { class: 'h' }, 'Resource'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Folder'), text('resource', 'mlo_' + (safeRes(P.name) || 'house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Prefix'), el('input', { type: 'text', class: 'grow', value: P.prefix, maxlength: 8, title: 'Every model in the pack starts with this. Keep it unique on your server. The second building adds a 2, the third a 3...', oninput: (e) => { P.prefix = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); Model.touch(); } })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Label'), text('label', P.name)));
        const stepsNow = steps(), stepsOpen = stepsNow.filter(s => !s.done && s.sev !== 'opt').length;
        sec(root, 'e.steps', 'Before you export', { sum: stepsOpen ? stepsOpen + ' to do' : 'all done', open: stepsOpen > 0 }, (b) => UI2.renderChecklist(b, false));
        // what goes into the resource
        const all = Model.bldAll(P), nopen = all.reduce((n, b) => n + (b.d.import.cutters || []).length, 0), lights = (P.shell.lights || []).length;
        root.append(el('div', { class: 'note', style: { marginTop: '6px' } }, all.length + ' building' + (all.length === 1 ? '' : 's') + ', ' + all.filter(b => hasRooms(b.d)).length + ' with rooms: one interior each. The model file: ' + nopen + ' opening(s) and ' + I.deletes.length + ' deleted face(s)' + ((I.mdeletes || []).length ? ', ' + I.mdeletes.length + ' more deleted from detail models' : '') + ((I.fills || []).length ? ', ' + I.fills.length + ' filled hole(s)' : '') + '.'));
        const ndoor = all.reduce((n, b) => n + (b.d.import.cutters || []).filter(k => k.leaf).reduce((m, k) => m + (k.double ? 2 : 1), 0), 0);
        if (I.doorModel) root.append(el('div', { class: 'note' }, ndoor + ' door(s) placed with ' + I.doorModel.name + (I.doorModel.include ? ' (model included).' : ' (referenced by name: the game must have this model).')));
        sec(root, 'e.place', 'Where it goes', { open: true }, (b) => { ex.place = el('div', { class: 'kv' }); b.append(ex.place); UI2.updatePlace(); });
        sec(root, 'e.opt', 'Options', { sum: X.outDir ? 'own folder' : 'default folder' }, (b) => {
            b.append(el('div', { class: 'row' }, el('label', null, 'Output folder'), el('input', { type: 'text', class: 'grow', value: X.outDir || '', placeholder: 'default: the output folder next to the program', onchange: (e) => { X.outDir = e.target.value.trim(); Model.touch(); } })));
            b.append(el('div', { class: 'note' }, 'The cut model is written with its original file name, so the copy in your resource replaces the game\'s one while the resource runs. Only one resource can replace a given file, so all the buildings of the model go into one resource.'));
        });
        ex.btn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px', padding: '9px' }, onclick: () => doExport() }, 'Export resource');
        root.append(ex.btn);
        ex.log = el('div', { class: 'log', style: { marginTop: '10px', display: 'none' } }); root.append(ex.log);
        ex.after = el('div', { class: 'row wrap', style: { display: 'none' } }); root.append(ex.after);
        // what to do with the result: the way from the exported folder to walking through the door in the game
        sec(root, 'e.game', 'After the export: into the game', { open: true }, (b) => {
            const li = (t) => el('li', null, t);
            b.append(el('ol', { class: 'how num' },
                li('Press Export. "Open folder" shows the result: one folder, named like the Folder field above.'),
                li('Copy that whole folder into your server\'s resources folder (upload it to the VPS), and remove an older copy of it first.'),
                li('In the server console: refresh, then ensure the folder\'s name (the "Copy ensure" button gives the line; or add it to server.cfg). Reconnect so the new files stream in.'),
                li('Join and teleport to the test spot the export prints (the button copies it). Walk in through each door and look out of each window.'),
                li('Something wrong? Note where and what you see, fix it here and export again: the same folder is overwritten.')));
        });
    };
    UI2.updatePlace = function () {
        if (!ex.place) return; const P = S.project, all = Model.bldAll(P); ex.place.innerHTML = '';
        all.forEach(b => {
            const pl = placement(P, b.d.import.frame); if (!pl) return;
            if (all.length > 1) ex.place.append(el('b', null, b.name), el('span', { class: 'note' }, hasRooms(b.d) ? '' : 'no rooms: not exported'));
            ex.place.append('X', el('b', null, f2(pl.x, 3)), 'Y', el('b', null, f2(pl.y, 3)), 'Floor Z', el('b', null, f2(pl.z, 3)), 'Heading', el('b', null, f2(pl.heading, 2) + '°'));
        });
    };

    // world position of a point in the grid's own coordinates
    function toWorld(P, pl, sx, sy, sz) {
        const f = pl.frame || P.import.frame, hf = f.heading * Math.PI / 180, lx = f.x + sx * Math.cos(hf) - sy * Math.sin(hf), ly = f.y + sx * Math.sin(hf) + sy * Math.cos(hf), e = pl.ex;
        return [e.x + lx * pl.c - ly * pl.s, e.y + lx * pl.s + ly * pl.c, e.z + f.z + sz];
    }

    async function doExport() {
        const P = S.project, X = P.export, I = P.import;
        const log = (html, cls) => { ex.log.style.display = 'block'; ex.log.append(el('div', { class: cls || '' }, html)); ex.log.scrollTop = 1e9; };
        ex.log.innerHTML = ''; ex.after.style.display = 'none';
        if (!IM.targetModel()) { toast('Import the model first.', 'warn'); return; }
        if (!placement(P)) { toast('Set where the model stands in the game first (Import tab).', 'warn'); return; }
        if (!P.prefix) { toast('Give the project a prefix first.', 'warn'); return; }
        const all = Model.bldAll(P), todo = all.filter(b => hasRooms(b.d));
        if (!todo.length) { toast('No building has a room yet: add a room first.', 'warn'); return; }
        // a step that matters is still open (no opening, grid never set): say so before writing files (the steps are those of the building being worked on)
        const open = UI2.steps().filter(s => !s.done && s.sev !== 'opt'), musts = open.filter(s => s.sev === 'must');
        if (musts.length && !(await M.UI.confirm('Not everything is done', 'Still open' + (all.length > 1 ? ' in "' + (all.find(b => b.active) || {}).name + '"' : '') + ': ' + musts.map(s => s.title).join('; ') + '.' + (open.length > musts.length ? ' Also missing: ' + open.filter(s => s.sev === 'should').map(s => s.title.toLowerCase()).join('; ') + '.' : '') + ' The result may not work in the game.', 'Export anyway'))) return;
        const resource = safeRes(X.resource) || ('mlo_' + (safeRes(P.name) || 'house'));
        M.Errors.crumb('export "' + resource + '"');
        ex.btn.disabled = true; ex.btn.textContent = 'Exporting...';
        try {
            const occOn = I.occluders !== false && (IM.files || []).some(f => f.kind === 'map');
            // faces deleted from the detail models: their files are written with those faces gone
            const byFile = {}; (I.mdeletes || []).forEach(d => { (byFile[d[0]] = byFile[d[0]] || []).push([d[1], d[2]]); });
            // (and with the rooms clearing parts of the model, every detail model is looked at: the host only writes the ones a room reaches into)
            const clear = IM.clearSpec(), dmf = I.doorModel ? I.doorModel.file : null;
            const others = IM.models.filter(m => !m.target && m.file !== dmf && (byFile[m.file] || clear)).map(m => ({ file: m.file, deletes: byFile[m.file] || [], origin: IM.detailOrigin(m.file) }));          // (origin: the rooms in this file's own coordinates: a detail file is centred on its own entity)
            if (Object.keys(byFile).length) log('Detail models changed: ' + Object.keys(byFile).map(f => f + ' (' + byFile[f].length + ' faces)').join(', '));
            const skipped = all.filter(b => todo.indexOf(b) < 0).map(b => b.name); if (skipped.length) log('Not exported (no rooms yet): ' + skipped.join(', '), 'bad');
            const dmod = I.doorModel && IM.doorModel() ? I.doorModel : null, many = todo.length > 1, models = [], tps = [], occSets = [];
            // each building in turn is made the live one (nothing is recorded), so everything reads its own grid, rooms, openings and boxes
            todo.forEach(b => Model.withBuilding(b.id, () => {
                const BP = S.project, BI = BP.import, pl = placement(BP), rec = BI.buildings.find(r => r.id === b.id), tag = many ? b.name + ': ' : '';
                const built = Shell.build(BP, { mode: 'export', autoLights: false });
                if (!built.batches.length) { log(tag + 'the interior is empty, skipped.', 'bad'); return; }
                log(tag + 'Meshing: ' + built.stats.tris + ' triangles, ' + built.stats.boxes + ' collision boxes, ' + built.stats.portals + ' portals, ' + built.stats.lights + ' lights');
                if (!built.portals.length) log(tag + 'Warning: no door or window of this interior reaches the outside, so the inside will not be visible from outside.', 'bad');
                if (!built.lights.length) log(tag + 'Warning: no lights placed, the inside will be dark.', 'bad');
                const bb = built.bounds, mid = toWorld(BP, pl, (bb.mn[0] + bb.mx[0]) / 2, (bb.mn[1] + bb.mx[1]) / 2, 0.3), tp = f2(mid[0], 2) + ', ' + f2(mid[1], 2) + ', ' + f2(mid[2], 2);
                // doors placed with the door model (positions are in the grid's coordinates, which is the interior's own frame)
                const doors = []; if (dmod) BI.cutters.filter(k => k.leaf).forEach(k => IM.doorTransforms(k).forEach(t => doors.push({ x: t.x, y: t.y, z: t.z, heading: t.yaw * 180 / Math.PI, sxy: t.sxy, sz: t.sz })));        // two leaves for double doors
                if (doors.length) log(tag + 'Doors placed with ' + dmod.name + ': ' + doors.length);
                const m = Mesher.toExport(BP, built, { light: {}, model: { resource, prefix: prefixOf(BP, rec), label: many ? b.name : (X.label || BP.name), timecycle: 'hash_E83C53FC', placement: { x: pl.x, y: pl.y, heading: pl.heading, z: pl.z }, entranceNote: 'test spot inside the interior: ' + tp, outDir: X.outDir || undefined,
                    doors, doorModel: doors.length ? { name: dmod.name, include: !!dmod.include, project: BP.name } : undefined, fitted: M.FitModels.exportSpec(BP) } });
                models.push(m); tps.push({ name: b.name, tp }); occSets.push({ rects: Shell.regionRects(BP.shell), place: { x: pl.x, y: pl.y, heading: pl.heading } });
            }));
            if (!models.length) { log('Nothing to export.', 'bad'); ex.btn.disabled = false; ex.btn.textContent = 'Export resource'; return; }
            // the model files are cut by the openings of ALL the buildings (in the model's own coordinates: every building has its own grid)
            const cutters = IM.allCutters(), model = models[0];
            model.resourceLabel = X.label || P.name; model.more = models.slice(1);
            // the plants are counted against the rooms as they are NOW (a lookup from before the rooms were drawn would hide the wrong ones)
            if (((S.project.import.plants && S.project.import.plants.list) || []).length && M.Plants.stale()) { log('Counting the map\'s plants against the rooms...'); const ok = await M.Plants.ensureFresh(); if (!ok) log('The plants could not be counted again' + (M.Plants.err ? ' (' + M.Plants.err + ')' : '') + ': only the ones you ticked by hand are hidden.', 'bad'); }
            const hidePlants = M.Plants.hideList(); if (hidePlants.length) { model.hidePlants = hidePlants; log('Props and plants of the map hidden: ' + hidePlants.map(p => p.n).join(', ')); }
            model.cutModel = (cutters.length || I.deletes.length || (I.fills || []).length || (I.colDeletes || []).length || others.length || occOn || clear) ? { project: P.name, target: I.target, origin: IM.NOFRAME, cutters, roomVolumes: IM.allRoomVolumes(), colDeletes: I.colDeletes || [], deletes: I.deletes, fills: I.fills || [], others, clear, entity: I.entity,
                occluders: occOn ? { sets: occSets } : undefined } : undefined;
            const res = await Model.api('export', 'POST', model);
            if (!res.ok) { log('Export failed: ' + res.error, 'bad'); console.error(res.detail); }
            else {
                (res.log || []).forEach(l => log(l)); (res.warnings || []).forEach(l => log('Warning: ' + l, 'bad')); (res.files || []).forEach(l => log('  ' + l)); log('Done: ' + res.dir, 'good');
                tps.forEach(t => log('Test spot inside ' + (many ? t.name : 'the interior') + ' (world): ' + t.tp));
                ex.after.style.display = 'flex'; ex.after.innerHTML = '';
                ex.after.append(el('button', { class: 'btn sm', onclick: () => Model.api('reveal?name=' + encodeURIComponent(res.dir), 'POST') }, 'Open folder'),
                    el('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText('ensure ' + res.resource).then(() => toast('Copied: ensure ' + res.resource, 'ok')); } }, 'Copy "ensure ' + res.resource + '"'),
                    ...tps.map(t => el('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText(t.tp).then(() => toast('Copied the test spot' + (many ? ' of ' + t.name : '') + ': ' + t.tp, 'ok')); } }, 'Copy test spot' + (many ? ' (' + t.name + ')' : ''))));
            }
        } catch (err) { log('Export failed: ' + err.message, 'bad'); M.Errors.report('export', err, { quiet: true }); }
        ex.btn.disabled = false; ex.btn.textContent = 'Export resource';
    }

    UI2.renderLeft = function (root) {
        if (S.tab === 'import' || S.tab === 'build') UI2.renderChecklist(root, true);
        if (S.tab === 'import') UI2.renderImport(root); else if (S.tab === 'furnish') UI2.renderFurnish(root); else if (S.tab === 'build') UI2.renderBuild(root); else if (S.tab === 'paint') M.VanillaUI.renderPaint(root); else UI2.renderExport(root);
    };
    UI2.refresh = function () { M.UI.renderLeft(); M.UI.renderRight(); };
    UI2.updateInfo = function () { if (S.tab === 'export') UI2.updatePlace(); };
})(window.MLO);
