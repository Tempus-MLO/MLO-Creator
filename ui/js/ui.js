// Panels, dialogs and the export form.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, TEX, Model, Mesher } = M, S = Model.state, bus = Model.bus;
    const $ = (id) => document.getElementById(id);
    const UI = {};

    const TOOLS = [['wall', 'Wall', '1'], ['room', 'Room', '2'], ['floor', 'Floor', '3'], ['door', 'Door', '4'], ['window', 'Window', '5'], ['arch', 'Archway', '6'],
        ['stairs', 'Stairs', '7'], ['roof', 'Roof', '8'], ['light', 'Light', '9'], ['entrance', 'Entrance', '0'], ['eraser', 'Eraser', 'X']];
    const TOOL_HELP = {
        wall: 'Drag from one grid corner to another to build a straight wall. Walls stand on the grid lines.',
        room: 'Drag a rectangle: the four walls and the floor appear together. Draw a second room against the first to share a wall.',
        floor: 'Drag over cells to lay floor with no walls: terraces, porches, decks. Open floor stays outdoors.',
        door: 'Click a wall to cut a doorway (0.9 x 2.1 m). Click the same doorway again to fill it in.',
        window: 'Click a wall to put a window in it (0.8 x 1.2 m, sill at 0.9 m). Click again to remove it.',
        arch: 'Click a wall to open the whole metre of it up to 2.3 m: for open-plan rooms.',
        roof: 'Drag over cells to put a flat roof on top of the current level. Roofs show only while Roof is ticked.',
        light: 'Click a cell to add or remove a ceiling light. Rooms also get automatic lights when you export.',
        entrance: 'Click a door or archway on level 0 to mark it as the main entrance. Its position in the game decides where the house stands.',
        eraser: 'Click a wall or cell to remove it. Drag over walls to remove several, or drag from empty ground to clear a rectangle.',
        paint: 'Click a wall face, floor, ceiling or roof to paint it. Anything unpainted uses the project theme below.'
    };
    const PAINT_TARGETS = [['wall', 'Walls'], ['floor', 'Floors'], ['ceil', 'Ceilings'], ['roof', 'Roofs']];
    const DEFAULT_ROWS = [['wallExt', 'Outside walls'], ['wallInt', 'Inside walls'], ['floor', 'Floors'], ['ceiling', 'Ceilings'], ['roof', 'Roofs'], ['trim', 'Trim & frames'], ['slab', 'Slab edges'], ['stair', 'Stair treads']];

    function toast(text, kind) {
        const t = el('div', { class: 'toast ' + (kind || '') }, text); $('toasts').append(t);
        setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, kind === 'err' ? 6000 : 2800);
    }
    bus.on('toast', (t) => toast(t.text, t.kind));

    // ---------- modal ----------
    // opts.sticky: clicking outside does not close it (start screen, where nothing is open yet)
    function modal(content, opts) { const m = $('modal'); m.innerHTML = ''; m.append(content); m.hidden = false; m.onclick = (opts && opts.sticky) ? null : (e) => { if (e.target === m) closeModal(); }; }
    function closeModal() { $('modal').hidden = true; $('modal').innerHTML = ''; }
    function confirmDlg(title, text, okLabel, danger) {
        return new Promise(res => {
            const done = (v) => { closeModal(); res(v); };
            modal(el('div', { class: 'dlg' }, el('h2', null, title), el('div', { class: 'note' }, text),
                el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => done(true) }, okLabel || 'OK'))));
        });
    }

    // ---------- small widgets ----------
    function stepper(text, minus, plus) {
        const v = el('div', { class: 'val' }, text());
        const upd = () => { v.textContent = text(); };
        return el('div', { class: 'stepper' }, el('button', { onclick: () => { minus(); upd(); } }, '−'), v, el('button', { onclick: () => { plus(); upd(); } }, '+'));
    }
    function seg(items, cur, onPick) {
        const root = el('div', { class: 'seg' });
        items.forEach(it => root.append(el('button', { class: it[0] === cur ? 'on' : '', onclick: () => onPick(it[0]) }, it[1])));
        return root;
    }
    function swatchEl(id, px) { const c = TEX.swatch(id, px || 48); return c; }

    // ---------- top bar ----------
    function renderTop() {
        const tabs = $('tabs'); tabs.innerHTML = '';
        (S.project.kind === 'import' ? [['import', 'Import'], ['build', 'Build'], ['furnish', 'Inredning'], ['paint', 'Paint'], ['export', 'Export']] : (S.project.kind === 'vanilla' ? [['vanilla', 'House'], ['build', 'Build'], ['paint', 'Paint'], ['export', 'Export']] : [['build', 'Build'], ['paint', 'Paint'], ['export', 'Export']]))
            .forEach(t => tabs.append(el('button', { class: S.tab === t[0] ? 'on' : '', onclick: () => M.App.setTab(t[0]) }, t[1])));
        $('b-undo').disabled = !Model.hist.undo.length; $('b-redo').disabled = !Model.hist.redo.length;
        const nm = $('projname'); if (document.activeElement !== nm) nm.value = S.project.name;
        $('savestate').textContent = S.saving ? 'Saving...' : (S.saved ? 'Saved' : 'Unsaved');
    }

    // ---------- left: build ----------
    function renderBuild(root) {
        const t = S.tool, grid = el('div', { class: 'tools' });
        TOOLS.forEach(tl => grid.append(el('button', { class: 'tool' + (t === tl[0] ? ' on' : ''), onclick: () => M.App.setTool(tl[0]) }, tl[1], el('kbd', null, tl[2]))));
        root.append(el('div', { class: 'h' }, 'Tools'), grid);
        root.append(el('div', { class: 'h' }, TOOLS.filter(x => x[0] === t).map(x => x[1])[0] || 'Tool'));
        if (TOOL_HELP[t]) root.append(el('div', { class: 'note' }, TOOL_HELP[t]));
        if (t === 'room' || t === 'floor') {
            root.append(el('div', { class: 'row' }, el('label', null, 'Floor'), swatchEl(S.brush.floor, 28), el('span', { class: 'grow' }, TEX.def(S.brush.floor).name),
                el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'floor'; M.App.setTab('paint'); } }, 'Change')));
        }
        if (t === 'roof') {
            root.append(el('div', { class: 'row' }, el('label', null, 'Roof'), swatchEl(S.brush.roof, 28), el('span', { class: 'grow' }, TEX.def(S.brush.roof).name),
                el('button', { class: 'btn sm', onclick: () => { S.paintTarget = 'roof'; M.App.setTab('paint'); } }, 'Change')));
            root.append(el('div', { class: 'row wrap' },
                el('button', { class: 'btn sm', onclick: () => { Model.edit(P => { const L = P.levels[S.level], above = P.levels[S.level + 1]; Object.keys(L.floor).forEach(k => { if (!above || above.floor[k] === undefined) L.roof[k] = S.brush.roof; }); }); } }, 'Roof over all rooms'),
                el('button', { class: 'btn sm danger', onclick: () => { Model.edit(P => { P.levels[S.level].roof = {}; }); } }, 'Clear roof')));
        }
        if (t === 'stairs') renderStairOptions(root);
        root.append(el('div', { class: 'h' }, 'Camera'),
            el('div', { class: 'note' }, 'Right-drag orbit · middle-drag or Shift+right-drag pan · wheel zoom · WASD move · Q/E turn · T top-down.'));
    }

    function renderStairOptions(root) {
        const st = S.stair, cfg = S.project.settings;
        const info = el('div', { class: 'note' });
        const refreshInfo = () => {
            const si = Mesher.stairInfo(cfg, { i: 0, j: 0, dir: st.dir, wid: st.wid, steps: st.steps, run: st.run });
            info.textContent = (si.rise * 100).toFixed(1) + ' cm rise · ' + (si.tread * 100).toFixed(0) + ' cm run · ' + si.angle.toFixed(0) + '° · ' + si.len + ' cells long, ' + si.wc + ' wide';
        };
        const auto = () => Math.max(3, Math.round(cfg.storyHeight / 0.18));
        root.append(el('div', { class: 'h' }, 'Stair settings'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Steps'), stepper(() => st.steps === 0 ? 'auto (' + auto() + ')' : String(st.steps),
            () => { st.steps = Math.max(3, (st.steps || auto()) - 1); refreshInfo(); }, () => { st.steps = Math.min(40, (st.steps || auto()) + 1); refreshInfo(); })));
        root.append(el('div', { class: 'row' }, el('label', null, ''), el('button', { class: 'btn sm', onclick: () => { st.steps = 0; M.App.refreshPanels(); } }, 'Auto steps')));
        root.append(el('div', { class: 'row' }, el('label', null, 'Run (cm)'), stepper(() => String(Math.round(st.run * 100)),
            () => { st.run = Math.max(0.22, st.run - 0.01); refreshInfo(); }, () => { st.run = Math.min(0.45, st.run + 0.01); refreshInfo(); })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Width (m)'), stepper(() => st.wid.toFixed(2),
            () => { st.wid = Math.max(0.6, Math.round((st.wid - 0.05) * 100) / 100); refreshInfo(); }, () => { st.wid = Math.min(3, Math.round((st.wid + 0.05) * 100) / 100); refreshInfo(); })));
        root.append(info); refreshInfo();
        root.append(el('div', { class: 'h' }, 'Climbs towards'));
        const names = ['East', 'North', 'West', 'South'], pad = el('div', { class: 'dirpad' });
        const mk = (d, label, col, row) => { const b = el('button', { class: st.dir === d ? 'on' : '', style: { gridColumn: col, gridRow: row }, onclick: () => { st.dir = d; M.App.refreshPanels(); } }, label); return b; };
        pad.append(mk(1, '↑ N', 2, 1), mk(2, '← W', 1, 2), mk(0, 'E →', 3, 2), mk(3, '↓ S', 2, 3));
        pad.append(el('button', { style: { gridColumn: 2, gridRow: 2 }, title: 'Rotate (R)', onclick: () => { st.dir = (st.dir + 3) % 4; M.App.refreshPanels(); } }, '↻'));
        root.append(pad, el('div', { class: 'note' }, 'Flight climbs ' + names[st.dir] + '. Press R to turn it. It opens a hole in the floor above.'));
        root.append(el('div', { class: 'h' }, 'Style'));
        root.append(el('div', { class: 'row' }, seg([['solid', 'Solid'], ['open', 'Open']], st.style, v => { st.style = v; M.App.refreshPanels(); })));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.rail ? true : null, onchange: (e) => { st.rail = e.target.checked; } }), 'Railings'));
        root.append(el('button', { class: 'btn sm danger', onclick: () => { Model.edit(P => { P.levels[S.level].stairs.pop(); }); } }, 'Delete last stair'));
    }

    // ---------- left: paint ----------
    function renderPaint(root) {
        const P = S.project;
        root.append(el('div', { class: 'h' }, 'Paint'), el('div', { class: 'note' }, TOOL_HELP.paint));
        root.append(el('div', { class: 'row' }, seg(PAINT_TARGETS, S.paintTarget, v => { S.paintTarget = v; S.benchSel = S.brush[v]; M.App.refreshPanels(); })));
        if (S.paintTarget !== 'roof') root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: S.paintRoom ? true : null, onchange: (e) => { S.paintRoom = e.target.checked; } }), 'Whole room at once'));
        root.append(el('div', { class: 'h' }, 'Project theme'),
            el('div', { class: 'note' }, 'What every unpainted surface looks like. Pick a texture below, then press Set.'));
        DEFAULT_ROWS.forEach(r => {
            root.append(el('div', { class: 'defrow' }, swatchEl(P.defaults[r[0]], 22), el('span', null, r[1]),
                el('button', { class: 'btn sm', onclick: () => { Model.edit(PP => { PP.defaults[r[0]] = S.benchSel || S.brush[S.paintTarget]; }); M.App.refreshPanels(); } }, 'Set')));
        });
    }

    // a picture the user picked becomes a texture in the "Mine" group (stored with the project, exported like the others)
    function addUserImage(file) {
        if (!file) return; const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => {
            const id = 'my_' + (file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 14) || 'image') + '_' + Math.random().toString(36).slice(2, 4);
            // the middle square of the picture, so a wide photo is not squeezed
            const s = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = c.height = 256;
            c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256);
            const def = TEX.addUser(id, file.name.replace(/\.[^.]+$/, '').slice(0, 24), 1, c); URL.revokeObjectURL(url);
            S.ref = S.ref || {}; S.ref.tex = (S.ref.tex || []).concat([{ id, name: def.name, tile: def.tile, url: TEX.userUrl(id) }]);
            Model.saveRef().catch(() => { }); S.benchCat = 'Mine'; S.benchSel = id; S.brush[S.paintTarget] = id; M.App.refreshPanels();
        };
        im.onerror = () => { toast('That file is not a picture the program can read.', 'err'); URL.revokeObjectURL(url); }; im.src = url;
    }
    function renderBench() {
        const b = $('bench'); b.innerHTML = '';
        if (S.tab !== 'paint') return;
        if (!S.benchSel) S.benchSel = S.brush[S.paintTarget];
        const t = TEX.def(S.benchSel), big = el('canvas', { class: 'big', width: 120, height: 120 });
        big.getContext('2d').drawImage(TEX.swatch(S.benchSel, 120), 0, 0);
        const cats = ['All'].concat(TEX.cats); if (!S.benchCat) S.benchCat = 'All';
        const chips = el('div', { class: 'chips' }); cats.forEach(c => chips.append(el('button', { class: 'chip' + (S.benchCat === c ? ' on' : ''), onclick: () => { S.benchCat = c; renderBench(); } }, c)));
        if (S.project.kind === 'import') chips.append(el('label', { class: 'chip', style: { cursor: 'pointer' }, title: 'Use a picture of your own (png, jpg) as a texture' }, '+ Add an image',
            el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: (e) => { addUserImage(e.target.files[0]); e.target.value = ''; } })));
        const grid = el('div', { class: 'sw-grid' });
        TEX.list.filter(x => S.benchCat === 'All' || x.cat === S.benchCat).forEach(x => {
            grid.append(el('div', { class: 'sw' + (x.id === S.benchSel ? ' on' : ''), title: x.name, onclick: () => { S.benchSel = x.id; S.brush[S.paintTarget] = x.id; M.App.refreshPanels(); } }, swatchEl(x.id, 64), el('span', null, x.name)));
        });
        b.append(el('div', { class: 'bench' },
            el('div', { class: 'cur' }, el('div', { class: 'h' }, 'Texture'), big, el('div', null, el('b', null, t.name), t.kind === 'user'
                ? el('div', { class: 'note' }, 'repeats every ', el('input', { type: 'number', step: '0.1', min: '0.2', max: '8', value: t.tile, style: { width: '58px' }, onchange: (e) => { const v = Math.min(8, Math.max(0.2, parseFloat(e.target.value) || 1)); t.tile = v; if (S.ref && S.ref.tex) S.ref.tex.forEach(q => { if (q.id === t.id) q.tile = v; }); Model.saveRef().catch(() => { }); M.App.remesh(); } }), ' m')
                : el('div', { class: 'note' }, t.cat + ' · repeats every ' + t.tile + ' m'))),
            el('div', null, chips, grid)));
    }

    // ---------- left: export ----------
    // accepts vec4(x, y, z, h), vector4(...), "x = 1, y = 2 ..." or plain numbers; words (and the 4 in vec4) are ignored
    function parseCoords(s) { return ((s || '').replace(/[A-Za-z_][A-Za-z_0-9]*/g, ' ').match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
    function computePlacement(P, built) {
        const X = P.export, n = parseCoords(X.coords);
        if (n.length < 3) return { error: 'Paste the game coordinates first (x, y, z and heading).' };
        const h = n.length > 3 ? n[3] : 0, floorZ = n[2] - (X.pedZ ? 1 : 0) + (+X.floorAbove || 0), ent = built.entrance;
        if (P.entrance && !(ent && ent.ok)) return { error: 'The entrance must be a door or archway in an outside wall (a floor on one side only).' };
        if (ent && ent.ok) {
            const hh = (h + (X.facing === 'out' ? 180 : 0)) * Math.PI / 180, wd = [-Math.sin(hh), Math.cos(hh)];
            const th = Math.atan2(wd[1], wd[0]) - Math.atan2(ent.inward[1], ent.inward[0]), c = Math.cos(th), s = Math.sin(th);
            const ox = n[0] - (ent.center[0] * c - ent.center[1] * s), oy = n[1] - (ent.center[0] * s + ent.center[1] * c);
            const deg = ((th * 180 / Math.PI) % 360 + 360) % 360;
            return { x: ox, y: oy, z: floorZ - ent.zFloor, heading: deg, note: 'door at ' + n[0].toFixed(2) + ', ' + n[1].toFixed(2) + ', ' + n[2].toFixed(2) + ' heading ' + h };
        }
        return { x: n[0], y: n[1], z: floorZ, heading: h, note: 'none set (project origin placed at the given coordinates)' };
    }
    function safeRes(s) { return (s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }

    let exportEls = {};
    function renderExport(root) {
        const P = S.project, X = P.export, E = exportEls = {};
        const text = (key, ph, w) => el('input', { type: 'text', class: 'grow', value: X[key] || '', placeholder: ph || '', oninput: (e) => { X[key] = e.target.value; Model.touch(); } });
        root.append(el('div', { class: 'h' }, 'Resource'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Folder'), text('resource', 'mlo_' + (safeRes(P.name) || 'house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Prefix'), el('input', { type: 'text', class: 'grow', value: P.prefix, maxlength: 8, title: 'Every model in the pack starts with this. Keep it unique on your server.', oninput: (e) => { P.prefix = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); Model.touch(); } })));
        root.append(el('div', { class: 'row' }, el('label', null, 'Label'), text('label', P.name)));
        root.append(el('div', { class: 'h' }, 'Where it goes'));
        E.ent = el('div', { class: 'note' }); root.append(E.ent);
        root.append(el('div', { class: 'note' }, 'In the game, stand in the doorway of the real spot and copy your coordinates, e.g. ', el('b', null, 'vec4(x, y, z, heading)'), '.'));
        root.append(el('textarea', { placeholder: 'vec4(-24.09, -1862.60, 25.35, 141.0)', oninput: (e) => { X.coords = e.target.value; Model.touch(); updateExportInfo(); } }, X.coords || ''));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.pedZ ? true : null, onchange: (e) => { X.pedZ = e.target.checked; Model.touch(); updateExportInfo(); } }), 'Coordinates are from a standing player (floor = z − 1)'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Heading'), el('select', { class: 'grow', onchange: (e) => { X.facing = e.target.value; Model.touch(); updateExportInfo(); } },
            el('option', { value: 'in', selected: X.facing !== 'out' ? true : null }, 'taken facing into the house'), el('option', { value: 'out', selected: X.facing === 'out' ? true : null }, 'taken facing out of the house'))));
        root.append(el('div', { class: 'row' }, el('label', null, 'Floor above ground'), el('input', { type: 'number', class: 'grow', step: '0.05', value: X.floorAbove, onchange: (e) => { X.floorAbove = parseFloat(e.target.value) || 0; Model.touch(); updateExportInfo(); } }), el('span', { class: 'note' }, 'm')));
        E.place = el('div', { class: 'note' }); root.append(E.place);
        root.append(el('div', { class: 'h' }, 'Options'));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.autoLights ? true : null, onchange: (e) => { X.autoLights = e.target.checked; Model.touch(); } }), 'Automatic ceiling lights in every room'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Output folder'), el('input', { type: 'text', class: 'grow', value: X.outDir || '', placeholder: 'default: the output folder next to the program', onchange: (e) => { X.outDir = e.target.value.trim(); Model.touch(); } })));
        E.btn = el('button', { class: 'btn primary', style: { width: '100%', marginTop: '10px', padding: '9px' }, onclick: () => doExport() }, 'Export resource');
        root.append(E.btn);
        E.log = el('div', { class: 'log', style: { marginTop: '10px', display: 'none' } }); root.append(E.log);
        E.after = el('div', { class: 'row wrap', style: { display: 'none' } }); root.append(E.after);
        updateExportInfo();
    }
    function updateExportInfo() {
        if (S.project.kind === 'vanilla' || S.tab !== 'export' || !exportEls.ent) return;
        const P = S.project, built = M.App.exportPreview(), E = exportEls;
        E.ent.innerHTML = '';
        if (!P.entrance) E.ent.append(el('span', null, 'No entrance marked. Use the '), el('b', null, 'Entrance'), el('span', null, ' tool on a door in the Build tab, or the project origin (grid corner 0,0) is placed at the coordinates.'));
        else if (built.entrance && built.entrance.ok) E.ent.append(el('span', null, 'Entrance: '), el('b', null, 'door on level 0 at grid ' + built.entrance.center[0].toFixed(1) + ', ' + built.entrance.center[1].toFixed(1)));
        else E.ent.append(el('b', { style: { color: '#f0a4a3' } }, 'The entrance is not on an outside wall.'));
        const pl = S.project.export.coords ? computePlacement(P, built) : null;
        E.place.textContent = pl ? (pl.error ? pl.error : 'Project origin goes to ' + pl.x.toFixed(2) + ', ' + pl.y.toFixed(2) + ', ' + pl.z.toFixed(2) + ' turned ' + pl.heading.toFixed(1) + '°') : '';
    }

    async function doExport() {
        const P = S.project, X = P.export, E = exportEls;
        const built = Mesher.build(P, { mode: 'export', autoLights: X.autoLights });
        const log = (html, cls) => { E.log.style.display = 'block'; E.log.append(el('div', { class: cls || '' }, html)); E.log.scrollTop = 1e9; };
        E.log.innerHTML = ''; E.after.style.display = 'none';
        if (!built.batches.length) { toast('Nothing to export yet. Build walls and floors first.', 'warn'); return; }
        const pl = computePlacement(P, built); if (pl.error) { toast(pl.error, 'warn'); return; }
        if (!P.prefix) { toast('Give the project a prefix first.', 'warn'); return; }
        const resource = safeRes(X.resource) || ('mlo_' + (safeRes(P.name) || 'house'));
        E.btn.disabled = true; E.btn.textContent = 'Exporting...';
        try {
            log('Meshing: ' + built.stats.tris + ' triangles, ' + built.stats.boxes + ' collision boxes, ' + built.stats.portals + ' portals, ' + built.stats.lights + ' lights');
            if (!built.portals.length) log('Warning: no windows or doors on an outside wall, so the interior is never visible from outside. Add an entrance door.', 'bad');
            const model = Mesher.toExport(P, built, { light: {}, model: { resource, prefix: P.prefix, label: X.label || P.name, timecycle: 'hash_E83C53FC', placement: { x: pl.x, y: pl.y, z: pl.z, heading: pl.heading }, entranceNote: pl.note, outDir: X.outDir || undefined } });
            const res = await Model.api('export', 'POST', model);
            if (!res.ok) { log('Export failed: ' + res.error, 'bad'); console.error(res.detail); }
            else {
                (res.log || []).forEach(l => log(l)); (res.warnings || []).forEach(l => log('Warning: ' + l, 'bad'));
                (res.files || []).forEach(f => log('  ' + f));
                log('Done: ' + res.dir, 'good');
                E.after.style.display = 'flex'; E.after.innerHTML = '';
                E.after.append(el('button', { class: 'btn sm', onclick: () => Model.api('reveal?name=' + encodeURIComponent(res.dir), 'POST') }, 'Open folder'),
                    el('button', { class: 'btn sm', onclick: () => { navigator.clipboard.writeText('ensure ' + res.resource).then(() => toast('Copied: ensure ' + res.resource, 'ok')); } }, 'Copy "ensure ' + res.resource + '"'));
            }
        } catch (err) { log('Export failed: ' + err.message, 'bad'); }
        E.btn.disabled = false; E.btn.textContent = 'Export resource';
    }

    // ---------- left dispatcher ----------
    function renderLeft() {
        const root = $('left'); root.innerHTML = '';
        if (S.project.kind === 'import') { M.ImportUI.renderLeft(root); return; }
        if (S.project.kind === 'vanilla') {
            const V = M.VanillaUI;
            if (S.tab === 'vanilla') V.renderHouse(root); else if (S.tab === 'build') V.renderBuild(root); else if (S.tab === 'paint') V.renderPaint(root); else V.renderExport(root);
            return;
        }
        if (S.tab === 'build') renderBuild(root); else if (S.tab === 'paint') renderPaint(root); else renderExport(root);
    }

    // ---------- right: view & levels ----------
    function renderRight() {
        const root = $('right'), P = S.project; root.innerHTML = '';
        if (P.kind === 'import') { M.ImportUI.renderRight(root); return; }
        if (P.kind === 'vanilla') { M.VanillaUI.renderRight(root); return; }
        root.append(el('div', { class: 'h' }, 'View & Levels'));
        const lv = el('div', { class: 'levels' });
        P.levels.forEach((l, k) => lv.append(el('button', { class: 'lvl' + (S.level === k ? ' on' : ''), onclick: () => M.App.setLevel(k) }, 'L' + k)));
        lv.append(el('button', { class: 'lvl', title: 'Add a level above', onclick: () => { Model.edit(PP => { PP.levels.push(Model.newLevel()); }); M.App.setLevel(P.levels.length - 1); } }, '+'));
        root.append(lv);
        root.append(el('div', { class: 'row wrap', style: { marginTop: '8px' } },
            S.level > 0 ? el('button', { class: 'btn sm', title: 'Copy the walls and floors of the level below onto this level', onclick: () => { Model.edit(PP => { const src = PP.levels[S.level - 1], dst = PP.levels[S.level]; dst.floor = JSON.parse(JSON.stringify(src.floor)); dst.walls = JSON.parse(JSON.stringify(src.walls)); dst.ceil = {}; }); } }, 'Copy level below') : null,
            P.levels.length > 1 && S.level === P.levels.length - 1 ? el('button', { class: 'btn sm danger', onclick: async () => { const L = P.levels[S.level]; if (Object.keys(L.floor).length + Object.keys(L.walls).length > 0 && !(await confirmDlg('Remove level ' + S.level + '?', 'Everything on this level will be deleted. You can undo with Ctrl+Z.', 'Remove', true))) return; Model.edit(PP => { PP.levels.pop(); }); M.App.setLevel(P.levels.length - 1); } }, 'Remove top level') : null));
        root.append(el('div', { class: 'row', style: { marginTop: '8px' } }, el('label', null, 'Level height'), el('input', { type: 'number', class: 'grow', step: '0.1', min: '2.4', max: '5', value: P.settings.storyHeight, onchange: (e) => { const v = Math.min(5, Math.max(2.4, parseFloat(e.target.value) || 3.1)); Model.edit(PP => { PP.settings.storyHeight = v; }); M.App.refreshGrid(); } }), el('span', { class: 'note' }, 'm')));
        const chk = (key, label) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: S.view[key] ? true : null, onchange: (e) => { S.view[key] = e.target.checked; if (key === 'grid') M.App.renderer.showGrid = e.target.checked; } }), label);
        root.append(chk('floor', 'Floors'), chk('walls', 'Walls'), chk('roof', 'Roofs'), chk('grid', 'Grid'), chk('outside', 'Outside shell only (what the game draws from outside)'));
        root.append(el('div', { class: 'row' }, el('label', null, 'Walls'), seg([['up', 'Up'], ['half', 'Half'], ['down', 'Down']], S.view.wallMode, v => { S.view.wallMode = v; M.App.remesh(); renderRight(); })));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.App.toggleTopDown() }, 'Top-down (T)'),
            el('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDlg('Clear level ' + S.level + '?', 'Walls, floors, stairs, roof and lights on this level are removed. You can undo with Ctrl+Z.', 'Clear', true)) Model.edit(PP => { PP.levels[S.level] = Model.newLevel(); if (PP.entrance && PP.entrance.level === S.level) PP.entrance = null; }); } }, 'Clear level')));
        const b = M.App.built; if (b) root.append(el('div', { class: 'h' }, 'Model'), el('div', { class: 'kv' }, 'Triangles', el('b', null, b.stats.tris.toLocaleString()), 'Walls', el('b', null, Object.keys(Model.cur().walls).length), 'Floor cells', el('b', null, Object.keys(Model.cur().floor).length)));
    }

    // ---------- dialogs ----------
    // starting a project: pick the kind, optionally name it
    function newProjectDialog(opts) {
        opts = opts || {};
        const nameIn = el('input', { type: 'text', class: 'grow', placeholder: 'Project name (optional)', maxlength: 60 });
        const create = async (kind) => { const n = nameIn.value.trim() || (kind === 'import' ? 'My Interior' : 'New House'); closeModal(); try { await Model.createProject(n, kind); } catch (e) { toast('Could not create the project: ' + e.message, 'err'); } };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') create('import'); });
        const card = (title, text, kind, primary) => el('button', { class: 'btn' + (primary ? ' primary' : ''), style: { display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginTop: '8px', whiteSpace: 'normal' }, onclick: () => create(kind) },
            el('div', { style: { fontWeight: 700 } }, title), el('div', { style: { fontWeight: 400, fontSize: '12px', opacity: 0.85, marginTop: '3px' } }, text));
        modal(el('div', { class: 'dlg' }, el('h2', null, 'New project'),
            el('div', { class: 'row' }, el('label', null, 'Name'), nameIn),
            card('Interior in an imported model', 'Import a building\'s model files (.ydr, .ytd, .ybn, .ymap), cut doors and windows through its walls, build the rooms inside, place lights and doors. Nothing is generated for you.', 'import', true),
            card('Whole new building', 'Build a new house on a grid: rooms, doors, windows, stairs, levels and a roof.', 'grid', false),
            el('div', { class: 'foot' }, opts.back ? el('button', { class: 'btn', onclick: () => opts.back() }, 'Back') : (opts.noCancel ? el('button', { class: 'btn', onclick: () => projectsDialog() }, 'Open an existing project') : el('button', { class: 'btn', onclick: closeModal }, 'Cancel')))), { sticky: !!(opts.back || opts.noCancel) });
        setTimeout(() => nameIn.focus(), 30);
    }
    // ---------- the project list: cards with a picture, the kind, when it was opened and edited; open, rename, duplicate, delete ----------
    const KIND = { import: 'Interior in an imported model', grid: 'New building', vanilla: 'House (older kind)' };
    function ago(iso) {
        if (!iso) return ''; const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
        if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
        if (s < 172800) return 'yesterday'; if (s < 86400 * 14) return Math.round(s / 86400) + ' days ago'; return d.toLocaleDateString();
    }
    function renameDialog(oldName, done) {
        const nameIn = el('input', { type: 'text', class: 'grow', value: oldName, maxlength: 60 });
        const go = async () => {
            const n = nameIn.value.trim(); if (!n) return;
            try { const r = await Model.renameAny(oldName, n); closeModal(); toast('Renamed to "' + r + '"', 'ok'); } catch (e) { toast('Could not rename: ' + e.message, 'err'); return; }
            done();
        };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        modal(el('div', { class: 'dlg' }, el('h2', null, 'Rename project'), el('div', { class: 'note' }, 'The project, its imported model files and its picture move to the new name.'), el('div', { class: 'row' }, nameIn),
            el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: () => done() }, 'Cancel'), el('button', { class: 'btn primary', onclick: go }, 'Rename'))), { sticky: true });
        setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
    }
    // ctx: current (name of the open project, or ''), open(name), rerender()
    function projectCards(list, ctx) {
        const wrap = el('div', { class: 'plist cards' });
        list.map(p => ({ p, opened: Model.openedAt(p.name) })).sort((a, b) => String(b.opened || b.p.modified).localeCompare(String(a.opened || a.p.modified))).forEach(({ p, opened }) => {
            const isCur = p.name === ctx.current, thumb = p.thumb ? el('img', { class: 'pthumb', src: p.thumb, alt: '' }) : el('div', { class: 'pthumb none' }, 'no picture yet');
            wrap.append(el('div', { class: 'pcard', title: 'Open "' + p.name + '"', onclick: () => ctx.open(p.name) }, thumb,
                el('div', { class: 'pinfo' }, el('div', { class: 'pname' }, p.name, isCur ? el('span', { class: 'chip' }, 'open now') : null), el('div', { class: 'note' }, KIND[p.kind] || 'Project'),
                    el('div', { class: 'note' }, (opened ? 'Opened ' + ago(opened) + '  ·  ' : '') + 'Edited ' + ago(p.modified))),
                el('div', { class: 'pbtns' },
                    el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); renameDialog(p.name, ctx.rerender); } }, 'Rename'),
                    el('button', { class: 'btn sm', onclick: async (e) => { e.stopPropagation(); try { const n = await Model.duplicate(p.name); toast('Created "' + n + '"', 'ok'); } catch (err) { toast('Could not copy it: ' + err.message, 'err'); } ctx.rerender(); } }, 'Duplicate'),
                    el('button', { class: 'btn sm danger', disabled: isCur ? true : null, title: isCur ? 'Open another project first' : 'Delete this project', onclick: async (e) => {
                        e.stopPropagation();
                        if (await confirmDlg('Delete "' + p.name + '"?', 'The project file is removed. A copy is kept as .deleted in the projects folder.', 'Delete', true)) { try { await Model.deleteProject(p.name); } catch (err) { toast('Could not delete it: ' + err.message, 'err'); } }
                        ctx.rerender();
                    } }, 'Delete'))));
        });
        if (!list.length) wrap.append(el('div', { class: 'note' }, 'No projects yet.'));
        return wrap;
    }
    // the first thing you see: nothing is opened until you choose (unless you tick the box to reopen the last project)
    async function startDialog() {
        let list = []; try { list = await Model.listProjects(); } catch (e) { toast(e.message, 'err'); }
        let auto = false; try { auto = localStorage.getItem('mlo.autoopen') === '1'; } catch (e) { }
        const plist = projectCards(list, { current: '', rerender: startDialog, open: async (name) => { closeModal(); try { await Model.openProject(name); } catch (e) { toast('Could not open it: ' + e.message, 'err'); startDialog(); } } });
        modal(el('div', { class: 'dlg wide' }, el('h2', null, 'MLO Creator'), el('div', { class: 'note' }, list.length ? 'Open a project, or start a new one.' : 'Start your first project.'), plist,
            el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: auto ? true : null, onchange: (e) => { try { localStorage.setItem('mlo.autoopen', e.target.checked ? '1' : '0'); } catch (err) { } } }), 'Open the last project automatically when the program starts'),
            el('div', { class: 'foot' }, el('button', { class: 'btn primary', onclick: () => newProjectDialog({ back: startDialog }) }, 'New project...'))), { sticky: true });
    }
    // a copy of the open project (with its imported files) under another name; the copy is opened
    function saveAsDialog() {
        const nameIn = el('input', { type: 'text', class: 'grow', value: S.project.name + ' copy', maxlength: 60 });
        const go = async () => { const n = nameIn.value.trim(); if (!n) return; closeModal(); try { const r = await Model.saveAs(n); toast('Saved as "' + r + '"', 'ok'); } catch (e) { toast('Could not save: ' + e.message, 'err'); } };
        nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        modal(el('div', { class: 'dlg' }, el('h2', null, 'Save as'), el('div', { class: 'note' }, 'Saves a copy of this project, with its imported files, under a new name and switches to the copy.'), el('div', { class: 'row' }, nameIn),
            el('div', { class: 'foot' }, el('button', { class: 'btn', onclick: closeModal }, 'Cancel'), el('button', { class: 'btn primary', onclick: go }, 'Save as'))));
        setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
    }
    async function projectsDialog() {
        try { await Model.saveThumb(true); } catch (e) { }                     // so the open project's picture shows what is on screen now
        let list = []; try { list = await Model.listProjects(); } catch (e) { toast(e.message, 'err'); }
        const plist = projectCards(list, { current: Model.safeName(S.project.name), rerender: projectsDialog, open: async (name) => { closeModal(); try { await Model.openProject(name); } catch (e) { toast('Could not open it: ' + e.message, 'err'); } } });
        modal(el('div', { class: 'dlg wide' }, el('h2', null, 'Projects'), plist,
            el('div', { class: 'foot' }, el('button', { class: 'btn primary', onclick: () => newProjectDialog() }, 'New project...'), el('button', { class: 'btn', title: 'Save a copy of the open project under another name', onclick: () => saveAsDialog() }, 'Save as...'), el('button', { class: 'btn', onclick: closeModal }, 'Close'))));
    }
    function helpDialog() {
        const rows = [['Left mouse', 'Use the current tool'], ['Middle-drag / right-drag', 'Orbit the camera (like Blender)'], ['Shift+middle-drag / Shift+right-drag', 'Pan'], ['Ctrl+middle-drag / wheel', 'Zoom'], ['Keypad 1 / 3 / 7', 'Front / right / top view (Ctrl: opposite side). Home: frame everything'], ['G / J / H', 'Imported-model projects: raise or lower the rooms, fill gaps, stand a 1.8 m figure in the scene (R turns it)'], ['C', 'Imported-model projects: cutaway, hides the roof and upper walls of the model (it also happens by itself with the Door and Window tools)'], ['V, then click a room', 'Drag an edge or corner to resize, the inside to move (Shift: no snapping). Del or X removes it, Esc deselects'], ['W A S D / arrows', 'Move the camera'], ['Q / E', 'Turn the view 90°'], ['T', 'Top-down view'],
            ['PageUp / PageDown', 'Next / previous level  ( ] and [ too )'], ['1 … 9, 0, X, P', 'Tools: wall, room, floor, door, window, archway, stairs, roof, light, entrance, eraser, paint'], ['O / L / F', 'Imported-model projects: frame tool, light, delete faces (1-7, V, X, P as in the panel)'], ['R', 'Turn the stairs'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S', 'Save now (it also saves by itself)'], ['Esc', 'Cancel a drag']];
        const g = el('div', { class: 'helpgrid' }); rows.forEach(r => g.append(el('div', null, r[0]), el('div', null, r[1])));
        modal(el('div', { class: 'dlg' }, el('h2', null, 'How it works'), el('div', { class: 'note' }, 'Two kinds of project. "Interior in an imported model": import the building\'s model files (.ydr, .ytd, .ybn, .ymap), set the grid on its floor, cut doors and windows through its walls with boxes (the triangles inside them are removed, like a boolean in Blender), delete fake doors and walls face by face, draw the rooms, place the lights and paint. Nothing is built for you. "Whole new building": build on a grid like a house builder (rooms, doors, windows, stairs, levels, roof). Either way Export writes a FiveM resource folder you upload to your server.'), g,
            el('div', { class: 'foot' }, el('button', { class: 'btn primary', onclick: closeModal }, 'Got it'))));
    }

    UI.renderAll = function () { renderTop(); renderLeft(); renderRight(); renderBench(); document.body.classList.toggle('paint', S.tab === 'paint'); };
    UI.renderTop = renderTop; UI.renderRight = renderRight; UI.renderLeft = renderLeft; UI.renderBench = renderBench; UI.updateExportInfo = updateExportInfo;
    UI.addUserImage = addUserImage; UI.newProjectDialog = newProjectDialog; UI.startDialog = startDialog; UI.saveAsDialog = saveAsDialog; UI.projectsDialog = projectsDialog; UI.helpDialog = helpDialog; UI.confirm = confirmDlg; UI.toast = toast; UI.closeModal = closeModal; UI.modal = modal;
    UI.kit = { stepper, seg, swatchEl, confirm: confirmDlg };
    UI.updateShellInfo = function () { if (M.VanillaUI && S.project.kind === 'vanilla' && S.tab === 'export') M.VanillaUI.updatePlace(); };
    M.UI = UI;
})(window.MLO);

