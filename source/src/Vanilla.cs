// Reads the game's own files (through CodeWalker.Core) to grab a vanilla house: finds the map pieces around a door spot,
// extracts their triangles and collision, then HouseFit works out frame, floor level, interior outline and windows. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using CodeWalker.GameFiles;
using SharpDX;

namespace MloCreator
{
    public class EntityHit
    {
        public string Ymap, Name, Lod; public uint Hash; public Vector3 Pos, Scale; public Quaternion Rot;
        public RpfFileEntry Ydr; public RpfFile YdrOwner; public Vector3 BMin, BMax; public bool Covers; public double Dist;
    }
    // a prop the game's map files place (plants and the like): where it stands, where the middle of it is, how wide and tall it is, which map files place it
    public class PropHit
    {
        public Quaternion Rot = Quaternion.Identity; public Vector3 Scale = new Vector3(1, 1, 1);          // how the map places it (turn, size)
        public string Name, Lod, Why, Kind; public uint Hash; public Vector3 Pos, Centre; public float R, H; public bool Sized; public List<string> Files = new List<string>();      // Why: "name", or what shows the model is a plant (its archive, shader or textures)
        public int Tris = -1, TrisAll;                 // triangles of the prop that lie inside the rooms, and all of them (-1: not counted)
    }
    public class RefTri { public double[] P = new double[9]; public int Group; }
    public class RefGroup { public string Entity, Texture; public float[] Color = new float[] { 0.62f, 0.60f, 0.56f }; }
    public class ColPoly
    {
        public int Kind;                // 0 triangle, 1 box
        public double[] P;              // triangle: 9 numbers; box: 12 numbers (4 corners as stored)
        public string File; public int Room; public string Material; public bool Hi;
    }

    public static partial class Vanilla
    {
        public static volatile string Status = "";
        static RpfManager rpf; static string gta, cache;
        static Dictionary<string, RpfFileEntry> ent = new Dictionary<string, RpfFileEntry>();
        static Dictionary<string, RpfFile> own = new Dictionary<string, RpfFile>();
        static readonly object gate = new object();
        public static bool Ready { get { return rpf != null; } }
        public static string GtaPath { get { return gta; } }

        public static void Init(string gtaPath, string cacheDir, bool refresh = false)
        {
            lock (gate)
            {
                if (rpf != null && gtaPath == gta && !refresh) return;
                if (!Directory.Exists(gtaPath) || !File.Exists(Path.Combine(gtaPath, "GTA5.exe"))) throw new Exception("GTA V was not found" + (string.IsNullOrEmpty(gtaPath) ? "" : " in \"" + gtaPath + "\"") + ". Put its folder in settings.json next to the program as \"gtaPath\" (or set the GTA5_PATH environment variable).");
                Status = "Reading the game archives (about 10 seconds)...";
                GTA5Keys.LoadFromPath(gtaPath, "");
                RpfManager m = new RpfManager();
                m.Init(gtaPath, delegate (string s) { }, delegate (string s) { }, false, true);
                ent = new Dictionary<string, RpfFileEntry>(); own = new Dictionary<string, RpfFile>();
                foreach (RpfFile rf in m.AllRpfs)
                {
                    if (rf.AllEntries == null) continue;
                    foreach (RpfEntry e in rf.AllEntries)
                    {
                        RpfFileEntry fe = e as RpfFileEntry; if (fe == null) continue;
                        string k = fe.Name.ToLowerInvariant(); ent[k] = fe; own[k] = rf;          // later archives (updates, dlc) win
                    }
                }
                rpf = m; gta = gtaPath; cache = cacheDir; Directory.CreateDirectory(cacheDir);
                ymapIdx = null; bboxCache.Clear(); texColor.Clear(); ytdDone.Clear();
                Status = "";
            }
        }

        public static RpfFileEntry GetEntry(string lowerName, out RpfFile owner) { owner = null; RpfFileEntry e; if (!ent.TryGetValue(lowerName, out e)) return null; owner = own[lowerName]; return e; }
        public static List<string> Names(string suffix) { List<string> l = new List<string>(); foreach (string k in ent.Keys) if (k.EndsWith(suffix)) l.Add(k); return l; }

        public static byte[] Bytes(string name, out RpfFileEntry entry)
        {
            string k = name.ToLowerInvariant(); entry = null; RpfFileEntry e; if (!ent.TryGetValue(k, out e)) return null;
            entry = e; return own[k].ExtractFile(e);
        }

        // ---------------- ymap extents index (built once, then cached on disk) ----------------
        class YmapInfo { public string Name; public float X0, Y0, X1, Y1; }
        static List<YmapInfo> ymapIdx;

        static void EnsureYmapIndex()
        {
            if (ymapIdx != null) return;
            string f = Path.Combine(cache, "ymap_index.txt");
            string stamp = gta + "|" + File.GetLastWriteTimeUtc(Path.Combine(gta, "GTA5.exe")).Ticks + "|" + ent.Count;
            List<YmapInfo> list = new List<YmapInfo>();
            if (File.Exists(f))
            {
                string[] lines = File.ReadAllLines(f);
                if (lines.Length > 1 && lines[0] == stamp)
                {
                    for (int i = 1; i < lines.Length; i++)
                    {
                        string[] p = lines[i].Split('|'); if (p.Length < 5) continue;
                        YmapInfo yi = new YmapInfo(); yi.Name = p[0];
                        yi.X0 = float.Parse(p[1], CultureInfo.InvariantCulture); yi.Y0 = float.Parse(p[2], CultureInfo.InvariantCulture); yi.X1 = float.Parse(p[3], CultureInfo.InvariantCulture); yi.Y1 = float.Parse(p[4], CultureInfo.InvariantCulture);
                        list.Add(yi);
                    }
                    ymapIdx = list; return;
                }
            }
            int n = 0, total = 0; foreach (string k in ent.Keys) if (k.EndsWith(".ymap")) total++;
            StringBuilder sb = new StringBuilder(); sb.AppendLine(stamp);
            foreach (KeyValuePair<string, RpfFileEntry> kv in ent)
            {
                if (!kv.Key.EndsWith(".ymap")) continue;
                n++; if (n % 500 == 0) Status = "Indexing the game's map files, first run only: " + n + " / " + total;
                try
                {
                    byte[] data = own[kv.Key].ExtractFile(kv.Value); if (data == null) continue;
                    YmapFile y = new YmapFile(); y.Load(data, kv.Value);
                    Vector3 a = y.CMapData.entitiesExtentsMin, b = y.CMapData.entitiesExtentsMax;
                    if (float.IsNaN(a.X) || float.IsInfinity(a.X) || (a.X == 0 && a.Y == 0 && b.X == 0 && b.Y == 0)) continue;
                    if (y.AllEntities == null || y.AllEntities.Length == 0) continue;
                    YmapInfo yi = new YmapInfo(); yi.Name = kv.Key; yi.X0 = a.X; yi.Y0 = a.Y; yi.X1 = b.X; yi.Y1 = b.Y; list.Add(yi);
                    sb.AppendLine(string.Format(CultureInfo.InvariantCulture, "{0}|{1}|{2}|{3}|{4}", kv.Key, a.X, a.Y, b.X, b.Y));
                }
                catch (Exception) { }
            }
            File.WriteAllText(f, sb.ToString()); ymapIdx = list; Status = "";
        }

        // ---------------- finding the map pieces around a point ----------------
        static Dictionary<string, Vector3[]> bboxCache = new Dictionary<string, Vector3[]>();

        // A prop's drawable: a plain model (.ydr) or, for a fence, a bin, a table, a fragment (.yft: the drawable of the fragment). null when the game has neither by this name.
        static DrawableBase OpenDrawable(string name, out string file, out long size)
        {
            string k = name.ToLowerInvariant(); RpfFileEntry e; file = null; size = 0;
            if (ent.TryGetValue(k + ".ydr", out e)) { file = k + ".ydr"; size = e.GetFileSize(); YdrFile y = new YdrFile(); y.Load(own[file].ExtractFile(e), e); return y.Drawable; }
            if (ent.TryGetValue(k + ".yft", out e)) { file = k + ".yft"; size = e.GetFileSize(); YftFile f = new YftFile(); f.Load(own[file].ExtractFile(e), e); return f.Fragment != null ? f.Fragment.Drawable : null; }
            return null;
        }
        static bool HasDrawable(string name) { string k = name.ToLowerInvariant(); return ent.ContainsKey(k + ".ydr") || ent.ContainsKey(k + ".yft"); }

        static Vector3[] DrawableBox(string name, out RpfFileEntry entry)
        {
            entry = null; string k = name.ToLowerInvariant() + ".ydr"; RpfFileEntry e; if (!ent.TryGetValue(k, out e)) return null;
            entry = e; Vector3[] bb;
            if (bboxCache.TryGetValue(k, out bb)) return bb;
            try
            {
                YdrFile y = new YdrFile(); y.Load(own[k].ExtractFile(e), e);
                if (y.Drawable == null) { bboxCache[k] = null; return null; }
                bb = new Vector3[] { y.Drawable.BoundingBoxMin, y.Drawable.BoundingBoxMax };
            }
            catch (Exception) { bb = null; }
            bboxCache[k] = bb; return bb;
        }
        // the same for any prop, fragments too (a prop's bounding box)
        static Vector3[] PropBox(string name)
        {
            string ck = "prop|" + name.ToLowerInvariant(); Vector3[] bb; if (bboxCache.TryGetValue(ck, out bb)) return bb;
            try { string f; long sz; DrawableBase d = OpenDrawable(name, out f, out sz); bb = d == null ? null : new Vector3[] { d.BoundingBoxMin, d.BoundingBoxMax }; } catch (Exception) { bb = null; }
            bboxCache[ck] = bb; return bb;
        }

        public static List<EntityHit> FindEntities(double px, double py, double radius)
        {
            EnsureYmapIndex();
            List<EntityHit> hits = new List<EntityHit>(); HashSet<string> seen = new HashSet<string>();
            List<string> maps = new List<string>();
            foreach (YmapInfo yi in ymapIdx) if (px >= yi.X0 - 2 && px <= yi.X1 + 2 && py >= yi.Y0 - 2 && py <= yi.Y1 + 2) maps.Add(yi.Name);
            Status = "Looking through " + maps.Count + " map files near the door...";
            foreach (string mn in maps)
            {
                try
                {
                    YmapFile y = new YmapFile(); y.Load(own[mn].ExtractFile(ent[mn]), ent[mn]);
                    if (y.AllEntities == null) continue;
                    foreach (YmapEntityDef en in y.AllEntities)
                    {
                        double dx = en.Position.X - px, dy = en.Position.Y - py; if (dx * dx + dy * dy > radius * radius) continue;
                        string lod = en.CEntityDef.lodLevel.ToString(); if (lod != "LODTYPES_DEPTH_HD" && lod != "LODTYPES_DEPTH_ORPHANHD") continue;
                        uint h = en.CEntityDef.archetypeName.Hash; string name = JenkIndex.TryGetString(h); if (string.IsNullOrEmpty(name)) continue;
                        string key = h + "|" + Math.Round(en.Position.X, 2) + "|" + Math.Round(en.Position.Y, 2) + "|" + Math.Round(en.Position.Z, 2);
                        if (!seen.Add(key)) continue;
                        RpfFileEntry ye; string yk = name.ToLowerInvariant() + ".ydr"; if (!ent.TryGetValue(yk, out ye)) continue;
                        if (ye.GetFileSize() < 40000) continue;                                     // small props are skipped
                        EntityHit eh = new EntityHit(); eh.Ymap = mn; eh.Name = name; eh.Hash = h; eh.Pos = en.Position; eh.Rot = en.Orientation; eh.Scale = en.Scale; eh.Lod = lod; eh.Ydr = ye; eh.YdrOwner = own[yk]; eh.Dist = Math.Sqrt(dx * dx + dy * dy);
                        RpfFileEntry dummy; Vector3[] bb = DrawableBox(name, out dummy); if (bb == null) continue;
                        eh.BMin = bb[0]; eh.BMax = bb[1];
                        // is the point inside the entity's oriented box?
                        Quaternion inv = en.Orientation; inv.Invert();
                        Vector3 loc = Vector3.Transform(new Vector3((float)(px - en.Position.X), (float)(py - en.Position.Y), 0), inv);
                        float sx = en.Scale.X == 0 ? 1 : en.Scale.X; loc.X /= sx; loc.Y /= sx;
                        eh.Covers = loc.X >= bb[0].X - 1 && loc.X <= bb[1].X + 1 && loc.Y >= bb[0].Y - 1 && loc.Y <= bb[1].Y + 1;
                        hits.Add(eh);
                    }
                }
                catch (Exception) { }
            }
            Status = "";
            return hits;
        }

        // The props the map files place inside a box (world x/y), whose name nameOk accepts. The game keeps the same prop in several map files (the streaming one and its
        // "hei_" and "lr_" copies), so a prop standing at the same spot is listed once, with every file that places it. Only full detail props count (HD and orphan HD).
        // the middles of the triangles of a prop's most detailed model, in its own coordinates (x y z, x y z...)
        static Dictionary<string, float[]> centroidCache = new Dictionary<string, float[]>();
        static float[] Centroids(string name)
        {
            string k = name.ToLowerInvariant(); float[] res; if (centroidCache.TryGetValue(k, out res)) return res;
            List<float> list = new List<float>();
            try
            {
                string fl; long sz; DrawableBase d = OpenDrawable(name, out fl, out sz);
                if (d != null && d.DrawableModels != null && d.DrawableModels.High != null)
                    foreach (DrawableModel m in d.DrawableModels.High)
                    {
                        if (m.Geometries == null) continue;
                        foreach (DrawableGeometry g in m.Geometries)
                        {
                            VertexData vd = g.VertexData; if (vd == null || g.IndexBuffer == null || g.IndexBuffer.Indices == null) continue;
                            int posOff = vd.Info.GetComponentOffset(0), stride = g.VertexStride; byte[] vb = vd.VertexBytes; if (posOff < 0 || stride <= 0) continue;
                            int nv = vb.Length / stride; ushort[] idx = g.IndexBuffer.Indices;
                            for (int t = 0; t + 2 < idx.Length; t += 3)
                            {
                                int a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (a == b || b == c || a == c || a >= nv || b >= nv || c >= nv) continue;
                                float mx = 0, my = 0, mz = 0; int[] ids = new int[] { a, b, c };
                                for (int j = 0; j < 3; j++) { int o = ids[j] * stride + posOff; mx += BitConverter.ToSingle(vb, o); my += BitConverter.ToSingle(vb, o + 4); mz += BitConverter.ToSingle(vb, o + 8); }
                                list.Add(mx / 3); list.Add(my / 3); list.Add(mz / 3);
                            }
                        }
                    }
            }
            catch (Exception) { }
            res = list.ToArray(); centroidCache[k] = res; return res;
        }

        // Is this prop a plant, whatever its name says? Names lie ("prop_am_box_wood_01" is a 3 m bush): the archive that holds the model (v_bush, v_ext_veg...), the shader of its parts
        // (the game's foliage shaders are "trees_*") and the names of their textures (branches, leaves, grass, weeds) tell. null: no; else why.
        static Dictionary<string, string> plantWhy = new Dictionary<string, string>();
        static readonly System.Text.RegularExpressions.Regex PlantArchive = new System.Text.RegularExpressions.Regex("bush|veg|tree|plant|foliage|grass|flower|hedge|shrub|palm", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        static readonly System.Text.RegularExpressions.Regex PlantTexture = new System.Text.RegularExpressions.Regex("branch|leaf|leaves|foliage|grass|weed|bush|palm|fern|hedge|flower|shrub|ivy|cactus", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        public static string PlantWhy(string name)
        {
            string k = name.ToLowerInvariant(), res; if (plantWhy.TryGetValue(k, out res)) return res;
            res = null; RpfFileEntry e; string kf = ent.ContainsKey(k + ".ydr") ? k + ".ydr" : (ent.ContainsKey(k + ".yft") ? k + ".yft" : null);
            if (kf != null && ent.TryGetValue(kf, out e))
            {
                if (PlantArchive.IsMatch(own[kf].Name)) res = "archive " + own[kf].Name;
                else if (e.GetFileSize() < 600000)
                {
                    try
                    {
                        string fl; long sz; DrawableBase dr = OpenDrawable(name, out fl, out sz);
                        if (dr != null && dr.DrawableModels != null && dr.DrawableModels.High != null)
                            foreach (DrawableModel m in dr.DrawableModels.High)
                            {
                                if (m.Geometries == null) continue;
                                foreach (DrawableGeometry g in m.Geometries)
                                {
                                    string sh = ""; try { sh = g.Shader.Name.ToString(); } catch (Exception) { }
                                    if (sh.StartsWith("trees", StringComparison.OrdinalIgnoreCase)) { res = "foliage shader"; break; }
                                    try { ShaderParametersBlock pl = g.Shader.ParametersList; for (int q = 0; q < pl.Parameters.Length; q++) { TextureBase tb = pl.Parameters[q].Data as TextureBase; if (tb != null && PlantTexture.IsMatch(tb.Name)) { res = "foliage texture"; break; } } } catch (Exception) { }
                                    if (res != null) break;
                                }
                                if (res != null) break;
                            }
                    }
                    catch (Exception) { }
                }
            }
            plantWhy[k] = res; return res;
        }

        // A prop's most detailed model as loose triangles (3 vertices each, flat normals) for a picture of it, at most maxTris of them (every n-th triangle when it has more). Cached.
        static Dictionary<string, float[][]> meshCache = new Dictionary<string, float[][]>();
        public static float[][] PropMesh(string name, int maxTris)
        {
            string k = name.ToLowerInvariant(); float[][] res; if (meshCache.TryGetValue(k, out res)) return res;
            List<float> pos = new List<float>(), nrm = new List<float>(); res = null;
            if (HasDrawable(name))
            {
                try
                {
                    string fl; long sz; DrawableBase dr = OpenDrawable(name, out fl, out sz); List<float[]> tris = new List<float[]>();
                    if (dr != null && dr.DrawableModels != null && dr.DrawableModels.High != null)
                        foreach (DrawableModel m in dr.DrawableModels.High)
                        {
                            if (m.Geometries == null) continue;
                            foreach (DrawableGeometry g in m.Geometries)
                            {
                                VertexData vd = g.VertexData; if (vd == null || g.IndexBuffer == null || g.IndexBuffer.Indices == null) continue;
                                int posOff = vd.Info.GetComponentOffset(0), stride = g.VertexStride; byte[] vb = vd.VertexBytes; if (posOff < 0 || stride <= 0) continue;
                                int nv = vb.Length / stride; ushort[] idx = g.IndexBuffer.Indices;
                                for (int t = 0; t + 2 < idx.Length; t += 3)
                                {
                                    int a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (a == b || b == c || a == c || a >= nv || b >= nv || c >= nv) continue;
                                    float[] tr = new float[9]; int[] ids = new int[] { a, b, c };
                                    for (int j = 0; j < 3; j++) { int o = ids[j] * stride + posOff; tr[j * 3] = BitConverter.ToSingle(vb, o); tr[j * 3 + 1] = BitConverter.ToSingle(vb, o + 4); tr[j * 3 + 2] = BitConverter.ToSingle(vb, o + 8); }
                                    tris.Add(tr);
                                }
                            }
                        }
                    int step = Math.Max(1, (int)Math.Ceiling(tris.Count / (double)Math.Max(1, maxTris)));
                    for (int i = 0; i < tris.Count; i += step)
                    {
                        float[] tr = tris[i]; float ux = tr[3] - tr[0], uy = tr[4] - tr[1], uz = tr[5] - tr[2], vx = tr[6] - tr[0], vy = tr[7] - tr[1], vz = tr[8] - tr[2];
                        float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = (float)Math.Sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-9f) { nx = 0; ny = 0; nz = 1; l = 1; }
                        for (int j = 0; j < 3; j++) { pos.Add(tr[j * 3]); pos.Add(tr[j * 3 + 1]); pos.Add(tr[j * 3 + 2]); nrm.Add(nx / l); nrm.Add(ny / l); nrm.Add(nz / l); }
                    }
                    res = new float[][] { pos.ToArray(), nrm.ToArray(), new float[] { tris.Count } };
                }
                catch (Exception) { res = null; }
            }
            meshCache[k] = res; return res;
        }

        // vols: the rooms as boxes in the world, each { centre x, centre y, bottom z, top z, half width, half depth, cos yaw, sin yaw }; the triangles of a prop whose middle is inside one are counted
        // others: the props that are not plants too (bins, boxes, fences, tables...), except the ones skip says are the building's own models; Kind says which is which
        public static List<PropHit> PropsInBox(double x0, double y0, double x1, double y1, Func<string, bool> nameOk, List<double[]> vols, bool others, Func<string, bool> skip)
        {
            EnsureYmapIndex();
            List<PropHit> hits = new List<PropHit>(); Dictionary<string, PropHit> seen = new Dictionary<string, PropHit>();
            List<string> maps = new List<string>();
            foreach (YmapInfo yi in ymapIdx) if (x1 >= yi.X0 - 2 && x0 <= yi.X1 + 2 && y1 >= yi.Y0 - 2 && y0 <= yi.Y1 + 2) maps.Add(yi.Name);
            Status = "Looking through " + maps.Count + " map files around the building...";
            foreach (string mn in maps)
            {
                try
                {
                    YmapFile y = new YmapFile(); y.Load(own[mn].ExtractFile(ent[mn]), ent[mn]);
                    if (y.AllEntities == null) continue;
                    foreach (YmapEntityDef en in y.AllEntities)
                    {
                        if (en.Position.X < x0 || en.Position.X > x1 || en.Position.Y < y0 || en.Position.Y > y1) continue;
                        string lod = en.CEntityDef.lodLevel.ToString(); if (lod != "LODTYPES_DEPTH_HD" && lod != "LODTYPES_DEPTH_ORPHANHD") continue;
                        uint h = en.CEntityDef.archetypeName.Hash; string name = JenkIndex.TryGetString(h); if (string.IsNullOrEmpty(name)) continue;
                        string why = nameOk(name) ? "name" : PlantWhy(name);                                         // (a plant by its name, or by what the model is made of)
                        if (why == null) { if (!others || (skip != null && skip(name)) || !HasDrawable(name)) continue; }          // (not a plant: a prop only when asked for, and only a real model of its own)
                        string key = h + "|" + Math.Round(en.Position.X, 2) + "|" + Math.Round(en.Position.Y, 2) + "|" + Math.Round(en.Position.Z, 2);
                        PropHit ph; if (seen.TryGetValue(key, out ph)) { if (!ph.Files.Contains(mn)) ph.Files.Add(mn); continue; }
                        ph = new PropHit(); ph.Name = name; ph.Why = why; ph.Kind = why == null ? "prop" : "plant"; ph.Hash = h; ph.Rot = en.Orientation; ph.Scale = en.Scale; ph.Pos = en.Position; ph.Lod = lod.Replace("LODTYPES_DEPTH_", ""); ph.Files.Add(mn); ph.Centre = en.Position; ph.R = 0.5f; ph.H = 1f;
                        Vector3[] bb = PropBox(name);
                        if (bb != null)
                        {
                            float sx = en.Scale.X == 0 ? 1 : en.Scale.X, sz = en.Scale.Z == 0 ? 1 : en.Scale.Z;
                            Vector3 mid = new Vector3((bb[0].X + bb[1].X) / 2 * sx, (bb[0].Y + bb[1].Y) / 2 * sx, (bb[0].Z + bb[1].Z) / 2 * sz);
                            ph.Centre = en.Position + Vector3.Transform(mid, en.Orientation);
                            ph.R = Math.Max((bb[1].X - bb[0].X), (bb[1].Y - bb[0].Y)) / 2 * sx; ph.H = (bb[1].Z - bb[0].Z) * sz; ph.Sized = true;
                        }
                        if (why != "name" && ph.R > 6f) { seen[key] = ph; continue; }              // (a model wider than 12 m with leaf textures is ground or a whole block's detail file, not a plant)
                        if (why == null && ph.R > 8f) { seen[key] = ph; continue; }                // (nor is a prop that wide: a road piece, a whole building)
                        if (vols != null && vols.Count > 0)
                        {
                            // only a prop whose box can reach a room is looked at triangle by triangle
                            float reach = Math.Max(ph.R, ph.H) * 1.5f + 1f; bool near = false;
                            foreach (double[] v in vols) { double ddx = ph.Centre.X - v[0], ddy = ph.Centre.Y - v[1]; if (Math.Sqrt(ddx * ddx + ddy * ddy) <= reach + Math.Sqrt(v[4] * v[4] + v[5] * v[5])) { near = true; break; } }
                            float[] cs = near ? Centroids(name) : null; ph.Tris = 0;
                            if (cs != null && cs.Length > 0)
                            {
                                float sx2 = en.Scale.X == 0 ? 1 : en.Scale.X, sz2 = en.Scale.Z == 0 ? 1 : en.Scale.Z; ph.TrisAll = cs.Length / 3;
                                for (int ci = 0; ci + 2 < cs.Length; ci += 3)
                                {
                                    Vector3 w = Vector3.Transform(new Vector3(cs[ci] * sx2, cs[ci + 1] * sx2, cs[ci + 2] * sz2), en.Orientation) + en.Position;
                                    foreach (double[] v in vols)
                                    {
                                        if (w.Z < v[2] || w.Z > v[3]) continue; double dx = w.X - v[0], dy = w.Y - v[1];
                                        if (Math.Abs(dx * v[6] + dy * v[7]) <= v[4] && Math.Abs(-dx * v[7] + dy * v[6]) <= v[5]) { ph.Tris++; break; }
                                    }
                                }
                            }
                            else if (near) ph.Tris = -1;                                          // its model could not be read
                        }
                        seen[key] = ph; hits.Add(ph);
                    }
                }
                catch (Exception) { }
            }
            Status = "";
            return hits;
        }

        // ---------------- textures: average colour of a texture, looked up in the archive that holds the drawable ----------------
        static Dictionary<string, float[]> texColor = new Dictionary<string, float[]>();
        static HashSet<string> ytdDone = new HashSet<string>();

        static float[] AvgColor(Texture t)
        {
            try
            {
                byte[] px = CodeWalker.Utils.DDSIO.GetPixels(t, 0); if (px == null) return null;
                int w = t.Width, h = t.Height; long r = 0, g = 0, b = 0; int n = 0; int step = Math.Max(1, (w * h) / 4096);
                for (int i = 0; i + 3 < px.Length; i += 4 * step) { b += px[i]; g += px[i + 1]; r += px[i + 2]; n++; }
                if (n == 0) return null; return new float[] { r / (float)n / 255f, g / (float)n / 255f, b / (float)n / 255f };
            }
            catch (Exception) { return null; }
        }

        static void LoadTexturesFor(RpfFile owner, HashSet<string> wanted)
        {
            // texture dictionaries living in the same archive as the drawable
            foreach (RpfEntry e in owner.AllEntries)
            {
                RpfFileEntry fe = e as RpfFileEntry; if (fe == null || !fe.Name.EndsWith(".ytd", StringComparison.OrdinalIgnoreCase)) continue;
                string key = owner.Path + "|" + fe.Name; if (ytdDone.Contains(key)) continue;
                bool anyMissing = false; foreach (string w in wanted) if (!texColor.ContainsKey(w)) { anyMissing = true; break; }
                if (!anyMissing) return;
                ytdDone.Add(key);
                try
                {
                    YtdFile ytd = new YtdFile(); ytd.Load(owner.ExtractFile(fe), fe);
                    if (ytd.TextureDict == null || ytd.TextureDict.Textures == null) continue;
                    foreach (Texture t in ytd.TextureDict.Textures.data_items)
                    {
                        string tn = t.Name.ToLowerInvariant(); if (!wanted.Contains(tn) || texColor.ContainsKey(tn)) continue;
                        float[] c = AvgColor(t); if (c != null) texColor[tn] = c;
                    }
                }
                catch (Exception) { }
            }
        }

        // ---------------- reference geometry ----------------
        static float Half(byte[] b, int o)
        {
            int h = BitConverter.ToUInt16(b, o), s = (h >> 15) & 1, e = (h >> 10) & 31, m = h & 1023; double v;
            if (e == 0) v = Math.Pow(2, -14) * (m / 1024.0); else if (e == 31) v = 0; else v = Math.Pow(2, e - 15) * (1 + m / 1024.0);
            return (float)(s == 1 ? -v : v);
        }

        public static void ExtractGeometry(List<EntityHit> hits, double[] win, List<RefGroup> groups, List<RefTri> tris)
        {
            // win = minX, maxX, minY, maxY, minZ, maxZ in world coordinates
            uint diffHash = JenkHash.GenHash("diffusesampler");
            Dictionary<string, int> groupIdx = new Dictionary<string, int>();
            Dictionary<string, HashSet<string>> wantByOwner = new Dictionary<string, HashSet<string>>();
            Dictionary<string, RpfFile> ownerByPath = new Dictionary<string, RpfFile>();
            foreach (EntityHit eh in hits)
            {
                // world box test
                Vector3[] cs = new Vector3[8]; int ci = 0;
                for (int i = 0; i < 8; i++)
                {
                    Vector3 c = new Vector3((i & 1) == 0 ? eh.BMin.X : eh.BMax.X, (i & 2) == 0 ? eh.BMin.Y : eh.BMax.Y, (i & 4) == 0 ? eh.BMin.Z : eh.BMax.Z);
                    cs[ci++] = Vector3.Transform(c * (eh.Scale.X == 0 ? 1 : eh.Scale.X), eh.Rot) + eh.Pos;
                }
                double x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; foreach (Vector3 c in cs) { x0 = Math.Min(x0, c.X); x1 = Math.Max(x1, c.X); y0 = Math.Min(y0, c.Y); y1 = Math.Max(y1, c.Y); }
                if (x1 < win[0] || x0 > win[1] || y1 < win[2] || y0 > win[3]) continue;
                YdrFile ydr = new YdrFile();
                try { ydr.Load(eh.YdrOwner.ExtractFile(eh.Ydr), eh.Ydr); } catch (Exception) { continue; }
                if (ydr.Drawable == null || ydr.Drawable.DrawableModels == null || ydr.Drawable.DrawableModels.High == null) continue;
                foreach (DrawableModel m in ydr.Drawable.DrawableModels.High)
                {
                    if (m.Geometries == null) continue;
                    foreach (DrawableGeometry g in m.Geometries)
                    {
                        VertexData vd = g.VertexData; if (vd == null || g.IndexBuffer == null || g.IndexBuffer.Indices == null) continue;
                        string tex = "";
                        try
                        {
                            ShaderParametersBlock pl = g.Shader.ParametersList; string first = "";
                            for (int k = 0; k < pl.Parameters.Length; k++)
                            {
                                TextureBase tb = pl.Parameters[k].Data as TextureBase; if (tb == null) continue;
                                if (first == "") first = tb.Name; if ((uint)pl.Hashes[k] == diffHash) tex = tb.Name;
                            }
                            if (tex == "") tex = first;
                        }
                        catch (Exception) { }
                        int posOff = vd.Info.GetComponentOffset(0); int stride = g.VertexStride; byte[] vb = vd.VertexBytes; if (posOff < 0 || stride <= 0) continue;
                        int nv = vb.Length / stride; double sc = eh.Scale.X == 0 ? 1 : eh.Scale.X;
                        double[] wx = new double[nv], wy = new double[nv], wz = new double[nv]; bool[] inside = new bool[nv];
                        for (int i = 0; i < nv; i++)
                        {
                            int o = i * stride + posOff;
                            Vector3 w = Vector3.Transform(new Vector3(BitConverter.ToSingle(vb, o) * (float)sc, BitConverter.ToSingle(vb, o + 4) * (float)sc, BitConverter.ToSingle(vb, o + 8) * (float)sc), eh.Rot) + eh.Pos;
                            wx[i] = w.X; wy[i] = w.Y; wz[i] = w.Z;
                            inside[i] = w.X >= win[0] && w.X <= win[1] && w.Y >= win[2] && w.Y <= win[3] && w.Z >= win[4] && w.Z <= win[5];
                        }
                        ushort[] idx = g.IndexBuffer.Indices; string gk = eh.Name + "|" + tex; int gi;
                        for (int t = 0; t + 2 < idx.Length; t += 3)
                        {
                            int a = idx[t], b = idx[t + 1], c = idx[t + 2];
                            if (a == b || b == c || a == c || a >= nv || b >= nv || c >= nv) continue;
                            if (!(inside[a] && inside[b] && inside[c])) continue;
                            if (!groupIdx.TryGetValue(gk, out gi))
                            {
                                gi = groups.Count; groupIdx[gk] = gi; RefGroup rg = new RefGroup(); rg.Entity = eh.Name; rg.Texture = tex; groups.Add(rg);
                                if (tex != "")
                                {
                                    string ok = eh.YdrOwner.Path; ownerByPath[ok] = eh.YdrOwner; if (!wantByOwner.ContainsKey(ok)) wantByOwner[ok] = new HashSet<string>(); wantByOwner[ok].Add(tex.ToLowerInvariant());
                                }
                            }
                            RefTri rt = new RefTri(); rt.Group = gi; int[] ids = new int[] { a, b, c };
                            for (int j = 0; j < 3; j++) { rt.P[j * 3] = wx[ids[j]]; rt.P[j * 3 + 1] = wy[ids[j]]; rt.P[j * 3 + 2] = wz[ids[j]]; }
                            tris.Add(rt);
                        }
                    }
                }
            }
            Status = "Colouring the reference from the game's textures...";
            foreach (KeyValuePair<string, HashSet<string>> kv in wantByOwner) LoadTexturesFor(ownerByPath[kv.Key], kv.Value);
            foreach (RefGroup g in groups) { float[] c; if (!string.IsNullOrEmpty(g.Texture) && texColor.TryGetValue(g.Texture.ToLowerInvariant(), out c)) g.Color = c; }
            Status = "";
        }

        // ---------------- collision ----------------
        public static void ExtractCollision(List<EntityHit> hits, double[] win, List<ColPoly> polys, List<string> filesUsed)
        {
            HashSet<string> owners = new HashSet<string>(); List<RpfFile> ownerList = new List<RpfFile>();
            foreach (EntityHit eh in hits) { if (!eh.Covers) continue; if (owners.Add(eh.YdrOwner.Path)) ownerList.Add(eh.YdrOwner); }
            foreach (RpfFile rf in ownerList)
            {
                foreach (RpfEntry e in rf.AllEntries)
                {
                    RpfFileEntry fe = e as RpfFileEntry; if (fe == null || !fe.Name.EndsWith(".ybn", StringComparison.OrdinalIgnoreCase)) continue;
                    // the entry that is actually active for this name
                    RpfFileEntry active; if (!ent.TryGetValue(fe.Name.ToLowerInvariant(), out active)) continue;
                    RpfFile ao = own[fe.Name.ToLowerInvariant()];
                    Bounds root; YbnFile y = new YbnFile();
                    try { y.Load(ao.ExtractFile(active), active); root = y.Bounds; } catch (Exception) { continue; }
                    if (root == null) continue;
                    if (root.BoxMax.X < win[0] || root.BoxMin.X > win[1] || root.BoxMax.Y < win[2] || root.BoxMin.Y > win[3]) continue;
                    int before = polys.Count;
                    WalkBounds(root, win, polys, fe.Name.ToLowerInvariant());
                    if (polys.Count > before) filesUsed.Add(fe.Name + " (" + (polys.Count - before) + " polygons)");
                }
            }
        }

        static void WalkBounds(Bounds b, double[] win, List<ColPoly> polys, string file)
        {
            if (b == null) return;
            BoundComposite comp = b as BoundComposite;
            if (comp != null) { if (comp.Children != null) foreach (Bounds c in comp.Children.data_items) WalkBounds(c, win, polys, file); return; }
            BoundGeometry geo = b as BoundGeometry; if (geo == null || geo.Polygons == null) return;
            if (b.BoxMax.X < win[0] || b.BoxMin.X > win[1] || b.BoxMax.Y < win[2] || b.BoxMin.Y > win[3]) return;
            foreach (BoundPolygon p in geo.Polygons)
            {
                BoundPolygonTriangle tp = p as BoundPolygonTriangle; BoundPolygonBox bp = p as BoundPolygonBox;
                if (tp == null && bp == null) continue;
                Vector3[] vp = p.VertexPositions; if (vp == null) continue;
                bool inside = false;
                foreach (Vector3 v in vp) if (v.X >= win[0] && v.X <= win[1] && v.Y >= win[2] && v.Y <= win[3] && v.Z >= win[4] && v.Z <= win[5]) { inside = true; break; }
                if (!inside) continue;
                ColPoly cp = new ColPoly(); cp.File = file; cp.Hi = file.StartsWith("hi@"); cp.Kind = tp != null ? 0 : 1;
                int n = tp != null ? 3 : 4; cp.P = new double[n * 3];
                for (int i = 0; i < n; i++) { cp.P[i * 3] = vp[i].X; cp.P[i * 3 + 1] = vp[i].Y; cp.P[i * 3 + 2] = vp[i].Z; }
                try { cp.Material = p.Material.Type.ToString(); cp.Room = p.Material.RoomId; } catch (Exception) { cp.Material = ""; }
                polys.Add(cp);
            }
        }
    }
}
