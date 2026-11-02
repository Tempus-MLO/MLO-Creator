// Tools for projects built inside an imported model: frame, door / window / archway cutters, deleting faces, lights, select and erase.
// Rooms, partitions, floor paint and wall paint come from ShellTools. Nothing here places anything by itself: every cutter, light and
// deleted face comes from a click.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, bus = Model.bus, SH = M.ShellTools, IM = M.ImportModel;
    const C = { cut: [0.95, 0.55, 0.25, 0.30], cutEdge: [1, 0.8, 0.45, 0.95], sel: [0.35, 0.9, 0.55, 0.38], selEdge: [1, 1, 1, 0.95], thin: [0.95, 0.7, 0.4, 0.55], bad: [0.92, 0.35, 0.3, 0.45], face: [0.95, 0.3, 0.3, 0.55], amber: [1, 0.75, 0.25, 0.9], hov: [1, 0.9, 0.4, 0.5] };
    const DEF = { door: { w: 1.0, h: 2.1, zb: 0, d: 0.8 }, window: { w: 1.2, h: 1.2, zb: 0.9, d: 0.8 }, arch: { w: 1.6, h: 2.3, zb: 0, d: 0.8 } };
    const NAMES = { door: 'Door', window: 'Window', arch: 'Archway', cut: 'Cutter' };
    const api = () => M.Tools.api;
    const imp = () => S.project.import;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const randId = () => Math.random().toString(36).slice(2, 6);
    let labelFn = null, hover = null, drag = null, lastEvt = null, patchCache = null, fpatchCache = null, lvl = null, gapCache = null, rd = null, fd = null, cbd = null;
    const label = (t, at) => { if (labelFn) labelFn(t, at); };

    // ---------- cutters ----------
    function boxHit(ray, k, dx, dy, dz) {
        // the ray in the cutter's own axes (u = width, n = depth)
        const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), c = [k.cx + (dx || 0), k.cy + (dy || 0), k.zb + (dz || 0) + k.h / 2];
        const o = [ray.o[0] - c[0], ray.o[1] - c[1], ray.o[2] - c[2]];
        const lo = [o[0] * cs + o[1] * sn, -o[0] * sn + o[1] * cs, o[2]], ld = [ray.d[0] * cs + ray.d[1] * sn, -ray.d[0] * sn + ray.d[1] * cs, ray.d[2]];
        return api().rayBox({ o: lo, d: ld }, [-k.w / 2, -k.d / 2, -k.h / 2], [k.w / 2, k.d / 2, k.h / 2]);
    }
    function pickCutter(ray) {
        let best = null; imp().cutters.forEach(k => { const t = boxHit(ray, k); if (t != null && (!best || t < best.t)) best = { t, k }; }); return best;
    }
    function findCutter(id) { return imp().cutters.find(k => k.id === id) || null; }
    function selectCutter(id) { S.cutSel = id; S.shellSel = null; bus.emit('cutsel'); bus.emit('shellsel'); }

    function updateCutter(id, fn) { Model.edit(P => { const k = P.import.cutters.find(q => q.id === id); if (k) fn(k); }); }

    // where a new cutter goes for the surface under the pointer: on the model, or on a wall of the interior
    function surfaceAt(ray) {
        const mh = IM.pick(ray), sp = SH.pick(ray);
        if (sp && sp.kind === 'part' && (!mh || sp.t < mh.t)) return { part: sp };
        if (sp && sp.kind === 'seg' && (!mh || sp.t < mh.t + 0.05)) {
            const sg = sp.sg, n = sg.o === 'H' ? [0, sg.inward] : [sg.inward, 0];
            return { p: [sp.px, sp.py, 1.0], n, shell: true };
        }
        if (mh) return { p: mh.p, n: mh.n, shell: false, mh };
        return null;
    }
    function newCutter(type, s) {
        let d = DEF[type]; const nh = Math.hypot(s.n[0], s.n[1]); if (nh < 0.5) return null;
        // a door cutter takes the size of the door model, when one is chosen
        const ds = type === 'door' ? IM.doorSize() : null; if (ds) d = { w: Math.round((ds.w + 0.04) * 100) / 100, h: Math.round((ds.h + 0.02) * 100) / 100, zb: 0, d: 0.8 };
        const nx = s.n[0] / nh, ny = s.n[1] / nh; let yaw = Math.atan2(-nx, ny);
        const deg = yaw * 180 / Math.PI, q = ((deg % 90) + 90) % 90; if (Math.min(q, 90 - q) < 1.5) yaw = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
        const cx = s.p[0] - nx * (d.d / 2 - 0.2), cy = s.p[1] - ny * (d.d / 2 - 0.2), u = [Math.cos(yaw), Math.sin(yaw)];
        // along the wall it snaps to 5 cm; across the wall the point on the surface stays
        const al = (cx * u[0] + cy * u[1]), alS = Math.round(al / 0.05) * 0.05, sx = cx + (alS - al) * u[0], sy = cy + (alS - al) * u[1];
        const k = { id: randId(), type, cx: r3(sx), cy: r3(sy), zb: d.zb, w: d.w, h: d.h, d: d.d, yaw: r3(yaw) };
        if (ds && imp().placeDoors !== false) { k.leaf = true; k.flip = false; k.lo = 0; }
        return k;
    }

    // ---------- pointer ----------
    function scan(e) {
        const ray = api().pointerRay(e), t = S.shellTool; lastEvt = e;
        hover = { ray, tool: t };
        if (t === 'arch') { hover.cut = pickCutter(ray); hover.surf = surfaceAt(ray); }
        else if (t === 'door' || t === 'window') {
            // the faces of the model under the pointer: the flat patch around the face (Shift: just that triangle)
            hover.cut = pickCutter(ray); const o = IM.pickOriginal(ray); hover.face = o;
            if (o) { const key = o.g + ':' + o.tri + ':' + (e.shiftKey ? 1 : 0); if (!patchCache || patchCache.key !== key) patchCache = { key, g: o.g, tris: e.shiftKey ? [o.tri] : IM.flatPatch(o.g, o.tri) }; hover.patch = patchCache; } else patchCache = null;
        }
        else if (t === 'select' || t === 'eraser') {
            hover.cut = pickCutter(ray);
            if (t === 'select' && !rd) {
                const p = groundRaw(e), so = S.project.shell.ops[S.opSel]; hover.rp = p; hover.rh = (p && so) ? handleAt(so.r, p) : null; hover.ri = p ? roomPick(p) : -1;
            }
        }
        else if (t === 'frame') { hover.mh = IM.pick(ray); }
        else if (t === 'building') { hover.pc = IM.pickComponent(ray); }
        else if (t === 'faces' || t === 'parts') {
            // the building and, when they are shown, its detail models. Delete faces: the flat patch (Shift: one face, Alt: the whole connected piece)
            const o = IM.pickOriginal(ray, { details: true }); hover.face = o;
            if (o && t === 'faces') { const mode = e.altKey ? 'island' : ((e.ctrlKey || e.metaKey) ? 'one' : 'flat'), key = o.file + ':' + o.g + ':' + o.tri + ':' + mode; if (!fpatchCache || fpatchCache.key !== key) fpatchCache = { key, file: o.file, mode, groups: facePatch(o, mode) }; hover.fpatch = fpatchCache; } else fpatchCache = null;
        }
        else if (t === 'edges') { hover.edge = pickEdge(ray); }
        else if (t === 'collision') { hover.col = colPick(ray); if (!IM.colPolys && !IM._colLoading) IM.colPolysLoad().then(() => M.UI.renderLeft()); }
        else if (t === 'cbox') { if (!cbd) { hover.cb = cbPick(ray); const one = cbOne(); hover.cbm = one ? cbHandleAt(one, e) : null; } }
        else if (t === 'walk') { hover.wp = groundRaw(e); }
        else if (t === 'fit') { M.FitModels.scan(e, ray); }
        else if (t === 'plants') { M.Plants.tool.scan(e, ray); }
        else if (t === 'light') { const g = SH.ground(e); hover.g = g; }
        else if (t === 'level') { hover.mh = IM.pick(ray); hover.gz = !lvl && gizmoHit(ray); }
        else if (t === 'fill') { hover.g = SH.ground(e); hover.shift = !!e.shiftKey; }
        else if (t === 'figure') { hover.fs = M.Figure.spot(ray, IM.pick); hover.fh = M.Figure.hit(ray, S.figure, api().rayBox); }
    }

    function down(e) {
        const t = S.shellTool; scan(e);
        if (t === 'level') { levelDown(e); return; }
        if (t === 'fill') { fillDown(); return; }
        if (t === 'edges') { edgesDown(e); return; }
        if (t === 'figure') { figureDown(); return; }
        if (t === 'door' || t === 'window') { faceOpeningDown(t, e); return; }
        if (t === 'arch') {
            const s = hover.surf, ch = hover.cut;
            if (ch && (!s || s.part || ch.t < (s.mh ? s.mh.t : 1e9) + 0.3)) { selectCutter(ch.k.id); startDrag(ch.k, e); return; }
            if (!s) return;
            if (s.part) { SH.down(e); return; }
            const k = newCutter(t, s); if (!k) { toast('Click a wall: the cutter goes through it.', 'warn'); return; }
            Model.edit(P => { P.import.cutters.push(k); }); selectCutter(k.id); return;
        }
        if (t === 'select') {
            if (hover.cut) { S.opSel = null; selectCutter(hover.cut.k.id); startDrag(hover.cut.k, e); return; }
            S.cutSel = null;
            if (S.opSel != null && roomDown(e, true)) return;                     // a handle of the selected room
            SH.down(e);                                                           // a partition or an opening
            if (S.shellSel) { S.opSel = null; bus.emit('cutsel'); return; }
            if (!roomDown(e, false)) bus.emit('cutsel');                          // a room, or nothing
            return;
        }
        if (t === 'eraser') {
            if (hover.cut) { const id = hover.cut.k.id; Model.edit(P => { IM.removeCutterIn(P, id); }); if (S.cutSel === id) S.cutSel = null; bus.emit('cutsel'); return; }
            const g = SH.ground(e);
            if (g) { const i = (S.project.shell.lights || []).findIndex(l => Math.hypot(l.x - g.rx, l.y - g.ry) < 0.45); if (i >= 0) { Model.edit(P => { P.shell.lights.splice(i, 1); }); return; } }
            SH.down(e); return;
        }
        if (t === 'frame') { frameClick(e); return; }
        if (t === 'building') { buildingClick(e); return; }
        if (t === 'faces') { fdrag = { x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }; return; }       // the click or the box is decided on release
        if (t === 'collision') { fdrag = { x: e.clientX, y: e.clientY, moved: false, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, col: true }; return; }
        if (t === 'cbox') { cbDown(e); return; }
        if (t === 'fit') { M.FitModels.down(e); return; }
        if (t === 'plants') { M.Plants.tool.down(e); return; }
        if (t === 'walk') { const p = hover.wp; if (p) M.Walk.setStart(p[0], p[1]); else toast('Click the floor of a room to start the walk there.', 'warn'); return; }
        if (t === 'parts') {
            const o = hover.face; if (!o) { S.partSel = null; M.UI.renderLeft(); return; }
            S.partSel = { f: o.file, g: o.g }; M.UI.renderLeft(); return;
        }
        if (t === 'light') {
            const g = hover.g; if (!g) return;
            Model.edit(P => {
                const L = P.shell.lights = P.shell.lights || [], i = L.findIndex(l => Math.hypot(l.x - g.rx, l.y - g.ry) < 0.45);
                if (i >= 0) L.splice(i, 1); else L.push({ x: r3(Math.round(g.rx / 0.05) * 0.05), y: r3(Math.round(g.ry / 0.05) * 0.05) });
            });
            return;
        }
        SH.down(e);
    }

    // select a building: it is singled out, the grid is squared to its walls and centered on it
    async function buildingClick(e) {
        const h = hover.pc; if (!h || h.comp < 0) { toast('Click a building of the model.', 'warn'); return; }
        const P = S.project, add = !!(e.shiftKey && IM.selComps), cur = Model.bldAll(P).find(b => b.active);
        // what the building being worked on holds (the deleted faces are shared by all the buildings)
        const content = P.shell.ops.length || P.shell.parts.length || P.import.cutters.length || (P.shell.lights || []).length || (P.import.cboxes || []).length;
        // another building than the one being worked on, while that one already has rooms: the one clicked gets a building of its own
        let isNew = false;
        if (!add && content && !(IM.selComps && IM.selComps.has(h.comp))) {
            const ok = await M.UI.confirm('Start a new building?', '"' + cur.name + '" already has rooms and openings. The building you clicked gets its own grid, rooms, openings and collision boxes in a new building; "' + cur.name + '" keeps everything it has. (To use the clicked building for "' + cur.name + '" instead, delete its rooms first.)', 'New building');
            if (!ok) return;
            Model.addBuilding(); isNew = true;
        }
        const ids = IM.selectBuilding(h.g, h.tri, add); if (!ids) return;
        IM.rebuildMembers(); if (add) return;
        let center = true;
        if (content && !isNew) center = await M.UI.confirm('Move the grid onto this building?', 'Your rooms, cutters and lights keep their positions on the grid, so they move with it. Cancel keeps the grid where it is (the building stays selected).', 'Move the grid');
        if (center) IM.centerOnBuilding();
        M.App.frameAll(); bus.emit('cutsel');
    }

    function frameClick(e) {
        const h = hover.mh; if (!h) { toast('Click on the model: a floor sets the floor height and the corner, a wall squares the grid to it.', 'warn'); return; }
        const n = h.n;
        if (e && e.altKey) {
            const L = IM.fromShell(h.p[0], h.p[1], h.p[2]);
            Model.edit(P => { P.import.frame.x = r3(L[0]); P.import.frame.y = r3(L[1]); });
            toast('Corner (0, 0) moved here.', 'ok');
        } else if (e && e.shiftKey && Math.abs(n[2]) < 0.3) {
            // the floor of a shell house is not modelled: its bottom edge on a wall is where the floor goes
            const g = IM.tgt.find(x => x.g === h.g), ix = g.idx, p = g.pos; let z = 1e9;
            for (let k = 0; k < 3; k++) z = Math.min(z, p[ix[h.tri * 3 + k] * 3 + 2]);
            const L = IM.fromShell(0, 0, z);
            Model.edit(P => { P.import.frame.z = r3(L[2]); });
            toast('Floor set to the bottom edge of this wall.', 'ok');
        } else if (Math.abs(n[2]) > 0.8) {
            const L = IM.fromShell(h.p[0], h.p[1], h.p[2]);
            Model.edit(P => { P.import.frame.x = r3(L[0]); P.import.frame.y = r3(L[1]); P.import.frame.z = r3(L[2]); });
            toast('Floor set here: this point is now the corner (0, 0) at floor level.', 'ok');
        } else if (Math.abs(n[2]) < 0.3) {
            const f = imp().frame, hr = (f.heading || 0) * Math.PI / 180, c = Math.cos(hr), s = Math.sin(hr);
            const lx = n[0] * c - n[1] * s, ly = n[0] * s + n[1] * c;                       // wall normal in the model's own coordinates
            let a = Math.atan2(ly, lx) * 180 / Math.PI; a = ((a % 90) + 90) % 90; if (a > 45) a -= 90;
            Model.edit(P => { P.import.frame.heading = Math.round(a * 100) / 100; });
            toast('Grid squared to this wall (' + (Math.round(a * 100) / 100) + '°).', 'ok');
        } else toast('Click a flat floor or a straight wall.', 'warn');
    }

    // Door / Window tools: the faces of the model's door or window are cut out. A window is then filled with glass, a door with the supplied door model
    // (single or double). The cutter that is stored with it only opens the collision and the interior walls; it is read from the faces.
    function faceOpeningDown(type, e) {
        const ch = hover.cut, o = hover.face, p = hover.patch;
        if (ch && (!o || ch.t < o.t + 0.3)) { S.opSel = null; selectCutter(ch.k.id); startDrag(ch.k, e); return; }
        if (!p) { toast('Click the faces of a ' + type + ' on the model.', 'warn'); return; }
        const r = IM.faceRect({ g: p.g, tris: p.tris });
        if (!r) { toast('These faces are not upright like a wall, so they cannot be a ' + type + '. Click the faces of a ' + type + ' (Shift: one triangle).', 'warn'); return; }
        const leaf = type === 'door' && !!IM.doorModel() && imp().placeDoors !== false;
        const k = Object.assign({ id: randId(), type, mesh: false, face: { g: p.g, tris: p.tris.slice(), added: [] } }, r);
        if (leaf) { k.leaf = true; k.flip = false; k.lo = 0; }
        k.dd = IM.frameDepth(k, new Set(p.tris.map(tr => p.g + ':' + tr)));                  // how far behind the cut-out faces the frame sits: glass and door go there
        Model.edit(P => {
            const have = new Set(P.import.deletes.map(d => d[0] + ':' + d[1]));
            p.tris.forEach(tr => { if (!have.has(p.g + ':' + tr)) { P.import.deletes.push([p.g, tr]); k.face.added.push(tr); } });
            P.import.cutters.push(k);
        });
        patchCache = null; selectCutter(k.id);
        toast((type === 'door' ? 'Door' : 'Window') + ' faces cut out (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m)' + (type === 'window' ? ': filled with glass.' : (leaf ? ': filled with the door model.' : '. Choose a door model in the Import tab to fill it.')), 'ok');
    }
    // what a click of the Delete faces tool takes: the flat patch, one face, or the connected piece, without the faces that are already gone
    const isTargetFile = (file) => { const m = IM.targetModel(); return !file || (m && m.file === file); };
    function facePatch(o, mode) {
        const del = isTargetFile(o.file) ? new Set(imp().deletes.map(d => d[0] + ':' + d[1])) : IM.mdelSet(o.file);
        const raw = mode === 'one' ? [{ g: o.g, tris: [o.tri] }] : (mode === 'island' ? IM.island(o.file, o.g, o.tri) : [{ g: o.g, tris: IM.flatPatch(o.g, o.tri, o.file) }]);
        return raw.map(gr => ({ g: gr.g, tris: gr.tris.filter(t => !del.has(gr.g + ':' + t)) })).filter(gr => gr.tris.length);
    }
    function drawPatch(R, p, col) {
        const eye = R.camera.eye();
        p.tris.forEach(tr => {
            const c = IM.triCorners(p.g, tr, p.file); if (!c) return;
            // lifted a little towards the viewer so it is not hidden in the surface
            const e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]], e2 = [c[2][0] - c[0][0], c[2][1] - c[0][1], c[2][2] - c[0][2]];
            let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1;
            n = [n[0] / l, n[1] / l, n[2] / l]; if (n[0] * (eye[0] - c[0][0]) + n[1] * (eye[1] - c[0][1]) + n[2] * (eye[2] - c[0][2]) < 0) n = [-n[0], -n[1], -n[2]];
            const q = c.map(v => [v[0] + n[0] * 0.02, v[1] + n[1] * 0.02, v[2] + n[2] * 0.02]);
            R.ovQuad(q[0], q[1], q[2], q[2], col);
        });
    }

    function startDrag(k, e) {
        if (k.face) return;                                  // an opening made from faces is tied to them: it is not dragged
        const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), n = [-sn, cs, 0], ray = api().pointerRay(e), c = [k.cx, k.cy, k.zb + k.h / 2];
        const dn = ray.d[0] * n[0] + ray.d[1] * n[1]; if (Math.abs(dn) < 0.04) return;
        const t = ((c[0] - ray.o[0]) * n[0] + (c[1] - ray.o[1]) * n[1]) / dn; if (t < 0) return;
        drag = { id: k.id, k0: JSON.parse(JSON.stringify(k)), start: [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t], du: 0, dz: 0, moved: false };
    }

    function move(e) {
        scan(e);
        if (fdrag) { if (!fdrag.moved && Math.hypot(e.clientX - fdrag.x, e.clientY - fdrag.y) > 5) fdrag.moved = true; if (fdrag.moved) boxShow(e); return; }
        if (fd) { figureMove(); return; }
        if (cbd) { cbMove(e); return; }
        if (M.FitModels.dragging()) { M.FitModels.move(e); return; }
        if (rd) { roomMove(e); return; }
        if (lvl) { levelMove(e); return; }
        if (!drag) { if (S.shellTool === 'room' || S.shellTool === 'cut' || S.shellTool === 'part' || S.shellTool === 'floor' || S.shellTool === 'paint') SH.move(e); return; }
        const k = drag.k0, cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), n = [-sn, cs], ray = hover.ray;
        const dn = ray.d[0] * n[0] + ray.d[1] * n[1]; if (Math.abs(dn) < 0.04) return;
        const t = ((k.cx - ray.o[0]) * n[0] + (k.cy - ray.o[1]) * n[1]) / dn; if (t < 0) return;
        const p = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
        const du = Math.round(((p[0] - drag.start[0]) * cs + (p[1] - drag.start[1]) * sn) / 0.05) * 0.05, dz = Math.round((p[2] - drag.start[2]) / 0.05) * 0.05;
        if (du !== drag.du || dz !== drag.dz) { drag.du = du; drag.dz = dz; drag.moved = true; }
    }

    function up(e) {
        if (fdrag && fdrag.col) { const d = fdrag; boxHide(); if (d.moved) { const n = colBoxSelect(e); toast(n ? n + ' collision piece' + (n === 1 ? '' : 's') + ' in the box.' : 'No collision piece in the box.', n ? 'ok' : 'warn'); } else colClick(); fdrag = null; return; }
        if (fdrag) { const d = fdrag; boxHide(); if (d.moved) { const n = facesBoxSelect(e); toast(n ? n + ' face' + (n === 1 ? '' : 's') + ' in the box' + (S.faceXray ? '' : ' (only what you can see)') : 'No face in the box.', n ? 'ok' : 'warn'); } else facesClick(); fdrag = null; return; }
        if (fd) { figureEnd(true); return; }
        if (cbd) { cbEnd(true); return; }
        if (M.FitModels.dragging()) { M.FitModels.up(e, true); return; }
        if (rd) { roomEnd(true); return; }
        if (lvl) { levelEnd(true); return; }
        if (drag) {
            const d = drag; drag = null;
            if (d.moved) { const k0 = d.k0, cs = Math.cos(k0.yaw), sn = Math.sin(k0.yaw); updateCutter(d.id, k => { k.cx = r3(k0.cx + cs * d.du); k.cy = r3(k0.cy + sn * d.du); k.zb = Math.max(-0.5, r3(k0.zb + d.dz)); }); }
            bus.emit('cutsel'); return;
        }
        if (S.shellTool === 'room' || S.shellTool === 'cut' || S.shellTool === 'part' || S.shellTool === 'floor') SH.up(e);
    }

    // ---------- the scale figure (Scale figure tool): click to stand it somewhere, drag it, R turns it ----------
    const figureYaw = () => M.App.renderer.camera.yaw - Math.PI / 2;                    // faces the camera
    function figureDown() {
        const sp = hover.fs; if (!sp) return; const f = S.figure;
        if (f && hover.fh) { fd = { ox: f.x - sp.x, oy: f.y - sp.y, x0: f.x, y0: f.y, z0: f.z }; return; }
        S.figure = { x: sp.x, y: sp.y, z: sp.z, yaw: f ? f.yaw : figureYaw(), h: f ? f.h : M.Figure.DEFAULT_H };
        fd = { ox: 0, oy: 0, x0: sp.x, y0: sp.y, z0: sp.z }; M.UI.renderLeft();
    }
    function figureMove() { const sp = hover.fs; if (!fd || !S.figure || !sp) return; S.figure.x = sp.x + fd.ox; S.figure.y = sp.y + fd.oy; S.figure.z = sp.z; }
    function figureEnd(commit) { if (!fd) return; if (!commit && S.figure) { S.figure.x = fd.x0; S.figure.y = fd.y0; S.figure.z = fd.z0; } fd = null; }

    // ---------- editing the rooms directly (Select tool): click a room, drag an edge or corner to resize it, drag the inside to move it ----------
    const roomTol = () => Math.max(0.12, M.App.renderer.camera.dist * 0.012);
    function groundRaw(e) { const ph = api().planeHit(api().pointerRay(e), 0); return ph ? [ph.x, ph.y] : null; }
    // which handle of rectangle r is at ground point p: an edge ('w' 'e' 's' 'n'), a corner ('sw' ...), the inside ('move') or nothing
    function handleAt(r, p) {
        const tol = roomTol(); if (p[0] < r[0] - tol || p[0] > r[2] + tol || p[1] < r[1] - tol || p[1] > r[3] + tol) return null;
        let m = ''; if (Math.abs(p[1] - r[3]) < tol) m += 'n'; else if (Math.abs(p[1] - r[1]) < tol) m += 's';
        if (Math.abs(p[0] - r[2]) < tol) m += 'e'; else if (Math.abs(p[0] - r[0]) < tol) m += 'w';
        if (m) return m;
        return (p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]) ? 'move' : null;
    }
    // the rectangle under a ground point; of several the smallest (so a cut-out inside a room can be picked), the newest on a tie
    function roomPick(p) {
        let best = -1, ba = 1e18;
        S.project.shell.ops.forEach((o, i) => { const r = o.r; if (p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3]) { const a = (r[2] - r[0]) * (r[3] - r[1]); if (a <= ba) { ba = a; best = i; } } });
        return best;
    }
    function roomDown(e, handlesOnly) {
        const p = hover.rp, ops = S.project.shell.ops; if (!p) return false;
        let i = S.opSel, mode = (i != null && ops[i]) ? handleAt(ops[i].r, p) : null;
        if (!mode) {
            if (handlesOnly) return false;
            i = roomPick(p); if (i < 0) { if (S.opSel != null) { S.opSel = null; M.UI.renderLeft(); } return false; }
            mode = 'move'; S.opSel = i; S.shellSel = null; S.cutSel = null; M.UI.renderLeft();
        }
        const r = ops[i].r;
        rd = { i, mode, r0: r.slice(), cur: null, lines: SH.lines(), p0: p, px: [e.clientX, e.clientY], moved: false,
            off: [mode.indexOf('w') >= 0 ? r[0] - p[0] : (mode.indexOf('e') >= 0 ? r[2] - p[0] : 0), mode.indexOf('s') >= 0 ? r[1] - p[1] : (mode.indexOf('n') >= 0 ? r[3] - p[1] : 0)] };
        return true;
    }
    // while dragging the rectangle is changed without history; letting go (or Esc / right-click) restores it and makes one undo step
    function roomMove(e) {
        const k = rd, o = S.project.shell.ops[k.i]; if (!o) return;
        if (!k.moved && Math.hypot(e.clientX - k.px[0], e.clientY - k.px[1]) < 4) return; k.moved = true;
        const p = groundRaw(e); if (!p) return;
        const free = e.shiftKey, L = k.lines, r0 = k.r0, snap = (v, list) => free ? Math.round(v * 1000) / 1000 : SH.snapTo(v, list); let r = r0.slice();
        if (k.mode === 'move') {
            // an edge that comes near a line of the model or of another room snaps to it, else the corner snaps to 5 cm
            const adj = (a, b, list, d) => {
                if (free) return Math.round(d * 1000) / 1000;
                let best = null, bd = 0.09; [a, b].forEach(e0 => (list || []).forEach(l => { const dd = l - (e0 + d); if (Math.abs(dd) < bd) { bd = Math.abs(dd); best = d + dd; } }));
                return best != null ? best : Math.round((a + d) / 0.05) * 0.05 - a;
            };
            const dx = adj(r0[0], r0[2], L.xs, p[0] - k.p0[0]), dy = adj(r0[1], r0[3], L.ys, p[1] - k.p0[1]);
            r = [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy];
        } else {
            const m = k.mode, MIN = 0.2;
            if (m.indexOf('w') >= 0) r[0] = Math.min(snap(p[0] + k.off[0], L.xs), r0[2] - MIN);
            if (m.indexOf('e') >= 0) r[2] = Math.max(snap(p[0] + k.off[0], L.xs), r0[0] + MIN);
            if (m.indexOf('s') >= 0) r[1] = Math.min(snap(p[1] + k.off[1], L.ys), r0[3] - MIN);
            if (m.indexOf('n') >= 0) r[3] = Math.max(snap(p[1] + k.off[1], L.ys), r0[1] + MIN);
        }
        r = r.map(v => Math.round(v * 10000) / 10000);
        if (k.cur && r.every((v, j) => v === k.cur[j])) return;
        k.cur = r; o.r = r.slice(); bus.emit('change');
    }
    function roomEnd(commit) {
        const k = rd; rd = null; if (!k) return; const o = S.project.shell.ops[k.i]; if (!o) return; const fin = k.cur;
        o.r = k.r0.slice();
        if (commit && k.moved && fin && fin.some((v, j) => v !== k.r0[j])) Model.edit(P => { P.shell.ops[k.i].r = fin; }); else bus.emit('change');
        M.UI.renderLeft();
    }
    function deleteRoom() { const i = S.opSel; if (i == null || !S.project.shell.ops[i]) return false; S.opSel = null; Model.edit(P => { P.shell.ops.splice(i, 1); }); M.UI.renderLeft(); return true; }
    const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' };
    function drawRoomSel(R) {
        const ops = S.project.shell.ops, z = 0.022, top = (r, col) => R.ovTopQuad([r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z], col);
        const edge = (r, col) => { const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; for (let i = 0; i < 4; i++) R.ovTopLine([c[i][0], c[i][1], z + 0.004], [c[(i + 1) % 4][0], c[(i + 1) % 4][1], z + 0.004], col); };
        const hov = (!rd && hover && !hover.cut && hover.ri != null) ? hover.ri : -1;
        if (hov >= 0 && hov !== S.opSel && ops[hov]) { top(ops[hov].r, [1, 1, 1, 0.10]); edge(ops[hov].r, [1, 1, 1, 0.55]); }
        const o = ops[S.opSel]; let cur = '';
        if (o) {
            const r = o.r, cut = o.op === 'cut', hs = roomTol() * 0.42, hm = rd ? rd.mode : (hover && hover.rh);
            top(r, cut ? [0.92, 0.4, 0.3, 0.22] : [0.35, 0.9, 0.55, 0.20]); edge(r, [1, 1, 1, 0.95]);
            const mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
            [['sw', r[0], r[1]], ['se', r[2], r[1]], ['ne', r[2], r[3]], ['nw', r[0], r[3]], ['s', mx, r[1]], ['n', mx, r[3]], ['w', r[0], my], ['e', r[2], my]].forEach(h => {
                const hot = hm === h[0], s = hot ? hs * 1.35 : hs, c = hot ? [1, 0.93, 0.55, 1] : [1, 1, 1, 0.95];
                R.ovTopQuad([h[1] - s, h[2] - s, z + 0.01], [h[1] + s, h[2] - s, z + 0.01], [h[1] + s, h[2] + s, z + 0.01], [h[1] - s, h[2] + s, z + 0.01], c);
                R.ovTopQuad([h[1] - s * 0.55, h[2] - s * 0.55, z + 0.012], [h[1] + s * 0.55, h[2] - s * 0.55, z + 0.012], [h[1] + s * 0.55, h[2] + s * 0.55, z + 0.012], [h[1] - s * 0.55, h[2] + s * 0.55, z + 0.012], [0.12, 0.2, 0.35, 1]);
            });
            if (rd && rd.moved) label((r[2] - r[0]).toFixed(2) + ' x ' + (r[3] - r[1]).toFixed(2) + ' m   at ' + r[0].toFixed(2) + ', ' + r[1].toFixed(2), [mx, my, 0.4]);
            else if (hm && !rd) label(hm === 'move' ? 'Drag to move. Shift: no snapping. Del or X deletes' : 'Drag to resize', [mx, my, 0.4]);
            cur = hm ? (CURSORS[hm] || '') : '';
        }
        if (!cur && !rd && !(hover && hover.cut) && hov >= 0) cur = 'pointer';
        M.App.canvas.style.cursor = cur;
    }

    // ---------- raise / lower the rooms: the blue Z arrow (like a Blender move gizmo) ----------
    const ARROW = [0.27, 0.52, 0.96, 0.95], ARROW_HOT = [1, 0.93, 0.55, 1];
    const interiorBox = () => { const b = M.App.built && M.App.built.bounds; return (b && b.mn[0] <= b.mx[0]) ? b : null; };
    const gizmoAt = () => { const b = interiorBox(); return b ? [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, 0] : [0, 0, 0]; };
    const gizmoLen = () => Math.max(1.2, M.App.renderer.camera.dist * 0.11);          // about the same size on screen at any zoom
    function gizmoHit(ray) { const a = gizmoAt(), L = gizmoLen(), w = L * 0.09; return api().rayBox(ray, [a[0] - w, a[1] - w, -L * 0.05], [a[0] + w, a[1] + w, L * 1.08]) != null; }
    function drawGizmo(R, hot) {
        const a = gizmoAt(), L = gizmoLen(), c = hot ? ARROW_HOT : ARROW, s = L * 0.02, w = L * 0.08, z0 = a[2], z1 = a[2] + L * 0.78, tip = [a[0], a[1], a[2] + L];
        const q = (p, r, t, u) => R.ovTopQuad(p, r, t, u, c), x0 = a[0] - s, x1 = a[0] + s, y0 = a[1] - s, y1 = a[1] + s;
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
        q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]); q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
        const h = [[a[0] - w, a[1] - w], [a[0] + w, a[1] - w], [a[0] + w, a[1] + w], [a[0] - w, a[1] + w]];
        for (let i = 0; i < 4; i++) { const p = h[i], n = h[(i + 1) % 4]; q([p[0], p[1], z1], [n[0], n[1], z1], tip, tip); }
        q([h[0][0], h[0][1], z1], [h[1][0], h[1][1], z1], [h[2][0], h[2][1], z1], [h[3][0], h[3][1], z1]);
    }
    function levelDown(e) {
        if (hover.gz) {
            const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(), a = gizmoAt(), I = imp();
            const p0 = cam.project(a, r.width, r.height), p1 = cam.project([a[0], a[1], a[2] + 1], r.width, r.height);
            let vx = 0, vy = -60;                         // seen from straight above: 60 px per metre, up on screen is up
            if (p0 && p1) { const dx = p1[0] - p0[0], dy = p1[1] - p0[1]; if (dx * dx + dy * dy > 16) { vx = dx; vy = dy; } }
            lvl = { x: e.clientX, y: e.clientY, vx, vy, dz: 0, f0: I.frame.z, zb0: I.cutters.map(k => k.zb), ct0: cam.target[2] };
            return;
        }
        const h = hover.mh;
        if (h && Math.abs(h.n[2]) > 0.8) {
            const dz = Math.round(h.p[2] * 1000) / 1000;
            if (IM.shiftLevel(dz)) toast('The rooms\' floor now sits at this height (' + (dz > 0 ? 'raised ' : 'lowered ') + Math.abs(dz).toFixed(2) + ' m).', 'ok'); else toast('The floor is already at this height.', 'ok');
            M.UI.renderLeft(); return;
        }
        toast('Drag the blue arrow up or down, or click a floor of the model to put the rooms\' floor at that height.', 'warn');
    }
    // while dragging, the project is changed without history; letting go (or Esc / right-click) restores it and makes one undo step
    function levelMove(e) {
        const k = lvl, I = imp(), cam = M.App.renderer.camera;
        let dz = ((e.clientX - k.x) * k.vx + (e.clientY - k.y) * k.vy) / (k.vx * k.vx + k.vy * k.vy);
        if (e.shiftKey) dz *= 0.1;
        dz = e.ctrlKey ? Math.round(dz / 0.05) * 0.05 : Math.round(dz * 100) / 100;
        if (dz === k.dz) return;
        k.dz = dz; I.frame.z = Math.round((k.f0 + dz) * 1000) / 1000; I.cutters.forEach((c, i) => { c.zb = Math.round((k.zb0[i] - dz) * 1000) / 1000; }); cam.target[2] = k.ct0 + dz;
        bus.emit('change');
    }
    function levelEnd(commit) {
        const k = lvl; lvl = null; if (!k) return; const I = imp(), cam = M.App.renderer.camera;
        I.frame.z = k.f0; I.cutters.forEach((c, i) => { c.zb = k.zb0[i]; }); cam.target[2] = k.ct0;
        if (commit && k.dz) IM.shiftLevel(k.dz); else bus.emit('change');
        M.UI.renderLeft();
    }
    // right-click (like Escape) cancels what is being dragged
    function cancelTransform() { if (fdrag) { boxHide(); fdrag = null; return true; } if (fd) { figureEnd(false); return true; } if (cbd) { cbEnd(false); return true; } if (M.FitModels.cancel()) return true; if (rd) { roomEnd(false); return true; } if (lvl) { levelEnd(false); return true; } if (SH.dragging) { SH.cancel(); return true; } if (drag) { drag = null; bus.emit('cutsel'); return true; } return false; }

    // ---------- fill gaps ----------
    // A gap is empty floor between two filled parts that lie within "largest gap" of each other along x or along y. Everything works on the
    // grid made by the edges of your rectangles, so a fill meets the rooms exactly.
    const maxGap = () => Math.max(0.05, Math.min(5, S.fillGap || 0.5));
    function rectsOf(g, cells) {
        const has = new Set(cells.map(c => c[0] + ',' + c[1])), used = new Set(), out = [];
        cells.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]).forEach(c => {
            if (used.has(c[0] + ',' + c[1])) return;
            let i1 = c[0] + 1; while (has.has(i1 + ',' + c[1]) && !used.has(i1 + ',' + c[1])) i1++;
            let j1 = c[1] + 1; for (; ; j1++) { let ok = true; for (let x = c[0]; x < i1; x++) { const k = x + ',' + j1; if (!has.has(k) || used.has(k)) { ok = false; break; } } if (!ok) break; }
            for (let x = c[0]; x < i1; x++) for (let y = c[1]; y < j1; y++) used.add(x + ',' + y);
            out.push([g.X[c[0]], g.Y[c[1]], g.X[i1], g.Y[j1]]);
        });
        return out;
    }
    function findGaps(gm) {
        const key = JSON.stringify(S.project.shell.ops) + '|' + gm; if (gapCache && gapCache.key === key) return gapCache;
        const g = M.Shell.regionGrid(S.project.shell), nx = g.nx, ny = g.ny, gap = [], owner = [], comps = [], fill = g.mask.map(c => c.slice());
        for (let i = 0; i < nx; i++) { gap.push(new Array(ny).fill(false)); owner.push(new Array(ny).fill(-1)); }
        // a few passes: where a horizontal and a vertical gap cross, the square in the middle is only bridged once the two gaps count as filled
        for (let pass = 0; pass < 3; pass++) {
            const found = [];
            for (let j = 0; j < ny; j++) { let i = 0; while (i < nx) { if (fill[i][j]) { i++; continue; } let k = i; while (k < nx && !fill[k][j]) k++; if (i > 0 && k < nx && g.X[k] - g.X[i] <= gm + 1e-6) for (let q = i; q < k; q++) found.push([q, j]); i = k; } }
            for (let i = 0; i < nx; i++) { let j = 0; while (j < ny) { if (fill[i][j]) { j++; continue; } let k = j; while (k < ny && !fill[i][k]) k++; if (j > 0 && k < ny && g.Y[k] - g.Y[j] <= gm + 1e-6) for (let q = j; q < k; q++) found.push([i, q]); j = k; } }
            let added = 0; found.forEach(c => { if (!fill[c[0]][c[1]]) { fill[c[0]][c[1]] = true; gap[c[0]][c[1]] = true; added++; } });
            if (!added) break;
        }
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
            if (!gap[i][j] || owner[i][j] >= 0) continue; const id = comps.length, cells = [], st = [[i, j]]; owner[i][j] = id;
            while (st.length) { const c = st.pop(); cells.push(c); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => { const a = c[0] + d[0], b = c[1] + d[1]; if (a < 0 || b < 0 || a >= nx || b >= ny || !gap[a][b] || owner[a][b] >= 0) return; owner[a][b] = id; st.push([a, b]); }); }
            const rects = rectsOf(g, cells); let area = 0; rects.forEach(r => { area += (r[2] - r[0]) * (r[3] - r[1]); });
            comps.push({ rects, area });
        }
        return (gapCache = { key, g, owner, comps });
    }
    // an empty space that is closed on all sides, whatever its size (Shift+click)
    function holeAt(g, i, j) {
        if (g.mask[i][j]) return null;
        const seen = new Set([i + ',' + j]), st = [[i, j]], cells = []; let open = false;
        while (st.length) {
            const c = st.pop(); cells.push(c); if (c[0] === 0 || c[1] === 0 || c[0] === g.nx - 1 || c[1] === g.ny - 1) open = true;
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(d => { const a = c[0] + d[0], b = c[1] + d[1], k = a + ',' + b; if (a < 0 || b < 0 || a >= g.nx || b >= g.ny || g.mask[a][b] || seen.has(k)) return; seen.add(k); st.push([a, b]); });
        }
        return { open, rects: open ? null : rectsOf(g, cells) };
    }
    function fillTarget(h) {
        if (!h || !h.g) return null; const F = findGaps(maxGap()), g = F.g; let i = -1, j = -1;
        for (let a = 0; a < g.nx; a++) if (h.g.rx >= g.X[a] && h.g.rx < g.X[a + 1]) { i = a; break; }
        for (let b = 0; b < g.ny; b++) if (h.g.ry >= g.Y[b] && h.g.ry < g.Y[b + 1]) { j = b; break; }
        if (i < 0 || j < 0) return null;
        if (h.shift) { const o = holeAt(g, i, j); return o ? (o.open ? { open: true } : { rects: o.rects, kind: 'hole' }) : null; }
        const id = F.owner[i][j]; return id >= 0 ? { rects: F.comps[id].rects, kind: 'gap' } : null;
    }
    function fillRects(rects) { Model.edit(P => { rects.forEach(r => P.shell.ops.push({ op: 'add', r: r.slice() })); }); M.UI.renderLeft(); }
    function fillDown() {
        const tg = fillTarget(hover);
        if (!tg) { toast('No gap here. The green areas are gaps up to the "Largest gap" size. Shift+click fills a closed hole of any size.', 'warn'); return; }
        if (tg.open) { toast('This space is open to the outside, so it is not a hole. Make the gap size smaller or draw a room there.', 'warn'); return; }
        fillRects(tg.rects);
    }
    function fillAll() { const F = findGaps(maxGap()), all = []; F.comps.forEach(c => c.rects.forEach(r => all.push(r))); if (all.length) { fillRects(all); toast('Filled ' + F.comps.length + ' gap(s).', 'ok'); } }

    // ---------- edges: select the open edges around a hole in the model's wall, then fill it (like F in Blender) ----------
    // Open edges are drawn in orange (by default only the rims of holes made by deleting faces). Click selects one, Shift+click adds or removes it, Alt+click (or a double
    // click) takes the whole loop around the hole, A selects every edge shown, F makes the faces. The fills are stored with the project (`import.fills`) and the host
    // adds them to the model when it cuts it, so they are in the editor and in the exported model.
    let edgeSel = new Set(), lastEdgeClick = null;
    const edgeOpts = () => ({ holesOnly: !!S.edgeHolesOnly, outlines: !!S.edgeOutlines });
    function rayToSeg(ray, A, B) {
        const d = ray.d, o = ray.o, u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [o[0] - A[0], o[1] - A[1], o[2] - A[2]];
        const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], b = d[0] * u[0] + d[1] * u[1] + d[2] * u[2], c = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], d0 = d[0] * w[0] + d[1] * w[1] + d[2] * w[2], e0 = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
        const den = a * c - b * b; let s = den > 1e-12 ? (a * e0 - b * d0) / den : 0; s = Math.max(0, Math.min(1, s));
        const t = Math.max(0, (b * s - d0) / a), q = [A[0] + u[0] * s, A[1] + u[1] * s, A[2] + u[2] * s], p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
        return { d: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), t };
    }
    function pickEdge(ray) {
        const list = IM.edgeView(edgeOpts()); let best = null;
        for (const e of list) {
            const r = rayToSeg(ray, e.sa, e.sb), tol = Math.max(0.025, r.t * 0.012), score = r.d / tol;       // about 1 cm on screen at any distance
            if (score < 1 && (!best || score < best.score)) best = { e, score, t: r.t };
        }
        return best;
    }
    function edgesDown(ev) {
        const h = hover.edge, now = Date.now();
        if (!h) { if (!ev.shiftKey) edgeSel.clear(); M.UI.renderLeft(); return; }
        const dbl = lastEdgeClick && lastEdgeClick.k === h.e.k && now - lastEdgeClick.t < 400; lastEdgeClick = { k: h.e.k, t: now };
        const keys = (ev.altKey || dbl) ? IM.edgeLoop(h.e) : [h.e.k];
        if (ev.shiftKey) { const all = keys.every(k => edgeSel.has(k)); keys.forEach(k => { if (all) edgeSel.delete(k); else edgeSel.add(k); }); }
        else edgeSel = new Set(keys);
        M.UI.renderLeft();
    }
    function edgesSelectAll(on) { edgeSel = on ? new Set(IM.edgeView(edgeOpts()).map(e => e.k)) : new Set(); M.UI.renderLeft(); }
    function edgesFill() {
        if (!edgeSel.size) { toast('Select the edges around a hole first: click an edge, Alt+click takes the whole loop.', 'warn'); return false; }
        const eye = M.App.renderer.camera.eye(), r = IM.fillFromEdges([...edgeSel], IM.fromShell(eye[0], eye[1], eye[2]));
        if (!r.fills.length) { toast(r.skipped ? 'These edges do not make one loop: a corner where more than two selected edges meet cannot be filled. Select one loop at a time (Alt+click).' : 'Could not make a face from these edges.', 'warn'); return false; }
        Model.edit(P => { P.import.fills = (P.import.fills || []).concat(r.fills); });
        edgeSel.clear(); let tris = 0; r.fills.forEach(f => { tris += f.tris.length; });
        toast('Filled ' + r.fills.length + ' hole(s) with ' + tris + ' triangle(s)' + (r.skipped ? ', ' + r.skipped + ' selection(s) skipped' : '') + '. The faces look the way the wall around them looks: Flip turns one around.', 'ok');
        M.UI.renderLeft(); return true;
    }

    // ---------- Delete faces, the way Blender does it: select first, then act ----------
    // Click selects the flat patch under the pointer (Ctrl+click: one triangle, Alt+click: the whole connected piece), Shift+click adds or removes, dragging draws a
    // box that selects the faces whose centres are inside and that you can see (Shift adds, Ctrl takes away). A selects all, Alt+A none, Ctrl+I inverts, L selects the
    // piece under the pointer, Ctrl+L grows the selection to whole pieces, Shift+G selects everything with the same texture, X or Delete deletes the selection.
    let fsel = new Map(), fdrag = null, fbox = null, fselGroups = null, fselKey = '';
    const fk = (file, g, t) => file + '|' + g + '|' + t;
    function faceKeyNow() { return imp().deletes.length + '|' + (imp().mdeletes || []).length; }
    // forget selected faces that are gone (deleted, or undone)
    function selSync() {
        const k = faceKeyNow(); if (k === fselKey) return; fselKey = k; fselGroups = null; if (!fsel.size) return;
        const td = new Set(imp().deletes.map(d => d[0] + '|' + d[1])), dd = new Set((imp().mdeletes || []).map(d => d[0] + '|' + d[1] + '|' + d[2])), tf = (IM.targetModel() || {}).file;
        [...fsel.keys()].forEach(key => { const v = fsel.get(key); if (v[0] === tf ? td.has(v[1] + '|' + v[2]) : dd.has(key)) fsel.delete(key); });
    }
    const selChanged = () => { fselGroups = null; M.UI.renderLeft(); };
    function selAdd(file, groups, on) { groups.forEach(gr => gr.tris.forEach(t => { const k = fk(file, gr.g, t); if (on) fsel.set(k, [file, gr.g, t]); else fsel.delete(k); })); }
    function selGroups() {
        if (fselGroups) return fselGroups; const m = new Map();
        fsel.forEach(v => { const k = v[0] + '|' + v[1]; let e = m.get(k); if (!e) m.set(k, e = { file: v[0], g: v[1], tris: [] }); e.tris.push(v[2]); });
        return (fselGroups = [...m.values()]);
    }
    function facesSelectAll() { fsel.clear(); IM.shownFaces(true).forEach(f => fsel.set(fk(f.file, f.g, f.tri), [f.file, f.g, f.tri])); selChanged(); }
    function facesSelectNone() { fsel.clear(); selChanged(); }
    function facesInvert() { const all = IM.shownFaces(true), nxt = new Map(); all.forEach(f => { const k = fk(f.file, f.g, f.tri); if (!fsel.has(k)) nxt.set(k, [f.file, f.g, f.tri]); }); fsel = nxt; selChanged(); }
    // every face with the same texture as a selected one (Blender: Select Similar > Material)
    function facesSimilar() {
        if (!fsel.size) { toast('Select a face first: Shift+G selects everything with the same texture.', 'warn'); return; }
        const parts = new Set(); fsel.forEach(v => parts.add(v[0] + '|' + v[1]));
        IM.shownFaces(true).forEach(f => { if (parts.has(f.file + '|' + f.g)) fsel.set(fk(f.file, f.g, f.tri), [f.file, f.g, f.tri]); }); selChanged();
        toast(fsel.size + ' faces selected with the same texture.', 'ok');
    }
    function facesLinked(fromSelection) {
        const seeds = fromSelection ? [...fsel.values()] : (hover && hover.face ? [[hover.face.file, hover.face.g, hover.face.tri]] : []);
        if (!seeds.length) { if (!fromSelection) toast('Point at a face and press L: the connected piece is selected.', 'warn'); return; }
        const done = new Set(); seeds.forEach(s => { IM.island(s[0], s[1], s[2]).forEach(gr => { const key = s[0] + '|' + gr.g + '|' + gr.tris[0]; if (done.has(key)) return; done.add(key); selAdd(s[0], [gr], true); }); }); selChanged();
    }
    function facesSelectPart(file, g) {
        const m = IM.models.find(x => x.file === file), geo = m && m.geoms.find(x => x.g === g); if (!geo) return;
        const del = m.target ? new Set(imp().deletes.map(d => d[0] + ':' + d[1])) : IM.mdelSet(file); fsel.clear();
        for (let t = 0; t * 3 < geo.idx.length; t++) if (!del.has(g + ':' + t)) fsel.set(fk(file, g, t), [file, g, t]);
        M.App.setTool('faces'); selChanged();
    }
    function facesDelete() {
        if (!fsel.size) { toast('Nothing selected. Click a face (or drag a box) first; X deletes the selection.', 'warn'); return false; }
        const tf = (IM.targetModel() || {}).file, n = fsel.size;
        Model.edit(P => {
            const I = P.import, have = new Set(I.deletes.map(d => d[0] + ':' + d[1])); I.mdeletes = I.mdeletes || []; const mh = new Set(I.mdeletes.map(d => d.join(':')));
            fsel.forEach(v => { if (v[0] === tf) { if (!have.has(v[1] + ':' + v[2])) I.deletes.push([v[1], v[2]]); } else if (!mh.has(v[0] + ':' + v[1] + ':' + v[2])) I.mdeletes.push([v[0], v[1], v[2]]); });
        });
        fsel.clear(); fselGroups = null; fpatchCache = null; patchCache = null; M.UI.renderLeft();
        toast(n + ' face' + (n === 1 ? '' : 's') + ' deleted. Ctrl+Z brings them back.', 'ok'); return true;
    }
    // which of these faces can be seen from the camera: a coarse depth buffer is drawn from the faces and each face centre is compared with it
    function faceVisibility(faces, cam, cw, ch) {
        const v = cam.vp, RW = 400, RH = Math.max(8, Math.round(RW * ch / cw)), depth = new Float32Array(RW * RH).fill(1e9);
        const P = (x, y, z) => { const w = v[3] * x + v[7] * y + v[11] * z + v[15]; if (w <= 0.05) return null; return [(((v[0] * x + v[4] * y + v[8] * z + v[12]) / w) * 0.5 + 0.5) * RW, (1 - (((v[1] * x + v[5] * y + v[9] * z + v[13]) / w) * 0.5 + 0.5)) * RH, w]; };
        const info = faces.map(f => ({ a: P(f.p[0], f.p[1], f.p[2]), b: P(f.p[3], f.p[4], f.p[5]), c: P(f.p[6], f.p[7], f.p[8]), m: P(f.c[0], f.c[1], f.c[2]) }));
        info.forEach(it => {
            if (!it.a || !it.b || !it.c) return;
            const x0 = Math.max(0, Math.floor(Math.min(it.a[0], it.b[0], it.c[0]))), x1 = Math.min(RW - 1, Math.ceil(Math.max(it.a[0], it.b[0], it.c[0]))), y0 = Math.max(0, Math.floor(Math.min(it.a[1], it.b[1], it.c[1]))), y1 = Math.min(RH - 1, Math.ceil(Math.max(it.a[1], it.b[1], it.c[1])));
            const den = (it.b[1] - it.c[1]) * (it.a[0] - it.c[0]) + (it.c[0] - it.b[0]) * (it.a[1] - it.c[1]); if (Math.abs(den) < 1e-9) return;
            const iw0 = 1 / it.a[2], iw1 = 1 / it.b[2], iw2 = 1 / it.c[2];
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const px = x + 0.5, py = y + 0.5, l0 = ((it.b[1] - it.c[1]) * (px - it.c[0]) + (it.c[0] - it.b[0]) * (py - it.c[1])) / den, l1 = ((it.c[1] - it.a[1]) * (px - it.c[0]) + (it.a[0] - it.c[0]) * (py - it.c[1])) / den, l2 = 1 - l0 - l1;
                if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue; const d = 1 / (l0 * iw0 + l1 * iw1 + l2 * iw2); if (d < depth[y * RW + x]) depth[y * RW + x] = d;
            }
        });
        return info.map(it => {
            if (!it.m) return null; const sx = it.m[0] / RW * cw, sy = it.m[1] / RH * ch, px = Math.floor(it.m[0]), py = Math.floor(it.m[1]);
            if (px < 0 || py < 0 || px >= RW || py >= RH) return { vis: false, sx, sy }; const d = depth[py * RW + px];
            return { vis: it.m[2] <= d + 0.06 + 0.012 * d, sx, sy };
        });
    }
    function facesBoxSelect(ev) {
        const cv = M.App.canvas, r = cv.getBoundingClientRect(), cam = M.App.renderer.camera; cam.update(r.width / r.height);
        const x0 = Math.min(fdrag.x, ev.clientX) - r.left, x1 = Math.max(fdrag.x, ev.clientX) - r.left, y0 = Math.min(fdrag.y, ev.clientY) - r.top, y1 = Math.max(fdrag.y, ev.clientY) - r.top;
        const faces = IM.shownFaces(true), vis = faceVisibility(faces, cam, r.width, r.height), hit = [];
        faces.forEach((f, i) => { const s = vis[i]; if (!s || (!s.vis && !S.faceXray) || s.sx < x0 || s.sx > x1 || s.sy < y0 || s.sy > y1) return; hit.push(f); });
        if (!fdrag.shift && !fdrag.ctrl) fsel.clear();
        hit.forEach(f => { const k = fk(f.file, f.g, f.tri); if (fdrag.ctrl) fsel.delete(k); else fsel.set(k, [f.file, f.g, f.tri]); });
        selChanged(); return hit.length;
    }
    function boxShow(ev) {
        if (!fbox) { fbox = document.createElement('div'); fbox.style.cssText = 'position:fixed;pointer-events:none;border:1px dashed #fff;background:rgba(255,255,255,.08);z-index:50'; document.body.appendChild(fbox); }
        fbox.style.left = Math.min(fdrag.x, ev.clientX) + 'px'; fbox.style.top = Math.min(fdrag.y, ev.clientY) + 'px'; fbox.style.width = Math.abs(ev.clientX - fdrag.x) + 'px'; fbox.style.height = Math.abs(ev.clientY - fdrag.y) + 'px';
    }
    function boxHide() { if (fbox) { fbox.remove(); fbox = null; } }
    function facesClick() {
        const d = fdrag, p = hover && hover.fpatch;
        if (!p || !p.groups.length) { if (!d.shift) { fsel.clear(); selChanged(); } return; }
        if (d.shift) { const all = p.groups.every(gr => gr.tris.every(t => fsel.has(fk(p.file, gr.g, t)))); selAdd(p.file, p.groups, !all); } else { fsel.clear(); selAdd(p.file, p.groups, true); }
        selChanged();
    }

    // ---------- Collision: pick the building's collision pieces and delete them (select first, then act, like the faces) ----------
    // Click selects the piece under the pointer, Shift+click adds or removes it, dragging draws a box that selects the pieces whose centres are inside (Shift adds, Ctrl takes
    // away); A all, Alt+A none, Ctrl+I invert, Shift+G the same material, X or Delete deletes. The pieces are the original ones of all the collision files near the rooms;
    // a deleted piece is gone from the export (and from the overlay). "The same place in the other files": the three versions of a collision file overlap, so a piece of
    // about the same size at the same place in another file goes with it.
    let csel = new Set(), cpicked = -1;
    function rayAabb(ray, b, o) {
        let tmin = 0, tmax = 1e9;
        for (let a = 0; a < 3; a++) {
            const d = ray.d[a], lo = b[o + a] - 0.02, hi = b[o + 3 + a] + 0.02;
            if (Math.abs(d) < 1e-9) { if (ray.o[a] < lo || ray.o[a] > hi) return null; }
            else { let t1 = (lo - ray.o[a]) / d, t2 = (hi - ray.o[a]) / d; if (t1 > t2) { const x = t1; t1 = t2; t2 = x; } tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null; }
        }
        return tmin;
    }
    function rayTriV(ray, a, b, c) {
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], d = ray.d;
        const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]; if (Math.abs(det) < 1e-12) return null;
        const inv = 1 / det, tv = [ray.o[0] - a[0], ray.o[1] - a[1], ray.o[2] - a[2]], u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * inv; if (u < 0 || u > 1) return null;
        const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 0 || u + v > 1) return null;
        const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv; return t > 1e-4 ? t : null;
    }
    const colCorner = (cp, i, k) => [cp.shell[i * 12 + k * 3], cp.shell[i * 12 + k * 3 + 1], cp.shell[i * 12 + k * 3 + 2]];
    function colPick(ray) {
        const cp = IM.colShell(); if (!cp) return -1; let best = -1, bt = 1e9;
        for (const i of IM.colRegion()) {
            const t0 = rayAabb(ray, cp.box, i * 6); if (t0 == null || t0 > bt) continue; let t = null;
            if (cp.meta[i * 5 + 3] === 0) t = rayTriV(ray, colCorner(cp, i, 0), colCorner(cp, i, 1), colCorner(cp, i, 2));
            else { const cs = IM.colBoxCorners(cp.shell, i * 12); for (const f of IM.COLBOXFACES) for (const tri of [[0, 1, 2], [0, 2, 3]]) { const h = rayTriV(ray, cs[f[tri[0]]], cs[f[tri[1]]], cs[f[tri[2]]]); if (h != null && (t == null || h < t)) t = h; } }
            if (t != null && t < bt) { bt = t; best = i; }
        }
        return best;
    }
    function colEdges(cp, i) {
        if (cp.meta[i * 5 + 3] === 0) return [[colCorner(cp, i, 0), colCorner(cp, i, 1)], [colCorner(cp, i, 1), colCorner(cp, i, 2)], [colCorner(cp, i, 2), colCorner(cp, i, 0)]];
        const cs = IM.colBoxCorners(cp.shell, i * 12); return IM.COLBOXEDGES.map(e => [cs[e[0]], cs[e[1]]]);
    }
    const colChanged = () => { M.UI.renderLeft(); };
    function colSyncSel() { const cp = IM.colShell(); if (!cp || !csel.size) return; const live = new Set(IM.colRegion()); [...csel].forEach(i => { if (!live.has(i)) csel.delete(i); }); }
    function colClick() {
        const d = fdrag, i = hover ? hover.col : -1;
        if (i == null || i < 0) { if (!d.shift) { csel.clear(); colChanged(); } return; }
        if (d.shift) { if (csel.has(i)) csel.delete(i); else csel.add(i); } else csel = new Set([i]);
        colChanged();
    }
    function colBoxSelect(ev) {
        const cp = IM.colShell(); if (!cp) return 0; const cv = M.App.canvas, r = cv.getBoundingClientRect(), cam = M.App.renderer.camera; cam.update(r.width / r.height);
        const x0 = Math.min(fdrag.x, ev.clientX) - r.left, x1 = Math.max(fdrag.x, ev.clientX) - r.left, y0 = Math.min(fdrag.y, ev.clientY) - r.top, y1 = Math.max(fdrag.y, ev.clientY) - r.top, hit = [];
        IM.colRegion().forEach(i => { const s = cam.project([cp.ctr[i * 3], cp.ctr[i * 3 + 1], cp.ctr[i * 3 + 2]], r.width, r.height); if (s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1) hit.push(i); });
        if (!fdrag.shift && !fdrag.ctrl) csel.clear(); hit.forEach(i => { if (fdrag.ctrl) csel.delete(i); else csel.add(i); }); colChanged(); return hit.length;
    }
    function colAll() { csel = new Set(IM.colRegion()); colChanged(); }
    function colNone() { csel.clear(); colChanged(); }
    function colInvert() { const nxt = new Set(); IM.colRegion().forEach(i => { if (!csel.has(i)) nxt.add(i); }); csel = nxt; colChanged(); }
    function colSameMaterial() {
        const cp = IM.colShell(); if (!cp || !csel.size) { toast('Select a piece first: Shift+G selects everything with the same material.', 'warn'); return; }
        const mats = new Set(); csel.forEach(i => mats.add(cp.meta[i * 5 + 4])); IM.colRegion().forEach(i => { if (mats.has(cp.meta[i * 5 + 4])) csel.add(i); }); colChanged(); toast(csel.size + ' pieces selected with the same material.', 'ok');
    }
    // a piece of about the same size at the same place: most of the smaller one lies inside the other, and neither is more than 4 times the volume of the other
    function colSameSpot(cp, i, j) {
        const g = 0.02, vol = (k) => { let v = 1; for (let a = 0; a < 3; a++) v *= (cp.box[k * 6 + 3 + a] - cp.box[k * 6 + a]) + 2 * g; return v; };
        let inter = 1; for (let a = 0; a < 3; a++) { const lo = Math.max(cp.box[i * 6 + a], cp.box[j * 6 + a]) - g, hi = Math.min(cp.box[i * 6 + 3 + a], cp.box[j * 6 + 3 + a]) + g; if (hi <= lo) return false; inter *= hi - lo; }
        const vi = vol(i), vj = vol(j), r = vi / vj; return inter / Math.min(vi, vj) >= 0.7 && r >= 0.25 && r <= 4;
    }
    function colDelete() {
        const cp = IM.colShell(); colSyncSel(); if (!cp || !csel.size) { toast('Nothing selected. Click a collision piece (or drag a box) first; X deletes the selection.', 'warn'); return false; }
        const all = new Set(csel); let extra = 0;
        if (S.colSame !== false) { const region = IM.colRegion(); csel.forEach(i => region.forEach(j => { if (!all.has(j) && cp.meta[j * 5] !== cp.meta[i * 5] && colSameSpot(cp, i, j)) { all.add(j); extra++; } })); }
        Model.edit(P => { const I = P.import; I.colDeletes = I.colDeletes || []; const have = new Set(I.colDeletes.map(d => d.join('|'))); all.forEach(i => { const e = [cp.files[cp.meta[i * 5]], cp.meta[i * 5 + 1], cp.meta[i * 5 + 2]]; if (!have.has(e.join('|'))) I.colDeletes.push(e); }); });
        const n = csel.size; csel.clear(); M.UI.renderLeft();
        toast(n + ' collision piece' + (n === 1 ? '' : 's') + (extra ? ' and ' + extra + ' at the same place in the other files' : '') + ' deleted. Ctrl+Z brings them back.', 'ok'); return true;
    }
    function drawColPiece(R, cp, i, col) { colEdges(cp, i).forEach(e => R.ovTopLine(e[0], e[1], col)); }
    // select the building's original collision pieces that overlap a rectangle (grid frame, x0 y0 x1 y1) in the Collision tool: what the walk check found is shown that way
    async function colSelectIn(bb, zr) {
        M.App.setTool('collision'); await IM.colPolysLoad(); const cp = IM.colShell(); if (!cp) { toast('The building\'s collision could not be read.', 'warn'); return 0; }
        const pad = 0.03, hit = [], b = cp.box;
        IM.colRegion().forEach(i => { if (b[i * 6] < bb[2] - pad && b[i * 6 + 3] > bb[0] + pad && b[i * 6 + 1] < bb[3] - pad && b[i * 6 + 4] > bb[1] + pad && b[i * 6 + 5] > (zr ? zr[0] + 0.05 : 0.3) && b[i * 6 + 2] < (zr ? zr[1] - 0.05 : 1.8)) hit.push(i); });
        csel = new Set(hit); colChanged();
        toast(hit.length ? hit.length + ' collision piece' + (hit.length === 1 ? '' : 's') + ' of the building overlap this spot and are selected. Look at them, then X deletes them (a big wall slab may be among them: Shift+click takes it out of the selection).' : 'No original piece of the building overlaps this spot.', hit.length ? 'ok' : 'warn');
        return hit.length;
    }

    // the faces of the building whose centres lie in the box of a placed window or door (a little wider and higher than the model, 35 cm each way across the wall): selected in the Delete faces tool
    function facesBehind(b) {
        const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw), hu = b.w / 2 + 0.02, hn = Math.max(b.d / 2, 0.35), z0 = b.zb - 0.02, z1 = b.zb + b.h + 0.02, hit = [];
        IM.shownFaces(true).forEach(f => { const dx = f.c[0] - b.cx, dy = f.c[1] - b.cy, du = dx * cs + dy * sn, dn = -dx * sn + dy * cs; if (Math.abs(du) <= hu && Math.abs(dn) <= hn && f.c[2] >= z0 && f.c[2] <= z1) hit.push(f); });
        fsel.clear(); hit.forEach(f => fsel.set(fk(f.file, f.g, f.tri), [f.file, f.g, f.tri]));
        M.App.setTool('faces'); selChanged();
        toast(hit.length ? hit.length + ' face' + (hit.length === 1 ? '' : 's') + ' of the building behind the model are selected. Look at them (Shift+click takes one out, a drag adds more), then X deletes them.' : 'No face of the building lies behind this model.', hit.length ? 'ok' : 'warn');
        return hit.length;
    }
    // the building's collision behind a placement: the Collision tool with the pieces that overlap the model's footprint selected
    function colBehind(b) {
        const cs = Math.abs(Math.cos(b.yaw)), sn = Math.abs(Math.sin(b.yaw)), hx = cs * b.w / 2 + sn * Math.max(b.d, 0.3) / 2, hy = sn * b.w / 2 + cs * Math.max(b.d, 0.3) / 2;
        return colSelectIn([b.cx - hx, b.cy - hy, b.cx + hx, b.cy + hy], [b.zb, b.zb + b.h]);
    }

    // ---------- Collision boxes: collision you build yourself ----------
    // Drag on the floor to draw a box (on a ledge or step of the model it stands on that surface). Click a box to select it (Shift+click adds or removes), drag it to move it,
    // drag a white handle to resize it (the stem on top changes the height), X deletes, Shift+D duplicates, R turns it 90 degrees. Nothing is drawn for a box in the game:
    // it only makes collision, with the surface type (material) chosen in the panel. The boxes are in the grid's coordinates, standing on the interior floor (z = 0).
    let cbsel = new Set();
    const cbList = () => imp().cboxes || [];
    const cbFind = (id) => cbList().find(b => b.id === id) || null;
    const cbLive = () => { if (!cbsel.size) return; const ids = new Set(cbList().map(b => b.id)); [...cbsel].forEach(id => { if (!ids.has(id)) cbsel.delete(id); }); };
    const cbOne = () => { cbLive(); return cbsel.size === 1 ? cbFind([...cbsel][0]) : null; };
    const cbCopy = (b) => JSON.parse(JSON.stringify(b));
    const cbFix = (y) => { const q = Math.round(y / (Math.PI / 2)); return Math.abs(y - q * Math.PI / 2) < 1e-4 ? q * Math.PI / 2 : Math.round(y * 1e6) / 1e6; };      // (an exact quarter turn stays exact)
    function cbPick(ray) { let best = null; cbList().forEach(b => { const t = boxHit(ray, b); if (t != null && (!best || t < best.t)) best = { t, b }; }); return best; }
    const CB_HANDLES = [['sw', -1, -1], ['se', 1, -1], ['ne', 1, 1], ['nw', -1, 1], ['s', 0, -1], ['n', 0, 1], ['w', -1, 0], ['e', 1, 0]];
    // the direction of "up on the screen" in the world, so the height handle stands out from the box whichever way the camera looks (seen from straight above it is not over the box)
    function cbUp() {
        const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(); cam.update(r.width / r.height);
        const a = cam.ray(0, 0).d, b = cam.ray(0, 0.3).d, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(u[0], u[1], u[2]) || 1;
        return [u[0] / l, u[1] / l, u[2] / l];
    }
    // the handles of a box: its eight footprint handles on the top face, and the stem above it (the height)
    function cbHandles(b) {
        const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw), top = b.zb + b.h, hu = b.w / 2, hn = b.d / 2, P = (su, sv, z) => [b.cx + su * hu * cs - sv * hn * sn, b.cy + su * hu * sn + sv * hn * cs, z];
        const up = cbUp(), L = Math.max(0.3, M.App.renderer.camera.dist * 0.05);
        return CB_HANDLES.map(h => ({ m: h[0], p: P(h[1], h[2], top) })).concat([{ m: 'top', p: [b.cx + up[0] * L, b.cy + up[1] * L, top + up[2] * L] }]);
    }
    // the handle (of the selected box) within 11 px of the pointer
    function cbHandleAt(b, e) {
        const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(); cam.update(r.width / r.height);
        const mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 11;
        cbHandles(b).forEach(h => { const s = cam.project(h.p, r.width, r.height); if (!s) return; const d = Math.hypot(s[0] - mx, s[1] - my); if (d < bd) { bd = d; best = h.m; } });
        return best;
    }
    // where a new box stands: on an upward-facing surface of the model under the pointer (a ledge, a step), else on the floor
    function cbBase(ray) {
        const mh = IM.pick(ray);
        if (mh && Math.abs(mh.n[2]) > 0.8 && mh.p[2] > -0.3 && mh.p[2] < S.project.settings.ceilH) return Math.round(mh.p[2] * 100) / 100;
        return 0;
    }
    function cbDown(e) {
        const one = cbOne(); if (one) { const m = cbHandleAt(one, e); if (m) { cbStart(one, m, e); return; } }
        const h = hover.cb;
        if (h) {
            const id = h.b.id;
            if (e.shiftKey) { if (cbsel.has(id)) cbsel.delete(id); else cbsel.add(id); M.UI.renderLeft(); return; }
            if (!cbsel.has(id)) { cbsel = new Set([id]); M.UI.renderLeft(); }
            cbStart(h.b, 'move', e); return;
        }
        const z = cbBase(hover.ray), ph = api().planeHit(hover.ray, z); if (!ph) return;
        cbd = { mode: 'new', z, p0: [ph.x, ph.y], px: [e.clientX, e.clientY], moved: false, shift: e.shiftKey, cur: null };
    }
    function cbStart(b, mode, e) {
        const top = b.zb + b.h, ph = api().planeHit(hover.ray, top);
        const d = { mode, id: b.id, b0: cbCopy(b), px: [e.clientX, e.clientY], moved: false, cur: null, z: top, p0: ph ? [ph.x, ph.y] : null, all: null };
        if (mode === 'move') d.all = [...cbsel].map(id => cbFind(id)).filter(Boolean).map(cbCopy);
        if (mode === 'top') {
            // the stem moves along the screen's up direction: how many pixels is a metre there
            const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(); cam.update(r.width / r.height);
            const p0 = cam.project([b.cx, b.cy, top], r.width, r.height), p1 = cam.project([b.cx, b.cy, top + 1], r.width, r.height);
            let vx = 0, vy = -80; if (p0 && p1) { const dx = p1[0] - p0[0], dy = p1[1] - p0[1]; if (dx * dx + dy * dy > 1600) { vx = dx; vy = dy; } }          // (seen from nearly straight above a metre is a few pixels: up on the screen is up, 80 px a metre)
            d.vx = vx; d.vy = vy;
        } else if (mode !== 'move' && ph) {
            // where the pointer is inside the grabbed edge, so the edge does not jump to the pointer
            const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw), lu = (ph.x - b.cx) * cs + (ph.y - b.cy) * sn, ln = -(ph.x - b.cx) * sn + (ph.y - b.cy) * cs;
            d.off = [mode.indexOf('w') >= 0 ? -b.w / 2 - lu : (mode.indexOf('e') >= 0 ? b.w / 2 - lu : 0), mode.indexOf('s') >= 0 ? -b.d / 2 - ln : (mode.indexOf('n') >= 0 ? b.d / 2 - ln : 0)];
        }
        cbd = d;
    }
    // while dragging the boxes are changed without history; letting go (or Esc / right-click) restores them and makes one undo step
    function cbMove(e) {
        const d = cbd; if (!d.moved && Math.hypot(e.clientX - d.px[0], e.clientY - d.px[1]) < 4) return; d.moved = true;
        const free = e.shiftKey, L = SH.lines(), put = (id, f) => { const b = cbFind(id); if (b) Object.assign(b, f); };
        if (d.mode === 'top') {
            const dz = ((e.clientX - d.px[0]) * d.vx + (e.clientY - d.px[1]) * d.vy) / (d.vx * d.vx + d.vy * d.vy), h0 = d.b0.h + (free ? dz * 0.1 : dz);
            const h = Math.max(0.05, free ? Math.round(h0 * 1000) / 1000 : Math.round(h0 / 0.05) * 0.05);
            if (d.cur && d.cur.h === h) return; d.cur = { h }; put(d.id, d.cur); bus.emit('change'); return;
        }
        const ph = api().planeHit(hover.ray, d.z); if (!ph) return;
        const sx = (v) => free ? r3(v) : SH.snapTo(v, L.xs), sy = (v) => free ? r3(v) : SH.snapTo(v, L.ys);
        if (d.mode === 'new') {
            const a = [sx(d.p0[0]), sy(d.p0[1])], b = [sx(ph.x), sy(ph.y)];
            d.cur = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; return;
        }
        const b0 = d.b0, cs = Math.cos(b0.yaw), sn = Math.sin(b0.yaw);
        if (d.mode === 'move') {
            // an edge that comes near a line of the model or of a room snaps to it, else the centre snaps to 5 cm
            const ac = Math.abs(cs), as = Math.abs(sn), ex = ac * b0.w / 2 + as * b0.d / 2, ey = as * b0.w / 2 + ac * b0.d / 2;
            const adj = (a, b, list, dd) => {
                if (free) return Math.round(dd * 1000) / 1000;
                let best = null, bd = 0.09; [a, b].forEach(e0 => (list || []).forEach(l => { const q = l - (e0 + dd); if (Math.abs(q) < bd) { bd = Math.abs(q); best = dd + q; } }));
                return best != null ? best : Math.round((a + dd) / 0.05) * 0.05 - a;
            };
            const dx = adj(b0.cx - ex, b0.cx + ex, L.xs, ph.x - d.p0[0]), dy = adj(b0.cy - ey, b0.cy + ey, L.ys, ph.y - d.p0[1]);
            d.cur = { dx, dy }; d.all.forEach(q => put(q.id, { cx: r3(q.cx + dx), cy: r3(q.cy + dy) })); bus.emit('change'); return;
        }
        // resizing: the pointer in the box's own axes; a box square to the grid snaps to lines, a turned one to 5 cm
        const snapL = (axis, v) => {
            if (free) return Math.round(v * 1000) / 1000;
            if (Math.abs(sn) < 1e-6) { if (axis === 'u') { const x = SH.snapTo(b0.cx + v * cs, L.xs); return (x - b0.cx) * cs; } const y = SH.snapTo(b0.cy + v * cs, L.ys); return (y - b0.cy) * cs; }
            if (Math.abs(cs) < 1e-6) { if (axis === 'u') { const y = SH.snapTo(b0.cy + v * sn, L.ys); return (y - b0.cy) * sn; } const x = SH.snapTo(b0.cx - v * sn, L.xs); return (b0.cx - x) * sn; }
            return Math.round(v / 0.05) * 0.05;
        };
        const lu = (ph.x - b0.cx) * cs + (ph.y - b0.cy) * sn + d.off[0], ln = -(ph.x - b0.cx) * sn + (ph.y - b0.cy) * cs + d.off[1];
        const r = [-b0.w / 2, -b0.d / 2, b0.w / 2, b0.d / 2], m = d.mode, MIN = 0.05;
        if (m.indexOf('w') >= 0) r[0] = Math.min(snapL('u', lu), r[2] - MIN);
        if (m.indexOf('e') >= 0) r[2] = Math.max(snapL('u', lu), r[0] + MIN);
        if (m.indexOf('s') >= 0) r[1] = Math.min(snapL('n', ln), r[3] - MIN);
        if (m.indexOf('n') >= 0) r[3] = Math.max(snapL('n', ln), r[1] + MIN);
        const lcu = (r[0] + r[2]) / 2, lcn = (r[1] + r[3]) / 2, f = { w: r3(r[2] - r[0]), d: r3(r[3] - r[1]), cx: r3(b0.cx + lcu * cs - lcn * sn), cy: r3(b0.cy + lcu * sn + lcn * cs) };
        if (d.cur && ['w', 'd', 'cx', 'cy'].every(k => d.cur[k] === f[k])) return; d.cur = f; put(d.id, f); bus.emit('change');
    }
    function cbEnd(commit) {
        const d = cbd; cbd = null; if (!d) return;
        if (d.mode === 'new') {
            const r = d.cur;
            if (!commit || !d.moved || !r) { if (commit && !d.moved && !d.shift && cbsel.size) { cbsel.clear(); M.UI.renderLeft(); } return; }
            if (r[2] - r[0] < 0.05 || r[3] - r[1] < 0.05) { toast('That box is too small (under 5 cm).', 'warn'); return; }
            const nb = { id: randId(), cx: r3((r[0] + r[2]) / 2), cy: r3((r[1] + r[3]) / 2), zb: d.z, w: r3(r[2] - r[0]), d: r3(r[3] - r[1]), h: S.cboxH || 1.0, yaw: 0, mat: S.cboxMat || 'concrete' };
            Model.edit(P => { (P.import.cboxes = P.import.cboxes || []).push(nb); }); cbsel = new Set([nb.id]); M.UI.renderLeft();
            toast('Collision box added: ' + nb.w.toFixed(2) + ' x ' + nb.d.toFixed(2) + ' x ' + nb.h.toFixed(2) + ' m. Drag the white handles to resize it; the stem on top sets the height.', 'ok'); return;
        }
        const orig = d.mode === 'move' ? d.all : [d.b0], fin = [];
        orig.forEach(q => { const b = cbFind(q.id); if (b) { fin.push([q.id, { cx: b.cx, cy: b.cy, w: b.w, d: b.d, h: b.h }]); b.cx = q.cx; b.cy = q.cy; b.w = q.w; b.d = q.d; b.h = q.h; } });
        if (commit && d.moved && fin.length) { Model.edit(P => { fin.forEach(f => { const b = P.import.cboxes.find(q => q.id === f[0]); if (b) Object.assign(b, f[1]); }); }); if (d.mode === 'top') S.cboxH = fin[0][1].h; }
        else bus.emit('change');
        M.UI.renderLeft();
    }
    function cbDelete() {
        cbLive(); if (!cbsel.size) { toast('Nothing selected. Click a collision box first; X deletes it.', 'warn'); return false; }
        const ids = new Set(cbsel), n = ids.size; Model.edit(P => { P.import.cboxes = (P.import.cboxes || []).filter(b => !ids.has(b.id)); }); cbsel.clear(); M.UI.renderLeft();
        toast(n + ' collision box' + (n === 1 ? '' : 'es') + ' deleted. Ctrl+Z brings ' + (n === 1 ? 'it' : 'them') + ' back.', 'ok'); return true;
    }
    function cbDuplicate() {
        cbLive(); if (!cbsel.size) { toast('Select a collision box first: Shift+D duplicates it.', 'warn'); return false; }
        const copies = [...cbsel].map(id => cbFind(id)).filter(Boolean).map(b => Object.assign(cbCopy(b), { id: randId(), cx: r3(b.cx + 0.25), cy: r3(b.cy + 0.25) }));
        Model.edit(P => { copies.forEach(c => P.import.cboxes.push(c)); }); cbsel = new Set(copies.map(c => c.id)); M.UI.renderLeft();
        toast(copies.length + ' copy made, 25 cm to the side.', 'ok'); return true;
    }
    function cbTurn(rad) {
        cbLive(); if (!cbsel.size) return false; const ids = new Set(cbsel);
        Model.edit(P => { P.import.cboxes.forEach(b => { if (ids.has(b.id)) b.yaw = cbFix(b.yaw + rad); }); }); M.UI.renderLeft(); return true;
    }
    // change fields of the selected boxes (the panel); with nothing selected a material or height is what new boxes get
    function cbSet(f) {
        cbLive(); if (f.mat) S.cboxMat = f.mat; if (f.h) S.cboxH = f.h;
        if (cbsel.size) { const ids = new Set(cbsel); Model.edit(P => { P.import.cboxes.forEach(b => { if (ids.has(b.id)) Object.assign(b, f); }); }); }
        M.UI.renderLeft();
    }
    function cbSelect(id, add) { if (add) { if (cbsel.has(id)) cbsel.delete(id); else cbsel.add(id); } else cbsel = new Set([id]); M.UI.renderLeft(); }
    function cbAll() { cbsel = new Set(cbList().map(b => b.id)); M.UI.renderLeft(); }
    function cbNone() { cbsel.clear(); M.UI.renderLeft(); }
    function cbInvert() { const nxt = new Set(); cbList().forEach(b => { if (!cbsel.has(b.id)) nxt.add(b.id); }); cbsel = nxt; M.UI.renderLeft(); }
    // a 1 m box in the middle of the rooms, for people who want to type the numbers
    function cbAddMiddle() {
        const b = interiorBox(), nb = { id: randId(), cx: b ? r3(Math.round((b.mn[0] + b.mx[0]) / 2 / 0.05) * 0.05) : 0, cy: b ? r3(Math.round((b.mn[1] + b.mx[1]) / 2 / 0.05) * 0.05) : 0, zb: 0, w: 1, d: 1, h: S.cboxH || 1.0, yaw: 0, mat: S.cboxMat || 'concrete' };
        Model.edit(P => { (P.import.cboxes = P.import.cboxes || []).push(nb); }); cbsel = new Set([nb.id]); M.UI.renderLeft();
    }
    // a collision box around the faces selected in the Delete faces tool (the box around their corners in the grid's directions; at least 6 cm each way)
    function cbFromFaces() {
        selSync(); if (!fsel.size) { toast('Select faces first (click, or drag a box), then make a collision box around them.', 'warn'); return false; }
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        fsel.forEach(v => { const c = IM.triCorners(v[1], v[2], v[0]); if (c) c.forEach(p => { for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; } }); });
        if (mn[0] > mx[0]) { toast('Could not read the selected faces.', 'warn'); return false; }
        for (let a = 0; a < 3; a++) if (mx[a] - mn[a] < 0.06) { const c = (mx[a] + mn[a]) / 2; mn[a] = c - 0.03; mx[a] = c + 0.03; }
        const nb = { id: randId(), cx: r3((mn[0] + mx[0]) / 2), cy: r3((mn[1] + mx[1]) / 2), zb: r3(mn[2]), w: r3(mx[0] - mn[0]), d: r3(mx[1] - mn[1]), h: r3(mx[2] - mn[2]), yaw: 0, mat: S.cboxMat || 'concrete' };
        Model.edit(P => { (P.import.cboxes = P.import.cboxes || []).push(nb); }); cbsel = new Set([nb.id]); S.showMyCol = true; M.UI.renderLeft(); M.UI.renderRight();
        toast('Collision box made around the ' + fsel.size + ' selected face' + (fsel.size === 1 ? '' : 's') + ': ' + nb.w.toFixed(2) + ' x ' + nb.d.toFixed(2) + ' x ' + nb.h.toFixed(2) + ' m. Open the Collision box tool to change its material or size.', 'ok'); return true;
    }
    // outlines
    const GEN_COL = [0.3, 0.85, 0.9, 0.42], CB_HOT = [1, 0.93, 0.55, 1];
    function obEdges(R, c, hu, hn, hz, yaw, col) {
        const ux = Math.cos(yaw), uy = Math.sin(yaw), nx = -uy, ny = ux, P = (a, b, z) => [c[0] + a * hu * ux + b * hn * nx, c[1] + a * hu * uy + b * hn * ny, c[2] + z * hz];
        const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
        [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => R.ovTopLine(v[e[0]], v[e[1]], col));
    }
    const cbStar = (R, p, s, col) => {
        R.ovTopQuad([p[0] - s, p[1] - s, p[2]], [p[0] + s, p[1] - s, p[2]], [p[0] + s, p[1] + s, p[2]], [p[0] - s, p[1] + s, p[2]], col);
        R.ovTopQuad([p[0] - s, p[1], p[2] - s], [p[0] + s, p[1], p[2] - s], [p[0] + s, p[1], p[2] + s], [p[0] - s, p[1], p[2] + s], col);
        R.ovTopQuad([p[0], p[1] - s, p[2] - s], [p[0], p[1] + s, p[2] - s], [p[0], p[1] + s, p[2] + s], [p[0], p[1] - s, p[2] + s], col);
    };
    // what the game will collide with in the interior: what the rooms make by themselves (teal outlines) and your boxes (their material's colour, shown filled)
    function drawCBoxes(R, active) {
        const gen = (M.App.built && M.App.built.boxes) || [];
        gen.forEach(b => { if (b[7] && b[7].user) return; obEdges(R, [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], (b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2, 0, GEN_COL); });
        cbLive();
        cbList().forEach(b => {
            const m = M.COLMATS.get(b.mat), sel = cbsel.has(b.id), hov = active && !cbd && hover && hover.cb && hover.cb.b.id === b.id, c = [b.cx, b.cy, b.zb + b.h / 2];
            R.ovOBox(c, b.w / 2, b.d / 2, b.h / 2, b.yaw, sel ? [0.35, 0.9, 0.55, 0.30] : [m.col[0], m.col[1], m.col[2], hov ? 0.32 : 0.16], null);
            obEdges(R, c, b.w / 2, b.d / 2, b.h / 2, b.yaw, sel || hov ? [1, 1, 1, 1] : [m.col[0], m.col[1], m.col[2], 0.95]);
        });
        const one = cbOne();
        if (active && one && !(cbd && cbd.mode === 'new')) {
            const hs = Math.max(0.04, M.App.renderer.camera.dist * 0.0055), hm = cbd ? cbd.mode : (hover && hover.cbm), top = one.zb + one.h;
            R.ovTopLine([one.cx, one.cy, top], cbHandles(one)[8].p, [1, 1, 1, 0.7]);
            cbHandles(one).forEach(h => cbStar(R, h.p, hm === h.m ? hs * 1.5 : hs, hm === h.m ? CB_HOT : [1, 1, 1, 0.95]));
        }
        // the box being drawn
        if (cbd && cbd.mode === 'new' && cbd.cur) {
            const r = cbd.cur, h = S.cboxH || 1.0, m = M.COLMATS.get(S.cboxMat);
            if (r[2] > r[0] && r[3] > r[1]) { const c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, cbd.z + h / 2]; R.ovOBox(c, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, h / 2, 0, [m.col[0], m.col[1], m.col[2], 0.28], null); obEdges(R, c, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2, h / 2, 0, [1, 1, 1, 1]); }
        }
    }
    function cbCursor() {
        const hm = cbd ? cbd.mode : (hover && hover.cbm); if (hm) return hm === 'top' ? 'ns-resize' : (CURSORS[hm] || 'move');
        return (hover && hover.cb && !cbd) ? 'move' : '';
    }

    // ---------- overlays ----------
    function cutterBox(R, k, col, edge, dx, dy, dz) { R.ovOBox([k.cx + (dx || 0), k.cy + (dy || 0), k.zb + (dz || 0) + k.h / 2], k.w / 2, k.d / 2, k.h / 2, k.yaw, col, edge); }

    function draw(R, lbl) {
        const t = S.shellTool, I = imp(); labelFn = lbl;
        // the grid's corner and directions
        R.ovQuad([-0.05, -0.05, 0.02], [0.05, -0.05, 0.02], [0.05, 0.05, 0.02], [-0.05, 0.05, 0.02], [1, 1, 1, 0.9]);
        R.ovLine([0, 0, 0.03], [1.2, 0, 0.03], [0.95, 0.35, 0.3, 0.95]); R.ovLine([0, 0, 0.03], [0, 1.2, 0.03], [0.4, 0.9, 0.45, 0.95]);
        // the map's plants around the building (when they have been looked up)
        if (M.Plants) M.Plants.draw(R);
        // lights
        (S.project.shell.lights || []).forEach(l => R.ovBox([l.x - 0.12, l.y - 0.12, S.project.settings.ceilH - 0.35], [l.x + 0.12, l.y + 0.12, S.project.settings.ceilH - 0.12], C.amber));
        // the scale figure, in every tool once it has been put down
        if (S.figure) M.Figure.draw(R, S.figure, (t === 'figure' && (fd || (hover && hover.fh))) ? 'hot' : 'normal');
        // cutters
        const showCut = t === 'door' || t === 'window' || t === 'arch' || t === 'select' || t === 'eraser';
        I.cutters.forEach(k => {
            const sel = S.cutSel === k.id, hov = hover && hover.cut && hover.cut.k.id === k.id && showCut;
            const off = drag && drag.id === k.id ? { dx: Math.cos(k.yaw) * drag.du, dy: Math.sin(k.yaw) * drag.du, dz: drag.dz } : { dx: 0, dy: 0, dz: 0 };
            if (sel || hov || showCut) cutterBox(R, k, sel ? C.sel : (hov ? (t === 'eraser' ? C.bad : C.hov) : C.cut), sel ? C.selEdge : C.cutEdge, off.dx, off.dy, off.dz);
            else cutterBox(R, k, null, C.thin);
        });
        let text = null, at = null;
        if (t === 'cbox' || S.showMyCol) drawCBoxes(R, t === 'cbox');
        if (t === 'walk' || S.showWalk) M.Walk.draw(R, null);
        // the parts of the selected building, when the others are shown as well
        if (IM.selComps && IM.isoMode() !== 'hide') IM.selComps.forEach(id => { const b = IM.compBox(id); R.ovOBox(b.c, b.hu, b.hn, b.hz, b.yaw, null, [0.4, 0.9, 0.55, 0.75]); });
        if (t === 'building') {
            const h = hover && hover.pc;
            if (h && h.comp >= 0) {
                const b = IM.compBox(h.comp), shift = lastEvt && lastEvt.shiftKey && IM.selComps; R.ovOBox(b.c, b.hu, b.hn, b.hz, b.yaw, IM.isolating() ? null : C.hov, C.selEdge);
                text = shift ? (IM.selComps.has(h.comp) ? 'Shift: take this part out of the building' : 'Shift: add this part to the building') : 'Select this building (' + IM.comp.comps[h.comp].tris + ' triangles). Shift adds a part.'; at = [b.c[0], b.c[1], b.c[2] + b.hz + 0.5];
            }
        } else if (t === 'door' || t === 'window') {
            const p = hover && hover.patch, onCutter = hover && hover.cut && hover.face && hover.cut.t < hover.face.t + 0.3;
            if (p && !onCutter) {
                drawPatch(R, p, t === 'window' ? [0.45, 0.75, 0.95, 0.5] : [0.95, 0.7, 0.35, 0.5]);
                const r = IM.faceRect({ g: p.g, tris: p.tris }), c0 = IM.triCorners(p.g, p.tris[0]);
                if (r && c0) {
                    const what = t === 'window' ? 'cut out, fill with glass' : (IM.doorModel() ? 'cut out, fill with the door model' : 'cut out (no door model chosen)');
                    text = (t === 'window' ? 'Window ' : 'Door ') + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m: click to ' + what; at = [r.cx, r.cy, r.zb + r.h + 0.25];
                } else { text = 'Not a wall face'; at = c0 ? [c0[0][0], c0[0][1], c0[0][2] + 0.3] : null; }
            } else if (!hover || !hover.cut) { text = 'Point at the faces of a ' + t; at = null; }
        } else if (t === 'arch') {
            const s = hover && hover.surf;
            if (s && !s.part && !(hover.cut && hover.cut.t < (s.mh ? s.mh.t : 1e9) + 0.3)) {
                const k = newCutter(t, s);
                if (k) { cutterBox(R, k, C.hov, C.selEdge); text = NAMES[t] + ' ' + k.w.toFixed(2) + ' x ' + k.h.toFixed(2) + ' m'; at = [k.cx, k.cy, k.zb + k.h + 0.2]; }
                else { text = 'Click a wall'; at = [s.p[0], s.p[1], s.p[2] + 0.3]; }
            } else if (s && s.part) {
                const pt = s.part.pt, spec = M.Shell.OPEN[t] || M.Shell.OPEN.window, u = s.part.u, h = M.Shell && S.project.settings.partT / 2 + 0.03;
                if (pt) { if (pt.o === 'H') R.ovBox([u - spec.w / 2, pt.c - h, spec.z0], [u + spec.w / 2, pt.c + h, spec.z1], C.hov, [1, 1, 1, 0.9]); else R.ovBox([pt.c - h, u - spec.w / 2, spec.z0], [pt.c + h, u + spec.w / 2, spec.z1], C.hov, [1, 1, 1, 0.9]); }
            }
        } else if (t === 'frame') {
            const h = hover && hover.mh;
            if (h) {
                const fl = Math.abs(h.n[2]) > 0.8, wl = Math.abs(h.n[2]) < 0.3;
                R.ovBox([h.p[0] - 0.12, h.p[1] - 0.12, h.p[2] - 0.02], [h.p[0] + 0.12, h.p[1] + 0.12, h.p[2] + 0.5], fl ? C.sel : (wl ? C.cut : C.bad), C.selEdge);
                const e = lastEvt;
                text = (e && e.altKey) ? 'Alt: move the corner (0, 0) here' : (fl ? 'Floor: set the corner and floor height here' : (wl ? ((e && e.shiftKey) ? 'Shift: floor = the bottom edge of this wall' : 'Wall: square the grid to it (Shift: set the floor, Alt: set the corner)') : 'Not a floor or a wall')); at = [h.p[0], h.p[1], h.p[2] + 0.7];
            }
        } else if (t === 'faces') {
            selSync();
            // what is selected (orange), then what a click would select (white)
            let total = 0; selGroups().forEach(gr => { total += gr.tris.length; }); const sstep = Math.max(1, Math.ceil(total / 5000));      // a big selection is drawn thinned out
            selGroups().forEach(gr => drawPatch(R, { file: gr.file, g: gr.g, tris: sstep > 1 ? gr.tris.filter((_, i) => i % sstep === 0) : gr.tris }, [1, 0.62, 0.2, 0.55]));
            const p = hover && hover.fpatch;
            if (fdrag && fdrag.moved) { text = 'Release: select the faces in the box' + (fdrag.shift ? ' (add)' : (fdrag.ctrl ? ' (take away)' : '')); at = null; }
            else if (p && p.groups.length) {
                let n = 0, first = null; p.groups.forEach(gr => { n += gr.tris.length; });
                const step = Math.max(1, Math.ceil(n / 5000));
                p.groups.forEach(gr => drawPatch(R, { file: p.file, g: gr.g, tris: step > 1 ? gr.tris.filter((_, i) => i % step === 0) : gr.tris }, [1, 1, 1, 0.28]));
                const g0 = p.groups[0]; first = IM.triCorners(g0.g, g0.tris[0], p.file);
                const where = isTargetFile(p.file) ? '' : p.file.replace(/\.ydr$/i, '') + ': ';
                text = where + n + ' face' + (n === 1 ? '' : 's') + (p.mode === 'island' ? ' (the whole connected piece)' : (p.mode === 'one' ? ' (one triangle)' : ' (the flat patch)')) + ': click selects. Shift: add. Ctrl: one triangle. Alt: connected piece'; if (first) at = [first[0][0], first[0][1], first[0][2] + 0.3];
            } else if (fsel.size) { text = fsel.size + ' face' + (fsel.size === 1 ? '' : 's') + ' selected: X deletes them'; at = null; }
            else if (!hover || !hover.face) { text = IM.showDetails ? 'Point at a face (or drag a box). Detail models are shown' : 'Point at a face (or drag a box). Turn on "Detail models" to reach grilles, vents and bushes'; at = null; }
        } else if (t === 'parts') {
            const hl = (f, g, col) => { const tr = IM.partTris(f, g); if (!tr) return; const n = tr.length / 9, step = Math.max(1, Math.ceil(n / 6000)); for (let i = 0; i < n; i += step) { const o = i * 9, a = [tr[o], tr[o + 1], tr[o + 2]], b = [tr[o + 3], tr[o + 4], tr[o + 5]], c = [tr[o + 6], tr[o + 7], tr[o + 8]]; R.ovTopQuad(a, b, c, c, col); } };
            if (S.partHover) hl(S.partHover.f, S.partHover.g, [1, 0.8, 0.3, 0.30]);
            if (S.partSel) hl(S.partSel.f, S.partSel.g, [0.45, 1, 0.55, 0.30]);
            const o = hover && hover.face; if (o && !(S.partSel && S.partSel.f === o.file && S.partSel.g === o.g)) hl(o.file, o.g, [1, 1, 1, 0.14]);
            if (o) { const m = IM.models.find(x => x.file === o.file), geo = m && m.geoms.find(x => x.g === o.g); text = (geo ? geo.texName : 'part') + (m && !m.target ? ' in ' + m.file.replace(/\.ydr$/i, '') : '') + ': click to choose this part'; const c0 = IM.triCorners(o.g, o.tri, o.file); if (c0) at = [c0[0][0], c0[0][1], c0[0][2] + 0.3]; }
        } else if (t === 'collision') {
            const cp = IM.colShell();
            if (cp) {
                colSyncSel(); let n = 0; for (const i of csel) { if (n++ > 800) break; drawColPiece(R, cp, i, [0.35, 1, 0.55, 1]); }
                const h = hover ? hover.col : -1;
                if (fdrag && fdrag.moved && fdrag.col) { text = 'Release: select the collision pieces in the box' + (fdrag.shift ? ' (add)' : (fdrag.ctrl ? ' (take away)' : '')); at = null; }
                else if (h != null && h >= 0 && !csel.has(h)) {
                    drawColPiece(R, cp, h, [1, 1, 1, 1]);
                    const mx = [0, 1, 2].map(a => cp.box[h * 6 + 3 + a] - cp.box[h * 6 + a]);
                    text = cp.files[cp.meta[h * 5]] + ' - ' + (cp.meta[h * 5 + 3] === 0 ? 'triangle' : 'box') + ', material ' + cp.meta[h * 5 + 4] + ', ' + mx.map(v => v.toFixed(2)).join(' x ') + ' m: click selects, Shift adds'; at = [cp.ctr[h * 3], cp.ctr[h * 3 + 1], cp.ctr[h * 3 + 2] + 0.3];
                } else if (csel.size) { text = csel.size + ' collision piece' + (csel.size === 1 ? '' : 's') + ' selected: X deletes them'; at = null; }
                else if (!IM.colRegion().length) { text = IM.colPolys ? 'No collision pieces near the rooms' : 'Reading the collision...'; at = null; }
                else { text = 'Point at a collision piece (the orange lines) or drag a box'; at = null; }
            }
        } else if (t === 'cbox') {
            const h = hover && hover.cb ? hover.cb.b : null, one = cbOne(), md = M.COLMATS.get(S.cboxMat).name;
            if (cbd && cbd.mode === 'new' && cbd.cur) { const r = cbd.cur; text = (r[2] - r[0]).toFixed(2) + ' x ' + (r[3] - r[1]).toFixed(2) + ' x ' + (S.cboxH || 1.0).toFixed(2) + ' m  ' + md + (cbd.z ? '  on a surface ' + cbd.z.toFixed(2) + ' m up' : ''); at = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, cbd.z + (S.cboxH || 1.0) + 0.3]; }
            else if (cbd && cbd.mode !== 'new') { const b = cbFind(cbd.id); if (b) { text = cbd.mode === 'move' ? 'Moving: ' + b.cx.toFixed(2) + ', ' + b.cy.toFixed(2) : b.w.toFixed(2) + ' x ' + b.d.toFixed(2) + ' x ' + b.h.toFixed(2) + ' m'; at = [b.cx, b.cy, b.zb + b.h + 0.3]; } }
            else if (hover && hover.cbm && one) { text = hover.cbm === 'top' ? 'Drag: the height. Shift: fine' : 'Drag: resize. Shift: no snapping'; at = [one.cx, one.cy, one.zb + one.h + 0.3]; }
            else if (h) { text = M.COLMATS.get(h.mat).name + ' ' + h.w.toFixed(2) + ' x ' + h.d.toFixed(2) + ' x ' + h.h.toFixed(2) + ' m: click selects, drag moves. X deletes'; at = [h.cx, h.cy, h.zb + h.h + 0.3]; }
            else if (cbsel.size) { text = cbsel.size + ' collision box' + (cbsel.size === 1 ? '' : 'es') + ' selected: X deletes, Shift+D duplicates, R turns'; at = null; }
            else { text = 'Drag on the floor to draw a collision box (' + md + ')'; at = null; }
        } else if (t === 'walk') {
            const p = hover && hover.wp; if (p) { text = 'Click: walk from here'; at = [p[0], p[1], 0.3]; }
        } else if (t === 'figure') {
            const f = S.figure, sp = hover && hover.fs;
            if (f) { text = f.h.toFixed(2) + ' m' + (hover && hover.fh && !fd ? '   drag to move, R turns it' : ''); at = [f.x, f.y, f.z + f.h + 0.25]; }
            else if (sp) { M.Figure.draw(R, { x: sp.x, y: sp.y, z: sp.z, yaw: figureYaw(), h: M.Figure.DEFAULT_H }, 'ghost'); text = 'Click: stand the ' + M.Figure.DEFAULT_H.toFixed(1) + ' m figure here'; at = [sp.x, sp.y, sp.z + M.Figure.DEFAULT_H + 0.25]; }
        } else if (t === 'level') {
            const a = gizmoAt(), L = gizmoLen(), b = interiorBox(), hot = !!(lvl || (hover && hover.gz)); drawGizmo(R, hot);
            if (lvl) {
                // where the floor was, so the move can be judged against the model
                if (b && lvl.dz) {
                    const z = -lvl.dz, g0 = [0.82, 0.82, 0.88, 0.16], ge = [0.85, 0.85, 0.92, 0.75], c4 = [[b.mn[0], b.mn[1], z], [b.mx[0], b.mn[1], z], [b.mx[0], b.mx[1], z], [b.mn[0], b.mx[1], z]];
                    R.ovQuad(c4[0], c4[1], c4[2], c4[3], g0); for (let i = 0; i < 4; i++) R.ovLine(c4[i], c4[(i + 1) % 4], ge);
                    R.ovTopLine([a[0], a[1], z], [a[0], a[1], 0], [1, 0.93, 0.55, 0.9]);
                }
                text = (lvl.dz > 0 ? '+' : '') + lvl.dz.toFixed(2) + ' m   floor at ' + I.frame.z.toFixed(3); at = [a[0], a[1], a[2] + L * 1.12];
            } else if (hover && hover.gz) { text = 'Drag: raise or lower the rooms. Ctrl: 5 cm steps, Shift: fine, Esc or right-click: cancel'; at = [a[0], a[1], a[2] + L * 1.12]; }
            else {
                const h = hover && hover.mh;
                if (h && Math.abs(h.n[2]) > 0.8) {
                    R.ovBox([h.p[0] - 0.12, h.p[1] - 0.12, h.p[2] - 0.02], [h.p[0] + 0.12, h.p[1] + 0.12, h.p[2] + 0.5], C.sel, C.selEdge);
                    text = 'Click: put the rooms\' floor here (' + (h.p[2] > 0 ? 'raise ' : 'lower ') + Math.abs(h.p[2]).toFixed(2) + ' m)'; at = [h.p[0], h.p[1], h.p[2] + 0.7];
                }
            }
        } else if (t === 'fill') {
            const F = findGaps(maxGap()), tg = fillTarget(hover), z = 0.016, quad = (r, col) => R.ovQuad([r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z], col);
            F.comps.forEach(cp => cp.rects.forEach(r => quad(r, [0.4, 0.9, 0.5, 0.22])));
            // gaps in the model's wall beside cut-out windows and doors (the frame closes them)
            I.cutters.forEach(k => {
                const gp = k.face && IM.gapAround(k); if (!gp) return;
                const hw = k.w / 2, zt = k.zb + k.h, ct = Math.cos(k.yaw), st = Math.sin(k.yaw), dn = IM.depthOf(k), z0 = k.zb - gp.b, z1 = zt + gp.t;
                const box = (ua, ub, za, zb) => R.ovOBox([k.cx + (ua + ub) / 2 * ct - dn * st, k.cy + (ua + ub) / 2 * st + dn * ct, (za + zb) / 2], (ub - ua) / 2, 0.04, (zb - za) / 2, k.yaw, [1, 0.6, 0.2, 0.6], [1, 1, 1, 0.9]);
                if (gp.l) box(-hw - gp.l, -hw, z0, z1); if (gp.r) box(hw, hw + gp.r, z0, z1); if (gp.b) box(-hw, hw, z0, k.zb); if (gp.t) box(-hw, hw, zt, z1);
            });
            if (tg && tg.rects) {
                let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, area = 0;
                tg.rects.forEach(r => { quad(r, [1, 0.85, 0.35, 0.55]); x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); area += (r[2] - r[0]) * (r[3] - r[1]);
                    const e = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; for (let i = 0; i < 4; i++) R.ovLine([e[i][0], e[i][1], z + 0.01], [e[(i + 1) % 4][0], e[(i + 1) % 4][1], z + 0.01], [1, 1, 1, 0.9]); });
                text = (tg.kind === 'hole' ? 'Fill this hole' : 'Fill this gap') + ' (' + area.toFixed(2) + ' m2): click'; at = [(x0 + x1) / 2, (y0 + y1) / 2, 0.4];
            } else if (tg && tg.open) { text = 'Open to the outside: not a hole'; at = [hover.g.rx, hover.g.ry, 0.4]; }
        } else if (t === 'edges') {
            const list = IM.edgeView(edgeOpts()), h = hover && hover.edge ? hover.edge.e : null, sel = [];
            list.forEach(e => {
                const on = edgeSel.has(e.k), hot = h && h.k === e.k, col = on ? [0.45, 1, 0.55, 1] : (hot ? [1, 1, 1, 1] : [1, 0.6, 0.2, 0.85]);
                R.ovTopLine(e.sa, e.sb, col); if (on || hot) { const up = [e.sa[0], e.sa[1], e.sa[2] + 0.004], vp = [e.sb[0], e.sb[1], e.sb[2] + 0.004]; R.ovTopLine(up, vp, col); }
                if (on) sel.push(e);
            });
            sel.forEach(e => [e.sa, e.sb].forEach(p => R.ovBox([p[0] - 0.012, p[1] - 0.012, p[2] - 0.012], [p[0] + 0.012, p[1] + 0.012, p[2] + 0.012], [0.45, 1, 0.55, 0.9], null)));
            // holes that are already filled
            (I.fills || []).forEach(f => {
                const q = f.pts.map(p => IM.toShell(p[0], p[1], p[2]));
                f.tris.forEach(tr => { for (let i = 0; i < 3; i++) R.ovTopLine(q[tr[i]], q[tr[(i + 1) % 3]], [0.4, 0.8, 1, 0.55]); });
            });
            if (hover && hover.edge) { const e = hover.edge.e, loop = IM.edgeLoop(e).length; text = 'Click: select this edge. Shift: add. Alt+click: the whole loop (' + loop + ' edge' + (loop === 1 ? '' : 's') + ')'; at = [(e.sa[0] + e.sb[0]) / 2, (e.sa[1] + e.sb[1]) / 2, (e.sa[2] + e.sb[2]) / 2 + 0.2]; }
            else if (edgeSel.size) { const c = sel.length ? sel[0] : null; if (c) { text = edgeSel.size + ' edge' + (edgeSel.size === 1 ? '' : 's') + ' selected: F fills the hole'; at = [c.sa[0], c.sa[1], c.sa[2] + 0.3]; } }
            else if (!list.length) { text = 'No open edges near the rooms' + (S.edgeHolesOnly ? ' (only holes from deleted faces are shown)' : '') + '.'; at = null; }
        } else if (t === 'light') {
            const g = hover && hover.g; if (g) { R.ovBox([g.rx - 0.12, g.ry - 0.12, S.project.settings.ceilH - 0.35], [g.rx + 0.12, g.ry + 0.12, S.project.settings.ceilH - 0.12], [1, 0.9, 0.5, 0.5], C.selEdge); }
        } else if (t === 'fit') {
            const r = M.FitModels.draw(R); if (r) { text = r.text; at = r.at; }
        } else if (t === 'plants') {
            const r = M.Plants.tool.draw(R); if (r) { text = r.text; at = r.at; }
        }
        if (t === 'room' || t === 'cut' || t === 'part' || t === 'floor' || t === 'select' || t === 'eraser' || t === 'paint') SH.draw(R, label);
        else label(text, at);
        if (t === 'select') drawRoomSel(R); else M.App.canvas.style.cursor = t === 'cbox' ? cbCursor() : '';
    }

    const KEYS = { o: 'frame', l: 'light', f: 'faces', b: 'building', g: 'level', j: 'fill', h: 'figure', k: 'edges', p: 'parts', m: 'collision', n: 'cbox', u: 'walk', i: 'fit', y: 'plants' };
    function toggleCutaway() {
        IM.cutOn = !IM.cutOn; IM.applyCut(); M.UI.renderLeft(); M.UI.renderRight();
        toast(IM.cutOn ? 'Cutaway on: the model is hidden above ' + IM.cutH().toFixed(2) + ' m. C turns it off.' : 'Cutaway off.', 'ok');
    }
    function key(k) {
        if (k === 'c' && (S.tab === 'build' || S.tab === 'furnish')) { toggleCutaway(); return true; }
        if (k === 'r' && S.shellTool === 'figure' && S.figure) { S.figure.yaw += Math.PI / 4; return true; }
        // the Delete faces tool works like Blender's edit mode: A selects all, L the piece under the pointer, X / Delete deletes the selection, Esc selects none
        if (S.shellTool === 'faces' && S.tab === 'build') {
            if (k === 'a') { facesSelectAll(); return true; }
            if (k === 'l') { facesLinked(false); return true; }
            if (k === 'x' || k === 'Delete' || k === 'Backspace') { facesDelete(); return true; }
            if (k === 'Escape' && fsel.size) { facesSelectNone(); return true; }
        }
        // the Collision tool: A selects all, X / Delete deletes the selection, Esc selects none
        if (S.shellTool === 'collision' && S.tab === 'build') {
            if (k === 'a') { colAll(); return true; }
            if (k === 'x' || k === 'Delete' || k === 'Backspace') { colDelete(); return true; }
            if (k === 'Escape' && csel.size) { colNone(); return true; }
        }
        // the Models tool: R turns the placed model 90 degrees, X / Delete removes it, Esc cancels a drag, then deselects, then forgets the chosen model
        if (S.shellTool === 'fit' && (S.tab === 'build' || S.tab === 'furnish') && M.FitModels.key(k)) return true;
        // the Plants tool: A selects all, X / Delete removes the selection, R keeps it, Esc selects none
        if (S.shellTool === 'plants' && S.tab === 'build' && M.Plants.tool.key(k)) return true;
        // the Collision box tool: A selects all, X / Delete deletes, R turns the selection 90 degrees, Esc cancels a drag or selects none
        if (S.shellTool === 'cbox' && S.tab === 'build') {
            if (k === 'a') { cbAll(); return true; }
            if (k === 'x' || k === 'Delete' || k === 'Backspace') { cbDelete(); return true; }
            if (k === 'r') { if (!cbTurn(Math.PI / 2)) toast('Select a collision box first: R turns it 90 degrees.', 'warn'); return true; }
            if (k === 'Escape') { if (cbd) { cbEnd(false); return true; } if (cbsel.size) { cbNone(); return true; } }
        }
        // the Edges tool keeps F (fill, as in Blender), A (select all) and Esc (select none) for itself
        if (S.shellTool === 'edges' && S.tab === 'build') {
            if (k === 'f') { edgesFill(); return true; }
            if (k === 'a') { edgesSelectAll(edgeSel.size === 0); return true; }
            if (k === 'Escape' && edgeSel.size) { edgesSelectAll(false); return true; }
        }
        // a selected room: Delete, Backspace or X removes it (X is the eraser tool otherwise)
        if ((k === 'x' || k === 'Delete' || k === 'Backspace') && S.shellTool === 'select' && S.opSel != null && !S.cutSel && !S.shellSel && !rd && deleteRoom()) return true;
        if (KEYS[k]) { M.App.setTool(KEYS[k]); return true; }
        if (k === 'Escape') { if (fd) { figureEnd(false); return true; } if (rd) roomEnd(false); else if (S.shellTool === 'select' && S.opSel != null && !lvl && !drag) { S.opSel = null; M.UI.renderLeft(); } if (lvl) levelEnd(false); drag = null; SH.cancel(); return true; }
        if ((k === 'Delete' || k === 'Backspace') && S.cutSel) { const id = S.cutSel; Model.edit(P => { IM.removeCutterIn(P, id); }); S.cutSel = null; bus.emit('cutsel'); return true; }
        return SH.key(k);
    }

    // keys with modifiers (Blender's): Alt+A select none, Ctrl+I invert, Ctrl+L grow to whole pieces, Shift+G select the same texture. true = handled
    function keyEv(e, k) {
        if (S.shellTool === 'fit' && (S.tab === 'build' || S.tab === 'furnish')) return M.FitModels.keyEv(e, k);
        if (S.shellTool === 'plants' && S.tab === 'build') return M.Plants.tool.keyEv(e, k);
        if (S.shellTool === 'collision' && S.tab === 'build') {
            if (e.altKey && k === 'a') { colNone(); return true; }
            if ((e.ctrlKey || e.metaKey) && k === 'i') { colInvert(); return true; }
            if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'g') { colSameMaterial(); return true; }
            return false;
        }
        if (S.shellTool === 'cbox' && S.tab === 'build') {
            if (e.altKey && k === 'a') { cbNone(); return true; }
            if ((e.ctrlKey || e.metaKey) && k === 'i') { cbInvert(); return true; }
            if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'd') { cbDuplicate(); return true; }
            return false;
        }
        if (S.shellTool !== 'faces' || S.tab !== 'build') return false;
        if (e.altKey && k === 'a') { facesSelectNone(); return true; }
        if ((e.ctrlKey || e.metaKey) && k === 'i') { facesInvert(); return true; }
        if ((e.ctrlKey || e.metaKey) && k === 'l') { facesLinked(true); return true; }
        if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'g') { facesSimilar(); return true; }
        return false;
    }
    M.ImportTools = { down, move, up, draw, key, keyEv, col: { count: () => { colSyncSel(); return csel.size; }, region: () => IM.colRegion().length, selectAll: colAll, none: colNone, invert: colInvert, same: colSameMaterial, del: colDelete, hovered: () => (hover && hover.col != null) ? hover.col : -1 }, surfaceAt, colBehind, faces: { selectBehind: facesBehind, count: () => { selSync(); return fsel.size; }, selectAll: facesSelectAll, none: facesSelectNone, invert: facesInvert, similar: facesSimilar, linked: () => facesLinked(true), del: facesDelete, selectPart: facesSelectPart, toBox: cbFromFaces },
        cbox: { count: () => { cbLive(); return cbsel.size; }, one: cbOne, selected: () => { cbLive(); return [...cbsel]; }, list: cbList, select: cbSelect, all: cbAll, none: cbNone, invert: cbInvert, del: cbDelete, dup: cbDuplicate, turn: cbTurn, set: cbSet, addMiddle: cbAddMiddle },
        colSelectIn, cancelTransform, deleteRoom, toggleCutaway, state: () => ({ level: !!lvl, room: rd ? rd.mode : null, cutter: !!drag, shell: SH.dragging, figure: !!fd, cbox: cbd ? cbd.mode : null, fit: M.FitModels.state() }), gaps: () => findGaps(maxGap()), fillAll, edges: { view: () => IM.edgeView(edgeOpts()), selected: () => edgeSel.size, selectAll: edgesSelectAll, fill: edgesFill, hovered: () => hover && hover.edge ? hover.edge.e : null }, cancel() { if (rd) roomEnd(false); if (lvl) levelEnd(false); if (cbd) cbEnd(false); drag = null; SH.cancel(); }, setLabel(f) { labelFn = f; SH.setLabel(f); }, updateCutter, findCutter, selectCutter, NAMES, DEF, get hover() { return hover; } };
})(window.MLO);
