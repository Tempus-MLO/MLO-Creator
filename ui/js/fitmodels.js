// Window and door models from .glb files, placed by hand with a gizmo (Models tool, key I).
// The library: every .glb of the project, split by the host into models (one per window system, or the one door). A placement ("fit") is stored in
// import.fits = [{ id, f (file), m (model id), kind, cx, cy, zb, yaw, w, d, h, hinge, open }] in the grid's coordinates: (cx, cy) is the middle of the model's
// footprint, zb its bottom, yaw the turn of its width axis u = (cos, sin), n = (-sin, cos) is the way its front faces. w, d, h are the size the user gave it.
// Nothing is cut from the building: the user deletes the wall faces himself with the Delete faces tool. A placement only opens the interior's own wall (and makes the portal).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus, IM = M.ImportModel;
    const imp = () => S.project.import;
    const safe = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const randId = () => Math.random().toString(36).slice(2, 6);
    const api = () => M.Tools.api;
    const IT = () => M.ImportTools;
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    const FM = M.FitModels = { lib: { files: [], byId: new Map(), busy: false, error: '', ver: 0, loaded: false }, sel: null };
    const fits = () => (S.project.kind === 'import' && imp()) ? (imp().fits || []) : [];
    const byId = (id) => fits().find(f => f.id === id) || null;
    const selFit = () => { const f = FM.sel ? byId(FM.sel) : null; if (!f) FM.sel = null; return f; };
    let thumbs = new Map(), bakeCache = new Map(), hover = { fit: null, h: null, surf: null, ray: null }, drag = null;

    // ---------- the library ----------
    FM.reset = function () { FM.lib = { files: [], byId: new Map(), busy: false, error: '', ver: (FM.lib.ver || 0) + 1, loaded: false }; thumbs = new Map(); bakeCache.clear(); FM.sel = null; FM.chosen = null; drag = null; FM.catalog = { query: '', kind: 'all', format: 'all', sort: 'name', page: 0 }; FM.game = { records: [], root: '', busy: false, error: '', pending: new Map(), failed: new Set(), total: 0 }; };
    FM.kindOf = function (file) { const rec = FM.lib.files.find(x => x.file === file); return ((imp().glbKinds || {})[file]) || (rec ? rec.guess : 'window'); };
    FM.setKind = function (file, kind) { if (file.startsWith('gta:')) return; Model.edit(P => { P.import.glbKinds = P.import.glbKinds || {}; P.import.glbKinds[file] = kind; }); IM.origD = null; IM.rebuild(); FM.loadLib(file); };
    FM.model = function (id) { return FM.lib.byId.get(id) || null; };
    FM.models = function () { const out = []; FM.lib.files.forEach(f => f.models.forEach(m => out.push(m))); return out; };
    // `only`: the name of one file to read again (its kind, or the turn of one of its models, changed); the others stay as they are
    FM.loadLib = async function (only) {
        if (S.project.kind !== 'import') return;
        const lib = FM.lib; lib.busy = true; lib.error = '';
        try {
            const r = await Model.api('import/glb?name=' + safe(), 'POST', { kinds: imp().glbKinds || {}, setups: imp().glbSetup || {}, only: only || '' });
            (r.textures || []).forEach(t => { IM.textures[t.name] = { w: t.w, h: t.h, rgba: bytes(t.rgba) }; });
            const files = lib.files.filter(f => only ? f.file !== only : !!f.game), map = new Map([...lib.byId].filter(e => only ? e[1].f !== only : !!e[1].game));
            (r.files || []).forEach(f => {
                const rec = { file: f.file, builtin: !!f.builtin, guess: f.kind || 'window', title: f.title || '', author: f.author || '', license: f.license || '', source: f.source || '', error: f.error || '', warnings: f.warnings || [], models: [] };
                const mats = (f.mats || []).map(m => ({ name: m.name, key: m.key, color: m.color || [0.7, 0.7, 0.7, 1], tex: m.tex || '', glass: !!m.glass }));
                (f.models || []).forEach(m => {
                    const size = [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]];
                    const mm = { id: m.id, f: f.file, name: m.name, min: m.min, max: m.max, size, tris: m.tris, core: m.core || null, latch: m.latch || 0, rot: m.rot || SETUP.ident, auto: !!m.auto, inner: m.inner || null, mats, geoms: m.geoms.map(g => ({ mat: g.mat, pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx) })) };
                    rec.models.push(mm); map.set(mm.id, mm);
                });
                files.push(rec);
            });
            files.sort((a, b) => a.file.localeCompare(b.file));
            lib.files = files; lib.byId = map; lib.loaded = true;
            if (M.App.renderer) M.App.renderer.resetImgTextures();
        } catch (e) { lib.error = e.message; M.Errors.report('glb', e, { quiet: true }); }
        lib.busy = false; lib.ver++; bakeCache.clear(); thumbs = new Map();
        for (const fit of fits().filter(f => f.game)) { try { await FM.ensureGame(fit.m); } catch(e) { lib.error=e.message; } }
        M.UI.renderLeft(); if (M.App.remesh) M.App.remesh();
    };
    FM.game = { records: [], root: '', busy: false, error: '', pending: new Map(), failed: new Set(), total: 0 };
    FM.acceptGame = function (response) {
        const lib = FM.lib;
        (response.textures || []).forEach(t => { IM.textures[t.name] = { w:t.w, h:t.h, rgba:bytes(t.rgba) }; });
        response.files.forEach(f => {
            const rec = { file:f.file, guess:f.game.Kind || 'prop', title:f.title, game:f.game, warnings:f.warnings || [], models:[] };
            const mats = f.mats.map(m => ({name:m.name,key:m.key,color:m.color,tex:m.tex,glass:m.glass}));
            f.models.forEach(m => {
                const mm = {id:m.id,f:f.file,name:m.name,game:f.game,min:m.min,max:m.max,size:m.max.map((v,i)=>v-m.min[i]),tris:m.tris,rot:SETUP.ident,mats,geoms:m.geoms.map(g=>({mat:g.mat,pos:f32(g.pos),nrm:f32(g.nrm),uv:f32(g.uv),idx:u16(g.idx)}))};
                rec.models.push(mm);lib.byId.set(mm.id,mm);
            });
            lib.files = lib.files.filter(x=>x.file!==f.file);lib.files.push(rec);
        });
        lib.ver++;thumbs.clear();bakeCache.clear();
        if (M.App.renderer) M.App.renderer.resetImgTextures();
    };
    FM.ensureGame = async function (id) {
        if (FM.model(id)) return FM.model(id);
        if (FM.game.pending.has(id)) return FM.game.pending.get(id);
        const lib = FM.lib, game = FM.game;
        const task = (async () => {
            const response = await Model.api('import/rpf-model?name='+safe(),'POST',{id:id.replace(/^gta:/,''),gta:game.root});
            if (FM.lib !== lib) throw new Error('Project changed while loading the model');
            FM.acceptGame(response);return FM.model(id);
        })();
        game.pending.set(id,task);
        try { return await task; } catch(e) { game.failed.add(id); throw e; } finally { game.pending.delete(id); }
    };
    FM.gameEntries = function (records) {
        return (records || FM.game.records).map(row => {
            const id = 'gta:'+row.Id, m = FM.model(id) || {id,name:row.Name,game:row,size:null,geoms:null};
            m.game = row;
            const loadedFile = FM.lib.files.find(f => f.file === m.f); if (loadedFile) loadedFile.game = row;
            return {m,kind:row.Kind || 'prop',f:{file:row.Name+'.ydr',title:row.Name,game:row,warnings:[]}};
        });
    };
    function gameControls(host, refresh) {
        host.innerHTML = '';
        if (FM.catalog.origin !== 'game') return;
        const game = FM.game;
        const path = el('input',{type:'text',class:'model-search',value:game.root,placeholder:'GTA V installation folder','aria-label':'Local GTA installation'});
        if (!game.root) Model.api('import/rpf-status?name='+safe()).then(r=>{if(!path.value){path.value=r.gta||'';game.root=path.value;}}).catch(()=>{});
        const status = el('p',{class:'note',role:'status'},game.busy?'Indexing archive metadata…':(game.total?game.total.toLocaleString()+' YDR archive entries indexed. '+(game.uniqueTotal || 0).toLocaleString()+' unique model names. Search and pages use metadata only.':'Read-only local catalogue. All props searches the whole YDR index except doors/windows, which stay in Build. Categories are approximate. Geometry loads only when selected.'));
        const button = el('button',{type:'button',class:'btn',disabled:game.busy?true:null,onclick:async()=>{
            game.busy=true;game.error='';game.root=path.value.trim();button.disabled=true;status.textContent='Scanning archive metadata…';
            const poll=setInterval(()=>Model.api('import/rpf-status?name='+safe()).then(r=>{status.textContent=r.status||'Reading archive metadata…';}).catch(()=>{}),1000);
            try {
                const r=await Model.api('import/rpf-index?name='+safe(),'POST',{gta:game.root});
                game.records=r.pilot || [];game.total=r.models;game.uniqueTotal=r.uniqueModels;game.version=(game.version || 0)+1;game.root=r.root;game.failed.clear();
            } catch(e){game.error=e.message;} finally {clearInterval(poll);game.busy=false;gameControls(host,refresh);refresh();}
        }},game.total?'Refresh local index':'Index local GTA');
        const settings = el('details',{class:'model-import-notes'},el('summary',null,'Installation and search tags'));
        if (game.total) { settings.append(path,button); host.append(status,settings); }
        else host.append(path,button,status);
        const tagHost = game.total ? settings : host;
        if(game.error)host.append(el('p',{class:'note model-error',role:'alert'},game.error));
        const tagsPath=el('input',{type:'text',class:'model-search',placeholder:'Path to optional props_export.json','aria-label':'Optional prop tags JSON path'});
        tagHost.append(el('details',{class:'model-import-notes'},el('summary',null,'Optional external search tags'),el('p',{class:'note'},'Read a local Sadler2-style JSON export. AI labels are search hints; dimensions and assets still come from GTA.'),tagsPath,
            el('button',{type:'button',class:'btn sm',disabled:!game.total?true:null,onclick:async()=>{
                try {const r=await Model.api('import/rpf-labels?name='+safe(),'POST',{path:tagsPath.value});game.version=(game.version || 0)+1;refresh();M.UI.toast('Loaded optional search tags.');}catch(e){M.UI.toast(e.message,'err');}
            }},'Read tags JSON')));
    }

    // Setting a model up: a model can lie down or face the wrong way as it comes out of its file. Quarter turns (3x3, row major, on (u = width, n = depth, z = up)) are kept for each model in
    // import.glbSetup; none stored = the host stands a door or a frame up by itself. The turn is applied by the host (the library comes back turned), and by the export.
    const mul3 = (A, B) => { const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C.map(v => v + 0); };
    const SETUP = { ident: [1, 0, 0, 0, 1, 0, 0, 0, 1], tilt: [1, 0, 0, 0, 0, -1, 0, 1, 0], roll: [0, 0, 1, 0, 1, 0, -1, 0, 0], spin: [0, -1, 0, 1, 0, 0, 0, 0, 1], flip: [-1, 0, 0, 0, -1, 0, 0, 0, 1], over: [1, 0, 0, 0, -1, 0, 0, 0, -1] };
    FM.setup = function (m, how) { if (m.game) return;
        Model.edit(P => {
            P.import.glbSetup = P.import.glbSetup || {};
            if (how === 'auto') delete P.import.glbSetup[m.id]; else P.import.glbSetup[m.id] = how === 'reset' ? SETUP.ident.slice() : mul3(SETUP[how], m.rot || SETUP.ident);
        });
        return FM.loadLib(m.f);
    };

    // Cached front / three-quarter previews. A small depth projection makes props
    // readable without changing their actual model orientation or placement.
    FM.thumb = function (m, px, view) {
        px = px || 72; view = view || 'front';
        const key = m.id + ':' + view + ':' + px;
        let url = thumbs.get(key);
        if (!url) {
            const W = px * 2, cv = document.createElement('canvas'); cv.width = W; cv.height = W;
            const ctx = cv.getContext('2d'), iso = view === 'iso', a = iso ? Math.PI / 6 : 0, e = iso ? Math.PI / 10 : 0;
            const project = (x, y, z) => [-x * Math.cos(a) + y * Math.sin(a), z * Math.cos(e) - (x * Math.sin(a) + y * Math.cos(a)) * Math.sin(e)];
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            m.geoms.forEach(g => { for (let i = 0; i < g.pos.length; i += 3) {
                const p = project(g.pos[i], g.pos[i + 1], g.pos[i + 2]);
                x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
            } });
            const sc = Math.min((W - 32) / Math.max(0.001, x1 - x0), (W - 32) / Math.max(0.001, y1 - y0));
            const screen = (g, i) => { const p = project(g.pos[i], g.pos[i + 1], g.pos[i + 2]); return [W / 2 + (p[0] - (x0 + x1) / 2) * sc, W / 2 - (p[1] - (y0 + y1) / 2) * sc]; };
            const tris = [];
            m.geoms.forEach(g => {
                const mat = m.mats[g.mat] || m.mats[0], c = mat.color;
                for (let t = 0; t + 2 < g.idx.length; t += 3) {
                    const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, d = g.idx[t + 2] * 3;
                    const nx = (g.nrm[a] + g.nrm[b] + g.nrm[d]) / 3, ny = (g.nrm[a + 1] + g.nrm[b + 1] + g.nrm[d + 1]) / 3, nz = (g.nrm[a + 2] + g.nrm[b + 2] + g.nrm[d + 2]) / 3;
                    const sh = 0.5 + 0.5 * Math.max(0, -nx * 0.35 + ny * 0.65 + nz * 0.65);
                    const depth = (g.pos[a] + g.pos[b] + g.pos[d]) * Math.sin(iso ? Math.PI / 6 : 0) + (g.pos[a + 1] + g.pos[b + 1] + g.pos[d + 1]) * Math.cos(iso ? Math.PI / 6 : 0) + (g.pos[a + 2] + g.pos[b + 2] + g.pos[d + 2]) * Math.sin(iso ? Math.PI / 10 : 0);
                    tris.push({depth, points:[screen(g,a),screen(g,b),screen(g,d)], color:mat.glass ? 'rgba(150,200,235,.4)' : 'rgb(' + c.slice(0,3).map(v => Math.round(Math.min(1,v * sh) * 255)).join(',') + ')'});
                }
            });
            tris.sort((a,b) => a.depth-b.depth).forEach(t => {
                ctx.fillStyle = t.color; ctx.strokeStyle = t.color; ctx.lineWidth = .5;
                ctx.beginPath(); t.points.forEach((p,i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fill(); ctx.stroke();
            });
            url = cv.toDataURL('image/png'); thumbs.set(key,url);
        }
        const im = new Image(); im.src = url; im.style.width = px + 'px'; im.style.height = px + 'px'; im.draggable = false; return im;
    };

    // ---------- placements in the view ----------
    // the model baked to a placement (scaled to its size, turned, moved), as batches of the renderer; kept until the placement changes
    // A double door: two leaves side by side, each half of the placement's width, hinged on the two outer edges and meeting in the middle. A door model has its knob on one side; the
    // leaf whose knob would come out on its hinge side is the model turned inside out left-to-right (a mirror), so both knobs are where the leaves meet.
    // side +1 is the half on +u (the viewer's left, hinge left), side -1 the other. Returns [{ side, hinge, du (the leaf's middle from the placement's, along the wall), w, mirror }].
    FM.leaves = function (it) {
        if (!(it.double && it.kind === 'door')) return [{ side: 0, hinge: it.hinge || 'l', du: 0, w: it.w, mirror: false }];
        const m = FM.model(it.m), nat = m && m.latch > 0 ? 'r' : 'l';              // the hinge side the model is made for (opposite its knob)
        return [{ side: 1, hinge: 'l', du: it.w / 4, w: it.w / 2, mirror: nat !== 'l' }, { side: -1, hinge: 'r', du: -it.w / 4, w: it.w / 2, mirror: nat !== 'r' }];
    };
    function bake(it) {
        const m = FM.model(it.m); if (!m) { if(it.game && !FM.game.failed.has(it.m)) FM.ensureGame(it.m).then(()=>M.App.remesh()).catch(e=>{FM.game.error=e.message;}); return []; }
        const key = [FM.lib.ver, it.m, it.cx, it.cy, it.zb, it.yaw, it.w, it.d, it.h, it.double ? 'D' : 's'].join('|'), c = bakeCache.get(it.id); if (c && c.key === key) return c.batches;
        const sd = it.d / m.size[1], sh = it.h / m.size[2], uc = (m.min[0] + m.max[0]) / 2, nc = (m.min[1] + m.max[1]) / 2, z0 = m.min[2], cs = Math.cos(it.yaw), sn = Math.sin(it.yaw), out = [];
        FM.leaves(it).forEach(lf => {
            const sw = lf.w / m.size[0], mir = lf.mirror ? -1 : 1;
            m.geoms.forEach(g => {
                const nv = g.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), mat = m.mats[g.mat] || m.mats[0];
                for (let i = 0; i < nv; i++) {
                    const lu = (g.pos[i * 3] - uc) * sw * mir + lf.du, ln = (g.pos[i * 3 + 1] - nc) * sd, lz = (g.pos[i * 3 + 2] - z0) * sh;
                    pos[i * 3] = it.cx + lu * cs - ln * sn; pos[i * 3 + 1] = it.cy + lu * sn + ln * cs; pos[i * 3 + 2] = it.zb + lz;
                    let nu = g.nrm[i * 3] / sw * mir, nn = g.nrm[i * 3 + 1] / sd, nz = g.nrm[i * 3 + 2] / sh; const l = Math.hypot(nu, nn, nz) || 1; nu /= l; nn /= l; nz /= l;
                    nrm[i * 3] = nu * cs - nn * sn; nrm[i * 3 + 1] = nu * sn + nn * cs; nrm[i * 3 + 2] = nz;
                }
                let idx = g.idx; if (lf.mirror) { idx = new g.idx.constructor(g.idx.length); for (let t = 0; t + 2 < idx.length; t += 3) { idx[t] = g.idx[t]; idx[t + 1] = g.idx[t + 2]; idx[t + 2] = g.idx[t + 1]; } }       // (a mirror turns the faces inside out: the order of the corners goes back)
                out.push({ level: 0, kind: 'fit', group: 'fit', tex: '', imgKey: mat.tex && IM.textures[mat.tex] ? mat.tex : null, flat: [mat.color[0], mat.color[1], mat.color[2]], alpha: 1, noCull: true, pos, nrm, uv: g.uv, idx, glass: mat.glass, fit: it.id });
            });
        });
        bakeCache.set(it.id, { key, batches: out }); return out;
    }
    FM.batches = function () {
        const list = fits(), out = []; if (!FM.lib.loaded) return out;
        list.forEach(it => { bake(it).forEach(b => out.push(b)); });
        if (bakeCache.size > list.length + 4) { const ids = new Set(list.map(f => f.id)); [...bakeCache.keys()].forEach(k => { if (!ids.has(k)) bakeCache.delete(k); }); }
        return out;
    };
    // The placements open the interior's own walls (and make the portals and the glass collision) like cutters do; they cut nothing from the building.
    // A door's room: the same gap each side of the leaf, so that the cut is centred on the door: half the leaf's thickness (the leaf turns about its hinge, so its corner sweeps that far into the jamb;\n    // the knob does not count) and 1.5 cm to spare.
    function doorRoom(it) {
        const m = FM.model(it.m), t = m && m.core ? (m.core[1] - m.core[0]) * it.d / m.size[1] : Math.min(it.d, 0.08);
        return { gap: t / 2 + 0.015 };
    }
    // The wall cut of a door: the size of the door-shaped opening it was fitted to (it.cut = { w, h, du, dz }: the hole's size, and where its middle is from the door's middle along the
    // wall and in height), else the door plus its room, 2 cm higher, moved towards the hinge side. Returns the hole: middle (cx, cy), bottom, width, height.
    FM.doorCut = function (it) {
        const rm = doorRoom(it); let w = it.w + 2 * rm.gap, z0 = it.zb, h = it.h + 0.02;
        if (it.cut) { w = it.cut.w; h = it.cut.h; z0 = it.zb + (it.cut.dz || 0); }
        const hz = z0 <= 0.02 ? 0 : r3(z0);          // (a door on the floor keeps the floor: no sill piece)
        return { cx: it.cx, cy: it.cy, zb: hz, w: r3(w), h: r3(z0 + h - hz) };
    };
    FM.cutters = function (project) {
        const list = (project && project.import && project.import.fits) || [];
        // (a door that stands in a frame has no hole of its own: the frame's hole is the wall's cut)
        return list.filter(f => f.kind !== 'prop' && f.open !== false && f.w > 0.1 && f.h > 0.1 && !(f.kind === 'door' && findFrame(f, list))).map(f => {
            if (f.kind === 'door') { const c = FM.doorCut(f); return { id: 'fit' + f.id, type: 'door', face: true, fit: true, cx: c.cx, cy: c.cy, zb: c.zb, w: c.w, h: c.h, d: 0.8, yaw: f.yaw, dd: 0 }; }
            // a window or a frame: the hole is 1 cm smaller than the model all round, so its frame overlaps the wall; a frame on the floor is a doorway (no sill piece, no glass)
            const frame = f.kind === 'frame', floor = frame && f.zb <= 0.02, zb = floor ? 0 : r3(f.zb + 0.01);
            return { id: 'fit' + f.id, type: frame && floor ? 'door' : 'window', face: true, fit: true, noglass: frame, cx: f.cx, cy: f.cy, zb, w: r3(f.w - 0.02), h: r3(f.zb + f.h - 0.01 - zb), d: 0.8, yaw: f.yaw, dd: 0 };
        });
    };
    // ---- frames: a door frame is placed in the opening of the wall; the door goes inside the frame ----
    // The clear opening of a frame as placed: width, height, where its middle is from the frame's middle along the wall (cu) and its bottom. Without a measured opening: the whole frame.
    function frameInner(fr) {
        const m = FM.model(fr.m); if (!m) return null; const su = fr.w / m.size[0], sz = fr.h / m.size[2], uc = (m.min[0] + m.max[0]) / 2, inn = m.inner || [m.min[0], m.max[0], m.min[2], m.max[2]];
        return { w: (inn[1] - inn[0]) * su, h: (inn[3] - inn[2]) * sz, cu: ((inn[0] + inn[1]) / 2 - uc) * su, zb: fr.zb + (inn[2] - m.min[2]) * sz };
    }
    // the frame a door stands in: the one whose box holds the door's middle (about the same way round, and in the same wall)
    function findFrame(it, list) {
        let best = null; (list || fits()).forEach(fr => {
            if (fr.kind !== 'frame' || fr.id === it.id || fr.open === false) return;
            let dy = Math.abs((((fr.yaw - it.yaw) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2); dy = Math.min(dy, Math.PI - dy); if (dy > 0.15) return;
            const FU = [Math.cos(fr.yaw), Math.sin(fr.yaw)], FN = [-Math.sin(fr.yaw), Math.cos(fr.yaw)], dx = it.cx - fr.cx, dz = it.cy - fr.cy, du = dx * FU[0] + dz * FU[1], dn = dx * FN[0] + dz * FN[1], mid = it.zb + it.h / 2;
            if (Math.abs(du) > fr.w / 2 + 0.05 || Math.abs(dn) > 0.6 || mid < fr.zb - 0.05 || mid > fr.zb + fr.h + 0.05) return;
            const s = Math.abs(du) + Math.abs(dn); if (!best || s < best.s) best = { fr, s };
        });
        return best ? best.fr : null;
    }
    // the door sized and put to the frame's opening: the opening less its room (and 2 cm at the head), in the middle of the frame across the wall as well
    function doorInFrame(it, fr) {
        const fi = frameInner(fr); if (!fi) return null; const { U, N } = axes(it), rm = doorRoom(it), FU = [Math.cos(fr.yaw), Math.sin(fr.yaw)];
        const ox = fr.cx + FU[0] * fi.cu, oy = fr.cy + FU[1] * fi.cu, along = (ox - it.cx) * U[0] + (oy - it.cy) * U[1], across = (fr.cx - it.cx) * N[0] + (fr.cy - it.cy) * N[1];
        return { cx: r3(it.cx + U[0] * along + N[0] * across), cy: r3(it.cy + U[1] * along + N[1] * across), zb: fi.zb < 0.02 ? 0 : r3(fi.zb), w: r3(Math.max(0.5, fi.w - 2 * rm.gap)), h: r3(Math.max(1.5, fi.h - 0.02)), cut: { w: r3(fi.w), h: r3(fi.h), du: 0, dz: 0 } };
    }
    // a frame put to the building's door opening: its outside is the opening (its depth and its place across the wall stay)
    function frameFit(it, r) {
        const { U } = axes(it), along = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1];
        return { cx: r3(it.cx + U[0] * along), cy: r3(it.cy + U[1] * along), zb: r.zb < 0.02 ? 0 : r3(r.zb), w: r3(r.w), h: r3(r.h) };
    }
    // The door-shaped opening of the building behind a door (the faces the building has where its own door is: the "door cut" the wall is measured from): the flat patch of faces that
    // is about as tall as a door and starts near the floor, found by looking along the wall's normal through the door's area, from outside and from inside. Null when there is none (the
    // faces may be deleted already). Returns the rectangle of the faces (IM.faceRect: middle, bottom, width, height, in the grid's frame).
    function findOpening(it) {
        const { U, N } = axes(it), seen = new Set(), found = [], tfile = (IM.targetModel() || {}).file, yawq = it.yaw;
        // a rectangle that is a door-shaped opening near this placement: about as tall as a door, starting near the floor, parallel to it, close to it along and across the wall
        const accept = (r) => {
            let dy = Math.abs((((r.yaw - yawq) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2); dy = Math.min(dy, Math.PI - dy);
            const du = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1], dn = (r.cx - it.cx) * N[0] + (r.cy - it.cy) * N[1];
            if (r.w < 0.6 || r.w > 2.6 || r.h < 1.7 || r.h > 2.7 || r.zb > 0.45 || r.zb < -0.3 || dy > 0.15 || Math.abs(du) > Math.max(0.7, it.w) || Math.abs(dn) > 0.8) return;
            found.push({ r, score: Math.abs(du) + Math.abs(dn) * 0.3 });
        };
        [-0.3, 0, 0.3].forEach(fu => [0.3, 0.5, 0.8].forEach(fz => {
            const u = it.w * fu, p = [it.cx + U[0] * u, it.cy + U[1] * u, it.zb + Math.min(it.h * fz, it.h - 0.1)];
            [1, -1].forEach(sd => {
                const o = IM.pickOriginal({ o: [p[0] + N[0] * sd * 2.5, p[1] + N[1] * sd * 2.5, p[2]], d: [-N[0] * sd, -N[1] * sd, 0] }); if (!o || (o.file && o.file !== tfile)) return;
                const key = o.g + ':' + o.tri; if (seen.has(key)) return; seen.add(key);
                const r = IM.faceRect({ g: o.g, tris: IM.flatPatch(o.g, o.tri) }); if (r) accept(r);
            });
        }));
        // the faces may be gone already (a door cut out with the Door tool): that cut remembers the opening
        if (!found.length) (imp().cutters || []).forEach(k => { if (k.face && k.type === 'door') accept({ cx: k.cx, cy: k.cy, zb: k.zb, w: k.w, h: k.h, yaw: k.yaw }); });
        if (!found.length) return null; found.sort((a, b) => a.score - b.score); return found[0].r;
    }
    // the door sized and put to the opening: its wall cut is the opening, the door is the opening less its room (and 2 cm at the head), moved along the wall so that it sits in it
    // with its room on the hinge side; the depth and the position across the wall stay as they are
    function openingFit(it, r) {
        const { U } = axes(it), rm = doorRoom(it), along = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1];
        return { cx: r3(it.cx + U[0] * along), cy: r3(it.cy + U[1] * along), zb: r.zb < 0.02 ? 0 : r3(r.zb), w: r3(Math.max(0.5, r.w - 2 * rm.gap)), h: r3(Math.max(1.5, r.h - 0.02)), cut: { w: r3(r.w), h: r3(r.h), du: 0, dz: 0 } };
    }
    FM.findOpening = findOpening; FM.openingFit = openingFit;
    FM.matchOpening = function () {
        const it = selFit(); if (!it || (it.kind !== 'door' && it.kind !== 'frame')) { toast('Select a placed door or frame first.', 'warn'); return false; }
        const r = findOpening(it);
        if (!r) { toast('No door-shaped opening of the building is behind this ' + it.kind + ' (it may be deleted already): set the size by hand, or put it over the building\'s door faces and try again.', 'warn'); return false; }
        FM.set(it.kind === 'frame' ? frameFit(it, r) : openingFit(it, r));
        toast(it.kind === 'frame' ? 'The frame\'s outside now matches the building\'s door opening (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m).' : 'The wall cut now matches the building\'s door opening (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m) and the door was sized to sit in it.', 'ok'); return true;
    };
    // every door that stands in the selected frame, sized to its opening
    FM.fitDoorsInFrame = function () {
        const fr = selFit(); if (!fr || fr.kind !== 'frame') { toast('Select a placed frame first.', 'warn'); return false; }
        const patches = fits().filter(d => d.kind === 'door' && !d.game && findFrame(d) === fr).map(d => [d.id, doorInFrame(d, fr)]).filter(p => p[1]);
        if (!patches.length) { toast('No door stands in this frame: put a door into it first.', 'warn'); return false; }
        Model.edit(P => { patches.forEach(p => { const q = (P.import.fits || []).find(f => f.id === p[0]); if (q) Object.assign(q, p[1]); }); }); M.UI.renderLeft();
        toast(patches.length + ' door' + (patches.length === 1 ? '' : 's') + ' sized to the frame\'s opening.', 'ok'); return true;
    };
    // the door sized to the opening of the frame it stands in
    FM.fitToFrame = function () {
        const it = selFit(); if (!it || it.kind !== 'door' || it.game) { toast('Select an imported door first.', 'warn'); return false; }
        const fr = findFrame(it); if (!fr) { toast('This door does not stand in a frame: move it into one.', 'warn'); return false; }
        const p = doorInFrame(it, fr); if (!p) { toast('The frame\'s model is missing.', 'warn'); return false; }
        FM.set(p); toast('The door was sized to the frame\'s opening (' + p.cut.w.toFixed(2) + ' x ' + p.cut.h.toFixed(2) + ' m) with room to swing.', 'ok'); return true;
    };

    // A door that is "solid": a box the size of its leaf in the interior's own collision (the same place the walls' collision is), so it blocks the doorway whatever the door prop does. It is fixed:
    // it stays when a door script swings the prop open.
    FM.solidBoxes = function (project) {
        const list = (project && project.import && project.import.fits) || [];
        const out = [];
        list.filter(f => f.kind === 'prop' && !f.game && f.collision !== false).forEach(f => out.push({ id: 'fp' + f.id, cx: f.cx, cy: f.cy, zb: f.zb, h: f.h, hu: f.w / 2, hn: f.d / 2, yaw: f.yaw }));
        list.filter(f => f.kind === 'door' && f.solid && !f.managed && (!f.doorType || f.doorType === 'hinged')).forEach(f => {
            const m = FM.model(f.m), t = m && m.core ? (m.core[1] - m.core[0]) * f.d / m.size[1] : Math.min(f.d, 0.08);
            if (f.double) { const U = [Math.cos(f.yaw), Math.sin(f.yaw)]; FM.leaves(f).forEach(lf => out.push({ id: 'fs' + f.id + (lf.side > 0 ? 'a' : 'b'), cx: r3(f.cx + U[0] * lf.du), cy: r3(f.cy + U[1] * lf.du), zb: f.zb, h: f.h, hu: lf.w / 2, hn: Math.max(0.03, t / 2 + 0.005), yaw: f.yaw })); }
            else out.push({ id: 'fs' + f.id, cx: f.cx, cy: f.cy, zb: f.zb, h: f.h, hu: f.w / 2, hn: Math.max(0.03, t / 2 + 0.005), yaw: f.yaw });
        });
        return out;
    };
    // what the export gets: every placement; a double door as its two leaves (each a door of its own: its middle, half the width, its hinge side, mirrored or not)
    FM.exportSpec = function (project) {
        const list = (project.import && project.import.fits) || []; if (!list.length) return undefined;
        const items = []; list.forEach(f => {
            if (f.game) { items.push({source:'gta',kind:f.kind,frozen:f.kind === 'prop' && !!f.frozen,doorType:f.doorType || 'hinged',hinge:f.hinge || 'l',direction:f.direction === -1 ? -1 : 1,travel:f.travel || ((f.doorType === 'garage') ? f.h : (f.doorType === 'sliding' ? f.w : 90)),speed:f.speed || (f.doorType === 'tilt' ? 45 : (f.doorType && f.doorType !== 'hinged' ? 1 : 90)),tiltLift:f.tiltLift || 0,tiltOffset:f.tiltOffset || 0,collision:f.collision !== false,autoOpen:!!f.autoOpen,autoDistance:f.autoDistance || 6,closeDelay:f.closeDelay == null ? 3 : f.closeDelay,oxDoorId:f.oxDoorId || 0,id:f.id,gameName:f.game.Archetype || f.game.Name,gameId:f.game.Id,gameArchive:f.game.Archive,gameMin:f.gameMin,gameMax:f.gameMax,cx:f.cx,cy:f.cy,zb:f.zb,yaw:f.yaw,w:f.w,d:f.d,h:f.h});return; }

            const base = { autoOpen: !!f.autoOpen, autoDistance: f.autoDistance || 6, closeDelay: f.closeDelay == null ? 3 : f.closeDelay, oxDoorId: f.oxDoorId || 0, tiltLift: f.tiltLift || 0, tiltOffset: f.tiltOffset || 0, doorType: f.doorType || 'hinged', managed: !!f.managed, direction: f.direction === -1 ? -1 : 1, travel: f.travel || ((f.doorType === 'garage') ? f.h : (f.doorType === 'sliding' ? f.w : 90)), speed: f.speed || (f.doorType === 'tilt' ? 45 : (f.doorType && f.doorType !== 'hinged' ? 1 : 90)), collision: f.collision !== false, group: f.id, f: f.f, m: f.m, kind: f.kind, zb: f.zb, yaw: f.yaw, d: f.d, h: f.h, rot: (FM.model(f.m) || {}).rot || null }, U = [Math.cos(f.yaw), Math.sin(f.yaw)];
            if (f.double && f.kind === 'door') FM.leaves(f).forEach(lf => items.push(Object.assign({}, base, { id: f.id + (lf.side > 0 ? 'a' : 'b'), cx: r3(f.cx + U[0] * lf.du), cy: r3(f.cy + U[1] * lf.du), w: r3(lf.w), hinge: lf.hinge, mirror: lf.mirror, direction: (f.direction === -1 ? -1 : 1) * (f.doorType === 'garage' || f.doorType === 'tilt' || lf.side > 0 ? 1 : -1) })));
            else items.push(Object.assign({}, base, { id: f.id, cx: f.cx, cy: f.cy, w: f.w, hinge: f.hinge || 'l' }));
        });
        return { project: project.name, items };
    };

    // ---------- geometry of a placement ----------
    const axes = (it) => { const cs = Math.cos(it.yaw), sn = Math.sin(it.yaw); return { U: [cs, sn, 0], N: [-sn, cs, 0], Z: [0, 0, 1], c: [it.cx, it.cy, it.zb + it.h / 2] }; };
    const add = (p, a, k) => [p[0] + a[0] * k, p[1] + a[1] * k, p[2] + a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function hitBox(ray, it, pad) {
        const cs = Math.cos(it.yaw), sn = Math.sin(it.yaw), c = [it.cx, it.cy, it.zb + it.h / 2], o = [ray.o[0] - c[0], ray.o[1] - c[1], ray.o[2] - c[2]];
        const lo = [o[0] * cs + o[1] * sn, -o[0] * sn + o[1] * cs, o[2]], ld = [ray.d[0] * cs + ray.d[1] * sn, -ray.d[0] * sn + ray.d[1] * cs, ray.d[2]], p = pad || 0;
        return api().rayBox({ o: lo, d: ld }, [-it.w / 2 - p, -Math.max(it.d, 0.12) / 2 - p, -it.h / 2 - p], [it.w / 2 + p, Math.max(it.d, 0.12) / 2 + p, it.h / 2 + p]);
    }
    // the placement under the pointer; the opening of a frame is not part of it (a door is put into a frame by clicking in its opening)
    function pickFit(ray) {
        let best = null; const cm = FM.chosen ? FM.model(FM.chosen) : null, frameChosen = !!cm && FM.kindOf(cm.f) === 'frame';          // (with a frame chosen the doors are not in the way: a frame goes round a door)
        fits().filter(f => FM.inScope(f.kind)).forEach(f => {
            if (frameChosen && f.kind === 'door') return;
            const t = hitBox(ray, f, 0.02); if (t == null || (best && t >= best.t)) return;
            if (f.kind === 'frame') {
                const fi = frameInner(f); if (fi) { const hp = add(ray.o, ray.d, t), U = [Math.cos(f.yaw), Math.sin(f.yaw)], du = (hp[0] - f.cx) * U[0] + (hp[1] - f.cy) * U[1] - fi.cu; if (Math.abs(du) < fi.w / 2 - 0.02 && hp[2] > fi.zb + 0.02 && hp[2] < fi.zb + fi.h - 0.02) return; }
            }
            best = { t, id: f.id };
        });
        return best ? byId(best.id) : null;
    }

    // the point on the line P + t A that is nearest to the ray (t), null when they run parallel
    function lineParam(ray, P, A) {
        const w = [P[0] - ray.o[0], P[1] - ray.o[1], P[2] - ray.o[2]], a = dot(A, A), b = dot(A, ray.d), c = dot(ray.d, ray.d), d = dot(A, w), e = dot(ray.d, w), den = a * c - b * b;
        if (Math.abs(den) < 1e-6) return null; return (b * e - c * d) / den;
    }
    function planeHitN(ray, P, N) { const dn = dot(ray.d, N); if (Math.abs(dn) < 1e-5) return null; const t = dot([P[0] - ray.o[0], P[1] - ray.o[1], P[2] - ray.o[2]], N) / dn; if (t < 0) return null; return add(ray.o, ray.d, t); }

    // ---------- the gizmo ----------
    const COL = { u: [0.95, 0.38, 0.32, 1], n: [0.42, 0.9, 0.48, 1], z: [0.42, 0.64, 1, 1], hot: [1, 0.93, 0.5, 1], ring: [1, 0.82, 0.35, 0.95] };
    function sizes() { const cam = M.App.renderer.camera; return { hs: Math.max(0.028, cam.dist * 0.0052), L: Math.max(0.32, Math.min(1.8, cam.dist * 0.07)) }; }
    function ringPts(it) {
        const R = Math.max(0.35, Math.hypot(it.w, it.d) / 2 + 0.22), pts = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([it.cx + Math.cos(a) * R, it.cy + Math.sin(a) * R, it.zb]); } return pts;
    }
    function gizmo(it) {
        const { U, N, Z, c } = axes(it), { hs, L } = sizes(), g = [];
        g.push({ id: 'su+', type: 'face', axis: 'u', s: 1, p: add(c, U, it.w / 2), col: COL.u }, { id: 'su-', type: 'face', axis: 'u', s: -1, p: add(c, U, -it.w / 2), col: COL.u });
        g.push({ id: 'sz+', type: 'face', axis: 'z', s: 1, p: add(c, Z, it.h / 2), col: COL.z }, { id: 'sz-', type: 'face', axis: 'z', s: -1, p: add(c, Z, -it.h / 2), col: COL.z });
        g.push({ id: 'sn+', type: 'face', axis: 'n', s: 1, p: add(add(add(c, N, it.d / 2), U, -it.w / 2), Z, -it.h / 2), col: COL.n });          // (a corner, so it does not sit where you grab the model to slide it)
        g.push({ id: 'uni', type: 'uni', p: add(add(add(c, U, it.w / 2), N, it.d / 2), Z, it.h / 2), col: [1, 1, 1, 1] });
        const tipU = add(c, U, it.w / 2 + L), tipN = add(c, N, it.d / 2 + L), tipZ = add(c, Z, it.h / 2 + L);
        g.push({ id: 'au', type: 'arrow', axis: 'u', p: add(c, U, it.w / 2 + 2.6 * hs), p2: tipU, dir: U, col: COL.u });
        g.push({ id: 'an', type: 'arrow', axis: 'n', p: add(c, N, it.d / 2 + 2.6 * hs), p2: tipN, dir: N, col: COL.n });
        g.push({ id: 'az', type: 'arrow', axis: 'z', p: add(c, Z, it.h / 2 + 2.6 * hs), p2: tipZ, dir: Z, col: COL.z });
        g.push({ id: 'ring', type: 'ring', col: COL.ring });
        return it.game ? g.filter(h => h.type === 'arrow' || h.type === 'ring') : g;
    }
    FM.gizmo = gizmo;
    function toScreen(p) { const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(); cam.update(r.width / r.height); return cam.project(p, r.width, r.height); }
    function segDist(px, py, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy, t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2)); return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t)); }
    function handleAt(it, e) {
        const r = M.App.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 1e9;
        gizmo(it).forEach(h => {
            let d = 1e9, tol = 11, bias = 0;
            if (h.type === 'face' || h.type === 'uni') { const s = toScreen(h.p); if (s) d = Math.hypot(s[0] - mx, s[1] - my); bias = -4; }
            else if (h.type === 'arrow') { const a = toScreen(h.p), b = toScreen(h.p2); if (a && b) d = segDist(mx, my, a, b); tol = 9; }
            else if (h.type === 'ring') { const pts = ringPts(it).map(toScreen); for (let i = 0; i + 1 < pts.length; i++) if (pts[i] && pts[i + 1]) d = Math.min(d, segDist(mx, my, pts[i], pts[i + 1])); tol = 7; bias = 3; }
            if (d <= tol && d + bias < bd) { bd = d + bias; best = h; }
        });
        return best;
    }
    function cube(R, p, hs, col) {
        const q = (a, b, c, d) => R.ovTopQuad(a, b, c, d, col), x0 = p[0] - hs, x1 = p[0] + hs, y0 = p[1] - hs, y1 = p[1] + hs, z0 = p[2] - hs, z1 = p[2] + hs;
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]); q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
        q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
    }
    function cone(R, tip, base, dir, rad, col) {
        // a cone from the base centre to the tip; two vectors across the axis
        let a = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]; const k = [dir[1] * a[2] - dir[2] * a[1], dir[2] * a[0] - dir[0] * a[2], dir[0] * a[1] - dir[1] * a[0]], kl = Math.hypot(k[0], k[1], k[2]) || 1, v1 = [k[0] / kl, k[1] / kl, k[2] / kl], v2 = [dir[1] * v1[2] - dir[2] * v1[1], dir[2] * v1[0] - dir[0] * v1[2], dir[0] * v1[1] - dir[1] * v1[0]];
        const ring = []; for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; ring.push([base[0] + (v1[0] * Math.cos(t) + v2[0] * Math.sin(t)) * rad, base[1] + (v1[1] * Math.cos(t) + v2[1] * Math.sin(t)) * rad, base[2] + (v1[2] * Math.cos(t) + v2[2] * Math.sin(t)) * rad]); }
        for (let i = 0; i < 6; i++) R.ovTopQuad(ring[i], ring[(i + 1) % 6], tip, tip, col);
    }
    function obox(R, it, col) {
        const { U, N } = axes(it), hu = it.w / 2, hn = Math.max(it.d, 0.04) / 2, P = (a, b, z) => [it.cx + U[0] * a * hu + N[0] * b * hn, it.cy + U[1] * a * hu + N[1] * b * hn, it.zb + z * it.h];
        const v = [P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
        [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => R.ovTopLine(v[e[0]], v[e[1]], col));
    }
    FM.draw = function (R) {
        const cam = R.camera, hs = sizes().hs; let text = null, at = null;
        fits().forEach(f => { const sel = f.id === FM.sel, hov = hover.fit && hover.fit.id === f.id && !drag; obox(R, f, sel ? [1, 1, 1, 0.95] : (hov ? [1, 0.93, 0.55, 1] : [0.62, 0.8, 1, 0.4])); });
        const it = selFit();
        if (it) {
            const act = drag ? drag.h : hover.h, { c, N, U } = axes(it), hinges = FM.hinges(it);
            gizmo(it).forEach(h => {
                const hot = act && act.id === h.id, col = hot ? COL.hot : h.col;
                if (h.type === 'face' || h.type === 'uni') cube(R, h.p, hot ? hs * 1.5 : hs, col);
                else if (h.type === 'arrow') { R.ovTopLine(add(h.p, h.dir, -2.6 * hs), h.p2, col); cone(R, add(h.p2, h.dir, hs * 3.4), h.p2, h.dir, hs * 1.3, col); }
                else if (h.type === 'ring') { const pts = ringPts(it); for (let i = 0; i + 1 < pts.length; i++) R.ovTopLine(pts[i], pts[i + 1], hot ? COL.hot : (i % 4 < 2 ? h.col : [h.col[0], h.col[1], h.col[2], 0.45])); }
            });
            // the front of the model (the way its green arrow points) and, for a door, the hinge
            if (it.kind === 'door' && it.doorType === 'tilt') {
                const top = [c[0], c[1], it.zb + it.h];
                R.ovTopLine(add(top, U, -it.w / 2), add(top, U, it.w / 2), [1, 0.55, 0.2, 1]);
            } else hinges.forEach(side => R.ovTopLine(side, add(side, [0, 0, 1], it.h), [1, 0.55, 0.2, 1]));
            if (it.double && it.kind === 'door') R.ovTopLine(add(c, [0, 0, 1], -it.h / 2), add(c, [0, 0, 1], it.h / 2), [0.95, 0.95, 0.95, 0.55]);          // where the two leaves meet
            if (drag && drag.moved) { text = it.w.toFixed(2) + ' x ' + it.h.toFixed(2) + ' x ' + it.d.toFixed(2) + ' m, ' + Math.round(((it.yaw * 180 / Math.PI) % 360 + 360) % 360) + '°, bottom ' + it.zb.toFixed(2) + ' m'; at = [c[0], c[1], it.zb + it.h + 0.3]; }
            else if (hover.h && !drag) { const lab = { face: 'Drag to change the size', uni: 'Drag to scale it all together', arrow: 'Drag to move it along this axis', ring: 'Drag to turn it' }; text = lab[hover.h.type]; at = [c[0], c[1], it.zb + it.h + 0.3]; }
        }
        // where a click would put the chosen model
        if (!drag && !hover.h && !hover.fit && hover.surf && FM.chosen) {
            const m = FM.model(FM.chosen), nf = m ? newFit(m, hover.surf) : null;
            if (nf) { obox(R, nf, [0.45, 0.95, 0.6, 0.95]); text = 'Click to put the ' + m.name.toLowerCase() + ' here (' + nf.w.toFixed(2) + ' x ' + nf.h.toFixed(2) + ' m)'; at = [nf.cx, nf.cy, nf.zb + nf.h + 0.3]; }
        } else if (!drag && !hover.h && hover.fit && !text) { text = 'Click to select (drag to move it)'; at = [hover.fit.cx, hover.fit.cy, hover.fit.zb + hover.fit.h + 0.3]; }
        else if (!drag && !hover.h && !hover.fit && !FM.chosen && !it) { text = 'Choose a model in the list first'; at = null; }
        M.App.canvas.style.cursor = drag ? (drag.type === 'ring' ? 'grabbing' : 'move') : ((hover.h || hover.fit) ? 'move' : '');
        return { text, at };
    };
    // where the hinge of a door is (the bottom of its hinge edge)
    // where the hinge of a door is (the bottom of its hinge edge); a double door has two, on its outer edges
    FM.hinges = function (it) { if (it.kind !== 'door') return []; const { U, c } = axes(it); return FM.leaves(it).map(lf => { const k = lf.du + (lf.hinge === 'r' ? -lf.w / 2 : lf.w / 2); return [c[0] + U[0] * k, c[1] + U[1] * k, it.zb]; }); };
    FM.hingeOf = function (it) { const h = FM.hinges(it); return h.length ? h[0] : null; };

    // ---------- placing ----------
    function snapYaw(yaw) { const deg = yaw * 180 / Math.PI, q = ((deg % 90) + 90) % 90; return Math.min(q, 90 - q) < 1.5 ? Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2) : yaw; }
    // a new placement for the model on the surface under the pointer: its front looks the way the surface faces, it sits just behind the surface
    // Ground uses structural geometry in shell coordinates, independent of cutaway.
    // Placed props are deliberately excluded so a model never snaps to itself.
    let groundCache={imported:null,shell:null,triangles:[]};
    function groundTriangles() {
        const imported=IM.tgt, shell=M.App.built && M.App.built.batches;
        if(groundCache.imported===imported && groundCache.shell===shell)return groundCache.triangles;
        const triangles=[];
        for(const mesh of [...(imported || []),...(shell || [])]) {
            const p=mesh.pos, ix=mesh.idx;if(!p || !ix)continue;
            for(let i=0;i+2<ix.length;i+=3) {
                const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
                const ax=p[a],ay=p[a+1],az=p[a+2],ux=p[b]-ax,uy=p[b+1]-ay,uz=p[b+2]-az,vx=p[c]-ax,vy=p[c+1]-ay,vz=p[c+2]-az;
                const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
                if(Math.abs(nz)<1e-10 || Math.abs(nz)/Math.hypot(nx,ny,nz)<.7)continue;
                triangles.push({ax,ay,az,ux,uy,uz,vx,vy,vz,det:nz,x0:Math.min(ax,p[b],p[c]),x1:Math.max(ax,p[b],p[c]),y0:Math.min(ay,p[b+1],p[c+1]),y1:Math.max(ay,p[b+1],p[c+1])});
            }
        }
        groundCache={imported,shell,triangles};return triangles;
    }
    FM.groundHeight=function(it,fromZ) {
        if(!it || it.kind!=='prop' || ![it.cx,it.cy,it.w,it.d,it.yaw,fromZ].every(Number.isFinite))return null;
        const cs=Math.cos(it.yaw),sn=Math.sin(it.yaw),points=[[it.cx,it.cy]];
        for(const u of [-it.w/2,it.w/2])for(const n of [-it.d/2,it.d/2])points.push([it.cx+cs*u-sn*n,it.cy+sn*u+cs*n]);
        let highest=null;
        for(const tri of groundTriangles())for(const [x,y] of points) {
            if(x<tri.x0-1e-6 || x>tri.x1+1e-6 || y<tri.y0-1e-6 || y>tri.y1+1e-6)continue;
            const dx=x-tri.ax,dy=y-tri.ay,u=(dx*tri.vy-dy*tri.vx)/tri.det,v=(tri.ux*dy-tri.uy*dx)/tri.det;
            if(u< -1e-6 || v< -1e-6 || u+v>1+1e-6)continue;
            const z=tri.az+u*tri.uz+v*tri.vz;
            if(z<=fromZ+.15 && (highest===null || z>highest))highest=z;
        }
        // Round upwards to a millimetre instead of sinking into a sloping surface.
        return highest===null?null:Math.ceil((highest-1e-7)*1000)/1000;
    };
    FM.snapToGround=function(id) {
        const it=id?byId(id):selFit();if(!it || it.kind!=='prop')return false;
        const z=FM.groundHeight(it,it.zb);
        if(z===null){toast('No floor found below this prop. Its height was kept.','warn');return false;}
        FM.set({zb:z},it.id);return true;
    };
    function newFit(m, s) {
        if (!s || !s.p || !s.n) return null; const nh = Math.hypot(s.n[0], s.n[1]); let nx, ny;
        if (nh < 0.5) { const cy = M.App.renderer.camera.yaw; nx = Math.cos(cy); ny = Math.sin(cy); const q = Math.round(Math.atan2(ny, nx) / (Math.PI / 2)) * (Math.PI / 2); nx = Math.cos(q); ny = Math.sin(q); }       // a floor: the front looks at the camera
        else {
            nx = s.n[0] / nh; ny = s.n[1] / nh;
            // the front looks at the side the viewer is on (a surface of the model or of the room's wall can face either way)
            const eye = M.App.renderer.camera.eye(); if ((eye[0] - s.p[0]) * nx + (eye[1] - s.p[1]) * ny < 0) { nx = -nx; ny = -ny; }
        }
        const yaw = r3(snapYaw(Math.atan2(-nx, ny))), kind = m.game ? (m.game.Kind || 'prop') : FM.kindOf(m.f), floorKind = kind === 'door' || kind === 'frame';
        // a model made in some other unit (a frame 99 units high) gets the height of a door; the proportions stay
        const sc = (!m.game && floorKind && (m.size[2] > 4.5 || m.size[2] < 0.3)) ? 2.2 / m.size[2] : 1, w = m.game ? m.size[0] : r3(m.size[0] * sc), d = m.game ? m.size[1] : r3(Math.max(0.03, m.size[1] * sc)), h = m.game ? m.size[2] : r3(m.size[2] * sc), back = d / 2 + 0.03;
        const cs = Math.cos(yaw), sn = Math.sin(yaw), offset=kind==='prop' && S.propSnapGround!==false ? back : -back, cx0 = s.p[0] + nx * (nh < 0.5 ? 0 : offset), cy0 = s.p[1] + ny * (nh < 0.5 ? 0 : offset), al = cx0 * cs + cy0 * sn, alS = Math.round(al / 0.01) * 0.01;
        const placed={ id: 'new', game: m.game || undefined, gameMin: m.game ? m.min : undefined, gameMax: m.game ? m.max : undefined, f: m.f, m: m.id, kind, cx: r3(cx0 + (alS - al) * cs), cy: r3(cy0 + (alS - al) * sn), zb: kind === 'prop' && nh < 0.5 ? r3(s.p[2]) : floorKind ? 0 : Math.max(0.05, r3(Math.round((s.p[2] - h / 2) * 100) / 100)), yaw, w, d, h, hinge: m.latch > 0 ? 'r' : 'l', managed: m.game && kind === 'door' ? true : undefined, open: true };          // (a door hangs on the side opposite its knob: the knob is on +u, so the hinge is on the right as seen from the front)
        if(kind==='prop' && S.propSnapGround!==false){const z=FM.groundHeight(placed,s.p[2]);if(z!==null)placed.zb=z;}
        return placed;
    }
    FM.newFit = newFit;
    function place() {
        const m = FM.chosen ? FM.model(FM.chosen) : null;
        if (!m) { toast('Choose a model in the list first, then click a wall.', 'warn'); return; }
        const nf = newFit(m, hover.surf); if (!nf) { toast('Click a wall of the model or of your rooms.', 'warn'); return; }
        nf.id = randId(); let fitted = null, framed = null, wide = false;
        if (nf.kind === 'door' && !nf.game) {
            framed = findFrame(nf); const fp = framed ? doorInFrame(nf, framed) : null, leaf0 = nf.w;                                      // put in a frame: it is sized to the frame's opening
            if (fp) Object.assign(nf, fp); else { framed = null; fitted = findOpening(nf); if (fitted) Object.assign(nf, openingFit(nf, fitted)); }          // put over the building's door faces: the wall cut is their size
            wide = (fp ? fp.w : (fitted ? fitted.w : 0)) > leaf0 * 1.7;                                                                          // wide enough for two leaves
        } else if (nf.kind === 'frame') { fitted = findOpening(nf); if (fitted) Object.assign(nf, frameFit(nf, fitted)); }        // a frame over the building's door faces takes their size
        Model.edit(P => { (P.import.fits = P.import.fits || []).push(nf); }); FM.sel = nf.id; M.UI.renderLeft();
        const inside = nf.kind === 'frame' ? fits().filter(d => d.kind === 'door' && findFrame(d, [nf])).length : 0;
        if (inside) { toast('Frame placed. ' + inside + ' door' + (inside === 1 ? ' stands' : 's stand') + ' in it: "Fit the doors in it" in the panel sizes ' + (inside === 1 ? 'it' : 'them') + ' to the frame\'s opening.', 'ok'); return; }
        toast(m.name + ' placed (' + nf.w.toFixed(2) + ' x ' + nf.h.toFixed(2) + ' m)' + (framed ? ', sized to the frame\'s opening' : (fitted ? ', fitted to the building\'s door opening (' + fitted.w.toFixed(2) + ' x ' + fitted.h.toFixed(2) + ' m): the wall cut has that size' : '')) + (wide ? '. The doorway is wide enough for two leaves: tick "Double door" in the panel' : '') + '. Drag the gizmo to move, size or turn it; the wall behind it is yours to delete with the Delete faces tool.', 'ok');
    }

    // ---------- pointer ----------
    FM.dragging = () => !!drag;
    FM.state = () => drag ? drag.type : null;
    FM.scan = function (e, ray) {
        hover.ray = ray; if (drag) return;
        const it = selFit(); hover.h = it ? handleAt(it, e) : null;
        hover.fit = hover.h ? null : pickFit(ray);
        hover.surf = (!hover.h && !hover.fit && FM.chosen) ? IT().surfaceAt(ray) : null;
    };
    const copyGeo = (it) => ({ cx: it.cx, cy: it.cy, zb: it.zb, yaw: it.yaw, w: it.w, d: it.d, h: it.h });
    FM.down = function (e) {
        const it = selFit(), ray = api().pointerRay(e);
        if (it && hover.h) { startHandle(it, hover.h, e, ray); return; }
        if (hover.fit) { FM.sel = hover.fit.id; startMove(hover.fit, e, ray); M.UI.renderLeft(); return; }
        if (!FM.chosen) { if (it) { FM.sel = null; M.UI.renderLeft(); } else toast('Choose a model in the list first, then click a wall.', 'warn'); return; }
        place();
    };
    function startMove(it, e, ray) {
        const { N, c } = axes(it), wall = Math.abs(dot(ray.d, N)) > 0.12, normal = wall ? N : [0, 0, 1], p0 = planeHitN(ray, c, normal); if (!p0) return;
        drag = { type: 'move', mode: wall ? 'wall' : 'floor', id: it.id, g0: copyGeo(it), p0, px: [e.clientX, e.clientY], moved: false, h: null };
    }
    function startHandle(it, h, e, ray) {
        const { U, N, Z, c } = axes(it); drag = { type: h.type, h, id: it.id, g0: copyGeo(it), px: [e.clientX, e.clientY], moved: false };
        if (h.type === 'arrow') { drag.A = h.dir; drag.P0 = c; drag.t0 = lineParam(ray, c, h.dir); if (drag.t0 == null) { drag = null; return; } }
        else if (h.type === 'face') { drag.A = h.axis === 'u' ? U : (h.axis === 'n' ? N : Z); drag.P0 = h.p; drag.t0 = lineParam(ray, h.p, drag.A); if (drag.t0 == null) { drag = null; return; } }
        else if (h.type === 'uni') { const sc = toScreen(c), r = M.App.canvas.getBoundingClientRect(); drag.sc = sc; drag.r0 = Math.max(12, Math.hypot(e.clientX - r.left - sc[0], e.clientY - r.top - sc[1])); }
        else if (h.type === 'ring') { const p = planeHitN(ray, [it.cx, it.cy, it.zb], [0, 0, 1]); if (!p) { drag = null; return; } drag.a0 = Math.atan2(p[1] - it.cy, p[0] - it.cx); }
    }
    FM.move = function (e) {
        const d = drag; if (!d) return; if (!d.moved && Math.hypot(e.clientX - d.px[0], e.clientY - d.px[1]) < 4) return; d.moved = true;
        const it = byId(d.id); if (!it) return; const ray = api().pointerRay(e), free = e.shiftKey, step = free ? 0.001 : 0.01, sn = (v) => Math.round(v / step) * step, g0 = d.g0;
        const cs = Math.cos(g0.yaw), si = Math.sin(g0.yaw), U = [cs, si, 0], N = [-si, cs, 0];
        let patch = null;
        if (d.type === 'move') {
            const p = d.mode === 'wall' ? planeHitN(ray, [g0.cx, g0.cy, g0.zb + g0.h / 2], N) : planeHitN(ray, [g0.cx, g0.cy, g0.zb + g0.h / 2], [0, 0, 1]); if (!p) return;
            const v = [p[0] - d.p0[0], p[1] - d.p0[1], p[2] - d.p0[2]], du = sn(dot(v, U)), dn = d.mode === 'wall' ? 0 : sn(dot(v, N)), dz = d.mode === 'wall' ? sn(v[2]) : 0;
            patch = { cx: g0.cx + U[0] * du + N[0] * dn, cy: g0.cy + U[1] * du + N[1] * dn, zb: g0.zb + dz };
        } else if (d.type === 'arrow') {
            const t = lineParam(ray, d.P0, d.A); if (t == null) return; const k = sn(t - d.t0);
            patch = d.h.axis === 'z' ? { zb: g0.zb + k } : { cx: g0.cx + d.A[0] * k, cy: g0.cy + d.A[1] * k };
        } else if (d.type === 'face') {
            const t = lineParam(ray, d.P0, d.A); if (t == null) return; const s = d.h.s, delta = t - d.t0, ax = d.h.axis, size0 = ax === 'u' ? g0.w : (ax === 'n' ? g0.d : g0.h), sym = e.altKey;
            let size = Math.max(0.05, sn(size0 + (sym ? 2 : 1) * s * delta)); const shift = sym ? 0 : s * (size - size0) / 2;
            if (ax === 'u') patch = { w: r3(size), cx: g0.cx + U[0] * shift, cy: g0.cy + U[1] * shift };
            else if (ax === 'n') patch = { d: r3(size), cx: g0.cx + N[0] * shift, cy: g0.cy + N[1] * shift };
            else patch = { h: r3(size), zb: sym ? g0.zb - (size - size0) / 2 : (s > 0 ? g0.zb : g0.zb - (size - size0)) };
        } else if (d.type === 'uni') {
            const r = M.App.canvas.getBoundingClientRect(); let f = Math.hypot(e.clientX - r.left - d.sc[0], e.clientY - r.top - d.sc[1]) / d.r0; f = free ? f : Math.round(f * 100) / 100; f = Math.max(0.1, Math.min(8, f));
            patch = { w: r3(g0.w * f), d: r3(g0.d * f), h: r3(g0.h * f) };
        } else if (d.type === 'ring') {
            const p = planeHitN(ray, [g0.cx, g0.cy, g0.zb], [0, 0, 1]); if (!p) return; let yaw = g0.yaw + (Math.atan2(p[1] - g0.cy, p[0] - g0.cx) - d.a0);
            if (!free) { const q = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12); yaw = q; }            // 15 degree steps (Shift: free)
            patch = { yaw: r3(yaw) };
        }
        if (!patch) return;
        if (patch.zb != null && !free && Math.abs(patch.zb) < 0.03) patch.zb = 0;
        for (const k in patch) patch[k] = r3(patch[k]);
        Object.assign(it, patch); bus.emit('change');
    };
    FM.up = function (e, commit) {
        const d = drag; drag = null; if (!d) return; const it = byId(d.id); if (!it) return;
        const fin = copyGeo(it); Object.assign(it, d.g0);
        if (commit && d.moved) Model.edit(P => { const q = (P.import.fits || []).find(f => f.id === d.id); if (q) Object.assign(q, fin); }); else bus.emit('change');
        M.UI.renderLeft();
    };
    FM.cancel = function () { if (!drag) return false; FM.up(null, false); return true; };

    // ---------- editing ----------
    FM.set = function (patch, id) { id = id || FM.sel; if (!id) return; Model.edit(P => { const q = (P.import.fits || []).find(f => f.id === id); if (q) Object.assign(q, q.game ? Object.fromEntries(Object.entries(patch).filter(([k]) => ['cx','cy','zb','yaw',...(q.kind === 'prop' ? ['frozen'] : []),...(q.kind === 'door' ? ['hinge','doorType','direction','travel','speed','tiltLift','tiltOffset','collision','autoOpen','autoDistance','closeDelay','oxDoorId','cut'] : [])].includes(k))) : patch); }); M.UI.renderLeft(); };
    // a door becomes a double door (its width is the whole doorway: the leaves keep the size the door had) or a single one again (one leaf of half the width)
    FM.setDouble = function (on) {
        const it = selFit(); if (!it || it.kind !== 'door' || !!it.double === !!on) return;
        // a door already as wide as two leaves (it was stretched over a double doorway) keeps its width, so the doorway stays as it is; a one-leaf door doubles
        const m = FM.model(it.m), nat = m ? m.size[0] * ((m.size[2] > 4.5 || m.size[2] < 0.3) ? 2.2 / m.size[2] : 1) : it.w, already = on && it.w >= nat * 1.6, nw = on ? (already ? it.w : it.w * 2) : it.w / 2, leaf = nw / (on ? 2 : 1);
        FM.set({ double: on ? true : undefined, w: r3(nw), cut: already ? it.cut : undefined });
        toast(on ? 'Double door: two leaves, ' + leaf.toFixed(2) + ' m each. Press "Match the building\'s door opening" to fit the doorway, or size and move it with the gizmo.' : 'Single door again.', 'ok');
    };
    FM.turn = function (rad) { const it = selFit(); if (!it) return false; FM.set({ yaw: r3(snapYaw(it.yaw + rad)) }); return true; };
    FM.remove = function () {
        const it = selFit(); if (!it) { toast('Select a placed model first (click it).', 'warn'); return false; }
        Model.edit(P => { P.import.fits = (P.import.fits || []).filter(f => f.id !== it.id); }); FM.sel = null; M.UI.renderLeft(); toast('Removed. Ctrl+Z brings it back.', 'ok'); return true;
    };
    FM.duplicate = function () {
        const it = selFit(); if (!it) { toast('Select a placed model first.', 'warn'); return false; }
        const { U } = axes(it), cp = Object.assign({}, it, { id: randId(), cx: r3(it.cx + U[0] * (it.w + 0.1)), cy: r3(it.cy + U[1] * (it.w + 0.1)) });
        Model.edit(P => { P.import.fits.push(cp); }); FM.sel = cp.id; M.UI.renderLeft(); toast('Copied next to it.', 'ok'); return true;
    };
    FM.select = function (id) { FM.sel = id; M.UI.renderLeft(); };
    FM.choose = async function (id) { try { if(id.startsWith('gta:')) { FM.game.failed.delete(id); await FM.ensureGame(id); } FM.chosen = FM.chosen === id ? null : id; M.UI.renderLeft(); } catch(e){M.UI.toast(e.message,'err');} };
    FM.key = function (k) {
        if (k === 'Escape') { if (drag) { FM.cancel(); return true; } if (FM.sel) { FM.sel = null; M.UI.renderLeft(); return true; } if (FM.chosen) { FM.chosen = null; M.UI.renderLeft(); return true; } return false; }
        if (k === 'x' || k === 'Delete' || k === 'Backspace') { FM.remove(); return true; }
        if (k === 'r') { if (!FM.turn(Math.PI / 2)) toast('Select a placed model first: R turns it 90 degrees.', 'warn'); return true; }
        return false;
    };
    FM.keyEv = function (e, k) {
        if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'd') { FM.duplicate(); return true; }
        if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'r') { if (!FM.turn(Math.PI)) toast('Select a placed model first: Shift+R turns it around.', 'warn'); return true; }
        return false;
    };

    // ---------- helpers for the wall behind a placement ----------
    FM.boxOf = function (it) { return { cx: it.cx, cy: it.cy, zb: it.zb, w: it.w, d: it.d, h: it.h, yaw: it.yaw }; };

    // ---------- the panel ----------
    const num = (label, get, set, step, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: step || '0.01', value: get(), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
    const CATEGORIES = [['all', 'All'], ['prop', 'Decorations'], ['door', 'Doors'], ['window', 'Windows'], ['frame', 'Frames']];
    FM.catalog = { query: '', kind: 'all', format: 'all', sort: 'name', page: 0 };
    FM.inScope = kind => S.tab === 'furnish' ? kind === 'prop' : (S.tab === 'build' ? kind !== 'prop' : true);
    FM.changeScope = function (previous, next) {
        if (previous === next) return;
        FM.cancel(); FM.sel = null; FM.chosen = null;
        if (previous === 'furnish') FM.interiorSource = FM.catalog.origin || 'imported';
        if (previous === 'build') FM.buildSource = FM.catalog.origin || 'imported';
        FM.catalog.origin = next === 'furnish' ? (FM.interiorSource || 'imported') : (next === 'build' ? (FM.buildSource || 'imported') : 'imported');
        FM.catalog.kind = 'all'; FM.catalog.gameCategory = 'all'; FM.catalog.query = ''; FM.catalog.page = 0;
    };
    FM.catalogEntries = function () {
        const words = FM.catalog.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        return (FM.catalog.origin === 'game' ? FM.gameEntries() : FM.lib.files.filter(f => !f.game).flatMap(f => f.models.map(m => ({ m, f, kind: FM.kindOf(f.file) })))).filter(e =>
            (!FM.catalog.gameCategory || FM.catalog.gameCategory === 'all' || (e.m.game && e.m.game.Category === FM.catalog.gameCategory)) &&
            FM.inScope(e.kind) &&
            (FM.catalog.kind === 'all' || e.kind === FM.catalog.kind) &&
            (FM.catalog.format === 'all' || e.f.file.toLowerCase().endsWith('.' + FM.catalog.format)) &&
            words.every(w => (e.m.name + ' ' + e.f.file + ' ' + e.f.title + ' ' + (e.m.game ? (e.m.game.Tags || []).join(' ') + ' ' + (e.m.game.Description || '') : '')).toLocaleLowerCase().includes(w)))
            .sort((a, b) => FM.catalog.sort === 'size' ? (b.m.size ? b.m.size[2] : 0) - (a.m.size ? a.m.size[2] : 0) || a.m.name.localeCompare(b.m.name) :
                FM.catalog.sort === 'file' ? a.f.file.localeCompare(b.f.file) || a.m.name.localeCompare(b.m.name) : a.m.name.localeCompare(b.m.name));
    };
    const kindLabel = kind => (CATEGORIES.find(c => c[0] === kind) || ['', 'Model'])[1];
    const modelSize = m => !m.size ? 'Load model to measure' : m.size.map(v => f2(v)).join(' × ') + ' m';
    FM.browseGame = function (spec) {
        const query = Object.entries(spec).map(([key,value])=>encodeURIComponent(key)+'='+encodeURIComponent(value)).join('&');
        return Model.api('import/rpf-browse?name='+safe()+'&'+query);
    };
    function catalogView(host, expanded, selected, pick) {
        let remote = {key:'',records:[],total:0,busy:false,error:''}, generation=0, searchTimer=null, disposed=false;
        const categories = CATEGORIES.filter(c => c[0] === 'all' || FM.inScope(c[0]));
        const state = FM.catalog, results = el('div', { class: 'model-results' }), controls = el('div', { class: 'model-search-controls' });
        const search = el('input', { type: 'search', class: 'model-search', placeholder: 'Search name or filename…', value: state.query, 'aria-label': 'Search models', oninput: e => { state.query = e.target.value; state.page = 0; paint(); } });
        const gameHost=el('div',{class:'game-catalogue-controls'});
        const source=el('select',{'aria-label':'Catalogue source',onchange:e=>{state.origin=e.target.value;state.kind='all';state.format='all';state.gameCategory='all';state.page=0;filters.hidden=state.origin==='game';gameControls(gameHost,paint);paint();}},el('option',{value:'imported',selected:state.origin!=='game'?true:null},'Imported models'),el('option',{value:'game',selected:state.origin==='game'?true:null},'Local GTA V'));
        controls.append(source,gameHost);
        controls.append(search);

        const filters = el('div', { class: 'model-filters', role: 'group', 'aria-label': 'Model category' });
        categories.forEach(([id, title]) => filters.append(el('button', { type: 'button', class: 'model-filter' + (id === state.kind ? ' active' : ''), 'aria-pressed': id === state.kind ? 'true' : 'false', onclick: () => {
            state.kind = id; state.page = 0;
            [...filters.children].forEach((button, i) => { button.classList.toggle('active', categories[i][0] === id); button.setAttribute('aria-pressed', String(categories[i][0] === id)); });
            paint();
        } }, title)));
        const sort = el('select', { 'aria-label': 'Sort models', onchange: e => { state.sort = e.target.value; state.page = 0; paint(); } }, ...[['name', 'Name A–Z'], ['file', 'Filename'], ['size', 'Tallest first']].map(([v, t]) => el('option', { value: v, selected: state.sort === v ? true : null }, t)));
        const format = el('select', { 'aria-label': 'Model file format', onchange: e => { state.format = e.target.value; state.page = 0; paint(); } }, ...[['all', 'All formats'], ['ydr', 'YDR'], ['glb', 'GLB']].map(([v, t]) => el('option', { value: v, selected: state.format === v ? true : null }, t)));
        controls.append(filters, el('div', { class: 'model-sorting' }, format, sort));
        const gameCategory=el('select',{'aria-label':'Interior prop category',onchange:e=>{state.gameCategory=e.target.value;state.page=0;paint();}},...(S.tab === 'build' ? ['all','Doors','Gates & Garages','Windows'] : ['all','Seating','Tables & Desks','Storage','Kitchen','Electronics','Lighting','Bedroom','Bathroom','Plants','Tools & Workshop','Food & Drink','Rubbish & Debris','Office & Small Items','Sports & Leisure','Signs & Street','Containers & Industrial','Decorations','Buildings & Structure','Other / Uncategorised']).map(v=>el('option',{value:v,selected:state.gameCategory===v?true:null},v==='all'?'All categories':v)));
        const gameScope=el('select',{'aria-label':'GTA prop collection',onchange:e=>{state.gameScope=e.target.value;state.page=0;paint();}},el('option',{value:'props',selected:state.gameScope!=='interior'?true:null},'Alla props'),el('option',{value:'interior',selected:state.gameScope==='interior'?true:null},'Inredningsurval'));
        controls.append(gameScope,gameCategory);gameControls(gameHost,paint);filters.hidden=state.origin==='game';
        host.append(controls, results);

        function paint() {
            if(disposed)return;
            results.innerHTML = '';gameCategory.hidden=state.origin!=='game';gameScope.hidden=state.origin!=='game' || S.tab==='build';
            const isRemote=state.origin==='game' && !!FM.game.total, size=expanded?24:6;
            format.disabled=state.origin==='game';
            if(state.origin==='game' && state.sort==='size'){state.sort='name';sort.value='name';}
            const sizeOption=Array.from(sort.children).find(option=>option.value==='size');if(sizeOption)sizeOption.disabled=state.origin==='game';
            if(isRemote) {
                const game=FM.game, spec={q:state.query,category:state.gameCategory || 'all',scope:S.tab==='build'?'building':(state.gameScope || 'props'),offset:state.page*size,limit:size,order:state.sort};
                const key=JSON.stringify([spec,game.version || 0,game.root]);
                if(remote.key!==key) {
                    clearTimeout(searchTimer);const ticket=++generation;
                    remote={key,records:[],total:0,busy:true,error:''};
                    searchTimer=setTimeout(async()=>{
                        try {
                            const response=await FM.browseGame(spec);
                            if(ticket!==generation || FM.game!==game)return;
                            remote={key,records:response.items || [],total:response.total || 0,busy:false,error:''};
                            const last=Math.max(0,Math.ceil(remote.total/size)-1);if(state.page>last)state.page=last;
                        } catch(error) {if(ticket!==generation || FM.game!==game)return;remote={key,records:[],total:0,busy:false,error:error.message};}
                        paint();
                    },180);
                }
            }
            const entries=isRemote?FM.gameEntries(remote.records):FM.catalogEntries(), total=isRemote?remote.total:entries.length, pages=Math.max(1,Math.ceil(total/size));
            if(!isRemote)state.page=Math.max(0,Math.min(state.page,pages-1));
            const start=state.page*size, visible=isRemote?entries:entries.slice(start,start+size);
            results.append(el('div',{class:'model-result-count',role:'status'},isRemote && remote.busy?'Searching archive metadata…':total?(start+1)+'–'+Math.min(start+size,total)+' of '+total+' models':'0 matching models'));
            if(isRemote && remote.error)results.append(el('p',{class:'note model-error',role:'alert'},remote.error),el('button',{class:'btn sm',onclick:()=>{remote.key='';paint();}},'Retry search'));
            const grid = el('div', { class: 'model-grid' });
            visible.forEach(({m, f, kind}) => {
                const on = selected() === m.id, preview = m.geoms ? FM.thumb(m, expanded ? 144 : 104, 'iso') : el('span',{class:'game-model-placeholder'},'GTA',el('small',null,'Select to load'));
                preview.alt = ''; preview.loading = 'lazy';
                grid.append(el('button', { type: 'button', class: 'model-card' + (on ? ' selected' : ''), disabled:m.game && !m.game.Archetype?true:null, 'aria-pressed': String(on), title: m.name + '\n' + f.file + '\nWidth × depth × height: ' + modelSize(m), onclick: async e => { const button=e.currentTarget; button.disabled=true; button.setAttribute('aria-busy','true'); try { await pick(m.id); if (expanded) paint(); } catch(error) { M.UI.toast(error.message,'err'); } finally {button.disabled=false;button.removeAttribute('aria-busy');} } },
                    el('span', { class: 'model-card-image' }, preview, el('span', { class: 'model-badge' }, m.game ? 'GTA' : f.file.toLowerCase().endsWith('.ydr') ? 'YDR' : 'GLB'), on ? el('span', { class: 'model-selected-mark', 'aria-hidden': 'true' }, '✓') : null),
                    el('span', { class: 'model-card-name' }, m.name), el('span', { class: 'model-card-kind' }, m.game ? m.game.Category : kindLabel(kind)),
                    el('span', { class: 'model-card-dimensions' }, m.game && !m.game.Archetype ? 'Archive only · no standalone archetype' : m.size ? f2(m.size[0]) + ' × ' + f2(m.size[2]) + ' m' : 'Geometry not loaded'),
                    f.warnings.length ? el('span', { class: 'model-card-warning' }, 'Import notes') : null));
            });
            results.append(grid);
            if (!entries.length && state.origin === 'game' && (!isRemote || (!remote.busy && !remote.error))) results.append(el('div',{class:'model-empty'},el('b',null,!FM.game.total ? 'Index your local GTA installation' : 'No matching models'),el('p',null,'Alla props searches all non-door/window YDR names in the local index, including uncategorised entries. Archive-only entries without a standalone archetype cannot be placed. Doors/windows are in Build.')));
            if (!entries.length && state.origin !== 'game') results.append(el('div', { class: 'model-empty' }, el('b', null, FM.lib.files.length ? 'No models match your filters' : 'Your catalogue starts here'), el('p', null, FM.lib.files.length ? 'Try another search or show all categories.' : 'Import a GLB, or add a YDR with its textures.')));
            if (pages > 1) results.append(el('div', { class: 'model-pagination' }, el('button', { type: 'button', class: 'btn sm', disabled: state.page === 0 ? true : null, onclick: () => { state.page--; paint(); results.scrollIntoView({ block: 'nearest' }); } }, 'Previous'), el('span', null, (state.page + 1) + ' / ' + pages), el('button', { type: 'button', class: 'btn sm', disabled: state.page === pages - 1 ? true : null, onclick: () => { state.page++; paint(); results.scrollIntoView({ block: 'nearest' }); } }, 'Next')));
        }
        paint();
        return () => { disposed=true;generation++;clearTimeout(searchTimer); };
    }
    FM.openCatalog = function () {
        let selected = FM.chosen, selectionTicket=0, closed=false, dispose=()=>{};
        const scope=S.tab, library=FM.lib;
        const close = () => { closed=true;selectionTicket++;dispose();M.UI.closeModal();M.UI.renderLeft(); };
        const browser = el('div', { class: 'model-browser' }), detail = el('aside', { class: 'model-catalog-detail' });
        function showDetail() {
            detail.innerHTML = '';
            const m = FM.model(selected), f = m && FM.lib.files.find(f => f.file === m.f);
            if (!m || !f) { detail.append(el('div', { class: 'model-empty' }, el('b', null, 'Choose a model'), el('p', null, 'Select a card to see its size and a larger preview.'))); return; }
            const image = FM.thumb(m, 224, 'iso'); image.alt = m.name;
            detail.append(el('div', { class: 'model-detail-image' }, image), el('span', { class: 'model-eyebrow' }, f.game ? f.game.Category : kindLabel(FM.kindOf(f.file))), el('h3', null, m.name), el('p', { class: 'model-detail-file' }, f.game ? f.game.Name + '.ydr' : f.file),
                el('div', { class: 'model-detail-specs' }, el('span', null, 'Width'), el('b', null, f2(m.size[0]) + ' m'), el('span', null, 'Depth'), el('b', null, f2(m.size[1]) + ' m'), el('span', null, 'Height'), el('b', null, f2(m.size[2]) + ' m')),
                el('button', { type: 'button', class: 'btn primary model-place', onclick: () => { FM.chosen = m.id; close(); } }, 'Place this model'),
                el('p', { class: 'note' }, f.game ? 'Choose a spot in the scene. Move and turn the original game prop; its size stays unchanged.' : 'Choose a spot in the scene, then use the gizmo to move, turn or resize it.'));
            if (f.game) detail.append(el('details',{class:'model-import-notes'},el('summary',null,'Local archive and texture metadata'),el('p',{class:'note'},f.game.Archive),...f.game.Dependencies.map(d=>el('p',{class:'note'},d.Name+' — '+d.Evidence+(d.Locations.length?'':' (no external YTD found; textures may be embedded)'))),f.game.Description?el('p',{class:'note'},f.game.LabelSource+': '+f.game.Description):null));
            if (f.warnings.length) detail.append(el('details', { class: 'model-import-notes' }, el('summary', null, 'Import notes (' + f.warnings.length + ')'), ...f.warnings.map(w => el('p', { class: 'note' }, w))));
        }
        dispose=catalogView(browser, true, () => selected, async id => { const ticket=++selectionTicket;if(id.startsWith('gta:')) { FM.game.failed.delete(id); await FM.ensureGame(id); } if(closed || ticket!==selectionTicket || S.tab!==scope || FM.lib!==library)return;selected = id; showDetail(); });
        showDetail();
        M.UI.modal(el('div', { class: 'dlg model-catalog-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Model catalogue', onkeydown: e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } } },
            el('div', { class: 'model-catalog-header' }, el('div', null, el('span', { class: 'model-eyebrow' }, 'ASSET LIBRARY'), el('h2', null, S.tab === 'furnish' ? 'Prop catalogue' : S.tab === 'build' ? 'Doors, windows & frames' : 'Model catalogue'), el('p', null, 'Find the right detail for your interior.')), el('button', { type: 'button', class: 'btn', onclick: close, 'aria-label': 'Close catalogue' }, 'Close')),
            el('div', { class: 'model-catalog-body' }, browser, detail)), { sticky: true });
        browser.querySelector('input').focus();
    };

    function catalogPanel(root) {
        const lib = FM.lib;
        root.append(el('div', { class: 'model-library-heading' }, el('div', null, el('span', { class: 'model-eyebrow' }, 'ASSET LIBRARY'), el('b', null, S.tab === 'furnish' ? 'Prop catalogue' : S.tab === 'build' ? 'Doors & windows' : 'Model catalogue')), el('button', { type: 'button', class: 'btn sm', onclick: () => FM.openCatalog() }, 'Expand')),
            el('button', { type: 'button', class: 'btn model-import', onclick: () => M.ImportUI.addFiles('files') }, '+ Import models'));
        if (lib.busy) root.append(el('div', { class: 'note', role: 'status' }, 'Reading models…'));
        if (lib.error) root.append(el('div', { class: 'note model-error', role: 'alert' }, lib.error));
        const candidates = (IM.models || []).filter(m => !m.target && /\.ydr$/i.test(m.file) && !lib.files.some(f => f.file === m.file));
        if (candidates.length) {
            const list = el('div', { class: 'model-pending-list' });
            candidates.forEach(m => list.append(el('div', { class: 'model-pending-row' }, el('span', { title: m.file }, m.file), el('button', { type: 'button', class: 'btn sm', onclick: () => FM.setKind(m.file, S.tab === 'furnish' ? 'prop' : (/door|gate/i.test(m.file) ? 'door' : 'prop')) }, 'Add'))));
            root.append(el('details', { class: 'model-pending', open: !FM.models().length ? true : null }, el('summary', null, 'Imported YDR files (' + candidates.length + ')'), el('p', { class: 'note' }, 'Add these files to the placement catalogue.'), list));
        }
        catalogView(root, false, () => FM.chosen, id => FM.choose(id));
        const errors = lib.files.filter(f => f.error);
        if (errors.length) root.append(el('details', { class: 'model-import-notes model-error' }, el('summary', null, errors.length + ' file(s) could not be read'), ...errors.map(f => el('p', { class: 'note' }, f.file + ': ' + f.error))));
    }

    FM.panel = function (root) {
        const lib = FM.lib, k = M.UI.kit;
        catalogPanel(root);
        if(S.tab==='furnish')root.append(chk('Snap to ground vid placering',()=>S.propSnapGround!==false,v=>{S.propSnapGround=v;M.UI.renderLeft();}),el('p',{class:'note'},'Places the prop bottom on the nearest floor or horizontal structural surface below the clicked height. Turn off for free wall placement.'));

        const ch = FM.chosen ? FM.model(FM.chosen) : null;
        root.append(el('div', { class: 'note' }, ch ? 'Chosen: ' + ch.name + '. Click a wall to put it there (you can keep clicking to place more). Esc clears the choice.' : (lib.files.length ? 'Click a model to choose it, then click a wall.' : '')));
        if (ch) {
            const file = lib.files.find(f => f.file === ch.f);
            if (file && !file.game) {
                root.append(el('div', { class: 'model-chosen-file' }, el('b', null, ch.name), el('span', { class: 'model-detail-file' }, file.file), el('label', null, 'Use this file as', el('select', { 'aria-label': 'Model type', onchange: e => FM.setKind(file.file, e.target.value) }, ...CATEGORIES.filter(c => c[0] !== 'all').map(([v, t]) => el('option', { value: v, selected: FM.kindOf(file.file) === v ? true : null }, t))))));
                if (file.warnings.length || file.author || file.license) root.append(el('details', { class: 'model-import-notes' }, el('summary', null, 'Model information'), ...file.warnings.map(w => el('p', { class: 'note' }, w)), el('p', { class: 'note' }, [file.author, file.license].filter(Boolean).join(' · '))));
            }

            if (ch.game) root.append(el('p',{class:'note'},'Original GTA model: fixed size, game collision, reference-only export. Original doors always use the synchronized controller; place two leaves separately for a pair. Collision and availability must be tested in FiveM. Name-based window candidates may include facade parts.'));
            else {
            // setting the chosen model up before it is placed: a model can lie down or face the wrong way as it comes out of its file
            const turned = ch.rot && ch.rot.some((v, i) => v !== SETUP.ident[i]), odd = ch.size[2] > 4.5 || ch.size[2] < 0.3;
            root.append(el('div', { class: 'h' }, 'Set up: ' + ch.name));
            root.append(el('div', { class: 'note' }, (ch.auto ? 'Stood up automatically. ' : (turned ? 'Turned by you. ' : 'As it is in the file. ')) + 'The catalogue shows a three-quarter view; up is up. If it lies down or faces the wrong way, turn it here before you place it (models already placed keep their own size).'
                + (odd && ['door', 'frame'].includes(FM.kindOf(ch.f)) ? ' It was made in another unit (' + f2(ch.size[0]) + ' x ' + f2(ch.size[2]) + ' units): it is scaled to a door\'s height when placed, and you size it with the gizmo.' : '')));
            root.append(el('div', { class: 'row wrap' }, ...[['tilt', 'Tilt 90°'], ['roll', 'Roll 90°'], ['spin', 'Spin 90°'], ['flip', 'Flip front'], ['over', 'Upside down']].map(b => el('button', { class: 'btn sm', title: 'Turn the model a quarter turn about its ' + ({ tilt: 'width', roll: 'depth', spin: 'height' }[b[0]] || 'height') + ' axis', onclick: () => FM.setup(ch, b[0]) }, b[1])),
                el('button', { class: 'btn sm', onclick: () => FM.setup(ch, 'auto') }, 'Auto'), el('button', { class: 'btn sm', onclick: () => FM.setup(ch, 'reset') }, 'As in the file')));
            }
        }

        const it = selFit();
        if (it) {
            if (/\.ydr$/i.test(it.f)) root.append(el('div', { class: 'note' }, 'Direct YDR mesh import: diffuse textures from embedded data or imported YTDs. Export rebuilds materials and collision; original shader effects, rigging and physics are not preserved.'));
            const m = FM.model(it.m), door = it.kind === 'door', keep = S.fitKeep !== false;
            if(it.kind==='prop')root.append(el('button',{class:'btn sm',onclick:()=>FM.snapToGround(it.id)},'Snap to ground'),el('p',{class:'note'},'Drops this prop onto structural geometry below it. Existing props are not changed until you use this button.'));

            root.append(el('div', { class: 'h' }, 'Selected: ' + (m ? m.name : 'missing model')));
            if (!m) root.append(el('div', { class: 'note', style: { color: '#f0a4a3' } }, 'The model ' + it.m + ' is not in the library (is ' + it.f + ' still in the project?). It is left out of the export.'));
            const sz = (key, v) => {
                v = Math.max(0.05, v); const f = v / it[key], patch = {};
                if (keep && it[key] > 0) { patch.w = r3(it.w * f); patch.d = r3(it.d * f); patch.h = r3(it.h * f); } else patch[key] = r3(v);
                FM.set(patch);
            };
            if (!it.game) root.append(num('Width', () => f2(it.w, 3), v => sz('w', v), '0.01', 'm'), num('Height', () => f2(it.h, 3), v => sz('h', v), '0.01', 'm'), num('Depth', () => f2(it.d, 3), v => sz('d', v), '0.01', 'm'));
            if (!it.game) root.append(chk('Keep the proportions when I type a size', () => keep, v => { S.fitKeep = v; M.UI.renderLeft(); }));
            root.append(num('Bottom', () => f2(it.zb, 3), v => FM.set({ zb: r3(v) }), '0.01', 'm'), num('Centre x', () => f2(it.cx, 3), v => FM.set({ cx: r3(v) }), '0.01', 'm'), num('Centre y', () => f2(it.cy, 3), v => FM.set({ cy: r3(v) }), '0.01', 'm'),
                num('Turn', () => f2(it.yaw * 180 / Math.PI, 1), v => FM.set({ yaw: r3(v * Math.PI / 180) }), '1', '°'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'R', onclick: () => FM.turn(Math.PI / 2) }, 'Turn 90°'), el('button', { class: 'btn sm', title: 'Shift+R', onclick: () => FM.turn(Math.PI) }, 'Turn around'),
                el('button', { class: 'btn sm', title: 'Shift+D', onclick: () => FM.duplicate() }, 'Duplicate'), el('button', { class: 'btn sm danger', onclick: () => FM.remove() }, 'Delete ', el('kbd', null, 'X'))));
            if (door) {
                const type = it.doorType || 'hinged', angular = type === 'hinged' || type === 'tilt', managed = type !== 'hinged' || !!it.managed;
                root.append(el('div', { class: 'row' }, el('label', null, 'Door type'), k.seg([['hinged', 'Hinged'], ['garage', 'Vertical Garage'], ['tilt', 'Tilt-up Garage'], ['sliding', 'Sliding']], type, v => FM.set({ doorType: v, travel: v === 'garage' ? it.h : (v === 'sliding' ? it.w : 90), speed: v === 'tilt' ? 45 : (v === 'hinged' ? 90 : 1), direction: v === 'tilt' ? -1 : 1, autoOpen: it.autoOpen === undefined ? v !== 'hinged' : it.autoOpen, solid: false }))));
                if (type === 'hinged' && !it.game) root.append(chk('Built-in synchronized controller (otherwise use your door script)', () => !!it.managed, v => FM.set({ managed: v, solid: false })));
                root.append(el('div', { class: 'row' }, el('label', null, 'Opening direction'), k.seg([[1, type === 'garage' ? 'Up' : (type === 'tilt' ? 'Toward front' : (type === 'sliding' ? '+ width axis' : 'Positive rotation'))], [-1, type === 'garage' ? 'Down' : (type === 'tilt' ? 'Toward back' : (type === 'sliding' ? '- width axis' : 'Negative rotation'))]], it.direction === -1 ? -1 : 1, v => FM.set({ direction: Number(v) }))));
                root.append(num(angular ? 'Opening angle' : (type === 'garage' ? 'Lift height / opening distance' : 'Opening distance'), () => it.travel || (type === 'garage' ? it.h : (type === 'sliding' ? it.w : 90)), v => FM.set({ travel: Math.max(0.01, Math.min(angular ? 180 : 100, v)) }), '0.1', angular ? '°' : 'm'), num('Speed', () => it.speed || (type === 'tilt' ? 45 : (type === 'hinged' ? 90 : 1)), v => FM.set({ speed: Math.max(0.01, Math.min(100, v)) }), '0.1', angular ? '°/s' : 'm/s'));
                if (type === 'tilt') root.append(num('Extra lift when open', () => it.tiltLift || 0, v => FM.set({ tiltLift: Math.max(-20, Math.min(20, v)) }), '0.05', 'm'), num('Forward / back when open', () => it.tiltOffset || 0, v => FM.set({ tiltOffset: Math.max(-20, Math.min(20, v)) }), '0.05', 'm'), el('div', { class: 'note' }, 'The entire leaf rotates around its top edge: 90 degrees makes it horizontal. Extra lift adjusts the final height. Negative forward/back moves toward the back, positive toward the front (green arrow). Offsets and rotation animate together. Collision rotates with the object. This is a rigid tilt-up door, not a segmented roller door.'));
                if (managed) {
                    root.append(chk('Auto open when players or vehicles approach', () => !!it.autoOpen, v => FM.set({ autoOpen: v })));
                    if (it.autoOpen) root.append(num('Auto-open distance', () => it.autoDistance || 6, v => FM.set({ autoDistance: Math.max(1, Math.min(30, v)) }), '0.5', 'm'), num('Close delay after area is clear', () => it.closeDelay == null ? 3 : it.closeDelay, v => FM.set({ closeDelay: Math.max(0, Math.min(120, v)) }), '0.5', 's'));
                    root.append(num('ox_doorlock state ID (0 = none)', () => it.oxDoorId || 0, v => FM.set({ oxDoorId: Math.max(0, Math.min(2147483647, Math.floor(v))) }), '1'), el('div', { class: 'note' }, 'Auto open uses the shared server state and respects locks. An optional ox_doorlock ID reads the lock state of an existing entry; it does not create an ox entry or add ox interaction controls. Keep the built-in controller as the only movement controller for this prop. Existing placements keep auto open off until you enable it.'));
                }
                root.append(chk('Door leaf collision', () => it.collision !== false, v => FM.set({ collision: v })));
                root.append(el('div', { class: 'note' }, managed ? 'Export includes a server-authoritative controller and a moving collision object. Double leaves share one state; sliding and hinged leaves move in opposite directions, garage leaves lift together. No fixed collision is added to the doorway. Test with two FiveM clients before use.' : 'Angle, direction and speed apply when the built-in controller is enabled. Existing door scripts remain supported.'));
            }
            if (door && !it.game) {
                root.append(chk('Double door: two leaves side by side', () => !!it.double, v => FM.setDouble(v)));
                if (it.double) root.append(el('div', { class: 'note' }, it.doorType === 'tilt' ? 'Two leaves share the same state and tilt together about their top edges. The width is the whole opening.' : 'The width is the whole doorway: each leaf is half of it, hinged on the outer edges (the orange lines) and meeting in the middle where their knobs are (the right leaf is the model mirrored). Each leaf is a door prop of its own for your door script. Turning this on doubles the width (each leaf keeps the size the door had), turning it off halves it.'));
            }
            if (door && !it.double && it.doorType !== 'tilt' && it.doorType !== 'garage') root.append(el('div', { class: 'row' }, el('label', null, 'Hinge'), k.seg([['l', 'Left'], ['r', 'Right']], it.hinge || 'l', v => FM.set({ hinge: v }))), el('div', { class: 'note' }, 'Seen from the front (the green arrow points to the front); the orange line is the hinge, it starts on the side opposite the knob. The door is a prop of its own that swings about the hinge, with a collision box the thickness of the leaf: your door script (ox_doorlock...) moves it. Its opening in the interior wall is centred on the door, with room each side for the leaf to turn, so it does not catch on the wall.'));
            if (door && !it.managed && (!it.doorType || it.doorType === 'hinged')) {
                root.append(chk('Also block the doorway with solid collision (it stays when a door script opens the door)', () => !!it.solid, v => FM.set({ solid: v })));
                root.append(el('div', { class: 'note' }, 'The door prop has its own collision box. If the game gives you no collision there, turn this on: the doorway is blocked by the interior\'s own collision, which always works, but it stays blocked when the door is swung open.'));
            }
            if (it.kind === 'prop' && it.game) root.append(chk('Frys på plats', () => !!it.frozen, v => FM.set({ frozen: v })), el('div', {class:'note'}, 'Frozen props keep their original collision but cannot be pushed over. Off preserves the original model physics; some models are already static. Changes apply after export and resource reload.'));
            if (it.kind === 'prop' && !it.game) root.append(el('div', {class:'note'}, 'Imported decoration is baked into the interior and stays fixed in place.'));
            if (it.kind === 'prop' && !it.game) root.append(chk('Decoration collision (box approximation)', () => it.collision !== false, v => FM.set({ collision: v })));
            const inFrame = door ? findFrame(it) : null;
            if (door && inFrame && !it.game) {
                root.append(el('div', { class: 'h' }, 'Frame'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', title: 'Size the door to the opening of the frame it stands in', onclick: () => FM.fitToFrame() }, 'Fit the door to its frame')));
                root.append(el('div', { class: 'note' }, 'This door stands in a frame: the frame\'s hole is the cut in the room\'s wall, and the door is sized to the frame\'s opening (the opening less room to swing).'));
            }
            if (it.kind === 'frame') {
                const fi = frameInner(it);
                root.append(el('div', { class: 'h' }, 'Frame'));
                root.append(el('div', { class: 'note' }, (fi ? 'The opening inside it is ' + f2(fi.w) + ' x ' + f2(fi.h) + ' m. ' : '') + 'The frame sits in the wall cut and its hole is the cut in the room\'s wall. Put it over the building\'s door faces (or press the first button) to make its outside the size of that opening; doors that stand in it are sized to its opening with the second.'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: () => FM.matchOpening() }, 'Match the building\'s door opening'), el('button', { class: 'btn sm', onclick: () => FM.fitDoorsInFrame() }, 'Fit the doors in it')));
            }
            if (door && !inFrame) {
                const dc = FM.doorCut(it);
                root.append(el('div', { class: 'h' }, 'Wall cut'));
                root.append(num('Cut width', () => f2(dc.w, 3), v => FM.set({ cut: { w: r3(Math.max(0.3, v)), h: dc.h, du: 0, dz: it.cut ? it.cut.dz : 0 } }), '0.01', 'm'),
                    num('Cut height', () => f2(dc.h, 3), v => FM.set({ cut: { w: dc.w, h: r3(Math.max(0.5, v)), du: 0, dz: it.cut ? it.cut.dz : 0 } }), '0.01', 'm'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', title: 'Look behind the door for the door-shaped faces of the building and copy their size', onclick: () => FM.matchOpening() }, 'Match the building\'s door opening'),
                    it.cut ? el('button', { class: 'btn sm', onclick: () => FM.set({ cut: null }) }, 'Back to the door size') : null));
                root.append(el('div', { class: 'note' }, it.cut ? 'The wall cut is the size of the building\'s own door opening (the faces you delete there), so the room\'s wall and the building\'s hole line up; the door is sized to sit in it with room to swing.' : 'The wall cut is centred on the door: the door plus the same gap on each side, enough for the leaf to turn about its hinge. Put the door over the building\'s door faces (or press the button) to cut the room\'s wall to the same size as the building\'s opening, with the door in the middle of it.'));
            }
            if (it.kind !== 'prop') root.append(chk('Opens the interior\'s own wall here (and makes the portal / glass collision)', () => it.open !== false, v => FM.set({ open: v })));
            if (it.kind !== 'prop') {
            root.append(el('div', { class: 'h' }, 'The wall behind it'));
            root.append(el('div', { class: 'note' }, 'Nothing is cut from the building by itself. Select the faces behind the model, delete them in the Delete faces tool, and clear the building\'s collision there if the model has to be passable.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => IT().faces.selectBehind(FM.boxOf(it)) }, 'Select the wall faces behind it'), el('button', { class: 'btn sm', onclick: () => IT().colBehind(FM.boxOf(it)) }, 'Select the building\'s collision there')));
            }
        }
        const list = fits().filter(f => FM.inScope(f.kind));
        root.append(el('div', { class: 'h' }, 'Placed in this building (' + list.length + ')'));
        const pl = el('div', { class: 'plist', style: { maxHeight: '150px' } });
        list.forEach(f => { const m = FM.model(f.m); pl.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: f.id === FM.sel ? 'rgba(80,200,130,0.18)' : '' }, onclick: () => FM.select(f.id) }, el('b', null, m ? m.name : f.m), el('span', { class: 'note' }, f2(f.w) + ' x ' + f2(f.h) + ' m'),
            el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); Model.edit(Q => { Q.import.fits = (Q.import.fits || []).filter(q => q.id !== f.id); }); if (FM.sel === f.id) FM.sel = null; M.UI.renderLeft(); } }, 'x'))); });
        if (!list.length) pl.append(el('div', { class: 'note' }, 'None yet.'));
        root.append(pl);
        root.append(el('div', { class: 'note' }, 'Models are exported at the size shown here. Decorations become interior meshes. Door pivots: side hinge, garage bottom centre, sliding bottom corner. Managed doors include their own synchronized controller.'));
    };
})(window.MLO);
