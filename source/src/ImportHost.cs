// Files the user imports into a project (models, textures, collision, map placement), their meshes for the editor and the cuts. C# 5.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public static partial class ImportHost
    {
        static string projDir, cacheDir;
        static readonly object gate = new object();
        static Dictionary<string, ModelDoc> docs = new Dictionary<string, ModelDoc>();

        public static void Init(string projectsDir, string cache) { projDir = projectsDir; cacheDir = cache; Directory.CreateDirectory(cache); }
        public static string FilesDir(string project) { return Path.Combine(projDir, project + ".files"); }
        // The models that come with the program (.glb windows, door and frame in the "models" folder next to it): every project has them, the project's own files of the same name win.
        public static string ModelsDir;
        public static string GlbPath(string project, string file)
        {
            string n = CleanName(file); if (n.Length == 0) return null;
            string p = Path.Combine(FilesDir(project), n); if (File.Exists(p)) return p;
            if (!string.IsNullOrEmpty(ModelsDir)) { p = Path.Combine(ModelsDir, n); if (File.Exists(p)) return p; }
            return null;
        }

        static string KindOf(string file)
        {
            switch (Path.GetExtension(file).ToLowerInvariant())
            {
                case ".ydr": return "model";
                case ".ytd": return "textures";
                case ".ybn": return "collision";
                case ".ymap": return "map";
                case ".glb": return "glb";
            }
            return null;
        }

        static string CleanName(string n)
        {
            n = Path.GetFileName(n ?? ""); foreach (char c in Path.GetInvalidFileNameChars()) n = n.Replace(c.ToString(), "");
            return n.Trim();
        }

        public static List<object> List(string project)
        {
            List<object> l = new List<object>(); string dir = FilesDir(project); if (!Directory.Exists(dir)) return l;
            foreach (string f in Directory.GetFiles(dir))
            {
                string k = KindOf(f); if (k == null) continue; FileInfo fi = new FileInfo(f);
                Dictionary<string, object> e = new Dictionary<string, object>(); e["name"] = fi.Name; e["kind"] = k; e["bytes"] = fi.Length; l.Add(e);
            }
            return l;
        }

        // copies a file, or every supported file of a folder, into the project; returns the names added
        public static List<string> AddPath(string project, string path)
        {
            List<string> added = new List<string>(); string dir = FilesDir(project); Directory.CreateDirectory(dir);
            if (Directory.Exists(path)) { foreach (string f in Directory.GetFiles(path)) if (KindOf(f) != null) { File.Copy(f, Path.Combine(dir, Path.GetFileName(f)), true); added.Add(Path.GetFileName(f)); } }
            else if (File.Exists(path)) { if (KindOf(path) == null) throw new Exception("Only .ydr, .ytd, .ybn, .ymap and .glb files can be imported."); File.Copy(path, Path.Combine(dir, Path.GetFileName(path)), true); added.Add(Path.GetFileName(path)); }
            else throw new Exception("Not found: " + path);
            docs.Clear();
            return added;
        }

        public static string Upload(string project, string file, byte[] data)
        {
            string n = CleanName(file); if (n.Length == 0 || KindOf(n) == null) throw new Exception("Only .ydr, .ytd, .ybn, .ymap and .glb files can be imported.");
            string dir = FilesDir(project); Directory.CreateDirectory(dir); File.WriteAllBytes(Path.Combine(dir, n), data); docs.Clear(); return n;
        }

        public static void Remove(string project, string file)
        {
            string p = Path.Combine(FilesDir(project), CleanName(file)); if (File.Exists(p)) { File.Delete(p); docs.Clear(); }
        }

        // ---------- file / folder pickers (a Windows dialog, run on its own thread) ----------
        public static string[] Pick(bool folder)
        {
            string[] result = null; string last = null;
            try { string lf = Path.Combine(cacheDir, "last_import_dir.txt"); if (File.Exists(lf)) last = File.ReadAllText(lf).Trim(); } catch { }
            Thread t = new Thread(delegate ()
            {
                using (Form f = new Form())
                {
                    f.TopMost = true; f.ShowInTaskbar = false; f.FormBorderStyle = FormBorderStyle.None; f.StartPosition = FormStartPosition.Manual; f.Location = new Point(-3000, -3000); f.Size = new Size(1, 1); f.Show(); f.Activate();
                    if (folder)
                    {
                        using (FolderBrowserDialog d = new FolderBrowserDialog())
                        {
                            d.Description = "Pick the folder that holds the model files (.ydr, .ytd, .ybn, .ymap, .glb)"; if (!string.IsNullOrEmpty(last) && Directory.Exists(last)) d.SelectedPath = last;
                            if (d.ShowDialog(f) == DialogResult.OK) result = new string[] { d.SelectedPath };
                        }
                    }
                    else
                    {
                        using (OpenFileDialog d = new OpenFileDialog())
                        {
                            d.Multiselect = true; d.Title = "Import model files"; d.Filter = "Model files (*.ydr;*.ytd;*.ybn;*.ymap;*.glb)|*.ydr;*.ytd;*.ybn;*.ymap;*.glb|All files (*.*)|*.*";
                            if (!string.IsNullOrEmpty(last) && Directory.Exists(last)) d.InitialDirectory = last;
                            if (d.ShowDialog(f) == DialogResult.OK) result = d.FileNames;
                        }
                    }
                }
            });
            t.SetApartmentState(ApartmentState.STA); t.Start(); t.Join();
            if (result != null && result.Length > 0)
            {
                try { string dd = Directory.Exists(result[0]) ? result[0] : Path.GetDirectoryName(result[0]); File.WriteAllText(Path.Combine(cacheDir, "last_import_dir.txt"), dd); } catch { }
            }
            return result;
        }

        // ---------- loading ----------
        static ModelDoc Doc(string project, string file)
        {
            string path = Path.Combine(FilesDir(project), CleanName(file)); if (!File.Exists(path)) throw new Exception("The model file " + file + " is not in the project.");
            FileInfo fi = new FileInfo(path); string key = path.ToLowerInvariant() + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
            lock (gate)
            {
                ModelDoc md; if (docs.TryGetValue(key, out md)) return md;
                string tex = Path.Combine(cacheDir, "models", project.ToLowerInvariant().Replace(' ', '_') + "_" + Path.GetFileNameWithoutExtension(file).ToLowerInvariant());
                if (Directory.Exists(tex)) { try { Directory.Delete(tex, true); } catch { } }
                md = ModelDoc.Load(File.ReadAllBytes(path), tex, Path.GetFileNameWithoutExtension(file));
                List<string> stale = new List<string>(); foreach (string k in docs.Keys) if (k.StartsWith(path.ToLowerInvariant() + "|")) stale.Add(k);
                foreach (string k in stale) docs.Remove(k);
                docs[key] = md; return md;
            }
        }

        static string B64(float[] f) { byte[] b = new byte[f.Length * 4]; Buffer.BlockCopy(f, 0, b, 0, b.Length); return Convert.ToBase64String(b); }
        static string B64(int[] f) { byte[] b = new byte[f.Length * 4]; Buffer.BlockCopy(f, 0, b, 0, b.Length); return Convert.ToBase64String(b); }
        static string B64(ushort[] f) { byte[] b = new byte[f.Length * 2]; Buffer.BlockCopy(f, 0, b, 0, b.Length); return Convert.ToBase64String(b); }

        // ---------- window and door models from .glb files ----------
        // Every .glb in the project's files, split into models (one window system, or the one door): meshes in the model's own frame (u = width, n = depth, z = up, the bottom of the box at z = 0 after the
        // editor centres it), the materials and the textures they use.
        public static Dictionary<string, object> GlbLibrary(string project, Dictionary<string, object> body)
        {
            Dictionary<string, object> r = new Dictionary<string, object>(); List<object> files = new List<object>(), texs = new List<object>(); string dir = FilesDir(project);
            Dictionary<string, object> kinds = J.O(J.G(body, "kinds")), setups = J.O(J.G(body, "setups"));            // what the user chose: the kind of each file, the turn of each model
            string only = J.S(J.G(body, "only"), "");                                                                    // one file only (after its kind or its turn was changed)
            // the project's own .glb files, then the ones that come with the program (unless the project has a file of that name)
            List<string> paths = new List<string>(); HashSet<string> seenNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (Directory.Exists(dir)) foreach (string f in Directory.GetFiles(dir, "*.glb")) { paths.Add(f); seenNames.Add(Path.GetFileName(f)); }
            if (Directory.Exists(dir)) foreach (string f in Directory.GetFiles(dir, "*.ydr")) if (J.G(kinds, Path.GetFileName(f)) != null) paths.Add(f);
            if (!string.IsNullOrEmpty(ModelsDir) && Directory.Exists(ModelsDir)) foreach (string f in Directory.GetFiles(ModelsDir, "*.glb")) if (!seenNames.Contains(Path.GetFileName(f))) paths.Add(f);
            {
                foreach (string f in paths)
                {
                    if (only.Length > 0 && !Path.GetFileName(f).Equals(only, StringComparison.OrdinalIgnoreCase)) continue;
                    Dictionary<string, object> e = new Dictionary<string, object>(); e["file"] = Path.GetFileName(f); e["builtin"] = !string.IsNullOrEmpty(ModelsDir) && Path.GetDirectoryName(f).Equals(ModelsDir, StringComparison.OrdinalIgnoreCase);
                    try
                    {
                        GlbFile g = GlbFile.Load(f); e["kind"] = g.Kind; string fkind = J.S(J.G(kinds, Path.GetFileName(f)), g.Kind); e["title"] = g.Title; e["author"] = g.Author; e["license"] = g.License; e["source"] = g.Source; e["warnings"] = g.Warnings;
                        List<object> mats = new List<object>(); foreach (GlbMat m in g.Mats) { Dictionary<string, object> md = new Dictionary<string, object>(); md["name"] = m.Name; md["key"] = m.Key; md["color"] = new double[] { m.AvgR, m.AvgG, m.AvgB, m.A }; md["tex"] = m.Tex >= 0 ? g.Texs[m.Tex].Name : ""; md["glass"] = m.Glass; mats.Add(md); }
                        e["mats"] = mats;
                        foreach (GlbTex t in g.Texs) { Dictionary<string, object> td = new Dictionary<string, object>(); td["name"] = t.Name; td["w"] = t.Size; td["h"] = t.Size; td["rgba"] = Convert.ToBase64String(t.Rgba); texs.Add(td); }
                        List<object> models = new List<object>();
                        foreach (GlbModel m0 in g.Models)
                        {
                            int[] used; bool auto; int[] want = null; List<object> sl = J.A(J.G(setups, m0.Id)); if (sl.Count == 9) { want = new int[9]; for (int si = 0; si < 9; si++) want[si] = J.I(sl[si], 0); }
                            GlbModel m = g.Resolve(m0, fkind, want, out used, out auto);
                            Dictionary<string, object> mo = new Dictionary<string, object>(); mo["rot"] = used; mo["auto"] = auto; mo["inner"] = m.Inner; mo["id"] = m.Id; mo["name"] = m.Name; mo["min"] = m.Min; mo["max"] = m.Max; mo["tris"] = m.Tris; mo["core"] = new double[] { m.CoreN0, m.CoreN1 }; mo["latch"] = m.Latch;
                            List<object> geoms = new List<object>();
                            foreach (GlbGeom gg in m.Geoms)
                            {
                                Dictionary<string, object> go = new Dictionary<string, object>(); go["mat"] = gg.Mat; go["pos"] = B64(gg.Pos); go["nrm"] = B64(gg.Nrm); go["uv"] = B64(gg.Uv);
                                ushort[] ix = new ushort[gg.Idx.Length]; for (int i = 0; i < ix.Length; i++) ix[i] = (ushort)gg.Idx[i]; go["idx"] = B64(ix); geoms.Add(go);
                            }
                            mo["geoms"] = geoms; models.Add(mo);
                        }
                        e["models"] = models;
                    }
                    catch (Exception ex) { e["error"] = ex.Message; }
                    files.Add(e);
                }
            }
            r["files"] = files; r["textures"] = texs; return r;
        }
        // positions / normals / uvs of one geometry in the shape the editor wants
        static Dictionary<string, object> GeomJson(GeomData g, int no, float[] V, int[] Idx)
        {
            int S = g.Stride, nv = V.Length / S; float[] p = new float[nv * 3], n = new float[nv * 3], uv = new float[nv * 2];
            for (int v = 0; v < nv; v++)
            {
                for (int a = 0; a < 3; a++) p[v * 3 + a] = V[v * S + g.PosOff + a];
                if (g.NrmOff >= 0) for (int a = 0; a < 3; a++) n[v * 3 + a] = V[v * S + g.NrmOff + a]; else n[v * 3 + 2] = 1;
                if (g.UvOff >= 0) { uv[v * 2] = V[v * S + g.UvOff]; uv[v * 2 + 1] = V[v * S + g.UvOff + 1]; }
            }
            ushort[] ix = new ushort[Idx.Length]; for (int i = 0; i < ix.Length; i++) ix[i] = (ushort)Idx[i];
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["g"] = no; d["tex"] = g.Tex; d["shader"] = g.ShaderName; d["bucket"] = g.Bucket; d["tris"] = Idx.Length / 3;
            d["pos"] = B64(p); d["nrm"] = B64(n); d["uv"] = B64(uv); d["idx"] = B64(ix);
            return d;
        }

        static Dictionary<string, object> TexJson(string name, Texture t)
        {
            try
            {
                int w = t.Width, h = t.Height, mip = 0; int levels = Math.Max(1, (int)t.Levels);
                while ((w >> mip) > 256 && mip < levels - 1) mip++;
                int mw = Math.Max(1, w >> mip), mh = Math.Max(1, h >> mip);
                byte[] px = CodeWalker.Utils.DDSIO.GetPixels(t, mip); if (px == null || px.Length < mw * mh * 4) return null;
                byte[] rgba = new byte[mw * mh * 4];
                for (int i = 0; i < mw * mh; i++) { rgba[i * 4] = px[i * 4 + 2]; rgba[i * 4 + 1] = px[i * 4 + 1]; rgba[i * 4 + 2] = px[i * 4]; rgba[i * 4 + 3] = px[i * 4 + 3]; }
                Dictionary<string, object> d = new Dictionary<string, object>(); d["name"] = name.ToLowerInvariant(); d["w"] = mw; d["h"] = mh; d["rgba"] = Convert.ToBase64String(rgba); d["fullW"] = w; d["fullH"] = h;
                return d;
            }
            catch (Exception) { return null; }
        }

        public static Dictionary<string, object> LoadModels(string project, string target, List<string> log)
        {
            Dictionary<string, object> res = new Dictionary<string, object>(); List<object> models = new List<object>(); List<object> texList = new List<object>();
            string dir = FilesDir(project); HashSet<string> wanted = new HashSet<string>();
            foreach (string f in Directory.Exists(dir) ? Directory.GetFiles(dir, "*.ydr") : new string[0])
            {
                string fn = Path.GetFileName(f); ModelDoc md;
                try { md = Doc(project, fn); } catch (Exception ex) { log.Add(fn + ": " + ex.Message); continue; }
                Dictionary<string, object> m = new Dictionary<string, object>(); m["file"] = fn; m["target"] = string.Equals(fn, target, StringComparison.OrdinalIgnoreCase);
                List<object> gl = new List<object>(); double[] mn = new double[] { 1e30, 1e30, 1e30 }, mx = new double[] { -1e30, -1e30, -1e30 }; int tris = 0;
                for (int gi = 0; gi < md.Geoms.Count; gi++)
                {
                    GeomData g = md.Geoms[gi]; if (g.Lod != 0) continue;
                    gl.Add(GeomJson(g, gi, g.V, g.Idx)); tris += g.Idx.Length / 3; if (g.Tex.Length > 0) wanted.Add(g.Tex.ToLowerInvariant());
                    for (int v = 0; v < g.VertCount; v++) for (int a = 0; a < 3; a++) { double p = g.V[v * g.Stride + g.PosOff + a]; if (p < mn[a]) mn[a] = p; if (p > mx[a]) mx[a] = p; }
                }
                m["geoms"] = gl; m["bmin"] = mn; m["bmax"] = mx; m["tris"] = tris; models.Add(m);
            }
            // textures: imported .ytd files first, then the ones stored inside the models
            Dictionary<string, Dictionary<string, object>> found = new Dictionary<string, Dictionary<string, object>>();
            foreach (string f in Directory.Exists(dir) ? Directory.GetFiles(dir, "*.ytd") : new string[0])
            {
                try
                {
                    YtdFile ytd = new YtdFile(); ytd.Load(File.ReadAllBytes(f));
                    if (ytd.TextureDict == null || ytd.TextureDict.Textures == null) continue;
                    foreach (Texture t in ytd.TextureDict.Textures.data_items)
                    {
                        string k = (t.Name ?? "").ToLowerInvariant(); if (!wanted.Contains(k)) continue;
                        Dictionary<string, object> tj = TexJson(t.Name, t); if (tj == null) continue;
                        Dictionary<string, object> old; if (found.TryGetValue(k, out old) && J.I(old["fullW"], 0) >= J.I(tj["fullW"], 0)) continue; found[k] = tj;
                    }
                }
                catch (Exception ex) { log.Add(Path.GetFileName(f) + ": " + ex.Message); }
            }
            foreach (string f in Directory.Exists(dir) ? Directory.GetFiles(dir, "*.ydr") : new string[0])
            {
                try
                {
                    ModelDoc md = Doc(project, Path.GetFileName(f));
                    foreach (string dds in Directory.GetFiles(md.TexDir, "*.dds"))
                    {
                        string k = Path.GetFileNameWithoutExtension(dds).ToLowerInvariant(); if (!wanted.Contains(k) || found.ContainsKey(k)) continue;
                        Texture t = CodeWalker.Utils.DDSIO.GetTexture(File.ReadAllBytes(dds)); if (t == null) continue;
                        Dictionary<string, object> tj = TexJson(k, t); if (tj != null) found[k] = tj;
                    }
                }
                catch (Exception) { }
            }
            foreach (KeyValuePair<string, Dictionary<string, object>> kv in found) texList.Add(kv.Value);
            res["models"] = models; res["textures"] = texList; res["files"] = List(project); res["entities"] = Entities(project, target, log);
            return res;
        }

        // ---------- where the model stands in the world: the entity in an imported .ymap ----------
        public static List<object> Entities(string project, string target, List<string> log)
        {
            List<object> list = new List<object>(); string dir = FilesDir(project); if (!Directory.Exists(dir) || string.IsNullOrEmpty(target)) return list;
            uint hash = JenkHash.GenHash(Path.GetFileNameWithoutExtension(target).ToLowerInvariant());
            foreach (string f in Directory.GetFiles(dir, "*.ymap"))
            {
                try
                {
                    YmapFile y = new YmapFile(); y.Load(File.ReadAllBytes(f));
                    if (y.AllEntities == null) continue;
                    foreach (YmapEntityDef en in y.AllEntities)
                    {
                        if (en.CEntityDef.archetypeName.Hash != hash) continue;
                        list.Add(EntityJson(Path.GetFileName(f), en));
                    }
                }
                catch (Exception ex) { log.Add(Path.GetFileName(f) + ": " + ex.Message); }
            }
            return list;
        }

        static Dictionary<string, object> EntityJson(string ymap, YmapEntityDef en)
        {
            SharpDX.Quaternion q = en.Orientation; double heading = 2 * Math.Atan2(q.Z, q.W) * 180 / Math.PI;
            Dictionary<string, object> e = new Dictionary<string, object>();
            e["ymap"] = ymap; e["x"] = en.Position.X; e["y"] = en.Position.Y; e["z"] = en.Position.Z; e["heading"] = heading;
            e["qx"] = q.X; e["qy"] = q.Y; e["qz"] = q.Z; e["qw"] = q.W; e["scale"] = en.Scale.X;
            e["tilted"] = Math.Abs(q.X) > 0.002 || Math.Abs(q.Y) > 0.002;
            return e;
        }

        // Where each detail model (the other files of the block: hedges, weeds, bushes, vents) stands in the world. Every model file is centred on its own point, the position of the
        // entity that places it, so a detail file is not in the building's coordinates: the editor moves it from its frame to the building's with this. Looked up in the project's
        // own .ymap files and, only when asked, in the game's map files; the entity nearest (nx, ny) when there are several. { file: { ymap, x, y, z, heading, ... } }
        public static Dictionary<string, object> Places(string project, List<string> files, string gta, bool useGame, double nx, double ny, List<string> log)
        {
            Dictionary<string, object> res = new Dictionary<string, object>(); Dictionary<uint, string> want = new Dictionary<uint, string>(); Dictionary<string, double> bestD = new Dictionary<string, double>();
            foreach (string f in files) { string n = CleanName(f); if (n.Length > 0) want[JenkHash.GenHash(Path.GetFileNameWithoutExtension(n).ToLowerInvariant())] = n; }
            if (want.Count == 0) return res;
            Action<string, YmapFile> take = delegate (string yname, YmapFile y)
            {
                if (y.AllEntities == null) return;
                foreach (YmapEntityDef en in y.AllEntities)
                {
                    string f; if (!want.TryGetValue(en.CEntityDef.archetypeName.Hash, out f)) continue;
                    double dx = en.Position.X - nx, dy = en.Position.Y - ny, d = dx * dx + dy * dy, bd; if (bestD.TryGetValue(f, out bd) && bd <= d) continue;
                    bestD[f] = d; res[f] = EntityJson(yname, en);
                }
            };
            string dir = FilesDir(project);
            if (Directory.Exists(dir)) foreach (string p in Directory.GetFiles(dir, "*.ymap")) { try { YmapFile y = new YmapFile(); y.Load(File.ReadAllBytes(p)); take(Path.GetFileName(p), y); } catch (Exception ex) { log.Add(Path.GetFileName(p) + ": " + ex.Message); } }
            if (useGame && bestD.Count < want.Count)
            {
                Vanilla.Init(gta, cacheDir);
                string stem = Path.GetFileNameWithoutExtension(files[0]).ToLowerInvariant(); string[] parts = stem.Split('_'); string prefix = parts.Length >= 2 ? parts[0] + "_" + parts[1] : stem;
                List<string> first = new List<string>(), rest = new List<string>();
                foreach (string m in Vanilla.Names(".ymap")) { if (m.IndexOf("occl", StringComparison.Ordinal) >= 0 || m.EndsWith("_lod.ymap")) continue; if (m.StartsWith(prefix)) first.Add(m); else rest.Add(m); }
                int n = 0, total = first.Count;
                foreach (string mn in first)
                {
                    n++; Vanilla.Status = "Looking for the detail models in the game's map files: " + n + " / " + total;
                    try { RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(mn, out owner); if (fe == null) continue; YmapFile y = new YmapFile(); y.Load(owner.ExtractFile(fe), fe); take(fe.Name, y); } catch (Exception) { }
                }
                if (bestD.Count < want.Count)
                {
                    total = rest.Count; n = 0;
                    foreach (string mn in rest)
                    {
                        n++; if (n % 300 == 0) Vanilla.Status = "Looking for the detail models in the game's map files: " + n + " / " + total;
                        try { RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(mn, out owner); if (fe == null) continue; YmapFile y = new YmapFile(); y.Load(owner.ExtractFile(fe), fe); take(fe.Name, y); } catch (Exception) { }
                        if (bestD.Count >= want.Count) break;
                    }
                }
                Vanilla.Status = "";
            }
            foreach (string f in want.Values) if (!res.ContainsKey(f)) log.Add(f + ": no map file places it" + (useGame ? "" : " (the game's files were not looked at)"));
            return res;
        }

        // the same lookup in the game's own map files (only when the user asks for it)
        public static List<object> EntitiesInGame(string target, string gta, List<string> log)
        {
            List<object> list = new List<object>();
            Vanilla.Init(gta, cacheDir);
            uint hash = JenkHash.GenHash(Path.GetFileNameWithoutExtension(target).ToLowerInvariant());
            string stem = Path.GetFileNameWithoutExtension(target).ToLowerInvariant(); string[] parts = stem.Split('_');
            string prefix = parts.Length >= 2 ? parts[0] + "_" + parts[1] : stem;
            List<string> maps = Vanilla.Names(".ymap"), first = new List<string>(), rest = new List<string>();
            foreach (string m in maps) { if (m.IndexOf("occl", StringComparison.Ordinal) >= 0 || m.EndsWith("_lod.ymap")) continue; if (m.StartsWith(prefix)) first.Add(m); else rest.Add(m); }
            int n = 0, total = first.Count + rest.Count;
            Action<List<string>> scan = delegate (List<string> names)
            {
                foreach (string mn in names)
                {
                    n++; if (n % 300 == 0) Vanilla.Status = "Looking for " + target + " in the game's map files: " + n + " / " + total;
                    try
                    {
                        RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(mn, out owner); if (fe == null) continue;
                        YmapFile y = new YmapFile(); y.Load(owner.ExtractFile(fe), fe);
                        if (y.AllEntities == null) continue;
                        foreach (YmapEntityDef en in y.AllEntities) if (en.CEntityDef.archetypeName.Hash == hash) list.Add(EntityJson(fe.Name, en));
                    }
                    catch (Exception) { }
                }
            };
            scan(first);
            if (list.Count == 0) scan(rest);
            Vanilla.Status = "";
            return list;
        }

        // ---------- cutting ----------
        public static List<CutBox> BoxesFrom(object cuttersObj, Dictionary<string, object> origin)
        {
            double ox = J.D(J.G(origin, "x"), 0), oy = J.D(J.G(origin, "y"), 0), oz = J.D(J.G(origin, "z"), 0), hd = J.D(J.G(origin, "heading"), 0) * Math.PI / 180, c = Math.Cos(hd), s = Math.Sin(hd);
            List<CutBox> boxes = new List<CutBox>();
            foreach (object o in J.A(cuttersObj))
            {
                Dictionary<string, object> d = J.O(o); if (d == null) continue;
                double cx = J.D(J.G(d, "cx"), 0), cy = J.D(J.G(d, "cy"), 0), zb = J.D(J.G(d, "zb"), 0), w = J.D(J.G(d, "w"), 1), h = J.D(J.G(d, "h"), 2), dp = J.D(J.G(d, "d"), 0.6), yaw = J.D(J.G(d, "yaw"), 0);
                CutBox b = new CutBox(); b.Id = J.S(J.G(d, "id"), ""); b.Type = J.S(J.G(d, "type"), "cut"); b.NoMesh = !J.B(J.G(d, "mesh"), true);
                b.Cx = ox + cx * c - cy * s; b.Cy = oy + cx * s + cy * c; b.Cz = oz + zb + h / 2; b.Yaw = yaw + hd; b.Hu = w / 2; b.Hn = dp / 2; b.Hz = h / 2;
                b.Prepare(); boxes.Add(b);
            }
            return boxes;
        }

        public static HashSet<long> DeletesFrom(object delObj)
        {
            HashSet<long> set = new HashSet<long>();
            foreach (object o in J.A(delObj)) { List<object> p = J.A(o); if (p.Count >= 2) set.Add(ModelCut.Key(J.I(p[0], 0), J.I(p[1], 0))); }
            return set;
        }

        // holes filled in the Edges tool: [{ g, src, pts: [[x, y, z]...], tris: [[i, j, k]...] }], in the model's own coordinates
        public static List<FillSpec> FillsFrom(object fillObj)
        {
            List<FillSpec> list = new List<FillSpec>();
            foreach (object o in J.A(fillObj))
            {
                Dictionary<string, object> d = J.O(o); if (d == null) continue;
                FillSpec f = new FillSpec(); f.Geom = J.I(J.G(d, "g"), -1); f.Src = J.I(J.G(d, "src"), 0); if (f.Geom < 0) continue;
                List<object> pts = J.A(J.G(d, "pts")), tris = J.A(J.G(d, "tris")); f.Pts = new double[pts.Count][]; f.Tris = new int[tris.Count][];
                for (int i = 0; i < pts.Count; i++) { List<object> p = J.A(pts[i]); f.Pts[i] = new double[] { J.D(p.Count > 0 ? p[0] : null, 0), J.D(p.Count > 1 ? p[1] : null, 0), J.D(p.Count > 2 ? p[2] : null, 0) }; }
                for (int i = 0; i < tris.Count; i++) { List<object> t = J.A(tris[i]); f.Tris[i] = new int[] { J.I(t.Count > 0 ? t[0] : null, -1), J.I(t.Count > 1 ? t[1] : null, -1), J.I(t.Count > 2 ? t[2] : null, -1) }; }
                list.Add(f);
            }
            return list;
        }

        // "Clear from the rooms": { volumes: [room boxes], cats: { win, veg, other }, skip: ["file|geometry", ...] } -> null when nothing is to be cleared
        public static ClearSpec ClearFrom(object clearObj, Dictionary<string, object> origin)
        {
            Dictionary<string, object> c = J.O(clearObj); if (c == null) return null;
            ClearSpec cl = new ClearSpec(); cl.Boxes = BoxesFrom(J.G(c, "volumes"), origin); if (cl.Boxes.Count == 0) return null; foreach (CutBox cb in cl.Boxes) cb.Skin = true;
            List<CutBox> wb = BoxesFrom(J.G(c, "winVolumes"), origin); if (wb.Count > 0) { foreach (CutBox cb in wb) cb.Skin = true; cl.WinBoxes = wb; }
            Dictionary<string, object> cats = J.O(J.G(c, "cats")); cl.Win = J.B(J.G(cats, "win"), true); cl.Veg = J.B(J.G(cats, "veg"), true); cl.Other = J.B(J.G(cats, "other"), true);
            foreach (object s in J.A(J.G(c, "skip"))) { string k = J.S(s, ""); if (k.Length > 0) cl.Skip.Add(k); }
            return cl;
        }
        static Dictionary<string, object> ClearCounts(ClearSpec cl)
        {
            Dictionary<string, object> r = new Dictionary<string, object>(); r["win"] = cl == null ? 0 : cl.Counts[0]; r["veg"] = cl == null ? 0 : cl.Counts[1]; r["other"] = cl == null ? 0 : cl.Counts[2]; return r;
        }

        // preview: the target's geometries after the cut (only the ones that changed). Also used for a detail model (target = its file) to see what the rooms clear from it.
        public static Dictionary<string, object> CutPreview(string project, Dictionary<string, object> spec)
        {
            string target = J.S(J.G(spec, "target"), ""); ModelDoc md = Doc(project, target);
            List<CutBox> boxes = BoxesFrom(J.G(spec, "cutters"), J.O(J.G(spec, "origin"))); HashSet<long> del = DeletesFrom(J.G(spec, "deletes"));
            ClearSpec clear = ClearFrom(J.G(spec, "clear"), J.O(J.G(spec, "origin")));
            List<GeomOut> outs = ModelCut.Apply(md, boxes, del, FillsFrom(J.G(spec, "fills")), clear);
            List<object> geoms = new List<object>(); int before = 0, after = 0, removed = 0, added = 0;
            for (int i = 0; i < outs.Count; i++)
            {
                GeomOut o = outs[i]; if (o.Src.Lod != 0) continue; before += o.Src.Idx.Length / 3; after += o.Idx.Length / 3;
                if (!o.Changed) continue; removed += o.Removed; added += o.Added;
                Dictionary<string, object> gj = GeomJson(o.Src, i, o.V, o.Idx); if (o.TriSrc != null) gj["src"] = B64(o.TriSrc);     // which original triangle each one comes from
                geoms.Add(gj);
            }
            Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true; r["geoms"] = geoms; r["before"] = before; r["after"] = after; r["removed"] = removed; r["added"] = added; r["cleared"] = ClearCounts(clear);
            return r;
        }

        // ---------- collision ----------
        static Dictionary<string, ColDoc> cdocs = new Dictionary<string, ColDoc>();
        static ColDoc CDoc(string project, string file)
        {
            string path = Path.Combine(FilesDir(project), CleanName(file)); FileInfo fi = new FileInfo(path); string key = path.ToLowerInvariant() + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
            lock (gate)
            {
                ColDoc d; if (cdocs.TryGetValue(key, out d)) return d;
                d = ColDoc.Load(File.ReadAllBytes(path), file); cdocs.Clear(); cdocs[key] = d; return d;
            }
        }

        static double[] EntityOf(Dictionary<string, object> ent)
        {
            return new double[] { J.D(J.G(ent, "x"), 0), J.D(J.G(ent, "y"), 0), J.D(J.G(ent, "z"), 0), J.D(J.G(ent, "heading"), 0) * Math.PI / 180 };
        }

        // the cutters in world coordinates (the model stands at the entity's position and heading)
        public static List<CutBox> WorldBoxes(object cuttersObj, Dictionary<string, object> origin, Dictionary<string, object> entity)
        {
            double[] e = EntityOf(entity); double c = Math.Cos(e[3]), s = Math.Sin(e[3]); List<CutBox> res = new List<CutBox>();
            foreach (CutBox b in BoxesFrom(cuttersObj, origin))
            {
                CutBox w = new CutBox(); w.Id = b.Id; w.Type = b.Type; w.Hu = b.Hu; w.Hn = b.Hn; w.Hz = b.Hz;
                w.Cx = e[0] + b.Cx * c - b.Cy * s; w.Cy = e[1] + b.Cx * s + b.Cy * c; w.Cz = e[2] + b.Cz; w.Yaw = b.Yaw + e[3]; w.Prepare(); res.Add(w);
            }
            return res;
        }

        static List<string> CollisionFiles(string project)
        {
            List<string> l = new List<string>(); string dir = FilesDir(project); if (Directory.Exists(dir)) foreach (string f in Directory.GetFiles(dir, "*.ybn")) l.Add(Path.GetFileName(f)); return l;
        }

        // polygons the user deleted in the editor: [[file, child, polygon], ...] -> per file name the PolyKeys
        static Dictionary<string, HashSet<long>> ColDeletesFrom(object o)
        {
            Dictionary<string, HashSet<long>> d = new Dictionary<string, HashSet<long>>(StringComparer.OrdinalIgnoreCase);
            foreach (object it in J.A(o))
            {
                List<object> p = J.A(it); if (p.Count < 3) continue; string f = J.S(p[0], ""); if (f.Length == 0) continue;
                HashSet<long> set; if (!d.TryGetValue(f, out set)) { set = new HashSet<long>(); d[f] = set; } set.Add(CollisionCut.PolyKey(J.I(p[1], 0), J.I(p[2], 0)));
            }
            return d;
        }

        // the triangles and boxes of all the collision files around a point, for picking: { files, meta (int32 x 5 per polygon), verts (float32 x 12 per polygon) }
        public static Dictionary<string, object> CollisionPolys(string project, Dictionary<string, object> spec)
        {
            Dictionary<string, object> ent = J.O(J.G(spec, "entity")); Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true;
            if (ent == null) { r["files"] = new List<object>(); r["meta"] = ""; r["verts"] = ""; r["note"] = "Set where the model stands (Import tab) to see the collision."; return r; }
            double[] e = EntityOf(ent), near = new double[] { J.D(J.G(spec, "nx"), 0), J.D(J.G(spec, "ny"), 0) }; double radius = J.D(J.G(spec, "radius"), 45);
            List<int> meta = new List<int>(); List<float> verts = new List<float>(); List<object> names = new List<object>(); List<string> warns = new List<string>();
            foreach (string f in CollisionFiles(project))
            {
                ColDoc cd; try { cd = CDoc(project, f); } catch (Exception ex) { warns.Add(f + ": " + ex.Message); continue; }
                int no = names.Count; names.Add(f); CollisionCut.ListPolys(cd.Doc, no, new double[] { e[0], e[1], e[2] }, e[3], near, radius, meta, verts);
            }
            int[] mi = meta.ToArray(); byte[] mb = new byte[mi.Length * 4]; Buffer.BlockCopy(mi, 0, mb, 0, mb.Length);
            float[] vf = verts.ToArray(); byte[] vb = new byte[vf.Length * 4]; Buffer.BlockCopy(vf, 0, vb, 0, vb.Length);
            r["files"] = names; r["meta"] = Convert.ToBase64String(mb); r["verts"] = Convert.ToBase64String(vb); r["count"] = mi.Length / 5; r["warnings"] = warns; return r;
        }

        // The collision as the export will leave it: every collision file cut like the export cuts it (cutters, room volumes, deleted pieces), then listed like CollisionPolys
        // (meta int32 x 5 per polygon, verts float32 x 12, in the model's own coordinates). The walk check walks a player-sized capsule through it.
        public static Dictionary<string, object> CollisionFinal(string project, Dictionary<string, object> spec)
        {
            Dictionary<string, object> ent = J.O(J.G(spec, "entity")); Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true;
            if (ent == null) { r["files"] = new List<object>(); r["meta"] = ""; r["verts"] = ""; r["note"] = "Set where the model stands (Import tab) first."; return r; }
            double[] e = EntityOf(ent), near = new double[] { J.D(J.G(spec, "nx"), 0), J.D(J.G(spec, "ny"), 0) }; double radius = J.D(J.G(spec, "radius"), 30);
            List<CutBox> boxes = WorldBoxes(J.G(spec, "cutters"), J.O(J.G(spec, "origin")), ent); boxes.AddRange(WorldBoxes(J.G(spec, "roomVolumes"), J.O(J.G(spec, "origin")), ent));
            Dictionary<string, HashSet<long>> dels = ColDeletesFrom(J.G(spec, "colDeletes"));
            List<int> meta = new List<int>(); List<float> verts = new List<float>(); List<object> names = new List<object>(); List<string> warns = new List<string>();
            foreach (string f in CollisionFiles(project))
            {
                ColDoc cd; try { cd = CDoc(project, f); } catch (Exception ex) { warns.Add(f + ": " + ex.Message); continue; }
                HashSet<long> fd; dels.TryGetValue(f, out fd);
                CollisionStats st = new CollisionStats(); System.Xml.XmlDocument cut = (boxes.Count > 0 || fd != null) ? CollisionCut.Cut(cd, boxes, st, fd) : null; warns.AddRange(st.Warnings);
                int no = names.Count; names.Add(f); CollisionCut.ListPolys(cut ?? cd.Doc, no, new double[] { e[0], e[1], e[2] }, e[3], near, radius, meta, verts);
            }
            int[] mi = meta.ToArray(); byte[] mb = new byte[mi.Length * 4]; Buffer.BlockCopy(mi, 0, mb, 0, mb.Length);
            float[] vf = verts.ToArray(); byte[] vb = new byte[vf.Length * 4]; Buffer.BlockCopy(vf, 0, vb, 0, vb.Length);
            r["files"] = names; r["meta"] = Convert.ToBase64String(mb); r["verts"] = Convert.ToBase64String(vb); r["count"] = mi.Length / 5; r["warnings"] = warns; return r;
        }

        // the imported collision as wire-frame lines (model coordinates) after the cutters, around a point
        public static Dictionary<string, object> CollisionPreview(string project, Dictionary<string, object> spec)
        {
            Dictionary<string, object> ent = J.O(J.G(spec, "entity")); Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true;
            if (ent == null) { r["lines"] = ""; r["note"] = "Set where the model stands (Import tab) to see the collision."; return r; }
            List<CutBox> boxes = WorldBoxes(J.G(spec, "cutters"), J.O(J.G(spec, "origin")), ent); boxes.AddRange(WorldBoxes(J.G(spec, "roomVolumes"), J.O(J.G(spec, "origin")), ent)); double[] e = EntityOf(ent);
            double[] near = new double[] { J.D(J.G(spec, "nx"), 0), J.D(J.G(spec, "ny"), 0) }; double radius = J.D(J.G(spec, "radius"), 45);
            List<float> all = new List<float>(), left = new List<float>(); int removed = 0, added = 0, deleted = 0, insideNow = 0, insideBefore = 0; List<string> warns = new List<string>();
            bool wantLines = J.B(J.G(spec, "lines"), true); Dictionary<string, HashSet<long>> dels = ColDeletesFrom(J.G(spec, "colDeletes"));
            // the rooms, to count what is left of the building's collision inside them (whether or not it is being cleared), and to draw it
            List<CutBox> rooms = WorldBoxes(J.G(spec, "countRooms"), J.O(J.G(spec, "origin")), ent); double[] epos = new double[] { e[0], e[1], e[2] };
            foreach (string f in CollisionFiles(project))
            {
                // the three versions of a collision file cover the same walls; one of them is enough to look at (all three are counted)
                bool skipLines = f.StartsWith("ma@", StringComparison.OrdinalIgnoreCase);
                ColDoc cd; try { cd = CDoc(project, f); } catch (Exception ex) { warns.Add(f + ": " + ex.Message); continue; }
                HashSet<long> fd; dels.TryGetValue(f, out fd);
                CollisionStats st = new CollisionStats(); System.Xml.XmlDocument cut = (boxes.Count > 0 || fd != null) ? CollisionCut.Cut(cd, boxes, st, fd) : null;
                removed += st.Removed; added += st.Added; deleted += st.Deleted; warns.AddRange(st.Warnings);
                if (rooms.Count > 0) { insideBefore += CollisionCut.CountInside(cd.Doc, rooms, 0.03, null, epos, e[3]); insideNow += CollisionCut.CountInside(cut ?? cd.Doc, rooms, 0.03, skipLines ? null : left, epos, e[3]); }
                if (wantLines && !skipLines) all.AddRange(CollisionCut.Lines(cut ?? cd.Doc, epos, e[3], near, radius));
            }
            float[] a = all.ToArray(); byte[] b = new byte[a.Length * 4]; Buffer.BlockCopy(a, 0, b, 0, b.Length);
            float[] la = left.ToArray(); byte[] lb = new byte[la.Length * 4]; Buffer.BlockCopy(la, 0, lb, 0, lb.Length);
            r["lines"] = Convert.ToBase64String(b); r["removed"] = removed; r["added"] = added; r["deleted"] = deleted; r["warnings"] = warns;
            r["insideNow"] = insideNow; r["insideBefore"] = insideBefore; r["insideLines"] = Convert.ToBase64String(lb); return r;
        }

        public static void WriteCutCollision(string project, Dictionary<string, object> spec, string streamDir, List<string> log, List<string> files, List<string> warns)
        {
            Dictionary<string, object> ent = J.O(J.G(spec, "entity")); List<string> cf = CollisionFiles(project); if (cf.Count == 0) return;
            if (ent == null) { warns.Add("The collision files were not cut because where the model stands in the game is not set."); return; }
            List<CutBox> boxes = WorldBoxes(J.G(spec, "cutters"), J.O(J.G(spec, "origin")), ent);
            // the rooms: the building's collision inside them is cleared (boxes of the same kind as the cutters, but only for collision)
            List<CutBox> rooms = WorldBoxes(J.G(spec, "roomVolumes"), J.O(J.G(spec, "origin")), ent); boxes.AddRange(rooms);
            Dictionary<string, HashSet<long>> dels = ColDeletesFrom(J.G(spec, "colDeletes")); if (boxes.Count == 0 && dels.Count == 0) return;
            if (rooms.Count > 0) log.Add("collision: " + rooms.Count + " room volume(s) cleared of the building's own collision");
            foreach (string f in cf)
            {
                HashSet<long> fd; dels.TryGetValue(f, out fd);
                ColDoc cd = CDoc(project, f); CollisionStats st = new CollisionStats(); System.Xml.XmlDocument d = (boxes.Count > 0 || fd != null) ? CollisionCut.Cut(cd, boxes, st, fd) : null; warns.AddRange(st.Warnings);
                if (d == null) { log.Add("collision " + f + ": no cutter touches it"); continue; }
                byte[] bytes = XmlYbn.GetYbn(d).Save(); Directory.CreateDirectory(streamDir); File.WriteAllBytes(Path.Combine(streamDir, f), bytes);
                string m = f + ": " + st.Removed + " collision polygons cut away" + (st.Deleted > 0 ? " (" + st.Deleted + " of them deleted one by one)" : "") + ", " + st.Added + " put back around the openings"; log.Add("collision " + m); files.Add("game file replaced: " + m);
            }
        }

        // ---------- collision files in the game ----------
        public static List<object> GameCollision(string project, string target, string gta, Dictionary<string, object> entity)
        {
            Vanilla.Init(gta, cacheDir);
            string stem = Path.GetFileNameWithoutExtension(target).ToLowerInvariant(); string[] parts = stem.Split('_'); string prefix = parts.Length >= 2 ? parts[0] + "_" + parts[1] : stem;
            double[] wmn = null, wmx = null;
            if (entity != null)
            {
                ModelDoc md = Doc(project, target); double[] e = EntityOf(entity); double c = Math.Cos(e[3]), s = Math.Sin(e[3]); wmn = new double[] { 1e30, 1e30 }; wmx = new double[] { -1e30, -1e30 };
                foreach (GeomData g in md.Geoms) if (g.Lod == 0) for (int v = 0; v < g.VertCount; v++)
                    {
                        double x = g.V[v * g.Stride + g.PosOff], y = g.V[v * g.Stride + g.PosOff + 1], wx = e[0] + x * c - y * s, wy = e[1] + x * s + y * c;
                        if (wx < wmn[0]) wmn[0] = wx; if (wx > wmx[0]) wmx[0] = wx; if (wy < wmn[1]) wmn[1] = wy; if (wy > wmx[1]) wmx[1] = wy;
                    }
            }
            List<object> list = new List<object>();
            foreach (string n in Vanilla.Names(".ybn"))
            {
                if (n.IndexOf(prefix, StringComparison.Ordinal) < 0) continue;
                try
                {
                    RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(n, out owner); YbnFile y = new YbnFile(); y.Load(owner.ExtractFile(fe), fe); if (y.Bounds == null) continue;
                    int polys = 0; BoundComposite comp = y.Bounds as BoundComposite; if (comp != null && comp.Children != null) foreach (Bounds ch in comp.Children.data_items) { BoundGeometry bg = ch as BoundGeometry; if (bg != null && bg.Polygons != null) polys += bg.Polygons.Length; }
                    bool overlaps = wmn == null ? true : !(y.Bounds.BoxMax.X < wmn[0] || y.Bounds.BoxMin.X > wmx[0] || y.Bounds.BoxMax.Y < wmn[1] || y.Bounds.BoxMin.Y > wmx[1]);
                    Dictionary<string, object> d = new Dictionary<string, object>(); d["name"] = n; d["polys"] = polys; d["overlaps"] = overlaps; d["known"] = wmn != null;
                    d["bmin"] = new double[] { y.Bounds.BoxMin.X, y.Bounds.BoxMin.Y, y.Bounds.BoxMin.Z }; d["bmax"] = new double[] { y.Bounds.BoxMax.X, y.Bounds.BoxMax.Y, y.Bounds.BoxMax.Z }; list.Add(d);
                }
                catch (Exception) { }
            }
            return list;
        }

        // copies game files into the project as ordinary resource files
        public static List<string> GameAdd(string project, List<string> names, string gta)
        {
            Vanilla.Init(gta, cacheDir); List<string> added = new List<string>(); string dir = FilesDir(project); Directory.CreateDirectory(dir);
            foreach (string n in names)
            {
                RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(n.ToLowerInvariant(), out owner); if (fe == null) continue;
                RpfResourceFileEntry rre = fe as RpfResourceFileEntry; if (rre == null || KindOf(n) == null) continue;
                byte[] data = owner.ExtractFile(fe); byte[] file = ResourceBuilder.AddResourceHeader(rre, ResourceBuilder.Compress(data));
                File.WriteAllBytes(Path.Combine(dir, CleanName(n)), file); added.Add(CleanName(n));
            }
            docs.Clear(); cdocs.Clear(); return added;
        }

        // ---------- occluders ----------
        // world extents of the building (x0, y0, x1, y1), or null when its placement is not known
        static double[] ModelWorldBox(string project, string target, Dictionary<string, object> entity)
        {
            if (entity == null) return null;
            ModelDoc md = Doc(project, target); double[] e = EntityOf(entity), r = new double[] { 1e30, 1e30, -1e30, -1e30 }; double c = Math.Cos(e[3]), s = Math.Sin(e[3]);
            foreach (GeomData g in md.Geoms) if (g.Lod == 0) for (int v = 0; v < g.VertCount; v++)
                {
                    double x = g.V[v * g.Stride + g.PosOff], y = g.V[v * g.Stride + g.PosOff + 1], wx = e[0] + x * c - y * s, wy = e[1] + x * s + y * c;
                    if (wx < r[0]) r[0] = wx; if (wx > r[2]) r[2] = wx; if (wy < r[1]) r[1] = wy; if (wy > r[3]) r[3] = wy;
                }
            return r;
        }

        // occlusion map files of the game with box occluders around the building
        public static List<object> GameOcclusion(string project, string target, string gta, Dictionary<string, object> entity)
        {
            Vanilla.Init(gta, cacheDir); double[] box = ModelWorldBox(project, target, entity); List<object> list = new List<object>();
            foreach (string n in Vanilla.Names(".ymap"))
            {
                if (n.IndexOf("occl", StringComparison.Ordinal) < 0) continue;
                try
                {
                    RpfFile owner; RpfFileEntry fe = Vanilla.GetEntry(n, out owner); YmapFile y = new YmapFile(); y.Load(owner.ExtractFile(fe), fe);
                    if (y.BoxOccluders == null || y.BoxOccluders.Length == 0) continue;
                    int near = 0; foreach (YmapBoxOccluder o in y.BoxOccluders) if (box == null || (o.Position.X >= box[0] - 2 && o.Position.X <= box[2] + 2 && o.Position.Y >= box[1] - 2 && o.Position.Y <= box[3] + 2)) near++;
                    if (box != null && near == 0) continue;
                    Dictionary<string, object> d = new Dictionary<string, object>(); d["name"] = n; d["total"] = y.BoxOccluders.Length; d["near"] = near; d["known"] = box != null; list.Add(d);
                }
                catch (Exception) { }
            }
            return list;
        }

        // ---------- plants ----------
        // Bushes, hedges, trees and weeds are not part of the building model: the game's map files place them as props of their own. The ones around the building
        // (its footprint and 8 m), as {n name, x y z where it stands, cx cy cz its middle, r half its width, h height, lod, files that place it}.
        // (a word of the name, so "street" does not make a tree; the block's grass cards are "fgrass")
        static readonly System.Text.RegularExpressions.Regex PlantName = new System.Text.RegularExpressions.Regex("(^|_)(f?grass|bush|trees?|plants?|hedge|palm|shrub|weed\\w*|flowers?|vine|ivy|veg|foliage|cactus|agave|fern|bamboo|reeds?|moss|cypress|yucca|aloe|oleander|topiary|brush|bramble|thistle|sapling|pine|pot_plant)(_|\\d|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        // spec: entity (where the model stands) and volumes (the rooms as boxes in the model's own coordinates, like the cutters: cx cy zb w h d yaw); each plant comes back
        // with how many of its triangles lie inside a room (tris of all)
        public static List<object> GameProps(string project, string target, string gta, Dictionary<string, object> entity, object volumesObj, bool others, object skipObj, string region)
        {
            Vanilla.Init(gta, cacheDir); double[] box = ModelWorldBox(project, target, entity); List<object> list = new List<object>();
            if (box == null) return list;
            HashSet<string> skipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase); foreach (object so in J.A(skipObj)) { string sn = J.S(so, ""); if (sn.Length > 0) skipNames.Add(Path.GetFileNameWithoutExtension(sn)); }
            double[] e = EntityOf(entity); double ec = Math.Cos(e[3]), es = Math.Sin(e[3]);
            List<double[]> vols = new List<double[]>();
            foreach (object o in J.A(volumesObj))
            {
                Dictionary<string, object> v = J.O(o); if (v == null) continue;
                double cx = J.D(J.G(v, "cx"), 0), cy = J.D(J.G(v, "cy"), 0), zb = J.D(J.G(v, "zb"), 0), w = J.D(J.G(v, "w"), 1), h = J.D(J.G(v, "h"), 2), d = J.D(J.G(v, "d"), 1), yaw = J.D(J.G(v, "yaw"), 0) + e[3];
                vols.Add(new double[] { e[0] + cx * ec - cy * es, e[1] + cx * es + cy * ec, e[2] + zb, e[2] + zb + h, w / 2, d / 2, Math.Cos(yaw), Math.Sin(yaw) });
            }
            // the area: the plants of the whole block (8 m round it) as before; with the props too, only round the rooms (16 m), or there are thousands
            double sx0 = box[0] - 8, sy0 = box[1] - 8, sx1 = box[2] + 8, sy1 = box[3] + 8;
            if (others && vols.Count > 0 && region == "rooms") { sx0 = sy0 = 1e18; sx1 = sy1 = -1e18; foreach (double[] v in vols) { double rr = Math.Sqrt(v[4] * v[4] + v[5] * v[5]); sx0 = Math.Min(sx0, v[0] - rr - 16); sy0 = Math.Min(sy0, v[1] - rr - 16); sx1 = Math.Max(sx1, v[0] + rr + 16); sy1 = Math.Max(sy1, v[1] + rr + 16); } }
            List<PropHit> hits = Vanilla.PropsInBox(sx0, sy0, sx1, sy1, delegate (string n) { return PlantName.IsMatch(n); }, vols, others,
                delegate (string n) { return skipNames.Contains(n) || n.EndsWith("_lod", StringComparison.OrdinalIgnoreCase) || n.StartsWith("hash_", StringComparison.OrdinalIgnoreCase); });
            foreach (PropHit p in hits)
            {
                Dictionary<string, object> d = new Dictionary<string, object>(); d["k"] = p.Kind; d["n"] = p.Name; d["x"] = Math.Round(p.Pos.X, 3); d["y"] = Math.Round(p.Pos.Y, 3); d["z"] = Math.Round(p.Pos.Z, 3);
                d["cx"] = Math.Round(p.Centre.X, 3); d["cy"] = Math.Round(p.Centre.Y, 3); d["cz"] = Math.Round(p.Centre.Z, 3); d["r"] = Math.Round(p.R, 3); d["h"] = Math.Round(p.H, 3); d["sized"] = p.Sized; d["lod"] = p.Lod; d["files"] = p.Files; d["why"] = p.Why;
                d["q"] = new double[] { Math.Round(p.Rot.X, 5), Math.Round(p.Rot.Y, 5), Math.Round(p.Rot.Z, 5), Math.Round(p.Rot.W, 5) }; d["sc"] = new double[] { Math.Round(p.Scale.X, 4), Math.Round(p.Scale.Z, 4) };       // how it is placed: turn and size
                d["tris"] = p.Tris; d["all"] = p.TrisAll; list.Add(d);
            }
            return list;
        }

        // pictures of plant props: { name: { pos, nrm (loose triangles, 3 numbers a vertex), tris (all its triangles), shown (the ones sent) } }
        public static Dictionary<string, object> PropModels(List<string> names, string gta)
        {
            Vanilla.Init(gta, cacheDir); Dictionary<string, object> res = new Dictionary<string, object>();
            foreach (string n in names)
            {
                string nm = CleanName(n); if (nm.Length == 0 || res.ContainsKey(nm)) continue;
                float[][] m = Vanilla.PropMesh(nm, 2500); if (m == null || m[0].Length == 0) continue;
                Dictionary<string, object> d = new Dictionary<string, object>(); d["pos"] = B64(m[0]); d["nrm"] = B64(m[1]); d["tris"] = (int)m[2][0]; d["shown"] = m[0].Length / 9; res[nm] = d;
            }
            return res;
        }

        // removes the box occluders whose centre is inside the interior (spec.rects in the interior's own coordinates, spec.place = where that frame stands in the world)
        public static void WriteCutOccluders(string project, Dictionary<string, object> spec, string streamDir, List<string> log, List<string> files)
        {
            string dir = FilesDir(project); if (!Directory.Exists(dir) || spec == null) return;
            // one set per building: its rooms (rectangles in its own grid) and where its grid stands in the world
            List<Dictionary<string, object>> sets = new List<Dictionary<string, object>>();
            foreach (object so in J.A(J.G(spec, "sets"))) { Dictionary<string, object> sd = J.O(so); if (sd != null) sets.Add(sd); }
            if (sets.Count == 0) sets.Add(spec);
            List<double[]> setPlace = new List<double[]>(); List<List<double[]>> setRects = new List<List<double[]>>();
            foreach (Dictionary<string, object> sd in sets)
            {
                Dictionary<string, object> pl0 = J.O(J.G(sd, "place")); List<double[]> rr0 = new List<double[]>();
                foreach (object ro in J.A(J.G(sd, "rects"))) { List<object> rr = J.A(ro); if (rr.Count >= 4) rr0.Add(new double[] { J.D(rr[0], 0), J.D(rr[1], 0), J.D(rr[2], 0), J.D(rr[3], 0) }); }
                if (pl0 == null || rr0.Count == 0) continue;
                double h0 = J.D(J.G(pl0, "heading"), 0) * Math.PI / 180; setPlace.Add(new double[] { J.D(J.G(pl0, "x"), 0), J.D(J.G(pl0, "y"), 0), Math.Cos(-h0), Math.Sin(-h0) }); setRects.Add(rr0);
            }
            if (setRects.Count == 0) return; double margin = 0.5;
            foreach (string f in Directory.GetFiles(dir, "*.ymap"))
            {
                try
                {
                    YmapFile y = new YmapFile(); y.Load(File.ReadAllBytes(f)); if (y.BoxOccluders == null || y.BoxOccluders.Length == 0) continue;
                    List<YmapBoxOccluder> kill = new List<YmapBoxOccluder>();
                    foreach (YmapBoxOccluder o in y.BoxOccluders)
                    {
                        bool inside = false;
                        for (int si = 0; si < setRects.Count && !inside; si++)
                        {
                            double[] pp = setPlace[si]; double dx = o.Position.X - pp[0], dy = o.Position.Y - pp[1], lx = dx * pp[2] - dy * pp[3], ly = dx * pp[3] + dy * pp[2];
                            foreach (double[] r in setRects[si]) if (lx > r[0] - margin && lx < r[2] + margin && ly > r[1] - margin && ly < r[3] + margin) { inside = true; break; }
                        }
                        if (inside) kill.Add(o);
                    }
                    if (kill.Count == 0) { log.Add("occluders " + Path.GetFileName(f) + ": none inside the interior"); continue; }
                    foreach (YmapBoxOccluder o in kill) y.RemoveBoxOccluder(o);
                    y.Name = Path.GetFileName(f); Directory.CreateDirectory(streamDir); File.WriteAllBytes(Path.Combine(streamDir, Path.GetFileName(f)), y.Save());
                    string m = Path.GetFileName(f) + ": " + kill.Count + " occluder(s) inside the interior removed"; log.Add("occluders " + m); files.Add("game file replaced: " + m);
                }
                catch (Exception ex) { log.Add(Path.GetFileName(f) + ": " + ex.Message); }
            }
        }

        // the model's size, for door models
        public static double[] ModelBounds(string project, string file)
        {
            ModelDoc md = Doc(project, file); double[] b = new double[] { 1e30, 1e30, 1e30, -1e30, -1e30, -1e30 };
            foreach (GeomData g in md.Geoms) if (g.Lod == 0) for (int v = 0; v < g.VertCount; v++) for (int a = 0; a < 3; a++) { double p = g.V[v * g.Stride + g.PosOff + a]; if (p < b[a]) b[a] = p; if (p > b[a + 3]) b[a + 3] = p; }
            return b;
        }

        // export: the detail models (grilles, vents, bushes: other files that go with the building) written with the faces deleted in the editor taken out
        public static void WriteDetailModels(string project, Dictionary<string, object> spec, string streamDir, List<string> log, List<string> files)
        {
            foreach (object oo in J.A(J.G(spec, "others")))
            {
                Dictionary<string, object> d = J.O(oo); if (d == null) continue;
                string file = CleanName(J.S(J.G(d, "file"), "")); HashSet<long> del = DeletesFrom(J.G(d, "deletes")); if (file.Length == 0) continue;
                // (the rooms are in the building's coordinates; a detail file has its own centre, so its own origin says where the rooms are in it)
                Dictionary<string, object> org = J.O(J.G(d, "origin")); if (org == null) org = J.O(J.G(spec, "origin"));
                ClearSpec clear = ClearFrom(J.G(spec, "clear"), org); if (del.Count == 0 && clear == null) continue;
                ModelDoc md = Doc(project, file); List<GeomOut> outs = ModelCut.Apply(md, new List<CutBox>(), del, null, clear); int removed = 0, geoms = 0, empty = 0;
                foreach (GeomOut o in outs) if (o.Changed) { removed += o.Removed; geoms++; if (o.Idx.Length < 3) empty++; }
                if (geoms == 0) continue;                                                            // nothing of this file is in a room: the game's own file stays
                byte[] bytes = md.Save(outs);
                Directory.CreateDirectory(streamDir); File.WriteAllBytes(Path.Combine(streamDir, file), bytes);
                string msg = file + ": " + del.Count + " face(s) deleted and " + removed + " triangle(s) cut in " + geoms + " part(s)" + (clear != null && (clear.Counts[0] + clear.Counts[1] + clear.Counts[2]) > 0 ? ", cleared from the rooms: " + clear.Counts[0] + " window, " + clear.Counts[1] + " vegetation, " + clear.Counts[2] + " other" : "") + (empty > 0 ? " (" + empty + " left empty and taken out)" : "");
                log.Add("detail model " + msg); files.Add("game file replaced: " + msg);
            }
        }

        // export: the cut model written with its original file name
        public static string WriteCutModel(string project, Dictionary<string, object> spec, string streamDir, List<string> log)
        {
            string target = J.S(J.G(spec, "target"), ""); ModelDoc md = Doc(project, target);
            List<CutBox> boxes = BoxesFrom(J.G(spec, "cutters"), J.O(J.G(spec, "origin"))); HashSet<long> del = DeletesFrom(J.G(spec, "deletes"));
            List<FillSpec> fills = FillsFrom(J.G(spec, "fills")); ClearSpec clear = ClearFrom(J.G(spec, "clear"), J.O(J.G(spec, "origin")));
            if (boxes.Count == 0 && del.Count == 0 && fills.Count == 0 && clear == null) return null;
            List<GeomOut> outs = ModelCut.Apply(md, boxes, del, fills, clear); int removed = 0, added = 0, geoms = 0;
            foreach (GeomOut o in outs) if (o.Changed) { removed += o.Removed; added += o.Added; geoms++; }
            byte[] bytes = md.Save(outs);
            Directory.CreateDirectory(streamDir); File.WriteAllBytes(Path.Combine(streamDir, target), bytes);
            string msg = target + ": " + boxes.Count + " cutter(s), " + del.Count + " deleted face(s) and " + fills.Count + " filled hole(s) changed " + geoms + " geometries (" + removed + " triangles replaced by " + added + ")";
            log.Add(msg);
            if (clear != null) log.Add("cleared from the rooms (" + target + "): " + clear.Counts[0] + " window, " + clear.Counts[1] + " vegetation and " + clear.Counts[2] + " other triangles touched");
            return msg;
        }
    }
}
