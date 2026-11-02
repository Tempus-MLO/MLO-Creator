// Start-up and the main loop.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model, Mesher, UI, Tools } = M, S = Model.state, bus = Model.bus, $ = (id) => document.getElementById(id);
    const App = M.App = { built: null, renderer: null, refBatches: [] };
    let remeshQueued = false, gridCenter = [0, 0], lastTime = performance.now();

    const isVanilla = () => S.project.kind === 'vanilla';
    const isImport = () => S.project.kind === 'import';
    const isShell = () => isVanilla() || isImport();
    const levelZ = () => isShell() ? 0 : S.level * S.project.settings.storyHeight;

    function f32(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); }

    // the grabbed house as flat-coloured triangle batches, and its collision as line sets
    App.rebuildRef = function () {
        App.refBatches = []; const R = App.renderer, ref = S.ref;
        if (!ref) { R.setStaticLines('collision', null, [1, 0.5, 0.3, 0.6], false); return; }
        (ref.ref || []).forEach(g => {
            const p = f32(g.pos), nt = p.length / 9, CH = 20000;
            for (let t0 = 0; t0 < nt; t0 += CH) {
                const n = Math.min(CH, nt - t0), pos = p.subarray(t0 * 9, (t0 + n) * 9), nrm = new Float32Array(n * 9), idx = new Uint16Array(n * 3);
                for (let t = 0; t < n; t++) {
                    const o = t * 9, ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
                    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
                    for (let k = 0; k < 3; k++) { nrm[o + k * 3] = nx; nrm[o + k * 3 + 1] = ny; nrm[o + k * 3 + 2] = nz; idx[t * 3 + k] = t * 3 + k; }
                }
                App.refBatches.push({ level: 0, kind: 'ref', group: 'ref', tex: '', flat: g.color, alpha: 1, noCull: true, pos: new Float32Array(pos), nrm, uv: new Float32Array(n * 6), idx });
            }
        });
        const lines = [], c = ref.collision;
        if (c) {
            const t = f32(c.tris); for (let i = 0; i + 8 < t.length; i += 9) for (let k = 0; k < 3; k++) { const a = i + k * 3, b = i + ((k + 1) % 3) * 3; lines.push(t[a], t[a + 1], t[a + 2], t[b], t[b + 1], t[b + 2]); }
            const bx = f32(c.boxes); for (let i = 0; i + 5 < bx.length; i += 6) {
                const x0 = bx[i], y0 = bx[i + 1], z0 = bx[i + 2], x1 = bx[i + 3], y1 = bx[i + 4], z1 = bx[i + 5], cs = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
                [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => lines.push(...cs[e[0]], ...cs[e[1]]));
            }
        }
        R.setStaticLines('collision', new Float32Array(lines), [1.0, 0.55, 0.25, 0.55], S.showCollision);
    };

    App.remesh = function () {
        if (isImport()) {
            const I = S.project.import, fk = JSON.stringify(I.frame), IM = M.ImportModel;
            // openings made from faces read their size and place from the model again when the grid moved
            if (IM.loaded && IM._syncKey !== fk) { IM._syncKey = fk; IM.syncFaceCutters(); }
            const ck = JSON.stringify([I.frame, I.target, I.cutters, I.deletes, I.fills, IM.clearKey()]);      // (the rooms clear parts of the model too, so they are part of the cut)
            App.built = M.Shell.build(S.project, { boxes: true });          // (with the collision boxes, for the "my collision" outline)
            App.renderer.setBatches(App.built.batches.concat(IM.doorBatches(), M.FitModels.batches()));
            // the imported model only changes with the grid (frame) or with cutters / deleted faces
            const md = I.mdeletes || [], bk = JSON.stringify([I.building, I.iso, md.length, md[md.length - 1]]), again = fk !== App._fk || bk !== App._bk;
            if (bk !== App._bk && IM.loaded) IM.rebuildMembers();
            const pk = M.Plants ? M.Plants.stateKey() : '';                  // (the plant models shown in the view follow the ticks and the rooms)
            App._fk = fk; App._bk = bk; if (again && IM.loaded) IM.rebuild(); else if (pk !== App._pk && IM.loaded && M.Plants && M.Plants.shows()) IM.rebuild();
            App._pk = pk;
            if (ck !== App._ck) { App._ck = ck; IM.requestCut(); IM.requestCollision(); }
            const rk = JSON.stringify([S.project.shell.ops, S.project.settings.ceilH, I.clearCollision, I.entity, I.colDeletes]);      // the rooms are cut out of the collision: it changes when they do
            if (rk !== App._rk) { App._rk = rk; if (IM.loaded) IM.requestCollision(); }
        } else if (isVanilla()) {
            App.built = M.Shell.build(S.project, {});
            App.renderer.setBatches(App.built.batches.concat(App.refBatches));
        } else {
            App.built = Mesher.build(S.project, { wallMode: S.view.wallMode });
            App.renderer.setBatches(App.built.batches);
        }
        $('stats').textContent = App.bname() + App.built.stats.tris.toLocaleString() + ' triangles';
    };
    // "Building 2 · " in the status line when the project has several buildings
    App.bname = function () { if (!isImport()) return ''; const l = Model.bldAll(S.project); return l.length > 1 ? (l.find(b => b.active) || l[0]).name + ' · ' : ''; };
    function queueRemesh() { if (remeshQueued) return; remeshQueued = true; requestAnimationFrame(() => { remeshQueued = false; App.remesh(); UI.renderRight(); UI.updateExportInfo(); UI.updateShellInfo && UI.updateShellInfo(); }); }

    App.refreshGrid = function () {
        const c = App.renderer.camera; gridCenter = [Math.round(c.target[0]), Math.round(c.target[1])];
        App.renderer.setGrid(levelZ() + 0.004, 30, gridCenter[0], gridCenter[1]);
    };
    App.refreshPanels = function () { UI.renderLeft(); UI.renderBench(); UI.renderRight(); };
    App.setTab = function (tab) {
        const previousTab = S.tab;
        S.tab = tab; M.Errors.crumb('tab ' + tab);
        if (isShell()) { if (tab === 'paint') { S.shellTool = 'paint'; S.benchSel = S.brush[S.paintTarget]; } else if (S.shellTool === 'paint') S.shellTool = 'room'; }
        else if (tab === 'paint') { S.tool = 'paint'; S.benchSel = S.brush[S.paintTarget]; }
        else if (S.tool === 'paint') S.tool = 'wall';
        if (isImport()) {
            if (tab === 'furnish') { if (previousTab !== 'furnish') S.furnishBuildTool = S.shellTool; S.shellTool = 'fit'; }
            else if (previousTab === 'furnish' && tab !== 'paint') S.shellTool = S.furnishBuildTool || 'room';
            if (M.FitModels) M.FitModels.changeScope(previousTab, tab);
        }
        Tools.cancel(); M.ShellTools.cancel(); UI.renderAll(); UI.renderTop();
    };
    App.setTool = function (tool) {
        M.Errors.crumb('tool ' + tool);
        if (isShell()) {
            const ok = isImport() ? ['building', 'frame', 'level', 'room', 'cut', 'fill', 'part', 'door', 'window', 'arch', 'floor', 'light', 'figure', 'faces', 'edges', 'parts', 'collision', 'cbox', 'walk', 'fit', 'plants', 'select', 'eraser', 'paint'] : ['room', 'cut', 'part', 'door', 'window', 'arch', 'floor', 'select', 'eraser', 'paint'];
            if (ok.indexOf(tool) < 0) return;
            if (tool === 'paint') { S.shellTool = 'paint'; App.setTab('paint'); return; }
            if (tool === 'collision' && isImport() && !S.showCollision) { S.showCollision = true; M.ImportModel.requestCollision(); M.UI.renderRight(); }       // the pieces to pick are the orange lines
            if (tool !== 'select') S.opSel = null;
            S.shellTool = tool; const targetTab = tool === 'fit' && S.tab === 'furnish' ? 'furnish' : 'build'; if (S.tab !== targetTab) { const previousTab = S.tab; S.tab = targetTab; if (M.FitModels) M.FitModels.changeScope(previousTab, targetTab); } M.ShellTools.cancel(); if (isImport() && M.Plants) M.Plants.toolChanged(); UI.renderAll(); return;
        }
        if (tool === 'paint') { S.tool = 'paint'; App.setTab('paint'); return; }
        S.tool = tool; if (S.tab !== 'build') S.tab = 'build';
        if (tool === 'roof') S.view.roof = true;
        Tools.cancel(); UI.renderAll();
    };
    App.setLevel = function (n) {
        if (isShell()) return;
        n = Math.max(0, Math.min(S.project.levels.length - 1, n)); S.level = n; App.refreshGrid(); Tools.cancel(); UI.renderRight(); UI.renderLeft();
    };
    App.toggleTopDown = function () {
        const c = App.renderer.camera;
        if (c.pitch > 1.5) { c.pitch = App._pp || 0.87; if (App._py != null) c.yaw = App._py; }
        else { App._pp = c.pitch; App._py = c.yaw; c.pitch = 1.553; c.yaw = -Math.PI / 2; }
    };
    // the camera over the interior that is being drawn
    App.frameInterior = function () {
        const b = App.built && App.built.bounds, c = App.renderer.camera;
        if (!b || b.mn[0] > b.mx[0]) { c.target = [0, 0, 1]; c.dist = 14; }
        else { c.target = [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, 1]; c.dist = Math.max(10, Math.max(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1]) * 1.5 + 6); }
        App.refreshGrid();
    };
    App.frameAll = function () {
        if (isImport()) {
            // the selected building when one is singled out, else the whole model
            const IM = M.ImportModel, one = IM.isolating(), mb = IM.bounds(one), c = App.renderer.camera;
            if (mb) { c.target = [(mb.mn[0] + mb.mx[0]) / 2, (mb.mn[1] + mb.mx[1]) / 2, one ? 1 : 0]; const ext = Math.max(mb.mx[0] - mb.mn[0], mb.mx[1] - mb.mn[1]); c.dist = one ? Math.min(160, Math.max(14, ext * 1.5 + 4)) : Math.min(160, Math.max(30, ext * 1.1)); App.refreshGrid(); return; }
            App.frameInterior(); return;
        }
        const b = App.built && App.built.bounds, c = App.renderer.camera;
        if (!b || b.mn[0] > b.mx[0]) { c.target = [0, isVanilla() ? 4 : 0, 0]; c.dist = isVanilla() ? 16 : 18; }
        else { c.target = [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, 1]; c.dist = Math.max(isVanilla() ? 12 : 14, Math.max(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1]) * 1.5 + 6); }
        App.refreshGrid();
    };
    App.exportPreview = function () { return App.built || { entrance: null, stats: {} }; };

    function visible(b) {
        if (b.kind === 'ref') { if (S.refMode === 'off') return false; b.alpha = S.refMode === 'ghost' ? 0.2 : 1; return true; }
        if (b.kind === 'model') return S.refMode !== 'off';
        if (b.level > S.level) return false;
        if (S.view.outside && b.group !== 'ext') return false;
        switch (b.kind) {
            case 'floor': case 'stair': return S.view.floor;
            case 'wall': case 'glass': return S.view.walls;
            case 'roof': return S.view.roof;
        }
        return true;
    }

    function frame(now) {
        const dt = Math.min(0.05, (now - lastTime) / 1000); lastTime = now;
        // the next frame is always asked for first: an error in a tool's overlay must never stop the view
        requestAnimationFrame(frame);
        try { Tools.tick(dt); Tools.draw(); } catch (e) { M.Errors.report('overlay', e); M.App.renderer.ovClear(); }
        try { M.Hints.update(); } catch (e) { M.Errors.report('hint', e, { quiet: true }); }
        const c = App.renderer.camera;
        if (Math.abs(c.target[0] - gridCenter[0]) > 12 || Math.abs(c.target[1] - gridCenter[1]) > 12) App.refreshGrid();
        App.renderer.staticOn('collision', S.showCollision);
        if (isImport()) {
            // only the part of the model near where the camera looks, and below the chosen height
            const IM = M.ImportModel, t = c.target; IM.applyCut();
            App.renderer.clip = (IM.clipOn || IM.clipZ < 1e8) ? { cx: t[0], cy: t[1], r: IM.clipOn ? IM.clipR : 100000, zmax: IM.clipZ } : null;
        } else App.renderer.clip = null;
        App.renderer.render(visible);
    }

    // nothing is opened or created by itself: the start screen lists the projects (unless the user ticked "open the last project automatically")
    async function startProject() {
        let name = null, auto = false; try { name = localStorage.getItem('mlo.last'); auto = localStorage.getItem('mlo.autoopen') === '1'; } catch (e) { }
        if (auto && name) { try { await Model.openProject(name); return; } catch (e) { /* the last project is gone: show the start screen */ } }
        Model.state.project = Model.newProject('New House', 'grid'); bus.emit('project');          // an empty page behind the start screen, never saved
        UI.startDialog();
    }

    function onProject() {
        const IM = M.ImportModel;
        if (isImport()) {
            S.view.roof = false; S.view.floor = true; S.view.walls = true; App.renderer.showGrid = S.view.grid;
            if (!S.shellTool) S.shellTool = 'room';
            App.rebuildRef();
            // undo / redo send the same project again: only a different project (or a changed file list) needs the files read again
            if (App._impName !== S.project.name) {
                if (S.shellTool === 'select') S.shellTool = 'room'; S.opSel = null; S.figure = null;
                App._impName = S.project.name; App._fk = null; App._ck = null; App._bk = null; IM.reset();
                App.remesh(); UI.renderAll();
                IM.load().then(() => { App.remesh(); App.frameAll(); UI.renderAll(); if (S.showCollision) IM.requestCollision(); });
            } else { App.remesh(); UI.renderAll(); }
            return;
        }
        App._impName = null;
        if (isVanilla()) { S.view.roof = false; S.view.floor = true; S.view.walls = true; App.renderer.showGrid = S.view.grid; }
        else if (S.tab === 'vanilla' || S.tab === 'import' || S.tab === 'furnish') S.tab = 'build';
        if (IM.models.length) IM.reset();
        App.rebuildRef(); App.remesh(); App.frameAll(); UI.renderAll();
    }

    App.init = async function () {
        const canvas = $('gl');
        try { App.renderer = new M.Renderer(canvas); } catch (e) { document.body.append(M.el('div', { style: { padding: '30px' } }, 'WebGL is not available: ' + e.message)); return; }
        App.canvas = canvas; App.labelEl = $('hudlabel');
        Tools.init(App);
        bus.on('change', () => { queueRemesh(); UI.renderTop(); });
        bus.on('saved', () => UI.renderTop());
        bus.on('tooloptions', () => App.refreshPanels());
        bus.on('shellsel', () => UI.renderLeft());
        bus.on('cutsel', () => UI.renderLeft());
        bus.on('importstatus', () => { UI.renderRight(); if (S.tab === 'import') UI.renderLeft(); });
        // another building became the one being worked on (switched to, added or deleted): its grid, rooms and selection are the live ones now
        bus.on('buildings', () => {
            if (!isImport()) return;
            M.ImportTools.cancel(); if (M.Walk) { M.Walk.clear(); M.Walk.start = null; }
            App.remesh(); if (M.ImportModel.loaded) App.frameAll(); UI.renderAll();
        });
        bus.on('importmesh', () => { UI.renderRight(); if (M.ImportModel.stats) $('stats').textContent = App.bname() + (App.built ? App.built.stats.tris.toLocaleString() : '0') + ' interior triangles · model ' + M.ImportModel.stats.after.toLocaleString(); });
        // model files dropped onto the window
        window.addEventListener('dragover', e => { if (isImport()) e.preventDefault(); });
        window.addEventListener('drop', e => { if (!isImport()) return; e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) M.ImportUI.dropFiles(Array.from(e.dataTransfer.files)); });
        bus.on('project', onProject);
        bus.on('hint', (h) => { $('hint').textContent = 'Level ' + S.level + '  ·  cell ' + h.cx + ', ' + h.cy; });
        $('b-undo').onclick = () => Model.undo(); $('b-redo').onclick = () => Model.redo();
        $('b-new').onclick = () => UI.newProjectDialog(); $('b-projects').onclick = () => UI.projectsDialog();
        $('b-save').onclick = async () => { try { await Model.save(); if (S.project.kind === 'import' && S.ref) await Model.saveRef(); UI.toast('Saved "' + S.project.name + '"', 'ok'); } catch (e) { UI.toast('Save failed: ' + e.message, 'err'); } }; $('b-export').onclick = () => App.setTab('export');
        $('helpbtn').onclick = () => UI.helpDialog();
        window.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); UI.helpDialog(); } });
        const pn = $('projname');
        pn.addEventListener('change', async () => { try { await Model.renameProject(pn.value); } catch (e) { UI.toast(e.message, 'err'); } pn.value = S.project.name; });
        pn.addEventListener('keydown', e => { if (e.key === 'Enter') pn.blur(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden && !S.saved) Model.save().catch(() => { }); });
        window.addEventListener('resize', () => App.renderer.resize());
        setInterval(() => { Model.api('ping').catch(() => { }); }, 4000);

        try { await M.TEX.loadPhotos(); } catch (e) { /* the photo floors are missing: the generated ones still work */ }
        try { await startProject(); } catch (e) { UI.toast('Could not load a project: ' + e.message, 'err'); Model.state.project = Model.newProject('New House'); bus.emit('project'); }
        UI.renderAll(); App.refreshGrid();
        requestAnimationFrame(frame);
        try { if (!localStorage.getItem('mlo.helped') && $('modal').hidden) { localStorage.setItem('mlo.helped', '1'); UI.helpDialog(); } } catch (e) { }
    };

    window.addEventListener('load', () => { App.init().catch(e => { console.error(e); document.body.append(M.el('pre', { style: { padding: '20px', color: '#f88' } }, String(e.stack || e))); }); });
})(window.MLO);
