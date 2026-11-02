// The imported model in the editor: loads the files through the host, puts the model into the project's frame (floor at z = 0, walls square to the grid),
// shows it textured, picks its triangles with the mouse, and asks the host for the cut result whenever cutters or deleted faces change.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, bus = Model.bus;
    const IM = M.ImportModel = {
        models: [], textures: {}, files: [], entities: [], log: [], cutGeoms: new Map(), stats: null, busy: false, loading: false, loaded: false,
        showDetails: false, clipOn: false, clipR: 45, clipZ: 1e9, batches: [], tgt: [], error: '',
        cutOn: false, cutAuto: true, clipH: null
    };
    // The cutaway hides the model above a height (the roof and the upper floors) so you can see and click the walls below. cutOn is the C key / button;
    // cutAuto also does it while the Door or Window tool is active. clipZ is what the renderer and the picking use.
    IM.cutH = function () { return IM.clipH != null ? IM.clipH : (S.project.settings.ceilH || 2.45) + 0.75; };
    IM.cutByTool = function () { const t = S.shellTool; return !!IM.cutAuto && (t === 'door' || t === 'window' || t === 'figure'); };
    IM.cutActive = function () { return IM.cutOn || IM.cutByTool(); };
    IM.applyCut = function () { const z = IM.cutActive() ? IM.cutH() : 1e9; if (IM.clipZ !== z) IM.clipZ = z; };
    const imp = () => S.project.import;
    IM.isPlaceable = file => /\.ydr$/i.test(file) && Object.prototype.hasOwnProperty.call(imp().glbKinds || {}, file);
    const safe = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });

    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    // ---------- frame: shell = model local turned and shifted ----------
    function trig() { const h = (imp().frame.heading || 0) * Math.PI / 180; return [Math.cos(h), Math.sin(h)]; }
    IM.toShell = function (x, y, z) { const f = imp().frame, c = trig(), dx = x - f.x, dy = y - f.y; return [dx * c[0] + dy * c[1], -dx * c[1] + dy * c[0], z - f.z]; };
    IM.fromShell = function (x, y, z) { const f = imp().frame, c = trig(); return [f.x + x * c[0] - y * c[1], f.y + x * c[1] + y * c[0], f.z + z]; };
    IM.dirToShell = function (x, y) { const c = trig(); return [x * c[0] + y * c[1], -x * c[1] + y * c[0]]; };

    // ---------- colours for surfaces whose texture is not in the imported files ----------
    function colorFor(t, shader) {
        t = (t || '') + ' ' + (shader || ''); t = t.toLowerCase();
        if (/window|glass/.test(t)) return [0.55, 0.70, 0.85];
        if (/roof/.test(t)) return [0.50, 0.33, 0.27];
        if (/door|wood|bark/.test(t)) return [0.46, 0.34, 0.24];
        if (/tarp/.test(t)) return [0.52, 0.58, 0.62];
        if (/crop|detail|leaf|grass|plant|bush/.test(t)) return [0.30, 0.46, 0.27];
        if (/concrete|noise/.test(t)) return [0.60, 0.60, 0.58];
        if (/decal/.test(t)) return [0.55, 0.52, 0.48];
        if (/wall|plaster|tpage|stucco/.test(t)) return [0.76, 0.72, 0.65];
        return [0.66, 0.63, 0.58];
    }

    // ---------- loading ----------
    IM.reset = function () {
        IM.cutDet = new Map(); IM.clearDet = null; IM.clearCnt = null;
        IM.models = []; IM.textures = {}; IM.cutGeoms.clear(); IM.stats = null; IM.batches = []; IM.tgt = []; IM.loaded = false; IM.error = ''; IM.files = []; IM.entities = []; IM.log = [];
        IM.lines = null; IM.orig = null; IM.origD = null; IM.adj = {}; IM.isl = {}; IM.partGeo = null; IM._syncKey = null; IM._weld = null; IM.colInside = null; IM.colPolys = null; IM.cutVer = (IM.cutVer || 0) + 1;
        if (M.App.renderer) { M.App.renderer.setModelBatches([]); M.App.renderer.resetImgTextures(); }
        if (M.FitModels) M.FitModels.reset();
    };

    IM.refreshFiles = async function () {
        const r = await Model.api('import/files?name=' + safe()); IM.files = r.files || [];
        bus.emit('importfiles');
    };

    IM.load = async function () {
        if (S.project.kind !== 'import') return;
        IM.loading = true; IM.error = ''; bus.emit('importstatus');
        try {
            const P = S.project;
            const r = await Model.api('import/model?name=' + safe() + '&target=' + encodeURIComponent(P.import.target || ''));
            IM.files = r.files || []; IM.entities = r.entities || []; IM.log = r.log || [];
            IM.textures = {}; (r.textures || []).forEach(t => { IM.textures[t.name] = { w: t.w, h: t.h, rgba: bytes(t.rgba) }; });
            IM.models = (r.models || []).map(m => ({
                file: m.file, target: !!m.target, bmin: m.bmin, bmax: m.bmax, tris: m.tris,
                geoms: m.geoms.map(g => ({ g: g.g, tex: (g.tex || '').toLowerCase(), texName: g.tex, shader: g.shader, bucket: g.bucket, tris: g.tris, pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx) }))
            }));
            // no target chosen yet (or it was removed): the biggest model is the building
            if (!IM.models.some(m => m.target) && IM.models.length) {
                const big = IM.models.slice().sort((a, b) => b.tris - a.tris)[0]; big.target = true; imp().target = big.file; Model.touch();
            }
            IM.cutGeoms.clear(); IM.stats = null; IM.lines = null; IM.orig = null; IM.origD = null; IM.adj = {}; IM.isl = {}; IM.partGeo = null; IM._weld = null; IM.cutVer = (IM.cutVer || 0) + 1;
            if (M.App.renderer) M.App.renderer.resetImgTextures();
            IM._placeKey = null; IM.applyPlaces();
            IM.segment(); IM.rebuildMembers();
            IM.loaded = true; IM.rebuild(); IM.requestCollision(); IM.autoPlaces();
            if (M.FitModels) M.FitModels.loadLib();                                                     // the window and door models (.glb files) of the project
            if (imp().cutters.length || imp().deletes.length || (imp().fills || []).length || IM.clearSpec()) IM.requestCut();
        } catch (e) { IM.error = e.message; toast('Could not read the model files: ' + e.message, 'err'); M.Errors.report('loading', e, { quiet: true }); }
        IM.loading = false; bus.emit('importstatus'); bus.emit('importfiles');
    };

    IM.targetModel = function () { return IM.models.find(m => m.target) || null; };

    // ---------- buildings: the separate objects of the model (vertices that coincide belong together) ----------
    IM.segment = function () {
        IM.comp = null; IM.gIdx = new Map(); IM.member = null; const m = IM.targetModel(); if (!m) return;
        m.geoms.forEach((g, i) => IM.gIdx.set(g.g, i));
        const key = new Map(), par = []; let nid = 0;
        const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
        const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
        const vid = m.geoms.map(g => {
            const n = g.pos.length / 3, a = new Int32Array(n);
            for (let i = 0; i < n; i++) { const k = Math.round(g.pos[i * 3] * 500) + ',' + Math.round(g.pos[i * 3 + 1] * 500) + ',' + Math.round(g.pos[i * 3 + 2] * 500); let v = key.get(k); if (v === undefined) { v = nid++; key.set(k, v); par.push(v); } a[i] = v; }
            return a;
        });
        m.geoms.forEach((g, gi) => { for (let t = 0; t + 2 < g.idx.length; t += 3) { uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 1]]); uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 2]]); } });
        const root = new Map(), comps = [], triComp = m.geoms.map(g => new Int32Array(g.idx.length / 3));
        m.geoms.forEach((g, gi) => {
            for (let t = 0; t + 2 < g.idx.length; t += 3) {
                const r = find(vid[gi][g.idx[t]]); let id = root.get(r);
                if (id === undefined) { id = comps.length; root.set(r, id); comps.push({ id, tris: 0, mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9], seed: [g.g, t / 3] }); }
                triComp[gi][t / 3] = id; const c = comps[id]; c.tris++;
                for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = g.pos[g.idx[t + k] * 3 + a]; if (v < c.mn[a]) c.mn[a] = v; if (v > c.mx[a]) c.mx[a] = v; }
            }
        });
        IM.comp = { triComp, comps }; IM.fitCache = {};
    };
    IM.compAt = function (gdoc, tri) { const gi = IM.gIdx && IM.gIdx.get(gdoc); return (gi === undefined || !IM.comp) ? -1 : IM.comp.triComp[gi][tri]; };
    // the project remembers one triangle per part of the selected building
    IM.rebuildMembers = function () {
        IM.member = null; IM.selComps = null; const B = imp().building; if (!B || !B.parts || !B.parts.length || !IM.comp) return;
        const sel = new Set(); B.parts.forEach(p => { const c = IM.compAt(p[0], p[1]); if (c >= 0) sel.add(c); });
        if (!sel.size) return;
        IM.selComps = sel; IM.member = IM.comp.triComp.map(tc => { const a = new Uint8Array(tc.length); for (let i = 0; i < tc.length; i++) a[i] = sel.has(tc[i]) ? 1 : 0; return a; });
    };
    IM.isoMode = () => (imp().iso || 'hide');
    IM.isolating = () => !!IM.member && IM.isoMode() !== 'show';
    IM.buildingInfo = function () {
        if (!IM.selComps) return null; let tris = 0, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        IM.selComps.forEach(id => { const c = IM.comp.comps[id]; tris += c.tris; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], c.mn[a]); mx[a] = Math.max(mx[a], c.mx[a]); } });
        return { parts: IM.selComps.size, tris, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
    };

    // the turn of the walls, the floor level and the footprint of some parts of the model (original, uncut triangles, model coordinates)
    IM.fitFrame = function (ids) {
        const m = IM.targetModel(), tc = IM.comp.triComp, set = new Set(ids), angs = [], wts = [], bins = new Float64Array(90), pts = [];
        let zmin = 1e9, zmax = -1e9, zWall = 1e9;
        m.geoms.forEach((g, gi) => {
            const p = g.pos, ix = g.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (!set.has(tc[gi][t / 3])) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
                if (l >= 0.2 && Math.abs(n[2] / l) < 0.1) {
                    const ang = (((Math.atan2(n[1], n[0]) * 180 / Math.PI) % 90) + 90) % 90; angs.push(ang); wts.push(l / 2); bins[Math.floor(ang) % 90] += l / 2;
                    if (l / 2 >= 0.5) zWall = Math.min(zWall, p[a + 2], p[b + 2], p[c + 2]);
                }
                for (const o of [a, b, c]) { pts.push(p[o], p[o + 1]); zmin = Math.min(zmin, p[o + 2]); zmax = Math.max(zmax, p[o + 2]); }
            }
        });
        let heading = imp().frame.heading || 0;
        if (wts.length) {
            let pk = 0, best = -1; for (let i = 0; i < 90; i++) { const s = bins[(i + 89) % 90] + bins[i] + bins[(i + 1) % 90]; if (s > best) { best = s; pk = i; } }
            const pa = pk + 0.5; let sw = 0, sd = 0;
            for (let i = 0; i < angs.length; i++) { const d = ((((angs[i] - pa + 45) % 90) + 90) % 90) - 45; if (Math.abs(d) <= 3) { sw += wts[i]; sd += wts[i] * d; } }
            heading = pa + (sw ? sd / sw : 0); heading = ((heading % 90) + 90) % 90; if (heading > 45) heading -= 90; heading = Math.round(heading * 100) / 100;
        }
        const h = heading * Math.PI / 180, c = Math.cos(h), s = Math.sin(h); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let i = 0; i < pts.length; i += 2) { const sx = pts[i] * c + pts[i + 1] * s, sy = -pts[i] * s + pts[i + 1] * c; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        return { heading, x: Math.round((cx * c - cy * s) * 1000) / 1000, y: Math.round((cx * s + cy * c) * 1000) / 1000, z: Math.round((zWall < 1e8 ? zWall : zmin) * 1000) / 1000, minx: x0, maxx: x1, miny: y0, maxy: y1, size: [x1 - x0, y1 - y0, zmax - zmin] };
    };
    // small parts that belong to a building (porch, steps, a shed roof): their middle lies in its footprint and they are smaller than it
    IM.attachedParts = function (ci) {
        const comps = IM.comp.comps, C = comps[ci], fit = IM.fitFrame([ci]), h = fit.heading * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), out = [];
        const areaC = (C.mx[0] - C.mn[0]) * (C.mx[1] - C.mn[1]);
        comps.forEach(D => {
            if (D.id === ci) return; const mx = (D.mn[0] + D.mx[0]) / 2, my = (D.mn[1] + D.mx[1]) / 2, rx = mx * c + my * s, ry = -mx * s + my * c;
            if (rx < fit.minx - 0.5 || rx > fit.maxx + 0.5 || ry < fit.miny - 0.5 || ry > fit.maxy + 0.5) return;
            if ((D.mx[0] - D.mn[0]) * (D.mx[1] - D.mn[1]) > areaC * 0.8) return;
            if (D.mn[2] > C.mx[2] + 0.5 || D.mx[2] < C.mn[2] - 0.5) return; out.push(D.id);
        });
        return out;
    };
    // click on a part: the building is that part and what is attached to it; Shift adds or removes one part
    IM.selectBuilding = function (gdoc, tri, add) {
        const ci = IM.compAt(gdoc, tri); if (ci < 0) return null;
        let ids; if (add && IM.selComps) { ids = new Set(IM.selComps); if (ids.has(ci)) ids.delete(ci); else ids.add(ci); ids = [...ids]; } else ids = [ci].concat(IM.attachedParts(ci));
        if (!ids.length) return null;
        const parts = ids.map(id => IM.comp.comps[id].seed);
        Model.edit(P => { P.import.building = { parts }; if (!P.import.iso) P.import.iso = 'hide'; });
        return ids;
    };
    IM.centerOnBuilding = function () {
        if (!IM.selComps) return false; const fit = IM.fitFrame([...IM.selComps]);
        Model.edit(P => { P.import.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; }); return true;
    };
    IM.clearBuilding = function () { Model.edit(P => { delete P.import.building; }); };
    // raise (dz > 0) or lower the rooms against the model: the grid's floor height moves, and the cutters keep their place on the model.
    // The camera follows by the same amount, so the model stays where it is on screen while the rooms rise or sink.
    IM.shiftLevel = function (dz, keepView) {
        dz = Math.round(dz * 1000) / 1000; if (!dz) return false;
        const done = Model.edit(P => { const I = P.import; I.frame.z = Math.round((I.frame.z + dz) * 1000) / 1000; I.cutters.forEach(k => { k.zb = Math.round((k.zb - dz) * 1000) / 1000; }); });
        if (done && !keepView && M.App.renderer) M.App.renderer.camera.target[2] += dz;
        return done;
    };
    // an object of the model as a box in the project's frame (for outlines)
    IM.compBox = function (ci) {
        // turned to the object's own walls, not to the model's axes
        IM.fitCache = IM.fitCache || {}; const fit = IM.fitCache[ci] || (IM.fitCache[ci] = IM.fitFrame([ci])), C = IM.comp.comps[ci], fh = fit.heading * Math.PI / 180;
        const cx = (fit.minx + fit.maxx) / 2, cy = (fit.miny + fit.maxy) / 2, mid = IM.toShell(cx * Math.cos(fh) - cy * Math.sin(fh), cx * Math.sin(fh) + cy * Math.cos(fh), (C.mn[2] + C.mx[2]) / 2);
        return { c: mid, hu: (fit.maxx - fit.minx) / 2, hn: (fit.maxy - fit.miny) / 2, hz: (C.mx[2] - C.mn[2]) / 2, yaw: (fit.heading - (imp().frame.heading || 0)) * Math.PI / 180 };
    };

    // With a building selected the other buildings are hidden; the detail models go with the whole block, so only the faces near the building are shown (and can be picked):
    // the box of the selected parts of the building, 2 m wider, in the model's own coordinates. Null when no building is selected.
    IM.detailBox = function () {
        if (!IM.isolating() || !IM.selComps || !IM.comp) return null; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        IM.selComps.forEach(id => { const c = IM.comp.comps[id]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], c.mn[a]); mx[a] = Math.max(mx[a], c.mx[a]); } });
        return { mn: mn.map(v => v - 2), mx: mx.map(v => v + 2) };
    };
    function inBox(box, pos, idx, t) {
        let x = 0, y = 0, z = 0; for (let q = 0; q < 3; q++) { const i = idx[t * 3 + q] * 3; x += pos[i] / 3; y += pos[i + 1] / 3; z += pos[i + 2] / 3; }
        return x >= box.mn[0] && x <= box.mx[0] && y >= box.mn[1] && y <= box.mx[1] && z >= box.mn[2] && z <= box.mx[2];
    }

    // ---------- batches in the project's frame ----------
    IM.rebuild = function () {
        const R = M.App.renderer; if (!R) return;
        if (IM.applyPlaces()) IM.requestCut();                                                      // (the detail models first go to where they stand)
        const f = imp().frame, c = trig(), batches = [], tgt = [], ghost = S.refMode === 'ghost', iso = IM.isoMode(), hasB = !!IM.member && iso !== 'show';
        const dmf = imp().doorModel ? imp().doorModel.file : null;
        IM.models.forEach(m => {
            if (!m.target && (!IM.showDetails || m.file === dmf || IM.isPlaceable(m.file))) return;
            const md = m.target ? null : mdelSet(m.file), box = (!m.target && hasB) ? IM.detailBox() : null;       // md: faces deleted from a detail model; box: with a building selected, only the details near it
            m.geoms.forEach((g, gi) => {
                const dcut = (!m.target && IM.cutDet.has(m.file)) ? IM.cutDet.get(m.file).get(g.g) : null;                   // a detail model's part with the rooms cleared out of it
                const src = (m.target && IM.cutGeoms.has(g.g)) ? IM.cutGeoms.get(g.g) : (dcut || g), nv = src.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
                for (let i = 0; i < nv; i++) {
                    const dx = src.pos[i * 3] - f.x, dy = src.pos[i * 3 + 1] - f.y; pos[i * 3] = dx * c[0] + dy * c[1]; pos[i * 3 + 1] = -dx * c[1] + dy * c[0]; pos[i * 3 + 2] = src.pos[i * 3 + 2] - f.z;
                    const nx = src.nrm[i * 3], ny = src.nrm[i * 3 + 1]; nrm[i * 3] = nx * c[0] + ny * c[1]; nrm[i * 3 + 1] = -nx * c[1] + ny * c[0]; nrm[i * 3 + 2] = src.nrm[i * 3 + 2];
                }
                let keep = src.idx, other = null;
                if (!m.target && ((md && md.size) || box)) {
                    const k2 = [];
                    for (let t = 0; t * 3 < src.idx.length; t++) {
                        if (md.has(g.g + ':' + (src.src ? src.src[t] : t))) continue;                              // (a cut part: the original triangle it came from)
                        if (box && !inBox(box, src.pos, src.idx, t)) continue;
                        k2.push(src.idx[t * 3], src.idx[t * 3 + 1], src.idx[t * 3 + 2]);
                    }
                    keep = Uint16Array.from(k2);
                }
                if (m.target && hasB) {
                    // the selected building's triangles (cut triangles know which original one they came from) and the rest
                    const mem = IM.member[gi], n = src.idx.length / 3, k = [], o = [];
                    for (let t = 0; t < n; t++) { const orig = src.src ? src.src[t] : t, dst = mem[orig] ? k : o; dst.push(src.idx[t * 3], src.idx[t * 3 + 1], src.idx[t * 3 + 2]); }
                    keep = Uint16Array.from(k); other = Uint16Array.from(o);
                }
                if (keep.length) batches.push({ level: 0, kind: 'model', group: 'model', tex: '', imgKey: IM.textures[g.tex] ? g.tex : null, flat: colorFor(g.texName, g.shader), alpha: ghost ? 0.3 : 1, noCull: true, clip: true, pos, nrm, uv: src.uv, idx: keep, glass: false, model: m.file });
                if (other && other.length && iso === 'ghost') batches.push({ level: 0, kind: 'model', group: 'model', tex: '', imgKey: null, flat: [0.62, 0.66, 0.74], alpha: 0.13, noCull: true, clip: true, pos, nrm, uv: src.uv, idx: other, glass: false, model: m.file });
                if (m.target) tgt.push({ g: g.g, pos, idx: keep });
            });
        });
        if (M.Plants) { try { M.Plants.modelBatches().forEach(b => batches.push(b)); } catch (e) { M.Errors.report('plants', e, { quiet: true }); } }          // (the map's plants, when "Show the plant models" is on)
        IM.batches = batches; IM.tgt = tgt; IM.lines = null; IM.orig = null; IM.origD = null; IM.partGeo = null;
        R.setModelBatches(batches);
        bus.emit('importmesh');
    };

    // ---------- cutting ----------
    let cutTimer = null, cutSeq = 0;
    IM.requestCut = function () { clearTimeout(cutTimer); cutTimer = setTimeout(IM.cutNow, 140); };
    IM.cutNow = async function () {
        if (S.project.kind !== 'import' || !IM.models.length) return;
        const I = imp(), seq = ++cutSeq, cutters = IM.allCutters(), clear = IM.clearSpec();           // the openings of every building, and the rooms that clear parts of the model
        const fills = I.fills || [];
        IM.cutDetails();                                                                                // the detail models are cleared by the rooms too
        if (!cutters.length && !I.deletes.length && !fills.length && !clear) { IM.clearCnt = null; if (IM.cutGeoms.size) { IM.cutGeoms.clear(); IM.stats = null; IM.cutVer = (IM.cutVer || 0) + 1; IM.rebuild(); bus.emit('importstatus'); } return; }
        IM.busy = true; bus.emit('importstatus');
        try {
            const r = await Model.api('import/cut?name=' + safe(), 'POST', { target: I.target, origin: IM.NOFRAME, cutters, deletes: I.deletes, fills, clear });
            if (seq !== cutSeq) return;
            IM.cutVer = (IM.cutVer || 0) + 1;
            IM.cutGeoms.clear();
            (r.geoms || []).forEach(g => IM.cutGeoms.set(g.g, { pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx), tris: g.tris, src: g.src ? new Int32Array(bytes(g.src).buffer) : null }));
            IM.stats = { before: r.before, after: r.after, removed: r.removed, added: r.added }; IM.clearCnt = clear ? r.cleared : null; IM.rebuild();
        } catch (e) { toast('Cut failed: ' + e.message, 'err'); }
        if (seq === cutSeq) { IM.busy = false; bus.emit('importstatus'); }
    };

    // ---------- the door model ----------
    IM.doorModel = function () { const dm = imp().doorModel; return dm ? (IM.models.find(m => m.file === dm.file) || null) : null; };
    IM.doorSize = function () {
        const m = IM.doorModel(); if (!m) return null; const ex = m.bmax[0] - m.bmin[0], ey = m.bmax[1] - m.bmin[1];
        return { w: Math.max(ex, ey), t: Math.min(ex, ey), h: m.bmax[2] - m.bmin[2], widthAxisX: ex >= ey };
    };
    // ---------- openings made from the model's own faces (Door and Window tools) ----------
    // The faces are deleted from the model; the cutter that goes with them only opens the collision and the interior walls. Its size and place
    // are read from the faces (in the grid's frame), so they follow the grid when it moves.
    IM.faceRect = function (face) {
        const m = IM.targetModel(); if (!m || !face) return null; const g = m.geoms.find(x => x.g === face.g); if (!g) return null;
        let nx = 0, ny = 0, nz = 0; const pts = [];
        face.tris.forEach(t => {
            const v = [0, 1, 2].map(k => { const i = g.idx[t * 3 + k] * 3; return IM.toShell(g.pos[i], g.pos[i + 1], g.pos[i + 2]); });
            const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
            nx += e1[1] * e2[2] - e1[2] * e2[1]; ny += e1[2] * e2[0] - e1[0] * e2[2]; nz += e1[0] * e2[1] - e1[1] * e2[0]; v.forEach(p => pts.push(p));
        });
        const l = Math.hypot(nx, ny, nz); if (!pts.length || l < 1e-9 || Math.abs(nz / l) > 0.5 || Math.hypot(nx, ny) < 1e-9) return null;    // a floor or a roof is not a door or a window
        const yaw = Math.atan2(-nx, ny), cs = Math.cos(yaw), sn = Math.sin(yaw);
        let u0 = 1e9, u1 = -1e9, z0 = 1e9, z1 = -1e9, ns = 0;
        pts.forEach(p => { const u = p[0] * cs + p[1] * sn, n = -p[0] * sn + p[1] * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); ns += n; });
        const uc = (u0 + u1) / 2, nc = ns / pts.length, r3 = (v) => Math.round(v * 1000) / 1000;
        return { cx: r3(uc * cs - nc * sn), cy: r3(uc * sn + nc * cs), zb: r3(z0), w: r3(u1 - u0), h: r3(z1 - z0), yaw: Math.round(yaw * 100000) / 100000, d: 0.8 };
    };
    // How deep the frame of an opening sits: the model's own pieces that are left around the hole (the frame, the reveal) lie a few cm behind the
    // faces that were cut out, so glass and a door go to that depth ("in the frame") and not onto the outside surface. Metres along the outward
    // normal from the plane of the cut-out faces (negative = into the wall): the median of what is left near the opening, between 30 cm behind
    // and level with that plane; 3 cm behind when nothing is left. `extra` = faces about to be deleted (a Set of "geom:tri").
    IM.frameDepth = function (k, extra) {
        const m = IM.targetModel(); if (!m) return -0.03;
        const del = new Set(imp().deletes.map(d => d[0] + ':' + d[1])); if (extra) extra.forEach(v => del.add(v));
        const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), hu = k.w / 2 + 0.12, z0 = k.zb - 0.12, z1 = k.zb + k.h + 0.12, offs = [];
        m.geoms.forEach(g => {
            for (let t = 0; t * 3 < g.idx.length; t++) {
                if (del.has(g.g + ':' + t)) continue; let su = 0, sz = 0, sn2 = 0;
                for (let q = 0; q < 3; q++) { const i = g.idx[t * 3 + q] * 3, s = IM.toShell(g.pos[i], g.pos[i + 1], g.pos[i + 2]); su += (s[0] - k.cx) * cs + (s[1] - k.cy) * sn; sn2 += -(s[0] - k.cx) * sn + (s[1] - k.cy) * cs; sz += s[2]; }
                su /= 3; sn2 /= 3; sz /= 3; if (Math.abs(su) < hu && sz > z0 && sz < z1 && sn2 > -0.3 && sn2 < 0.02) offs.push(sn2);
            }
        });
        if (!offs.length) return -0.03; offs.sort((a, b) => a - b);
        return Math.round(Math.max(-0.25, Math.min(0, offs[offs.length >> 1])) * 1000) / 1000;
    };
    // ---------- gaps in the model's wall beside a cut-out ----------
    // The hole in the model's wall is not always just the faces that were cut out: on the model's small windows the wall has a slit a few cm below
    // the cut-out that a painted frame used to cover, and that frame is gone with the faces, so from outside you look straight through it.
    // The remaining triangles of the model are drawn into a 1 cm grid in the plane of the opening (along it, up); cells that nothing covers,
    // that touch the cut-out and are closed in on all sides within 20 cm, are the gap. The result says how far it reaches beyond the cut-out on each
    // side (l, r, b, t, metres) and how deep the wall around it lies (dw, metres along the outward normal). Not counted: the space below a door
    // (the floor), and anything that reaches 20 cm out (a missing piece of wall or a big opening is not a small gap). Null when there is no gap.
    let shellCache = null; const gapCache = new Map();
    function shellTris(m) {
        const f = imp().frame, key = m.file + '|' + f.x + '|' + f.y + '|' + f.z + '|' + f.heading;
        if (shellCache && shellCache.key === key) return shellCache;
        let n = 0; m.geoms.forEach(g => { n += g.idx.length / 3; });
        const p = new Float32Array(n * 9), gg = new Int32Array(n), tt = new Int32Array(n); let o = 0;
        m.geoms.forEach(g => { for (let t = 0; t * 3 < g.idx.length; t++, o++) { gg[o] = g.g; tt[o] = t; for (let q = 0; q < 3; q++) { const i = g.idx[t * 3 + q] * 3, s = IM.toShell(g.pos[i], g.pos[i + 1], g.pos[i + 2]); p[o * 9 + q * 3] = s[0]; p[o * 9 + q * 3 + 1] = s[1]; p[o * 9 + q * 3 + 2] = s[2]; } } });
        return (shellCache = { key, n, p, g: gg, t: tt });
    }
    IM.gapAround = function (k) {
        if (!k.face || S.project.kind !== 'import') return null; const m = IM.targetModel(); if (!m) return null; const I = imp();
        const key = [S.project.name, k.id, k.type, k.w, k.h, k.face.g, k.face.tris.length, I.deletes.length, m.file].join('|');
        if (gapCache.has(key)) return gapCache.get(key);
        const R = 0.01, MG = 0.2, hw = k.w / 2, nu = Math.ceil((k.w + 2 * MG) / R), nz = Math.ceil((k.h + 2 * MG) / R), u0 = -hw - MG, z0 = -MG;
        const cov = new Uint8Array(nu * nz), dnc = new Float32Array(nu * nz), st = shellTris(m), del = new Set(I.deletes.map(d => d[0] + ':' + d[1])), cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), L = new Float64Array(9);
        for (let t = 0; t < st.n; t++) {
            const o = t * 9; if (del.has(st.g[t] + ':' + st.t[t])) continue;
            let dm = 0; for (let q = 0; q < 3; q++) { const dx = st.p[o + q * 3] - k.cx, dy = st.p[o + q * 3 + 1] - k.cy; L[q * 3] = dx * cs + dy * sn; L[q * 3 + 1] = st.p[o + q * 3 + 2] - k.zb; L[q * 3 + 2] = -dx * sn + dy * cs; dm += L[q * 3 + 2]; }
            dm /= 3; if (dm < -0.8 || dm > 0.4) continue;
            const umn = Math.min(L[0], L[3], L[6]), umx = Math.max(L[0], L[3], L[6]), zmn = Math.min(L[1], L[4], L[7]), zmx = Math.max(L[1], L[4], L[7]);
            if (umx < u0 || umn > u0 + nu * R || zmx < z0 || zmn > z0 + nz * R) continue;
            const a2 = (L[3] - L[0]) * (L[7] - L[1]) - (L[6] - L[0]) * (L[4] - L[1]); if (Math.abs(a2) < 1e-6) continue;       // edge-on to the opening: lips and reveals cover nothing
            const i0 = Math.max(0, Math.floor((umn - u0) / R)), i1 = Math.min(nu - 1, Math.floor((umx - u0) / R)), j0 = Math.max(0, Math.floor((zmn - z0) / R)), j1 = Math.min(nz - 1, Math.floor((zmx - z0) / R));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const px = u0 + (i + 0.5) * R, pz = z0 + (j + 0.5) * R;
                const w0 = ((L[3] - px) * (L[7] - pz) - (L[6] - px) * (L[4] - pz)) / a2, w1 = ((L[6] - px) * (L[1] - pz) - (L[0] - px) * (L[7] - pz)) / a2, w2 = 1 - w0 - w1;
                if (w0 >= -1e-3 && w1 >= -1e-3 && w2 >= -1e-3) { cov[j * nu + i] = 1; dnc[j * nu + i] = dm; }
            }
        }
        const inRect = (i, j) => { const px = u0 + (i + 0.5) * R, pz = z0 + (j + 0.5) * R; return Math.abs(px) < hw && pz > 0 && pz < k.h; };
        if (k.type === 'door') for (let j = 0; j < nz; j++) if (z0 + (j + 0.5) * R < 0) for (let i = 0; i < nu; i++) cov[j * nu + i] = 1;   // the floor
        const seen = new Uint8Array(nu * nz); let l = 0, r = 0, b = 0, tp = 0; const dws = [];
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let j = 0; j < nz; j++) for (let i = 0; i < nu; i++) {
            if (cov[j * nu + i] || seen[j * nu + i] || inRect(i, j)) continue;
            if (!nb.some(d => { const a = i + d[0], c = j + d[1]; return a >= 0 && c >= 0 && a < nu && c < nz && inRect(a, c); })) continue;       // seeds touch the cut-out
            const stack = [[i, j]], cells = []; let open = false; seen[j * nu + i] = 1;
            while (stack.length) {
                const c = stack.pop(); cells.push(c); if (c[0] === 0 || c[1] === 0 || c[0] === nu - 1 || c[1] === nz - 1) open = true;
                nb.forEach(d => { const a = c[0] + d[0], e = c[1] + d[1]; if (a < 0 || e < 0 || a >= nu || e >= nz || seen[e * nu + a] || cov[e * nu + a] || inRect(a, e)) return; seen[e * nu + a] = 1; stack.push([a, e]); });
            }
            if (open) continue;
            cells.forEach(c => {
                const px = u0 + (c[0] + 0.5) * R, pz = z0 + (c[1] + 0.5) * R;
                if (px < -hw) l = Math.max(l, -hw - (px - R / 2)); if (px > hw) r = Math.max(r, (px + R / 2) - hw);
                if (pz < 0) b = Math.max(b, -(pz - R / 2)); if (pz > k.h) tp = Math.max(tp, (pz + R / 2) - k.h);
                nb.forEach(d => { const a = c[0] + d[0], e = c[1] + d[1]; if (a >= 0 && e >= 0 && a < nu && e < nz && cov[e * nu + a] && !(k.type === 'door' && z0 + (e + 0.5) * R < 0)) dws.push(dnc[e * nu + a]); });
            });
        }
        const up = (v) => v > 0.015 ? Math.round((v + 0.005) * 1000) / 1000 : 0;
        l = up(l); r = up(r); b = up(b); tp = up(tp); let out = null;
        if (l || r || b || tp) { dws.sort((x, y) => x - y); out = { l, r, b, t: tp, dw: dws.length ? Math.round(dws[dws.length >> 1] * 1000) / 1000 : IM.depthOf(k) }; }
        if (gapCache.size > 400) gapCache.clear(); gapCache.set(key, out); return out;
    };
    // How far behind the faces that were cut out of the model the frame, glass and door of an opening sit ("Depth in the wall", k.dd), held between these limits wherever it
    // is used. (+10 cm in front of the faces is allowed on purpose: a window that sits further in than the wall's siding is brought forward into the interior wall with it.)
    IM.DEPTH_MIN = -0.5; IM.DEPTH_MAX = 0.1;
    IM.depthOf = function (k) { const v = k && k.dd != null ? +k.dd : 0; return Math.max(IM.DEPTH_MIN, Math.min(IM.DEPTH_MAX, isNaN(v) ? 0 : v)); };
    // after the grid moved or turned: read the openings again from their faces. Returns true when something changed.
    IM.syncFaceCutters = function () {
        let changed = false;
        imp().cutters.forEach(k => {
            if (!k.face) return; const r = IM.faceRect(k.face); if (!r) return;
            ['cx', 'cy', 'zb', 'w', 'h', 'yaw', 'd'].forEach(key => { if (Math.abs((k[key] || 0) - r[key]) > 1e-4) { k[key] = r[key]; changed = true; } });
            if (k.dd === undefined) { k.dd = IM.frameDepth(k); changed = true; }                    // openings made before frame depth existed get it now
        });
        return changed;
    };
    // removing an opening gives its faces back (inside an edit)
    IM.removeCutterIn = function (P, id) {
        const c = P.import.cutters.find(k => k.id === id); if (!c) return;
        // only the faces this opening deleted come back
        if (c.face && c.face.tris) { const gone = new Set((c.face.added || c.face.tris).map(t => c.face.g + ':' + t)); P.import.deletes = P.import.deletes.filter(d => !gone.has(d[0] + ':' + d[1])); }
        P.import.cutters = P.import.cutters.filter(k => k.id !== id);
    };

    // The door model always keeps its own size. The game ignores the scale of an entity inside an interior (measured on a real test: the door came
    // out at 1.00 while the editor showed 1.06), so scaling a door to its opening cannot work; the frame generated around the door (see shell.js)
    // closes the difference between the door and the opening instead. Kept as a function because the transform and the export read it.
    IM.doorFit = function (k) { return { sxy: 1, sz: 1 }; };
    // the size the frame is built to: the door leaf, or two leaves side by side for double doors
    IM.doorGroup = function (k) { const s = IM.doorSize(); return s ? { w: s.w * (k.double ? 2 : 1), h: s.h } : null; };
    // How far the frame around a door reaches (the same numbers shell.js builds it from): half its outer width `ju` and the height of its top `top` (from the grid's floor).
    // It is built to the door model, so it can be bigger than the opening that was cut out of the model's faces; then the model's own wall is still there between the
    // opening and the frame. The wall is cut out to the MIDDLE of the frame's bars (`cu`: half the width, `ct`: the height; never less than the opening): half of every
    // bar sits in the wall and hides the wall's cut edge. The walls and the collision of the interior open to the same size (allCutters, shell.js). Null: no frame.
    IM.doorFrameExtent = function (k) {
        if (!k.face || k.type !== 'door' || !k.leaf) return null; const dg = IM.doorGroup(k); if (!dg) return null;
        // the model's own frame (k.vframe): nothing is built, the door model's own frame is the frame, so the wall is cut out to the size of the door model
        if (k.vframe) { const hw0 = k.w / 2, zt0 = k.zb + k.h, cu0 = Math.max(hw0, dg.w / 2), ct0 = Math.max(zt0, k.zb + dg.h); return { ju: cu0, top: ct0, hw: hw0, zt: zt0, cu: cu0, ct: ct0 }; }
        if (k.frame === false) return null;
        const bw = k.bw || 0.05, hw = k.w / 2, zt = k.zb + k.h, dw = dg.w / 2, dt = k.zb + dg.h, ju = Math.max(hw, dw + bw), top = Math.max(zt, dt + bw);
        return { ju, top, hw, zt, cu: Math.max(hw, (dw + ju) / 2), ct: Math.max(zt, (dt + top) / 2) };
    };
    // where the door model stands for a cutter: its width lies along the cutter, its bottom on the cutter's bottom
    IM.doorTransform = function (k) {
        const m = IM.doorModel(), s = IM.doorSize(); if (!m) return null; const fit = IM.doorFit(k);
        const ctr = [(m.bmin[0] + m.bmax[0]) / 2 * fit.sxy, (m.bmin[1] + m.bmax[1]) / 2 * fit.sxy];
        const phi = k.yaw - (s.widthAxisX ? 0 : Math.PI / 2) + (k.flip ? Math.PI : 0), nx = -Math.sin(k.yaw), ny = Math.cos(k.yaw), lo = (k.lo || 0) + (k.face && k.dd != null ? IM.depthOf(k) : 0);   // dd: the depth of the frame
        const tx = k.cx + nx * lo, ty = k.cy + ny * lo, c = Math.cos(phi), sn = Math.sin(phi);
        return { x: tx - (ctr[0] * c - ctr[1] * sn), y: ty - (ctr[0] * sn + ctr[1] * c), z: k.zb - m.bmin[2] * fit.sz, yaw: phi, sxy: fit.sxy, sz: fit.sz };
    };
    // every leaf of the door model a cutter places: one, or two for double doors (side by side, meeting in the middle of the opening, each as wide as the model)
    IM.doorTransforms = function (k) {
        const t = IM.doorTransform(k), s = IM.doorSize(); if (!t) return [];
        if (!k.double) return [t];
        const off = s.w * t.sxy / 2, ux = Math.cos(k.yaw), uy = Math.sin(k.yaw), one = (sign, flip) => IM.doorTransform(Object.assign({}, k, { cx: k.cx + ux * off * sign, cy: k.cy + uy * off * sign, flip, lo: k.lo || 0 }));
        return [one(-1, true), one(1, false)];                // the model's origin is its hinge and its knob is at the free end: hinges at the outer edges, knobs meet in the middle
    };
    // the door model drawn in every cutter that places one
    IM.doorBatches = function () {
        const out = []; if (S.project.kind !== 'import') return out; const m = IM.doorModel(); if (!m) return out;
        imp().cutters.forEach(k => {
            if (!k.leaf) return;
            IM.doorTransforms(k).forEach(t => { const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
            m.geoms.forEach(g => {
                const nv = g.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
                for (let i = 0; i < nv; i++) {
                    const x = g.pos[i * 3] * t.sxy, y = g.pos[i * 3 + 1] * t.sxy, z = g.pos[i * 3 + 2] * t.sz; pos[i * 3] = t.x + x * c - y * s; pos[i * 3 + 1] = t.y + x * s + y * c; pos[i * 3 + 2] = t.z + z;
                    const a = g.nrm[i * 3], b = g.nrm[i * 3 + 1]; nrm[i * 3] = a * c - b * s; nrm[i * 3 + 1] = a * s + b * c; nrm[i * 3 + 2] = g.nrm[i * 3 + 2];
                }
                out.push({ level: 0, kind: 'door', group: 'door', tex: '', imgKey: IM.textures[g.tex] ? g.tex : null, flat: colorFor(g.texName, g.shader), alpha: 1, noCull: true, pos, nrm, uv: g.uv, idx: g.idx, glass: false });
            }); });
        });
        return out;
    };

    // ---------- the building's walls, for fitting the rooms to them and for the inner skin ----------
    // The upright faces of the building as it is cut (deleted faces gone, openings cut), in the grid's frame: { p: [9], n, c, area }. The faces of a model only look
    // outwards, so a face's back is the room behind it.
    let wallCache = null;
    IM.wallFaces = function () {
        const m = IM.targetModel(); if (!m || S.project.kind !== 'import') return [];
        const I = imp(), key = [S.project.name, m.file, IM.cutVer || 0, I.deletes.length, JSON.stringify(I.frame)].join('|');
        if (wallCache && wallCache.key === key) return wallCache.list;
        const list = [], dels = delSet();
        m.geoms.forEach(g => {
            const cut = IM.cutGeoms.has(g.g), s = cut ? IM.cutGeoms.get(g.g) : g;
            for (let t = 0; t * 3 < s.idx.length; t++) {
                if (!cut && dels.has(g.g + ':' + t)) continue;
                const P3 = [0, 1, 2].map(q => { const i = s.idx[t * 3 + q] * 3; return IM.toShell(s.pos[i], s.pos[i + 1], s.pos[i + 2]); });
                const e1 = [P3[1][0] - P3[0][0], P3[1][1] - P3[0][1], P3[1][2] - P3[0][2]], e2 = [P3[2][0] - P3[0][0], P3[2][1] - P3[0][1], P3[2][2] - P3[0][2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]); if (l < 2e-4) continue;
                const nn = [n[0] / l, n[1] / l, n[2] / l]; if (Math.abs(nn[2]) > 0.35) continue;                      // walls only, not roofs and floors
                list.push({ p: [].concat(P3[0], P3[1], P3[2]), n: nn, c: [(P3[0][0] + P3[1][0] + P3[2][0]) / 3, (P3[0][1] + P3[1][1] + P3[2][1]) / 3, (P3[0][2] + P3[1][2] + P3[2][2]) / 3], area: l / 2 });
            }
        });
        wallCache = { key, list }; return list;
    };
    // Where each edge of each room should be so it lies exactly on the building's wall: the wall faces that look away from the room (their normal points out
    // of the edge), overlap it and lie within `tol` of it vote for a plane, the plane with the most wall wins and is taken as the average of its faces.
    // Returns [{ op, side, from, to, wall }] (side: 0 west, 1 south, 2 east, 3 north); `apply` moves the edges.
    IM.fitRooms = function (tol, apply) {
        tol = tol || 0.25; const H = S.project.settings.ceilH || 2.45, faces = IM.wallFaces(), found = [];
        S.project.shell.ops.forEach((op, oi) => {
            if (op.op !== 'add') return; const r = op.r;
            for (let side = 0; side < 4; side++) {
                const horiz = side === 0 || side === 2, pos = r[side], dir = side === 0 || side === 1 ? -1 : 1, a0 = horiz ? r[1] : r[0], a1 = horiz ? r[3] : r[2];
                const bins = new Map();
                for (const f of faces) {
                    const nd = horiz ? f.n[0] : f.n[1]; if (nd * dir < 0.98) continue;
                    const pl = horiz ? f.c[0] : f.c[1]; if (Math.abs(pl - pos) > tol) continue;
                    if (f.c[2] < -0.2 || f.c[2] > H + 0.3) continue;
                    let lo = 1e9, hi = -1e9; for (let q = 0; q < 3; q++) { const v = f.p[q * 3 + (horiz ? 1 : 0)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
                    const ov = Math.min(hi, a1) - Math.max(lo, a0); if (ov < 0.05) continue;
                    const k = Math.round(pl * 200); let b = bins.get(k); if (!b) bins.set(k, b = { w: 0, s: 0 }); const w = f.area * (ov / Math.max(1e-6, hi - lo)); b.w += w; b.s += pl * w;
                }
                let best = null; bins.forEach(b => { if (!best || b.w > best.w) best = b; });
                if (!best || best.w < 0.4) continue;
                const to = Math.round(best.s / best.w * 1000) / 1000;
                found.push({ op: oi, side, from: pos, to, wall: best.w });                    // also edges that are already there: they take part in choosing the plane of a line
            }
        });
        // Edges of different rooms that lie on one line (within 1.2 cm, along the same direction) must end on one line: they all take the plane of the one with the most
        // wall behind it, whether or not each of them found a wall itself.
        const all = []; S.project.shell.ops.forEach((op, oi) => { if (op.op !== 'add') return; for (let side = 0; side < 4; side++) all.push({ op: oi, side, pos: op.r[side], par: side % 2 }); });
        const fnd = new Map(found.map(f => [f.op + ':' + f.side, f])), out = [], seenE = new Set();
        all.forEach(e0 => {
            if (seenE.has(e0.op + ':' + e0.side)) return;
            const cl = [e0], st = [e0]; seenE.add(e0.op + ':' + e0.side);
            while (st.length) { const e = st.pop(); all.forEach(o => { if (!seenE.has(o.op + ':' + o.side) && o.par === e.par && Math.abs(o.pos - e.pos) < 0.012) { seenE.add(o.op + ':' + o.side); cl.push(o); st.push(o); } }); }
            let best = null; cl.forEach(e => { const f = fnd.get(e.op + ':' + e.side); if (f && (!best || f.wall > best.wall)) best = f; });
            if (!best) return;
            cl.forEach(e => { if (Math.abs(e.pos - best.to) > 0.0005) out.push({ op: e.op, side: e.side, from: e.pos, to: best.to, wall: (fnd.get(e.op + ':' + e.side) || { wall: 0 }).wall }); });
        });
        if (apply && out.length) Model.edit(P => { out.forEach(f => { P.shell.ops[f.op].r[f.side] = f.to; }); });
        return out;
    };
    // the height of the walls around the rooms, in metres above the floor: the top that most of the wall area around the rooms has (5 cm steps, tops under 2.2 m are
    // window pieces and are ignored); null when there is no wall
    IM.wallTop = function () {
        const g = M.Shell.regionGrid(S.project.shell), faces = IM.wallFaces(), inRoom = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
        const bins = new Map();
        for (const f of faces) {
            const nh = Math.hypot(f.n[0], f.n[1]); if (nh < 0.5) continue; const bx = f.c[0] - f.n[0] / nh * 0.1, by = f.c[1] - f.n[1] / nh * 0.1; if (!inRoom(bx, by)) continue;
            const top = Math.max(f.p[2], f.p[5], f.p[8]); if (top < 2.2) continue; const k = Math.round(top * 20); let b = bins.get(k); if (!b) bins.set(k, b = { w: 0, s: 0 }); b.w += f.area; b.s += top * f.area;
        }
        let best = null; bins.forEach(b => { if (!best || b.w > best.w) best = b; });
        return best ? Math.round(best.s / best.w * 100) / 100 : null;
    };

    // ---------- parts: the materials (geometries) of the building and of its detail models ----------
    // A part is one geometry of a model: all the faces that share a texture. Removing a part deletes all of its faces (in the building: through `deletes`, like
    // Delete faces; in a detail model: through `mdeletes`) and remembers which faces it took (`import.parts`) so it can be given back without touching faces
    // that were deleted for another reason.
    IM.partModels = function () {
        const dmf = imp().doorModel ? imp().doorModel.file : null;
        return IM.models.filter(m => m.file !== dmf && !IM.isPlaceable(m.file) && (m.target || Math.max(m.bmax[0] - m.bmin[0], m.bmax[1] - m.bmin[1]) > 4)).sort((a, b) => (b.target ? 1 : 0) - (a.target ? 1 : 0));
    };
    IM.partRecord = function (file, g) { return (imp().parts || []).find(p => p.f === file && p.g === g) || null; };
    // faces of the part that are still there / in all
    IM.partCount = function (m, geo) {
        const del = m.target ? delSet() : mdelSet(m.file); let left = 0, n = geo.idx.length / 3; for (let t = 0; t < n; t++) if (!del.has(geo.g + ':' + t)) left++; return { left, total: n };
    };
    IM.removePart = function (file, g) {
        const m = IM.models.find(x => x.file === file), geo = m && m.geoms.find(x => x.g === g); if (!geo || IM.partRecord(file, g)) return false;
        return Model.edit(P => {
            const I = P.import, added = [], n = geo.idx.length / 3;
            if (m.target) { const have = new Set(I.deletes.map(d => d[0] + ':' + d[1])); for (let t = 0; t < n; t++) if (!have.has(g + ':' + t)) { I.deletes.push([g, t]); added.push(t); } }
            else { I.mdeletes = I.mdeletes || []; const have = new Set(I.mdeletes.filter(d => d[0] === file).map(d => d[1] + ':' + d[2])); for (let t = 0; t < n; t++) if (!have.has(g + ':' + t)) { I.mdeletes.push([file, g, t]); added.push(t); } }
            I.parts = I.parts || []; I.parts.push({ f: file, g, name: geo.texName, added });
        });
    };
    IM.restorePart = function (file, g) {
        const rec = IM.partRecord(file, g); if (!rec) return false;
        return Model.edit(P => {
            const I = P.import, m = IM.models.find(x => x.file === file), gone = new Set(rec.added);
            if (m && m.target) I.deletes = I.deletes.filter(d => !(d[0] === g && gone.has(d[1])));
            else I.mdeletes = (I.mdeletes || []).filter(d => !(d[0] === file && d[1] === g && gone.has(d[2])));
            I.parts = I.parts.filter(p => !(p.f === file && p.g === g));
        });
    };
    // the faces of a part still there, as triangle corners in the grid's frame (for the highlight); cached until the model is rebuilt
    IM.partTris = function (file, g) {
        IM.partGeo = IM.partGeo || {}; const k = file + '|' + g; if (IM.partGeo[k]) return IM.partGeo[k];
        const m = IM.models.find(x => x.file === file), geo = m && m.geoms.find(x => x.g === g); if (!geo) return null;
        const del = m.target ? delSet() : mdelSet(file), out = [];
        for (let t = 0; t * 3 < geo.idx.length; t++) { if (del.has(g + ':' + t)) continue; for (let q = 0; q < 3; q++) { const i = geo.idx[t * 3 + q] * 3, s = IM.toShell(geo.pos[i], geo.pos[i + 1], geo.pos[i + 2]); out.push(s[0], s[1], s[2]); } }
        return (IM.partGeo[k] = Float32Array.from(out));
    };
    // a small picture of the texture of a part
    IM.partThumb = function (geo, size) {
        const t = IM.textures[geo.tex]; const c = document.createElement('canvas'); c.width = c.height = size || 36; c.className = 'pthumb';
        if (!t) return c; const tmp = document.createElement('canvas'); tmp.width = t.w; tmp.height = t.h; tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h), 0, 0);
        c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height); return c;
    };

    // ---------- open edges of the model (Edges tool) ----------
    // An open edge belongs to exactly one triangle of what is shown. Next to faces you deleted they are the rim of a hole. Everything here is in the model's
    // own coordinates (a fill is stored with the model, not with the grid). Vertices that lie within 1 mm count as one.
    const EKEY = 4194304; let edgeCache = null, viewCache = null;
    const ekey = (a, b) => a < b ? a * EKEY + b : b * EKEY + a;
    function weldOf(m) {
        if (IM._weld && IM._weld.file === m.file) return IM._weld;
        const vid = new Map(), vpos = [], W = { file: m.file, vid, vpos, orig: new Map() };
        W.id = (x, y, z) => { const k = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000); let v = vid.get(k); if (v === undefined) { v = vpos.length; vid.set(k, v); vpos.push([x, y, z]); } return v; };
        m.geoms.forEach(g => { for (let t = 0; t * 3 < g.idx.length; t++) { const v = [0, 1, 2].map(q => { const i = g.idx[t * 3 + q] * 3; return W.id(g.pos[i], g.pos[i + 1], g.pos[i + 2]); }); for (let q = 0; q < 3; q++) { const a = v[q], b = v[(q + 1) % 3]; if (a !== b) { const k = ekey(a, b); W.orig.set(k, (W.orig.get(k) || 0) + 1); } } } });
        return (IM._weld = W);
    }
    IM.edgeData = function () {
        const m = IM.targetModel(); if (!m || S.project.kind !== 'import') return null; const I = imp();
        const key = [S.project.name, m.file, IM.cutVer || 0, I.deletes.length, (I.fills || []).length].join('|');
        if (edgeCache && edgeCache.key === key) return edgeCache;
        const W = weldOf(m), edges = new Map();
        m.geoms.forEach(g => {
            const s = IM.cutGeoms.has(g.g) ? IM.cutGeoms.get(g.g) : g;
            for (let t = 0; t * 3 < s.idx.length; t++) {
                const P3 = [0, 1, 2].map(q => { const i = s.idx[t * 3 + q] * 3; return [s.pos[i], s.pos[i + 1], s.pos[i + 2]]; }), v = P3.map(p => W.id(p[0], p[1], p[2]));
                const e1 = [P3[1][0] - P3[0][0], P3[1][1] - P3[0][1], P3[1][2] - P3[0][2]], e2 = [P3[2][0] - P3[0][0], P3[2][1] - P3[0][1], P3[2][2] - P3[0][2]];
                let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
                for (let q = 0; q < 3; q++) {
                    const a = v[q], b = v[(q + 1) % 3]; if (a === b) continue; const k = ekey(a, b); let e = edges.get(k);
                    if (!e) edges.set(k, e = { k, a: Math.min(a, b), b: Math.max(a, b), n: 0, g: g.g, tri: s.src ? s.src[t] : t, nrm: n });
                    e.n++;
                }
            }
        });
        const open = [], adj = new Map(), byKey = new Map();
        edges.forEach(e => { if (e.n !== 1) return; e.hole = (W.orig.get(e.k) || 0) >= 2; open.push(e); byKey.set(e.k, e); [e.a, e.b].forEach(v => { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }); });
        return (edgeCache = { key, open, adj, byKey, vpos: W.vpos });
    };
    // the open edges worth showing: those near the rooms (within 1.5 m of a rectangle, up to a little above the ceiling), without the outlines of cut-out windows
    // and doors unless asked for; holesOnly keeps just the rims of holes that deleting faces made
    IM.edgeView = function (opts) {
        const D = IM.edgeData(); if (!D) return [];
        opts = opts || {}; const I = imp(), fk = JSON.stringify(I.frame);
        const ck = D.key + '|' + (opts.holesOnly ? 1 : 0) + (opts.outlines ? 1 : 0) + '|' + fk + '|' + I.cutters.length + '|' + JSON.stringify(S.project.shell.ops) + '|' + S.project.settings.ceilH;
        if (viewCache && viewCache.key === ck) return viewCache.list;
        const faceCut = I.cutters.filter(k => k.face), H = S.project.settings.ceilH || 2.45, ops = S.project.shell.ops.filter(o => o.op === 'add');
        const onOutline = (mid) => faceCut.some(k => {
            const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), dx = mid[0] - k.cx, dy = mid[1] - k.cy, u = dx * cs + dy * sn, n = -dx * sn + dy * cs, z = mid[2] - k.zb;
            return Math.abs(u) <= k.w / 2 + 0.1 && z >= -0.1 && z <= k.h + 0.1 && n >= -0.4 && n <= 0.15;
        });
        const nearRooms = (mid) => mid[2] > -0.3 && mid[2] < H + 0.5 && ops.some(o => mid[0] > o.r[0] - 1.5 && mid[0] < o.r[2] + 1.5 && mid[1] > o.r[1] - 1.5 && mid[1] < o.r[3] + 1.5);
        const list = [];
        for (const e of D.open) {
            if (opts.holesOnly && !e.hole) continue;
            const A = D.vpos[e.a], B = D.vpos[e.b], sa = IM.toShell(A[0], A[1], A[2]), sb = IM.toShell(B[0], B[1], B[2]), mid = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, (sa[2] + sb[2]) / 2];
            if (!nearRooms(mid) || (!opts.outlines && onOutline(mid))) continue;
            e.sa = sa; e.sb = sb; list.push(e); if (list.length >= 4000) break;       // sa, sb: the ends in the grid's frame (the cache key holds the frame)
        }
        viewCache = { key: ck, list }; return list;
    };
    // loop select: from one open edge along the open edges, through vertices where exactly two meet
    IM.edgeLoop = function (seed) {
        const D = IM.edgeData(); if (!D || !seed) return [];
        const out = new Set([seed.k]), walk = (v, from) => {
            for (let guard = 0; guard < 5000; guard++) {
                const l = D.adj.get(v) || []; if (l.length !== 2) return; const nx = l[0] === from ? l[1] : l[0]; if (out.has(nx.k)) return; out.add(nx.k); v = nx.a === v ? nx.b : nx.a; from = nx;
            }
        };
        walk(seed.a, seed); walk(seed.b, seed); return [...out];
    };
    // triangles over a polygon (3D points, in order): ear clipping in the plane of the polygon; the winding follows the polygon
    function triangulate(P) {
        let nx = 0, ny = 0, nz = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
        const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return null; const N = [nx / l, ny / l, nz / l];
        const ax = Math.abs(N[0]) >= Math.abs(N[1]) && Math.abs(N[0]) >= Math.abs(N[2]) ? 0 : (Math.abs(N[1]) >= Math.abs(N[2]) ? 1 : 2), i0 = (ax + 1) % 3, i1 = (ax + 2) % 3, sg = N[ax] >= 0 ? 1 : -1;
        const Q = P.map(p => [p[i0] * sg, p[i1]]), idx = P.map((_, i) => i), tris = [];
        const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        let guard = 0;
        while (idx.length > 3 && guard++ < 10000) {
            let cut = false;
            for (let k = 0; k < idx.length; k++) {
                const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], a = Q[ia], b = Q[ib], c = Q[ic];
                if (cr(a, b, c) <= 1e-12) continue;
                let inside = false; for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = Q[j]; if (cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12) { inside = true; break; } }
                if (inside) continue; tris.push([ia, ib, ic]); idx.splice(k, 1); cut = true; break;
            }
            if (!cut) { for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]); idx.length = 0; }       // not a simple polygon: a fan
        }
        if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
        return { tris, normal: N };
    }
    // fills for the selected open edges: one per loop (or per open chain, which closes with a straight line, like F in Blender). The faces look the way the faces
    // around the hole look, or towards `eye` when those disagree. Returns { fills, skipped }.
    IM.fillFromEdges = function (edgeKeys, eye) {
        const D = IM.edgeData(); const out = { fills: [], skipped: 0 }; if (!D) return out;
        const sel = edgeKeys.map(k => D.byKey.get(k)).filter(Boolean), adj = new Map();
        sel.forEach(e => [e.a, e.b].forEach(v => { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }));
        const seen = new Set();
        sel.forEach(e0 => {
            if (seen.has(e0.k)) return; const comp = [], st = [e0]; seen.add(e0.k);
            while (st.length) { const e = st.pop(); comp.push(e); [e.a, e.b].forEach(v => adj.get(v).forEach(o => { if (!seen.has(o.k)) { seen.add(o.k); st.push(o); } })); }
            const verts = new Set(); comp.forEach(e => { verts.add(e.a); verts.add(e.b); }); const ends = []; let bad = false;
            verts.forEach(v => { const d = adj.get(v).length; if (d === 1) ends.push(v); else if (d !== 2) bad = true; });
            if (bad || (ends.length !== 0 && ends.length !== 2)) { out.skipped++; return; }
            const start = ends.length ? ends[0] : comp[0].a, used = new Set(), order = [start]; let v = start;
            for (let guard = 0; guard < 10000; guard++) { const e = adj.get(v).find(x => !used.has(x.k)); if (!e) break; used.add(e.k); v = e.a === v ? e.b : e.a; if (v === start) break; order.push(v); }
            if (order.length < 3) { out.skipped++; return; }
            const pts = order.map(i => D.vpos[i]), tr = triangulate(pts); if (!tr || !tr.tris.length) { out.skipped++; return; }
            // which way the faces look: the sum of the faces around the hole, or towards the viewer
            let ref = [0, 0, 0]; comp.forEach(e => { ref[0] += e.nrm[0]; ref[1] += e.nrm[1]; ref[2] += e.nrm[2]; });
            if (Math.hypot(ref[0], ref[1], ref[2]) < 0.5 * comp.length && eye) { const c = [0, 1, 2].map(a => pts.reduce((s, p) => s + p[a], 0) / pts.length); ref = [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]]; }
            const flip = tr.normal[0] * ref[0] + tr.normal[1] * ref[1] + tr.normal[2] * ref[2] < 0;
            // the geometry that most of the rim belongs to (the new faces are part of it) and one of its triangles
            const cnt = new Map(); comp.forEach(e => cnt.set(e.g, (cnt.get(e.g) || 0) + 1)); let g = comp[0].g, bn = 0; cnt.forEach((n, gg) => { if (n > bn) { bn = n; g = gg; } });
            const src = (comp.find(e => e.g === g) || comp[0]).tri;
            const r4 = (x) => Math.round(x * 10000) / 10000;
            out.fills.push({ id: Math.random().toString(36).slice(2, 6), g, src, pts: pts.map(p => [r4(p[0]), r4(p[1]), r4(p[2])]), tris: tr.tris.map(t => flip ? [t[0], t[2], t[1]] : t) });
        });
        return out;
    };
    IM.fillArea = function (f) {
        let a = 0; f.tris.forEach(t => { const p = t.map(i => f.pts[i]), u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]; a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }); return a;
    };

    // ---------- clearing the building's collision out of the rooms ----------
    // The building's own collision fills its rooms (measured on a real building: a solid block 4 x 8 x 3 m, a wall slab 38 cm thick that reaches 29 cm past the visible
    // wall, window frames and panels), so the interior is blocked by things you cannot see. Every room (the region of your rectangles as a few boxes, from 2 cm above
    // the floor up to the ceiling) is cut out of that collision, like a cutter that only works on collision. What is outside the room edge stays, the floor stays, and
    // the interior's own wall collision stands at the room edge. Switched off with import.clearCollision = false. Same shape as a cutter, in the grid's frame.
    IM.roomVolumes = function (force) {
        const P = S.project, I = P.import; if (!I || (I.clearCollision === false && !force) || !P.shell.ops.length) return [];
        const H = P.settings.ceilH || 2.45, z0 = 0.02, r4 = (v) => Math.round(v * 10000) / 10000;
        return M.Shell.regionRects(P.shell).map((r, i) => ({ id: 'room' + i, type: 'room', mesh: false, cx: r4((r[0] + r[2]) / 2), cy: r4((r[1] + r[3]) / 2), zb: z0, w: r4(r[2] - r[0]), h: r4(H - z0), d: r4(r[3] - r[1]), yaw: 0 }));
    };

    // ---------- several buildings: the model is cut by the openings of ALL of them ----------
    // One file is written for the model (and one for each collision file), so the cut preview, the collision and the export are given the cutters and the rooms of every
    // building. Each building has its own grid, so they are turned into the model's own coordinates here (and the host is told there is no grid: IM.NOFRAME).
    IM.NOFRAME = { x: 0, y: 0, z: 0, heading: 0 };
    const q4 = (v) => Math.round(v * 10000) / 10000;
    IM.allCutters = function () {
        const out = [];
        Model.bldAll(S.project).forEach(b => {
            const f = b.d.import.frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
            const push = (id, type, mesh, cx, cy, zb, w, hh, d, yaw) => out.push({ id, type, mesh, cx: q4(f.x + cx * c - cy * s), cy: q4(f.y + cx * s + cy * c), zb: q4(f.z + zb), w, h: hh, d, yaw: yaw + h });
            (b.d.import.cutters || []).forEach(k => {
                // a door whose frame is bigger than its opening: the collision opens to the frame, and the model's wall is cut out to the frame (a cutter of its own that
                // only cuts the wall around it: from 3 cm in front of the opening's plane to 31 cm behind it, where the model's own wall and its reveals are)
                const fe = IM.doorFrameExtent(k), bigger = fe && (fe.cu > fe.hw + 0.002 || fe.ct > fe.zt + 0.002);
                push(k.id, k.type, k.mesh, k.cx, k.cy, k.zb, bigger ? q4(2 * fe.cu) : k.w, bigger ? q4(fe.ct - k.zb) : k.h, k.d, k.yaw);
                if (bigger) { const nx = -Math.sin(k.yaw), ny = Math.cos(k.yaw); push(k.id + 'w', 'cut', true, k.cx - nx * 0.14, k.cy - ny * 0.14, k.zb, q4(2 * fe.cu), q4(fe.ct - k.zb), 0.34, k.yaw); }
            });
        });
        return out;
    };
    // the rooms of every building as boxes that clear the building's collision (force: also the buildings that do not clear it)
    IM.allRoomVolumes = function (force) {
        const out = [];
        Model.bldAll(S.project).forEach(b => {
            const d = b.d, I = d.import; if ((I.clearCollision === false && !force) || !d.shell.ops.length) return;
            const f = I.frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), H = d.settings.ceilH || 2.45, z0 = 0.02;
            M.Shell.regionRects(d.shell).forEach((r, i) => { const sx = (r[0] + r[2]) / 2, sy = (r[1] + r[3]) / 2; out.push({ id: b.id + 'room' + i, type: 'room', mesh: false, cx: q4(f.x + sx * c - sy * s), cy: q4(f.y + sx * s + sy * c), zb: q4(f.z + z0), w: q4(r[2] - r[0]), h: q4(H - z0), d: q4(r[3] - r[1]), yaw: h }); });
        });
        return out;
    };

    // ---------- clearing the model's parts out of the rooms ----------
    // What of the model lies INSIDE a room is cut away at the room's walls, like a boolean in Blender: the boxes and frames of the model's windows that stick into the room,
    // plants and weeds that reach into it, vents, anything else (each kind can be switched off, and single parts left out). A part is a kind by the name of its texture
    // or shader (the host has the same rule, ClearSpec.KindOf). The rooms act as boxes from 30 cm under the floor to the ceiling; where a side of a room is its edge it
    // is moved in by the margin (1 cm), so a wall whose plane the room edge lies on to a millimetre or two is not cut. Switched off with import.clearMesh = false.
    IM.clearOn = () => !!imp() && imp().clearMesh !== false;
    IM.clearCats = () => Object.assign({ win: true, veg: true, other: true }, imp().clearCats || {});
    IM.clearMargin = () => { const m = imp().clearMargin; return m == null ? 0.01 : m; };
    const WIN_RX = /(^|[^a-z])(window|glass)/i, VEG_RX = /(^|[^a-z])(crop|weed|bush|hedge|tree|grass|plant|leaf|leaves|foliage|shrub|vine|ivy|flower|palm|fern|veg|moss|cactus)/i;
    IM.partKind = (tex, shader) => { const s = (tex || '') + ' ' + (shader || ''); return WIN_RX.test(s) ? 'win' : (VEG_RX.test(s) ? 'veg' : 'other'); };
    IM.clearWinDepth = () => { const v = imp().clearWinDepth; return v == null ? 0.10 : v; };
    // `extra`: a further inset of the sides that are the rooms' edges (the windows' own, see clearSpec)
    IM.allClearVolumes = function (extra) {
        const out = [], mg = IM.clearMargin();
        Model.bldAll(S.project).forEach(b => {
            const d = b.d, I = d.import; if (!d.shell.ops.length) return;
            const f = I.frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), H = d.settings.ceilH || 2.45, g = M.Shell.regionGrid(d.shell);
            const inReg = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
            // The room starts at the inner face of its wall, which is the wall thickness inside the room's edge: the parts of the model that lie in the thickness of the wall
            // (the window frames and boxes behind the siding, which the wall hides) stay, only what pokes past the wall's face into the room is cut.
            const T = Math.max(0, Math.min(0.5, +d.settings.wallThick || 0)), ins = mg + T + (extra || 0), zb = -0.3, top = H - mg;
            M.Shell.regionRects(d.shell).forEach((r, i) => {
                // a side that has another part of the room next to it stays where it is (2 mm over, so no seam is left); a side that is the room's edge moves in
                const nb = (x0, y0, x1, y1) => { let n = 0; for (const q of [0.25, 0.5, 0.75]) if (inReg(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q)) n++; return n >= 2; };
                const w = nb(r[0] - 0.005, r[1], r[0] - 0.005, r[3]), e = nb(r[2] + 0.005, r[1], r[2] + 0.005, r[3]), so = nb(r[0], r[1] - 0.005, r[2], r[1] - 0.005), no = nb(r[0], r[3] + 0.005, r[2], r[3] + 0.005);
                const x0 = r[0] + (w ? -0.002 : ins), x1 = r[2] + (e ? 0.002 : -ins), y0 = r[1] + (so ? -0.002 : ins), y1 = r[3] + (no ? 0.002 : -ins);
                if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || top - zb < 0.1) return;
                const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2;
                out.push({ id: b.id + 'clr' + i, type: 'clear', cx: q4(f.x + sx * c - sy * s), cy: q4(f.y + sx * s + sy * c), zb: q4(f.z + zb), w: q4(x1 - x0), h: q4(top - zb), d: q4(y1 - y0), yaw: h });
            });
        });
        return out;
    };
    // what the host is told to clear (null: nothing)
    IM.clearSpec = function () {
        if (!IM.clearOn()) return null; const volumes = IM.allClearVolumes(); if (!volumes.length) return null;
        // windows get their own, smaller volumes: a window's frame and box may reach this far (clearWinDepth) into the room past the wall's face before they are cut
        const wd = IM.clearWinDepth(), spec = { volumes, cats: IM.clearCats(), skip: imp().clearSkip || [] };
        if (wd > 0.0005) spec.winVolumes = IM.allClearVolumes(wd);
        return spec;
    };
    IM.clearKey = () => IM.clearOn() ? JSON.stringify([IM.allClearVolumes(), IM.clearWinDepth(), IM.clearCats(), imp().clearSkip || []]) : '';
    // ---------- where the detail models stand ----------
    // Every model file of the block is centred on its own point: the building's file on the building's entity (its position in the game's map), a detail file (hedges, weeds,
    // bushes, vents: det01..05, detail_01...) on ITS entity, some metres away. The editor draws, picks and cuts in the building's coordinates, so a detail file is moved from its own
    // frame into the building's (turn by the difference of the headings, move by the difference of the positions). import.detailPlace = { file: { x, y, z, heading, ymap } } is
    // where each one stands; without it a detail file is taken to stand on the building's centre (which it does not: the bush behind a window was not where it showed).
    const rad = (d) => d * Math.PI / 180;
    IM.detailXf = function (file) {
        const e = imp().entity, p = (imp().detailPlace || {})[file]; if (!e || !p) return null;
        const hb = rad(e.heading || 0), dl = rad(p.heading || 0) - hb, dx = p.x - e.x, dy = p.y - e.y, cb = Math.cos(-hb), sb = Math.sin(-hb);
        return { c: Math.cos(dl), s: Math.sin(dl), tx: dx * cb - dy * sb, ty: dx * sb + dy * cb, tz: p.z - e.z, dl };
    };
    // the origin the host needs to put the rooms (in the building's coordinates) into a detail file's own: the inverse of the move above (same shape as a cutter's origin)
    IM.detailOrigin = function (file) {
        const xf = IM.detailXf(file); if (!xf) return IM.NOFRAME;
        return { x: -(xf.tx * xf.c + xf.ty * xf.s), y: -(-xf.tx * xf.s + xf.ty * xf.c), z: -xf.tz, heading: -xf.dl * 180 / Math.PI };
    };
    IM.xfPos = function (a, xf) { const n = a.length / 3, o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const x = a[i * 3], y = a[i * 3 + 1]; o[i * 3] = x * xf.c - y * xf.s + xf.tx; o[i * 3 + 1] = x * xf.s + y * xf.c + xf.ty; o[i * 3 + 2] = a[i * 3 + 2] + xf.tz; } return o; };
    IM.xfNrm = function (a, xf) { const n = a.length / 3, o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const x = a[i * 3], y = a[i * 3 + 1]; o[i * 3] = x * xf.c - y * xf.s; o[i * 3 + 1] = x * xf.s + y * xf.c; o[i * 3 + 2] = a[i * 3 + 2]; } return o; };
    // moves every detail model to where it stands (from the file's own coordinates, kept as rawPos); true when something changed
    IM.applyPlaces = function () {
        const key = JSON.stringify([imp() && imp().entity, imp() && imp().detailPlace, IM.models.length]); if (IM._placeKey === key) return false; IM._placeKey = key;
        IM.models.forEach(m => {
            if (m.target) return; const xf = IM.detailXf(m.file);
            m.geoms.forEach(g => { if (!g.rawPos) { g.rawPos = g.pos; g.rawNrm = g.nrm; } g.pos = xf ? IM.xfPos(g.rawPos, xf) : g.rawPos; g.nrm = xf ? IM.xfNrm(g.rawNrm, xf) : g.rawNrm; });
        });
        IM.origD = null; IM.isl = {}; IM.cutDet = new Map(); IM.clearDet = null; IM.partGeo = null; IM.cutVer = (IM.cutVer || 0) + 1; return true;
    };
    IM.detailFiles = () => { const dmf = imp().doorModel ? imp().doorModel.file : null; return IM.models.filter(m => !m.target && m.file !== dmf && !IM.isPlaceable(m.file)).map(m => m.file); };
    IM.detailsPlaced = () => { const dp = imp().detailPlace || {}, all = IM.detailFiles(); return { have: all.filter(f => dp[f]).length, total: all.length }; };
    // look up where the detail models stand: the project's .ymap files, and the game's map files when `game` (the game is only read when the user asked once: the model's placement came from it, or the button)
    IM.lookupPlaces = async function (game) {
        const I = imp(); if (!I.entity) return { err: 'Set where the model stands first.' }; const files = IM.detailFiles(); if (!files.length) return { places: {} };
        const r = await Model.api('import/places?name=' + safe(), 'POST', { files, game: !!game, gta: '', near: { x: I.entity.x, y: I.entity.y } });
        if (r.places && Object.keys(r.places).length) { Model.edit(Q => { Q.import.detailPlace = Object.assign({}, Q.import.detailPlace || {}, r.places); }); IM.rebuild(); }
        return r;
    };
    IM.autoPlaces = function () {
        const I = imp(); if (!I || !I.entity || IM._placing) return; const dp = I.detailPlace || {}; if (!IM.detailFiles().some(f => !dp[f])) return;
        IM._placing = true; IM.lookupPlaces(I.entity.source === 'game').catch(() => { }).then(() => { IM._placing = false; bus.emit('importstatus'); });
    };

    // the detail models (the other files of the block) with the rooms cleared out of them, for the view: IM.cutDet = file -> (geometry number -> cut geometry)
    IM.cutDet = IM.cutDet || new Map(); let detSeq = 0;
    IM.cutDetails = async function () {
        if (S.project.kind !== 'import') return; const seq = ++detSeq, clear = IM.clearSpec(), I = imp(), dmf = I.doorModel ? I.doorModel.file : null;
        if (!clear) { if (IM.cutDet.size || IM.clearDet) { IM.cutDet = new Map(); IM.clearDet = null; IM.rebuild(); bus.emit('importstatus'); } return; }
        const det = new Map(), tot = { win: 0, veg: 0, other: 0 };
        try {
            for (const m of IM.models.filter(x => !x.target && x.file !== dmf && !IM.isPlaceable(x.file))) {
                const r = await Model.api('import/cut?name=' + safe(), 'POST', { target: m.file, origin: IM.detailOrigin(m.file), cutters: [], deletes: [], fills: [], clear }); if (seq !== detSeq) return;      // (the rooms in this file's own coordinates)
                const xf = IM.detailXf(m.file), gm = new Map(); (r.geoms || []).forEach(g => gm.set(g.g, { pos: xf ? IM.xfPos(f32(g.pos), xf) : f32(g.pos), nrm: xf ? IM.xfNrm(f32(g.nrm), xf) : f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx), tris: g.tris, src: g.src ? new Int32Array(bytes(g.src).buffer) : null }));
                if (gm.size) det.set(m.file, gm); ['win', 'veg', 'other'].forEach(k => { tot[k] += (r.cleared && r.cleared[k]) || 0; });
            }
        } catch (e) { toast('Could not clear the detail models: ' + e.message, 'err'); return; }
        if (seq !== detSeq) return; IM.cutDet = det; IM.clearDet = tot; IM.rebuild(); bus.emit('importstatus');
    };

    // ---------- the building's collision pieces, for picking them (Collision tool) ----------
    // The host lists every triangle and box of all the collision files near the model: file, child, polygon, kind, material and 4 corners (a box's 4 stored corners
    // give its 8: the same rule as the host's wire-frame). They are the ORIGINAL pieces, before any cutting. Deleted ones are import.colDeletes = [file name, child, polygon].
    const BOXSG = [[1, 1, -1, -1], [1, -1, 1, -1], [1, -1, -1, 1]];
    IM.colBoxCorners = function (p, o) {        // the 8 corners of the box whose 4 stored corners are p[o..o+12]
        const bc = [0, 0, 0], ee = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let a = 0; a < 3; a++) { bc[a] = (p[o + a] + p[o + 3 + a] + p[o + 6 + a] + p[o + 9 + a]) / 4; for (let j = 0; j < 3; j++) ee[j][a] = (BOXSG[j][0] * p[o + a] + BOXSG[j][1] * p[o + 3 + a] + BOXSG[j][2] * p[o + 6 + a] + BOXSG[j][3] * p[o + 9 + a]) / 4; }
        const cs = []; for (let q = 0; q < 8; q++) { const c = [0, 0, 0]; for (let a = 0; a < 3; a++) c[a] = bc[a] + ((q & 1) ? -1 : 1) * ee[0][a] + ((q & 2) ? -1 : 1) * ee[1][a] + ((q & 4) ? -1 : 1) * ee[2][a]; cs.push(c); }
        return cs;
    };
    IM.COLBOXEDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    IM.COLBOXFACES = [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]];
    IM.colPolysLoad = async function () {
        const I = imp(); if (S.project.kind !== 'import' || !I.entity || !(IM.files || []).some(f => f.kind === 'collision')) { IM.colPolys = null; return null; }
        const key = S.project.name + '|' + JSON.stringify(I.entity) + '|' + (IM.files || []).length; if (IM.colPolys && IM.colPolys.key === key) return IM.colPolys;
        if (IM._colLoading) return IM._colLoading;
        IM._colLoading = (async () => {
            try {
                const c0 = IM.fromShell(0, 0, 0), r = await Model.api('import/collision-polys?name=' + safe(), 'POST', { entity: I.entity, nx: c0[0], ny: c0[1], radius: 60 });
                const meta = new Int32Array(bytes(r.meta || '').buffer), verts = f32(r.verts || '');
                IM.colPolys = { key, files: r.files || [], n: meta.length / 5, meta, verts, sk: '' };
            } catch (e) { IM.colPolys = null; toast('Could not read the collision: ' + e.message, 'err'); }
            IM._colLoading = null; bus.emit('importstatus'); return IM.colPolys;
        })();
        return IM._colLoading;
    };
    // the pieces in the grid's frame: shell = 12 numbers per piece, box = the 6 numbers of its bounding box, ctr = its centre (recomputed when the grid moves)
    IM.colShell = function () {
        const cp = IM.colPolys; if (!cp) return null; const sk = JSON.stringify(imp().frame); if (cp.sk === sk) return cp;
        const n = cp.n, shell = new Float32Array(n * 12), box = new Float32Array(n * 6), ctr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const tri = cp.meta[i * 5 + 3] === 0, cnt = tri ? 3 : 4; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
            for (let k = 0; k < 4; k++) { const s = IM.toShell(cp.verts[i * 12 + k * 3], cp.verts[i * 12 + k * 3 + 1], cp.verts[i * 12 + k * 3 + 2]); shell[i * 12 + k * 3] = s[0]; shell[i * 12 + k * 3 + 1] = s[1]; shell[i * 12 + k * 3 + 2] = s[2]; }
            const pts = []; if (tri) { for (let k = 0; k < 3; k++) pts.push([shell[i * 12 + k * 3], shell[i * 12 + k * 3 + 1], shell[i * 12 + k * 3 + 2]]); } else IM.colBoxCorners(shell, i * 12).forEach(c => pts.push(c));
            const c = [0, 0, 0]; for (let k = 0; k < cnt; k++) for (let a = 0; a < 3; a++) c[a] += shell[i * 12 + k * 3 + a] / cnt;
            pts.forEach(p => { for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; } });
            for (let a = 0; a < 3; a++) { box[i * 6 + a] = mn[a]; box[i * 6 + 3 + a] = mx[a]; ctr[i * 3 + a] = c[a]; }
        }
        cp.shell = shell; cp.box = box; cp.ctr = ctr; cp.sk = sk; cp.region = null; return cp;
    };
    IM.colKey = (cp, i) => cp.files[cp.meta[i * 5]] + '|' + cp.meta[i * 5 + 1] + '|' + cp.meta[i * 5 + 2];
    IM.colDelSet = function () { const s = new Set(); (imp().colDeletes || []).forEach(d => s.add(d[0] + '|' + d[1] + '|' + d[2])); return s; };
    // the pieces worth picking: within 12 m of a room (to the sides) and from 1 m under the floor to 2 m over the ceiling, and not deleted
    IM.colRegion = function () {
        const cp = IM.colShell(); if (!cp) return []; const P = S.project, I = P.import, H = P.settings.ceilH || 2.45;
        const key = JSON.stringify([P.shell.ops, H, (I.colDeletes || []).length]); if (cp.region && cp.regionKey === key) return cp.region;
        const rects = M.Shell.regionRects(P.shell), del = IM.colDelSet(), out = [];
        for (let i = 0; i < cp.n; i++) {
            const x = cp.ctr[i * 3], y = cp.ctr[i * 3 + 1], z = cp.ctr[i * 3 + 2]; if (z < -1 || z > H + 2) continue;
            if (!rects.some(r => x > r[0] - 12 && x < r[2] + 12 && y > r[1] - 12 && y < r[3] + 12)) continue; if (del.has(IM.colKey(cp, i))) continue; out.push(i);
        }
        cp.region = out; cp.regionKey = key; return out;
    };

    // ---------- the model's collision (wire-frame, after the cutters) ----------
    let colTimer = null, colSeq = 0;
    IM.requestCollision = function () { clearTimeout(colTimer); colTimer = setTimeout(IM.collisionNow, 350); };
    // The collision overlay (orange) when it is switched on, and always the count of the building's collision inside the rooms (IM.colInside: { now, before }); what is
    // left inside the rooms is drawn in red.
    const toShellPts = (b64) => { const a = f32(b64 || ''), n = a.length / 3, pts = new Float32Array(a.length); for (let i = 0; i < n; i++) { const p = IM.toShell(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2]; } return pts; };
    IM.collisionNow = async function () {
        const R = M.App.renderer; if (!R) return; const col = [1.0, 0.55, 0.25, 0.6], red = [1.0, 0.22, 0.22, 0.95], none = () => { R.setStaticLines('collision', null, col, false); R.setStaticLines('collisionIn', null, red, false); };
        if (S.project.kind !== 'import') { none(); return; }
        const I = imp(); IM.colNote = '';
        if (!(IM.files || []).some(f => f.kind === 'collision')) { IM.colNote = S.showCollision ? 'No collision file imported.' : ''; IM.colInside = null; none(); bus.emit('importstatus'); return; }
        if (!I.entity) { IM.colNote = S.showCollision ? 'Set where the model stands in the game (Import tab) to see its collision.' : ''; IM.colInside = null; none(); bus.emit('importstatus'); return; }
        const seq = ++colSeq, c0 = IM.fromShell(0, 0, 0), show = !!S.showCollision;
        try {
            const r = await Model.api('import/collision-preview?name=' + safe(), 'POST', { cutters: IM.allCutters(), roomVolumes: IM.allRoomVolumes(), countRooms: IM.allRoomVolumes(true), colDeletes: I.colDeletes || [], lines: show, origin: IM.NOFRAME, entity: I.entity, nx: c0[0], ny: c0[1], radius: 45 });
            if (seq !== colSeq) return;
            IM.colInside = r.insideBefore != null && IM.allRoomVolumes(true).length ? { now: r.insideNow, before: r.insideBefore, clearing: I.clearCollision !== false } : null;
            if (show) { R.setStaticLines('collision', toShellPts(r.lines), col, true); R.setStaticLines('collisionIn', toShellPts(r.insideLines), red, true); IM.colNote = (r.removed || r.added) ? (r.removed + ' collision polygons cut away, ' + r.added + ' put back') : ''; }
            else none();
        } catch (e) { IM.colNote = show ? 'Collision: ' + e.message : ''; }
        bus.emit('importstatus'); const info = document.getElementById('colinside'); if (info) IM.colInsideFill(info);
    };
    // the line of the right panel that says how much of the building's collision is left inside the rooms
    IM.colInsideFill = function (node) {
        const c = IM.colInside; node.textContent = '';
        if (!c) { node.textContent = IM.allRoomVolumes(true).length ? 'Counting the building\'s collision inside the rooms...' : 'Draw a room to count the building\'s collision inside it.'; node.className = 'note'; return; }
        const left = c.now, clearing = c.clearing;
        node.className = 'note ' + (left === 0 ? 'ok' : (clearing ? '' : 'bad'));
        node.textContent = clearing ? ('Building collision inside the rooms: ' + left + ' left (' + c.before + ' before clearing)' + (left ? '. What is left is red in the view with the collision overlay on: pieces that belong to doors and windows, or that are not clear of the room.' : '.'))
            : ('Building collision inside the rooms: ' + left + ' pieces that can block you (clearing is off).');
    };

    // ---------- the building's collision as the export leaves it (for the walk check) ----------
    // Every collision file cut like the export cuts it (cutters, the rooms cleared, deleted pieces), near the rooms, in the grid's frame: n polygons, kind[i] 0 triangle / 1 box,
    // c[i*12..] the 4 stored corners (a box's 8 corners come from them). Cached until the cuts change.
    IM.colFinalKey = function () {
        const I = imp(); return JSON.stringify([IM.allCutters(), IM.allRoomVolumes(), I.colDeletes || [], I.frame, I.entity, (IM.files || []).length]);
    };
    IM.colFinalLoad = async function () {
        const I = imp(); if (S.project.kind !== 'import' || !I.entity || !(IM.files || []).some(f => f.kind === 'collision')) return null;
        const rects = M.Shell.regionRects(S.project.shell); if (!rects.length) return null;
        const key = IM.colFinalKey(); if (IM.colFinal && IM.colFinal.key === key) return IM.colFinal;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rects.forEach(r => { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); });
        const c0 = IM.fromShell((x0 + x1) / 2, (y0 + y1) / 2, 0), rad = Math.hypot(x1 - x0, y1 - y0) / 2 + 6;
        const r = await Model.api('import/collision-final?name=' + safe(), 'POST', { cutters: IM.allCutters(), roomVolumes: IM.allRoomVolumes(), colDeletes: I.colDeletes || [], origin: IM.NOFRAME, entity: I.entity, nx: c0[0], ny: c0[1], radius: rad });
        const meta = new Int32Array(bytes(r.meta || '').buffer), v = f32(r.verts || ''), n = meta.length / 5, kind = new Uint8Array(n), mat = new Int32Array(n), c = new Float32Array(n * 12);
        for (let i = 0; i < n; i++) {
            kind[i] = meta[i * 5 + 3]; mat[i] = meta[i * 5 + 4];
            for (let k = 0; k < 4; k++) { const s = IM.toShell(v[i * 12 + k * 3], v[i * 12 + k * 3 + 1], v[i * 12 + k * 3 + 2]); c[i * 12 + k * 3] = s[0]; c[i * 12 + k * 3 + 1] = s[1]; c[i * 12 + k * 3 + 2] = s[2]; }
        }
        IM.colFinal = { key, n, kind, mat, c, files: r.files || [], meta };
        return IM.colFinal;
    };

    // ---------- picking ----------
    function rayTri(o, d, p, a, b, c) {
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) return -1; const inv = 1 / det, tx = o[0] - p[a], ty = o[1] - p[a + 1], tz = o[2] - p[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return -1;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-4 ? t : -1;
    }
    IM.inView = function (x, y, z) {
        if (!IM.clipOn) return z <= IM.clipZ;
        const cam = M.App.renderer.camera.target, dx = x - cam[0], dy = y - cam[1]; return dx * dx + dy * dy <= IM.clipR * IM.clipR && z <= IM.clipZ;
    };
    // first triangle of the shown target model under the ray; the normal faces the viewer
    IM.pick = function (ray) {
        let best = null;
        for (const tb of IM.tgt) {
            const p = tb.pos, ix = tb.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3; if (!IM.inView(cx, cy, cz)) continue;
                best = { t: tt, g: tb.g, tri: t / 3, a, b, c, p };
            }
        }
        if (!best) return null;
        const p = best.p, a = best.a, b = best.b, c = best.c;
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
        if (n[0] * ray.d[0] + n[1] * ray.d[1] + n[2] * ray.d[2] > 0) n = [-n[0], -n[1], -n[2]];
        return { t: best.t, p: [ray.o[0] + ray.d[0] * best.t, ray.o[1] + ray.d[1] * best.t, ray.o[2] + ray.d[2] * best.t], n, g: best.g, tri: best.tri };
    };

    // ---------- the original (uncut) target in the shell frame, for choosing faces to delete ----------
    function shellOfModel(m) {
        const f = imp().frame, c = trig(), out = [];
        m.geoms.forEach(g => {
            const nv = g.pos.length / 3, pos = new Float32Array(nv * 3);
            for (let i = 0; i < nv; i++) { const dx = g.pos[i * 3] - f.x, dy = g.pos[i * 3 + 1] - f.y; pos[i * 3] = dx * c[0] + dy * c[1]; pos[i * 3 + 1] = -dx * c[1] + dy * c[0]; pos[i * 3 + 2] = g.pos[i * 3 + 2] - f.z; }
            out.push({ file: m.file, g: g.g, pos, idx: g.idx, lpos: g.pos });
        });
        return out;
    }
    function origShell() { if (IM.orig) return IM.orig; const m = IM.targetModel(); return (IM.orig = m ? shellOfModel(m) : []); }
    // the detail models (grilles, vents, bushes: separate files that go with the building) in the same frame; the door model is not one of them
    function origDetails() {
        if (IM.origD) return IM.origD; const dmf = imp().doorModel ? imp().doorModel.file : null, out = [];
        IM.models.forEach(m => { if (!m.target && m.file !== dmf && !IM.isPlaceable(m.file)) shellOfModel(m).forEach(t => out.push(t)); });
        return (IM.origD = out);
    }
    const isTarget = (file) => { const m = IM.targetModel(); return !file || (m && m.file === file); };
    const listOf = (file) => isTarget(file) ? origShell() : origDetails();
    // faces deleted from the detail models: Set of "geom:tri" for one file
    const mdelSet = (file) => { const s = new Set(); (imp().mdeletes || []).forEach(d => { if (d[0] === file) s.add(d[1] + ':' + d[2]); }); return s; };
    IM.mdelSet = mdelSet;
    function insideCutter(x, y, z) {
        return imp().cutters.some(k => {
            if (k.face) return false;                                            // an opening made from faces does not clip the model
            const dx = x - k.cx, dy = y - k.cy, cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), u = dx * cs + dy * sn, n = -dx * sn + dy * cs;
            return Math.abs(u) < k.w / 2 && Math.abs(n) < k.d / 2 && z > k.zb && z < k.zb + k.h;
        });
    }
    const delSet = () => { const s = new Set(); imp().deletes.forEach(d => s.add(d[0] + ':' + d[1])); return s; };
    // an object of the model under the ray, for choosing a building: everything that is shown can be picked (hidden objects cannot)
    IM.pickComponent = function (ray) {
        let best = null;
        for (const tb of origShell()) {
            const p = tb.pos, ix = tb.idx, mem = (IM.member && IM.isoMode() === 'hide') ? IM.member[IM.gIdx.get(tb.g)] : null;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (mem && !mem[t / 3]) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                if (!IM.inView((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3)) continue;
                best = { t: tt, g: tb.g, tri: t / 3 };
            }
        }
        if (best) best.comp = IM.compAt(best.g, best.tri);
        return best;
    };
    // first face of the original model under the ray (opts.details: also the shown detail models); { t, g, tri, file }
    IM.pickOriginal = function (ray, opts) {
        const dels = delSet(); let best = null, mdel = {};
        const lists = [origShell()]; if (opts && opts.details && IM.showDetails) lists.push(origDetails());
        const dbox = IM.detailBox();
        for (let li = 0; li < lists.length; li++) for (const tb of lists[li]) {
            const isT = li === 0, p = tb.pos, ix = tb.idx, mem = isT && IM.isolating() ? IM.member[IM.gIdx.get(tb.g)] : null, dl = isT ? dels : (mdel[tb.file] || (mdel[tb.file] = mdelSet(tb.file)));
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (mem && !mem[t / 3]) continue;
                if (dl.has(tb.g + ':' + t / 3)) continue;
                if (!isT && dbox && !inBox(dbox, tb.lpos, ix, t / 3)) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
                if (!IM.inView(cx, cy, cz)) continue;
                // a triangle that lies completely inside a cutter is already gone; one that only reaches into it is still there
                if (isT && insideCutter(p[a], p[a + 1], p[a + 2]) && insideCutter(p[b], p[b + 1], p[b + 2]) && insideCutter(p[c], p[c + 1], p[c + 2])) continue;
                best = { t: tt, g: tb.g, tri: t / 3, file: tb.file };
            }
        }
        return best;
    };
    // every face that is shown and can be selected (the building, minus what is deleted, and the detail models when they are shown), in the grid's frame:
    // { file, g, tri, p: [9 numbers], c: [x, y, z] centre }. Used by box select, select all and the like.
    IM.shownFaces = function (details) {
        const out = [], dels = delSet(), lists = [origShell()]; if (details && IM.showDetails) lists.push(origDetails());
        const dbox = IM.detailBox(), mdel = {};
        for (let li = 0; li < lists.length; li++) for (const tb of lists[li]) {
            const isT = li === 0, p = tb.pos, ix = tb.idx, mem = isT && IM.isolating() ? IM.member[IM.gIdx.get(tb.g)] : null, dl = isT ? dels : (mdel[tb.file] || (mdel[tb.file] = mdelSet(tb.file)));
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const tri = t / 3; if (mem && !mem[tri]) continue; if (dl.has(tb.g + ':' + tri)) continue; if (!isT && dbox && !inBox(dbox, tb.lpos, ix, tri)) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
                if (!IM.inView(cx, cy, cz)) continue;
                if (isT && insideCutter(p[a], p[a + 1], p[a + 2]) && insideCutter(p[b], p[b + 1], p[b + 2]) && insideCutter(p[c], p[c + 1], p[c + 2])) continue;
                out.push({ file: tb.file, g: tb.g, tri, p: [p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]], c: [cx, cy, cz] });
            }
        }
        return out;
    };
    // the connected piece of a model around one triangle: every triangle that can be reached through shared vertices (a grille, a vent, an air conditioner, a whole
    // building when it is one piece). Returns [{ g, tris }] over the geometries it spans.
    IM.isl = {};
    function islandData(file) {
        if (IM.isl[file]) return IM.isl[file]; const m = IM.models.find(x => x.file === file); if (!m) return null;
        const key = new Map(), par = []; let nid = 0;
        const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
        const vid = m.geoms.map(g => { const n = g.pos.length / 3, a = new Int32Array(n); for (let i = 0; i < n; i++) { const k = Math.round(g.pos[i * 3] * 500) + ',' + Math.round(g.pos[i * 3 + 1] * 500) + ',' + Math.round(g.pos[i * 3 + 2] * 500); let v = key.get(k); if (v === undefined) { v = nid++; key.set(k, v); par.push(v); } a[i] = v; } return a; });
        m.geoms.forEach((g, gi) => { for (let t = 0; t + 2 < g.idx.length; t += 3) { uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 1]]); uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 2]]); } });
        const groups = new Map(), tc = m.geoms.map(g => new Int32Array(g.idx.length / 3)), gIdx = new Map();
        m.geoms.forEach((g, gi) => { gIdx.set(g.g, gi); for (let t = 0; t * 3 < g.idx.length; t++) { const r = find(vid[gi][g.idx[t * 3]]); tc[gi][t] = r; let l = groups.get(r); if (!l) groups.set(r, l = new Map()); let arr = l.get(g.g); if (!arr) l.set(g.g, arr = []); arr.push(t); } });
        return (IM.isl[file] = { tc, groups, gIdx });
    }
    IM.island = function (file, g, tri) {
        const d = islandData(file || (IM.targetModel() || {}).file); if (!d) return []; const gi = d.gIdx.get(g); if (gi === undefined) return [];
        const l = d.groups.get(d.tc[gi][tri]), out = []; if (l) l.forEach((tris, gg) => out.push({ g: gg, tris })); return out;
    };
    // the flat, connected patch of triangles around one triangle (same plane, sharing edges)
    IM.flatPatch = function (g, tri, file) {
        const tb = listOf(file).find(x => x.g === g && (!file || x.file === file)); if (!tb) return [tri];
        const ix = tb.idx, P = tb.lpos, akey = tb.file + '|' + g;
        let adj = IM.adj[akey];
        if (!adj) {
            const weld = new Map(), wid = new Int32Array(P.length / 3);
            for (let i = 0; i < wid.length; i++) { const k = Math.round(P[i * 3] * 1000) + ',' + Math.round(P[i * 3 + 1] * 1000) + ',' + Math.round(P[i * 3 + 2] * 1000); let w = weld.get(k); if (w === undefined) { w = weld.size; weld.set(k, w); } wid[i] = w; }
            const edges = new Map(); adj = []; const nt = ix.length / 3;
            for (let t = 0; t < nt; t++) adj.push([]);
            for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
                const a = wid[ix[t * 3 + e]], b = wid[ix[t * 3 + (e + 1) % 3]]; if (a === b) continue; const k = a < b ? a + '_' + b : b + '_' + a, o = edges.get(k);
                if (o === undefined) edges.set(k, t); else { adj[t].push(o); adj[o].push(t); }
            }
            IM.adj[akey] = adj;
        }
        const normal = (t) => {
            const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3, e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
            const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l, P[a], P[a + 1], P[a + 2]];
        };
        const n0 = normal(tri), d0 = n0[0] * n0[3] + n0[1] * n0[4] + n0[2] * n0[5], seen = new Set([tri]), q = [tri];
        while (q.length && seen.size < 3000) {
            const t = q.pop();
            for (const o of adj[t]) {
                if (seen.has(o)) continue; const n = normal(o);
                if (Math.abs(n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2]) < 0.9995) continue;
                if (Math.abs(n0[0] * n[3] + n0[1] * n[4] + n0[2] * n[5] - d0) > 0.03) continue;
                seen.add(o); q.push(o);
            }
        }
        return [...seen];
    };
    IM.triCorners = function (g, tri, file) {
        const tb = listOf(file).find(x => x.g === g && (!file || x.file === file)); if (!tb) return null;
        const o = []; for (let k = 0; k < 3; k++) { const i = tb.idx[tri * 3 + k] * 3; o.push([tb.pos[i], tb.pos[i + 1], tb.pos[i + 2]]); } return o;
    };

    // ---------- lines of the model's own walls, so rooms snap to them ----------
    IM.snapLines = function () {
        if (IM.lines) return IM.lines;
        const xs = new Map(), ys = new Map();
        for (const tb of IM.tgt) {
            const p = tb.pos, ix = tb.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]); if (l < 0.4) continue;        // area under 0.2 m2
                if (Math.abs(n[2] / l) > 0.04) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3; if (Math.abs(cx) > 60 || Math.abs(cy) > 60) continue;
                const m = Math.abs(n[0] / l) > 0.999 ? xs : (Math.abs(n[1] / l) > 0.999 ? ys : null); if (!m) continue;
                const v = m === xs ? cx : cy, k = Math.round(v * 100); m.set(k, (m.get(k) || 0) + l / 2);
            }
        }
        const pick = (m) => [...m.entries()].filter(e => e[1] > 0.8).map(e => e[0] / 100);
        return (IM.lines = { xs: pick(xs), ys: pick(ys) });
    };

    // ---------- bounds of the target in the shell frame (for framing the camera) ----------
    IM.bounds = function (building) {
        const m = IM.targetModel(); if (!m) return null;
        const boxes = (building && IM.selComps) ? [...IM.selComps].map(id => { const c = IM.comp.comps[id]; return [c.mn, c.mx]; }) : [[m.bmin, m.bmax]];
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        boxes.forEach(bx => { for (let i = 0; i < 8; i++) { const p = IM.toShell((i & 1) ? bx[1][0] : bx[0][0], (i & 2) ? bx[1][1] : bx[0][1], (i & 4) ? bx[1][2] : bx[0][2]); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } } });
        return { mn, mx };
    };
})(window.MLO);
