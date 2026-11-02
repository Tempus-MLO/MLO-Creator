// Reads .glb files (glTF binary) into window and door models: the meshes of each model in the model's own frame (width, depth, up), their materials and textures.
// A file with several windows (one frame node + sashes per window system) is split into one model per window by the names of its top nodes. C# 5.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MloCreator
{
    public class GlbMat
    {
        public string Name = "", Key = ""; public float R = 1, G = 1, B = 1, A = 1; public int Tex = -1; public bool Glass;
        public float AvgR = 1, AvgG = 1, AvgB = 1;          // the colour the material shows on average (the picture's mean times the factor)
    }
    public class GlbTex { public string Name; public int Size; public byte[] Rgba; public bool HasAlpha; }
    public class GlbGeom { public int Mat; public float[] Pos, Nrm, Uv; public int[] Idx; }
    public class GlbModel
    {
        public string Id, Name, Key; public List<GlbGeom> Geoms = new List<GlbGeom>(); public double[] Min = new double[] { 1e9, 1e9, 1e9 }, Max = new double[] { -1e9, -1e9, -1e9 }; public int Tris;
        public double W { get { return Max[0] - Min[0]; } } public double D { get { return Max[1] - Min[1]; } } public double H { get { return Max[2] - Min[2]; } }
        // The thickness of the model's body: where most of its surface lies across the depth (the middle 99% of the area, so a knob or a handle that sticks out does not count), and
        // which side the things that stick out are on (a door's knob is on the side that latches, its hinges on the other). CoreN0..CoreN1 are in the model's own depth (n), Latch = +1 / -1 (+u / -u) or 0.
        public double CoreN0, CoreN1; public int Latch;
        // ---- setting a model up: a turn by quarter turns (a signed permutation of its axes u = width, n = depth, z = up, row major 3x3) ----
        // A model can come out of its file lying down or facing the wrong way; the turn stands it up before it is measured, shown, placed and baked.
        public int[] Rot;                              // the turn that was applied, null = none
        public bool UpsideDown;                         // a frame whose opening is open at the top (it stands on its head)
        public double[] Inner;                         // for a frame: the clear opening in the model's own width and height, u0, u1, z0, z1 (null when the model has no opening in its middle)
        public static readonly int[] Ident = new int[] { 1, 0, 0, 0, 1, 0, 0, 0, 1 };
        public static bool IsIdent(int[] r) { if (r == null || r.Length != 9) return true; for (int i = 0; i < 9; i++) if (r[i] != Ident[i]) return false; return true; }
        public GlbModel Oriented(int[] R)
        {
            GlbModel m = new GlbModel(); m.Id = Id; m.Name = Name; m.Key = Key; m.Tris = Tris; m.Rot = R;
            foreach (GlbGeom g in Geoms)
            {
                GlbGeom o = new GlbGeom(); o.Mat = g.Mat; o.Uv = g.Uv; o.Idx = g.Idx; o.Pos = new float[g.Pos.Length]; o.Nrm = new float[g.Nrm.Length];
                for (int i = 0; i + 2 < g.Pos.Length; i += 3)
                {
                    float x = g.Pos[i], y = g.Pos[i + 1], z = g.Pos[i + 2], nx = g.Nrm[i], ny = g.Nrm[i + 1], nz = g.Nrm[i + 2];
                    for (int a = 0; a < 3; a++)
                    {
                        o.Pos[i + a] = R[a * 3] * x + R[a * 3 + 1] * y + R[a * 3 + 2] * z; o.Nrm[i + a] = R[a * 3] * nx + R[a * 3 + 1] * ny + R[a * 3 + 2] * nz;
                        double v = o.Pos[i + a]; if (v < m.Min[a]) m.Min[a] = v; if (v > m.Max[a]) m.Max[a] = v;
                    }
                }
                m.Geoms.Add(o);
            }
            m.MeasureCore(); m.MeasureInner(); return m;
        }
        // The turn that stands a door or a frame up: its longest side is its height, its thinnest its depth, the other its width (a door or a frame lying on its back, or on its side, comes out upright).
        // Null when it already is. The front / back of the result is a guess; "Flip" in the panel turns it round.
        public static int[] AutoUpright(GlbModel m)
        {
            double[] e = new double[] { m.W, m.D, m.H }; int up = 0, dep = 0; for (int a = 1; a < 3; a++) { if (e[a] > e[up]) up = a; if (e[a] < e[dep]) dep = a; }
            if (up == dep) return null; int wid = 3 - up - dep; if (up == 2 && dep == 1) return null;
            // a model whose sides are nearly equal has no clear up
            double lo = Math.Min(e[0], Math.Min(e[1], e[2])), hi = Math.Max(e[0], Math.Max(e[1], e[2])); if (hi < lo * 1.3) return null;
            int[] r = new int[9]; r[wid] = 1; r[3 + dep] = 1; r[6 + up] = 1;
            int[] p = new int[] { wid, dep, up }; int inv = 0; for (int i = 0; i < 3; i++) for (int j = i + 1; j < 3; j++) if (p[i] > p[j]) inv++;
            if (inv % 2 == 1) r[3 + dep] = -1;                // keep it a turn, not a mirror
            return r;
        }
        // the clear opening of a frame: the front view (width x height) is drawn into a grid, and the empty cells that can be reached from the middle are the opening; it has to be shut in on
        // both sides and at the top (the bottom may be open: a door frame has no sill). A window or a door has nothing there.
        public void MeasureInner()
        {
            Inner = null; double w = W, h = H; if (w < 1e-6 || h < 1e-6 || Geoms.Count == 0) return;
            int N = 240; double cell = Math.Max(w, h) / N; int nu = (int)Math.Ceiling(w / cell), nz = (int)Math.Ceiling(h / cell); if (nu < 6 || nz < 6) return;
            bool[] cov = new bool[nu * nz]; double u0 = Min[0], z0 = Min[2];
            foreach (GlbGeom g in Geoms)
                for (int t = 0; t + 2 < g.Idx.Length; t += 3)
                {
                    double[] px = new double[3], py = new double[3]; for (int k = 0; k < 3; k++) { int vi = g.Idx[t + k] * 3; px[k] = (g.Pos[vi] - u0) / cell; py[k] = (g.Pos[vi + 2] - z0) / cell; }
                    double den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]); if (Math.Abs(den) < 1e-9) continue;
                    int i0 = Math.Max(0, (int)Math.Floor(Math.Min(px[0], Math.Min(px[1], px[2])))), i1 = Math.Min(nu - 1, (int)Math.Ceiling(Math.Max(px[0], Math.Max(px[1], px[2])))), j0 = Math.Max(0, (int)Math.Floor(Math.Min(py[0], Math.Min(py[1], py[2])))), j1 = Math.Min(nz - 1, (int)Math.Ceiling(Math.Max(py[0], Math.Max(py[1], py[2]))));
                    for (int j = j0; j <= j1; j++) for (int i = i0; i <= i1; i++)
                        {
                            double x = i + 0.5, y = j + 0.5, a = ((py[1] - py[2]) * (x - px[2]) + (px[2] - px[1]) * (y - py[2])) / den, b = ((py[2] - py[0]) * (x - px[2]) + (px[0] - px[2]) * (y - py[2])) / den, c = 1 - a - b;
                            if (a >= -1e-6 && b >= -1e-6 && c >= -1e-6) cov[j * nu + i] = true;
                        }
                }
            int ci = nu / 2, cj = nz / 2; if (cov[cj * nu + ci]) return;
            bool[] seen = new bool[nu * nz]; Stack<int> st = new Stack<int>(); st.Push(cj * nu + ci); seen[cj * nu + ci] = true; int imin = ci, imax = ci, jmin = cj, jmax = cj; bool leaks = false, reachTop = false, reachBottom = false;
            while (st.Count > 0)
            {
                int cur = st.Pop(), i = cur % nu, j = cur / nu; if (i < imin) imin = i; if (i > imax) imax = i; if (j < jmin) jmin = j; if (j > jmax) jmax = j;
                if (i == 0 || i == nu - 1) leaks = true; if (j == nz - 1) reachTop = true; if (j == 0) reachBottom = true;
                if (i > 0 && !cov[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = true; st.Push(cur - 1); }
                if (i < nu - 1 && !cov[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = true; st.Push(cur + 1); }
                if (j > 0 && !cov[cur - nu] && !seen[cur - nu]) { seen[cur - nu] = true; st.Push(cur - nu); }
                if (j < nz - 1 && !cov[cur + nu] && !seen[cur + nu]) { seen[cur + nu] = true; st.Push(cur + nu); }
            }
            if (leaks || (reachTop && reachBottom)) return;
            UpsideDown = reachTop;                 // the opening is open at the top and shut at the bottom: the frame stands on its head
            Inner = new double[] { u0 + imin * cell, Math.Min(Max[0], u0 + (imax + 1) * cell), z0 + jmin * cell, Math.Min(Max[2], z0 + (jmax + 1) * cell) };
            // the grid is coarse: each edge moves to the nearest corner of the model within a cell and a half, so the opening is the model's own, not the grid's
            for (int e = 0; e < 4; e++)
            {
                int axis = e < 2 ? 0 : 2; double best = Inner[e], bd = cell * 1.5;
                foreach (GlbGeom g in Geoms) for (int i = 0; i + 2 < g.Pos.Length; i += 3) { double v = g.Pos[i + axis], d = Math.Abs(v - Inner[e]); if (d < bd) { bd = d; best = v; } }
                Inner[e] = best;
            }
        }
        public void MeasureCore()
        {
            List<double[]> pts = new List<double[]>(); double total = 0;
            foreach (GlbGeom g in Geoms)
                for (int t = 0; t + 2 < g.Idx.Length; t += 3)
                {
                    int a = g.Idx[t] * 3, b = g.Idx[t + 1] * 3, c = g.Idx[t + 2] * 3;
                    double ux = g.Pos[b] - g.Pos[a], uy = g.Pos[b + 1] - g.Pos[a + 1], uz = g.Pos[b + 2] - g.Pos[a + 2], vx = g.Pos[c] - g.Pos[a], vy = g.Pos[c + 1] - g.Pos[a + 1], vz = g.Pos[c + 2] - g.Pos[a + 2];
                    double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, area = 0.5 * Math.Sqrt(nx * nx + ny * ny + nz * nz); if (area < 1e-12) continue;
                    foreach (int vi in new int[] { a, b, c }) pts.Add(new double[] { g.Pos[vi + 1], area / 3 });
                    total += area;
                }
            if (pts.Count == 0 || total <= 0) { CoreN0 = Min[1]; CoreN1 = Max[1]; Latch = 0; return; }
            pts.Sort(delegate (double[] p, double[] q) { return p[0].CompareTo(q[0]); });
            double acc = 0, lo = pts[0][0], hi = pts[pts.Count - 1][0]; bool gotLo = false;
            foreach (double[] p in pts) { acc += p[1]; if (!gotLo && acc >= total * 0.005) { lo = p[0]; gotLo = true; } if (acc >= total * 0.995) { hi = p[0]; break; } }
            CoreN0 = lo; CoreN1 = Math.Max(hi, lo + 0.005);
            double mid = (CoreN0 + CoreN1) / 2, half = (CoreN1 - CoreN0) / 2 + 0.006, uc = (Min[0] + Max[0]) / 2, su = 0; int n = 0;
            foreach (GlbGeom g in Geoms)
                for (int t = 0; t + 2 < g.Idx.Length; t += 3)
                {
                    bool out3 = true; double u = 0;
                    for (int k = 0; k < 3; k++) { int vi = g.Idx[t + k] * 3; if (Math.Abs(g.Pos[vi + 1] - mid) <= half) out3 = false; u += g.Pos[vi] / 3; }
                    if (out3) { su += u - uc; n++; }
                }
            Latch = n < 6 ? 0 : (su > 0 ? 1 : -1);
        }
    }

    public partial class GlbFile
    {
        public string FileName, Stem, Title = "", Author = "", License = "", Source = "";
        public List<GlbModel> Models = new List<GlbModel>(); public List<GlbMat> Mats = new List<GlbMat>(); public List<GlbTex> Texs = new List<GlbTex>();
        public string Kind = "window";          // "frame" when the file is one frame, "door" when it is one door, else "window"

        // the model turned by `r` (cached): a model is turned when it lies down or faces the wrong way, see GlbModel.Oriented
        readonly Dictionary<string, GlbModel> orientedCache = new Dictionary<string, GlbModel>();
        public GlbModel OrientedModel(GlbModel gm, int[] r)
        {
            if (GlbModel.IsIdent(r)) return gm; string key = gm.Id + "|" + string.Join(",", Array.ConvertAll<int, string>(r, delegate (int v) { return v.ToString(); }));
            lock (orientedCache) { GlbModel o; if (!orientedCache.TryGetValue(key, out o)) { o = gm.Oriented(r); orientedCache[key] = o; } return o; }
        }
        // The model as it is used: the turn the user chose (setup), else for a door or a frame the turn that stands it up, else none. `used` is the turn that was applied.
        public GlbModel Resolve(GlbModel gm, string kind, int[] setup, out int[] used, out bool auto)
        {
            auto = false; int[] r = (setup != null && setup.Length == 9) ? setup : null;
            if (r == null && (kind == "door" || kind == "frame")) { r = GlbModel.AutoUpright(gm); auto = r != null; }
            GlbModel om = r == null ? gm : OrientedModel(gm, r);
            if (setup == null && kind == "frame" && om.UpsideDown)
            {
                // turned 180 degrees about its width: up becomes down and front becomes back
                int[] cur = r ?? GlbModel.Ident, flip = new int[] { 1, 0, 0, 0, -1, 0, 0, 0, -1 }, m2 = new int[9];
                for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) { int s = 0; for (int k = 0; k < 3; k++) s += flip[i * 3 + k] * cur[k * 3 + j]; m2[i * 3 + j] = s; }
                r = m2; auto = true; om = OrientedModel(gm, r);
            }
            used = r ?? GlbModel.Ident; return om;
        }

        static readonly Dictionary<string, GlbFile> cache = new Dictionary<string, GlbFile>();
        static readonly object gate = new object();
        const int MaxTex = 1024, MaxVerts = 60000;

        public static GlbFile Load(string path)
        {
            FileInfo fi = new FileInfo(path); if (!fi.Exists) throw new Exception("The model file " + Path.GetFileName(path) + " is not in the project.");
            // YTD dependencies may change independently; the direct YDR adapter is read afresh.
            if (Path.GetExtension(path).Equals(".ydr", StringComparison.OrdinalIgnoreCase)) return LoadYdr(path);
            string key = path.ToLowerInvariant() + "|" + fi.Length + "|" + fi.LastWriteTimeUtc.Ticks;
            lock (gate)
            {
                GlbFile f; if (cache.TryGetValue(key, out f)) return f;
                f = Parse(File.ReadAllBytes(path), Path.GetFileName(path));
                List<string> stale = new List<string>(); foreach (string k in cache.Keys) if (k.StartsWith(path.ToLowerInvariant() + "|")) stale.Add(k);
                foreach (string k in stale) cache.Remove(k);
                cache[key] = f; return f;
            }
        }

        // ---------- 4x4 matrices, column major like glTF ----------
        static double[] Ident() { return new double[] { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }; }
        static double[] Mul(double[] a, double[] b)
        {
            double[] r = new double[16];
            for (int c = 0; c < 4; c++) for (int rr = 0; rr < 4; rr++) { double s = 0; for (int k = 0; k < 4; k++) s += a[k * 4 + rr] * b[c * 4 + k]; r[c * 4 + rr] = s; }
            return r;
        }
        static double[] Trs(double[] t, double[] q, double[] s)
        {
            double x = q[0], y = q[1], z = q[2], w = q[3], n = Math.Sqrt(x * x + y * y + z * z + w * w); if (n > 0) { x /= n; y /= n; z /= n; w /= n; } else w = 1;
            double[] m = Ident();
            m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = (2 * (x * y + z * w)) * s[0]; m[2] = (2 * (x * z - y * w)) * s[0];
            m[4] = (2 * (x * y - z * w)) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = (2 * (y * z + x * w)) * s[1];
            m[8] = (2 * (x * z + y * w)) * s[2]; m[9] = (2 * (y * z - x * w)) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
            m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m;
        }
        static double[] Nums(object o, int n, double[] def)
        {
            List<object> l = J.A(o); if (l.Count < n) return def; double[] r = new double[n]; for (int i = 0; i < n; i++) r[i] = J.D(l[i], 0); return r;
        }
        static double[] LocalMatrix(Dictionary<string, object> node)
        {
            double[] m = Nums(J.G(node, "matrix"), 16, null); if (m != null) return m;
            return Trs(Nums(J.G(node, "translation"), 3, new double[] { 0, 0, 0 }), Nums(J.G(node, "rotation"), 4, new double[] { 0, 0, 0, 1 }), Nums(J.G(node, "scale"), 3, new double[] { 1, 1, 1 }));
        }

        // ---------- accessors ----------
        class Bin { public byte[] Data; public int Off, Len; }
        static float[] ReadFloats(Dictionary<string, object> gltf, byte[] bin, int acc, int comps)
        {
            Dictionary<string, object> a = J.O(J.A(J.G(gltf, "accessors"))[acc]); int count = J.I(J.G(a, "count"), 0), ct = J.I(J.G(a, "componentType"), 5126); bool norm = J.B(J.G(a, "normalized"), false);
            float[] outp = new float[count * comps]; if (J.G(a, "bufferView") == null) return outp;
            Dictionary<string, object> bv = J.O(J.A(J.G(gltf, "bufferViews"))[J.I(J.G(a, "bufferView"), 0)]);
            int off = J.I(J.G(bv, "byteOffset"), 0) + J.I(J.G(a, "byteOffset"), 0), csz = (ct == 5126 || ct == 5125) ? 4 : (ct == 5123 || ct == 5122 ? 2 : 1), stride = J.I(J.G(bv, "byteStride"), 0); if (stride == 0) stride = csz * comps;
            for (int i = 0; i < count; i++) for (int c = 0; c < comps; c++)
                {
                    int p = off + i * stride + c * csz; float v;
                    switch (ct)
                    {
                        case 5126: v = BitConverter.ToSingle(bin, p); break;
                        case 5123: v = BitConverter.ToUInt16(bin, p); if (norm) v /= 65535f; break;
                        case 5121: v = bin[p]; if (norm) v /= 255f; break;
                        case 5122: v = BitConverter.ToInt16(bin, p); if (norm) v = Math.Max(v / 32767f, -1f); break;
                        case 5120: v = (sbyte)bin[p]; if (norm) v = Math.Max(v / 127f, -1f); break;
                        default: v = 0; break;
                    }
                    outp[i * comps + c] = v;
                }
            return outp;
        }
        static int[] ReadIndices(Dictionary<string, object> gltf, byte[] bin, int acc)
        {
            Dictionary<string, object> a = J.O(J.A(J.G(gltf, "accessors"))[acc]); int count = J.I(J.G(a, "count"), 0), ct = J.I(J.G(a, "componentType"), 5125);
            int[] r = new int[count]; if (J.G(a, "bufferView") == null) return r;
            Dictionary<string, object> bv = J.O(J.A(J.G(gltf, "bufferViews"))[J.I(J.G(a, "bufferView"), 0)]);
            int off = J.I(J.G(bv, "byteOffset"), 0) + J.I(J.G(a, "byteOffset"), 0), csz = ct == 5125 ? 4 : (ct == 5123 ? 2 : 1), stride = J.I(J.G(bv, "byteStride"), 0); if (stride == 0) stride = csz;
            for (int i = 0; i < count; i++) { int p = off + i * stride; r[i] = ct == 5125 ? (int)BitConverter.ToUInt32(bin, p) : (ct == 5123 ? BitConverter.ToUInt16(bin, p) : bin[p]); }
            return r;
        }

        // ---------- textures: any size in, a square power-of-two picture out (the game and the viewer both want that) ----------
        static int Pot(int v) { int p = 4; while (p < v) p <<= 1; if (p > 4 && (v - (p >> 1)) < (p - v)) p >>= 1; return Math.Min(p, MaxTex); }
        static GlbTex DecodeTexture(byte[] data, string name)
        {
            using (Bitmap src = new Bitmap(new MemoryStream(data)))
            {
                int side = Pot(Math.Max(src.Width, src.Height)); GlbTex t = new GlbTex(); t.Name = name; t.Size = side;
                using (Bitmap dst = new Bitmap(side, side, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(dst))
                    {
                        g.CompositingMode = CompositingMode.SourceCopy; g.InterpolationMode = InterpolationMode.HighQualityBicubic; g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.HighQuality;
                        using (ImageAttributes ia = new ImageAttributes()) { ia.SetWrapMode(WrapMode.TileFlipXY); g.DrawImage(src, new Rectangle(0, 0, side, side), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, ia); }
                    }
                    BitmapData bd = dst.LockBits(new Rectangle(0, 0, side, side), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    byte[] raw = new byte[bd.Stride * side]; System.Runtime.InteropServices.Marshal.Copy(bd.Scan0, raw, 0, raw.Length); dst.UnlockBits(bd);
                    t.Rgba = new byte[side * side * 4];
                    for (int y = 0; y < side; y++) for (int x = 0; x < side; x++)
                        {
                            int s = y * bd.Stride + x * 4, d = (y * side + x) * 4;
                            t.Rgba[d] = raw[s + 2]; t.Rgba[d + 1] = raw[s + 1]; t.Rgba[d + 2] = raw[s]; t.Rgba[d + 3] = raw[s + 3]; if (raw[s + 3] < 250) t.HasAlpha = true;
                        }
                }
                return t;
            }
        }

        // ---------- names ----------
        // "fixed_lattice_frame" -> "fixed_lattice": the parts of one window system are named <window>_<part>
        static readonly Regex PartSuffix = new Regex(@"^(.*?)(_(frame|window\w*|panel\w*|fin\w*|handle|armature|door|sash\w*|leaf\w*|glass\w*))?$", RegexOptions.IgnoreCase);
        static string KeyOf(string nodeName)
        {
            string n = nodeName ?? ""; Match m = PartSuffix.Match(n); string k = m.Success ? m.Groups[1].Value : n; if (k.Length == 0) k = n; return k;
        }
        public static string Pretty(string s)
        {
            s = Regex.Replace(s ?? "", @"[-_ ]*\d+\s*mb\b", "", RegexOptions.IgnoreCase); s = Regex.Replace(s, @"[_\-\.]+", " ").Trim(); s = Regex.Replace(s, @"\s+", " ");
            return s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s.Substring(1).ToLowerInvariant();
        }
        static string SafeId(string s) { string t = Regex.Replace((s ?? "").ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_'); return t.Length == 0 ? "model" : t; }

        // ---------- the file ----------
        static GlbFile Parse(byte[] b, string fileName)
        {
            if (b.Length < 20 || BitConverter.ToUInt32(b, 0) != 0x46546C67) throw new Exception(fileName + " is not a .glb file (binary glTF).");
            int pos = 12; string jsonText = null; byte[] bin = null;
            while (pos + 8 <= b.Length)
            {
                int len = (int)BitConverter.ToUInt32(b, pos), type = (int)BitConverter.ToUInt32(b, pos + 4); pos += 8;
                if (type == 0x4E4F534A) jsonText = Encoding.UTF8.GetString(b, pos, len);
                else if (type == 0x004E4942 && bin == null) { bin = new byte[len]; Buffer.BlockCopy(b, pos, bin, 0, len); }
                pos += len;
            }
            if (jsonText == null) throw new Exception(fileName + " has no glTF data.");
            JavaScriptSerializer js = new JavaScriptSerializer(); js.MaxJsonLength = int.MaxValue; js.RecursionLimit = 400;
            Dictionary<string, object> gltf = js.DeserializeObject(jsonText) as Dictionary<string, object>;
            if (bin == null) bin = new byte[0];
            GlbFile f = new GlbFile(); f.FileName = fileName; f.Stem = Path.GetFileNameWithoutExtension(fileName);
            Dictionary<string, object> ex = J.O(J.G(J.O(J.G(gltf, "asset")), "extras"));
            if (ex != null) { f.Title = J.S(J.G(ex, "title"), ""); f.Author = J.S(J.G(ex, "author"), ""); f.License = J.S(J.G(ex, "license"), ""); f.Source = J.S(J.G(ex, "source"), ""); }

            // textures (images used as a base colour) and materials
            List<object> images = J.A(J.G(gltf, "images")), textures = J.A(J.G(gltf, "textures")), bviews = J.A(J.G(gltf, "bufferViews")), mats = J.A(J.G(gltf, "materials"));
            Dictionary<int, int> texOfImage = new Dictionary<int, int>();
            string fid = SafeId(f.Stem); if (fid.Length > 6) fid = fid.Substring(0, 6);
            uint hv = 2166136261; foreach (char ch in f.Stem.ToLowerInvariant()) hv = (hv ^ ch) * 16777619; string hash = (hv % 0xFFFF).ToString("x");
            for (int mi = 0; mi < Math.Max(1, mats.Count); mi++)
            {
                Dictionary<string, object> md = mi < mats.Count ? J.O(mats[mi]) : null; GlbMat gm = new GlbMat(); gm.Name = J.S(J.G(md, "name"), "material " + mi);
                Dictionary<string, object> pbr = J.O(J.G(md, "pbrMetallicRoughness")); double[] bc = Nums(J.G(pbr, "baseColorFactor"), 4, new double[] { 1, 1, 1, 1 });
                gm.R = (float)bc[0]; gm.G = (float)bc[1]; gm.B = (float)bc[2]; gm.A = (float)bc[3];
                string mode = J.S(J.G(md, "alphaMode"), "OPAQUE");
                gm.Glass = Regex.IsMatch(gm.Name, "glass", RegexOptions.IgnoreCase) || (mode == "BLEND" && gm.A < 0.95f);
                Dictionary<string, object> bct = J.O(J.G(pbr, "baseColorTexture"));
                if (bct != null && !gm.Glass)
                {
                    int ti = J.I(J.G(bct, "index"), -1);
                    if (ti >= 0 && ti < textures.Count)
                    {
                        int si = J.I(J.G(J.O(textures[ti]), "source"), -1);
                        if (si >= 0 && si < images.Count)
                        {
                            int existing;
                            if (!texOfImage.TryGetValue(si, out existing))
                            {
                                Dictionary<string, object> im = J.O(images[si]); int bvi = J.I(J.G(im, "bufferView"), -1);
                                if (bvi >= 0 && bvi < bviews.Count)
                                {
                                    Dictionary<string, object> bv = J.O(bviews[bvi]); int off = J.I(J.G(bv, "byteOffset"), 0), len = J.I(J.G(bv, "byteLength"), 0); byte[] img = new byte[len]; Buffer.BlockCopy(bin, off, img, 0, len);
                                    try { GlbTex t = DecodeTexture(img, "g" + hash + "t" + f.Texs.Count); f.Texs.Add(t); existing = f.Texs.Count - 1; texOfImage[si] = existing; } catch (Exception) { existing = -1; texOfImage[si] = -1; }
                                }
                                else { existing = -1; texOfImage[si] = -1; }
                            }
                            gm.Tex = existing;
                        }
                    }
                }
                // what the material looks like on average (for thumbnails) and its name in the game's texture dictionary
                if (gm.Tex >= 0)
                {
                    GlbTex t = f.Texs[gm.Tex]; double sr = 0, sg = 0, sb = 0; int n = t.Size * t.Size, step = Math.Max(1, n / 4096), cnt = 0;
                    for (int i = 0; i < n; i += step) { sr += t.Rgba[i * 4]; sg += t.Rgba[i * 4 + 1]; sb += t.Rgba[i * 4 + 2]; cnt++; }
                    gm.AvgR = (float)(sr / cnt / 255.0) * gm.R; gm.AvgG = (float)(sg / cnt / 255.0) * gm.G; gm.AvgB = (float)(sb / cnt / 255.0) * gm.B;
                    gm.Key = t.Name;
                }
                else
                {
                    gm.AvgR = gm.R; gm.AvgG = gm.G; gm.AvgB = gm.B;
                    gm.Key = gm.Glass ? "glass" : "c" + ((int)Math.Round(gm.R * 255)).ToString("x2") + ((int)Math.Round(gm.G * 255)).ToString("x2") + ((int)Math.Round(gm.B * 255)).ToString("x2");
                }
                f.Mats.Add(gm);
            }

            // nodes: world matrices, parents
            List<object> nodes = J.A(J.G(gltf, "nodes")), meshes = J.A(J.G(gltf, "meshes"));
            int nn = nodes.Count; double[][] world = new double[nn][]; int[] parent = new int[nn]; for (int i = 0; i < nn; i++) parent[i] = -1;
            for (int i = 0; i < nn; i++) foreach (object c in J.A(J.G(J.O(nodes[i]), "children"))) { int ci = J.I(c, -1); if (ci >= 0 && ci < nn) parent[ci] = i; }
            Func<int, double[]> getWorld = null;
            getWorld = delegate (int i) { if (world[i] != null) return world[i]; double[] lm = LocalMatrix(J.O(nodes[i])); world[i] = parent[i] < 0 ? lm : Mul(getWorld(parent[i]), lm); return world[i]; };

            // the nodes that are windows (or the door): the children of the first node that has several children, going down from the scene root
            List<object> sceneRoots = new List<object>(); List<object> scenes = J.A(J.G(gltf, "scenes"));
            if (scenes.Count > 0) sceneRoots = J.A(J.G(J.O(scenes[Math.Min(scenes.Count - 1, J.I(J.G(gltf, "scene"), 0))]), "nodes")); else for (int i = 0; i < nn; i++) if (parent[i] < 0) sceneRoots.Add(i);
            List<int> units = new List<int>(); List<int> cur = new List<int>(); foreach (object r in sceneRoots) cur.Add(J.I(r, 0));
            for (int guard = 0; guard < 20; guard++)
            {
                List<int> nonEmpty = new List<int>(); foreach (int u in cur) if (HasMesh(nodes, u)) nonEmpty.Add(u);
                if (nonEmpty.Count != 1) { units = nonEmpty; break; }
                Dictionary<string, object> only = J.O(nodes[nonEmpty[0]]); List<object> ch = J.A(J.G(only, "children"));
                if (J.G(only, "mesh") != null || ch.Count == 0) { units = nonEmpty; break; }
                cur = new List<int>(); foreach (object c in ch) cur.Add(J.I(c, 0));
            }
            if (units.Count == 0) throw new Exception(fileName + " has no meshes.");

            // one model per key (the name of the unit with the part word taken off), in file order
            List<string> order = new List<string>(); Dictionary<string, List<int>> byKey = new Dictionary<string, List<int>>();
            foreach (int u in units)
            {
                string nm = J.S(J.G(J.O(nodes[u]), "name"), "node" + u); string key = units.Count == 1 ? f.Stem : KeyOf(nm);
                if (!byKey.ContainsKey(key)) { byKey[key] = new List<int>(); order.Add(key); }
                byKey[key].Add(u);
            }
            foreach (string key in order)
            {
                GlbModel m = new GlbModel(); m.Key = key; m.Id = SafeId(f.Stem) + "/" + SafeId(key);
                m.Name = (order.Count == 1) ? Pretty(f.Title.Length > 0 ? f.Title : f.Stem) : Pretty(key);
                Dictionary<int, List<GlbGeom>> open = new Dictionary<int, List<GlbGeom>>();
                foreach (int u in byKey[key]) AddNode(gltf, nodes, meshes, bin, u, getWorld, m, open);
                // vertex arrays are in glTF axes at this point; turn them into the model's own frame (u = width, n = depth, z = up) and measure
                foreach (GlbGeom g in m.Geoms)
                {
                    for (int i = 0; i + 2 < g.Pos.Length; i += 3)
                    {
                        float gx = g.Pos[i], gy = g.Pos[i + 1], gz = g.Pos[i + 2]; g.Pos[i] = -gx; g.Pos[i + 1] = gz; g.Pos[i + 2] = gy;
                        float nx = g.Nrm[i], ny = g.Nrm[i + 1], nz = g.Nrm[i + 2]; g.Nrm[i] = -nx; g.Nrm[i + 1] = nz; g.Nrm[i + 2] = ny;
                        for (int a = 0; a < 3; a++) { double v = g.Pos[i + a]; if (v < m.Min[a]) m.Min[a] = v; if (v > m.Max[a]) m.Max[a] = v; }
                    }
                    m.Tris += g.Idx.Length / 3;
                }
                if (m.Geoms.Count > 0) { m.MeasureCore(); m.MeasureInner(); f.Models.Add(m); }
            }
            if (f.Models.Count == 0) throw new Exception(fileName + " has no triangles.");
            bool one = f.Models.Count == 1; string nameText = f.Stem + " " + f.Title; f.Kind = one && Regex.IsMatch(nameText, "frame|casing|jamb", RegexOptions.IgnoreCase) ? "frame" : (one && Regex.IsMatch(nameText, "door", RegexOptions.IgnoreCase) ? "door" : "window");
            return f;
        }

        static bool HasMesh(List<object> nodes, int i)
        {
            Dictionary<string, object> n = J.O(nodes[i]); if (J.G(n, "mesh") != null) return true;
            foreach (object c in J.A(J.G(n, "children"))) if (HasMesh(nodes, J.I(c, 0))) return true;
            return false;
        }

        // adds the meshes of a node and everything below it (world transform applied; still in glTF axes)
        static void AddNode(Dictionary<string, object> gltf, List<object> nodes, List<object> meshes, byte[] bin, int ni, Func<int, double[]> getWorld, GlbModel m, Dictionary<int, List<GlbGeom>> open)
        {
            Dictionary<string, object> n = J.O(nodes[ni]);
            if (J.G(n, "mesh") != null)
            {
                double[] W = getWorld(ni); int mesh = J.I(J.G(n, "mesh"), 0); if (mesh < 0 || mesh >= meshes.Count) mesh = -1;
                if (mesh >= 0)
                {
                    // inverse transpose of the upper 3x3 for the normals; a mirrored node (negative determinant) turns the triangles round
                    double a = W[0], b = W[4], c = W[8], d = W[1], e = W[5], f2 = W[9], g = W[2], h = W[6], i2 = W[10];
                    double det = a * (e * i2 - f2 * h) - b * (d * i2 - f2 * g) + c * (d * h - e * g); bool flip = det < 0;
                    double[] nm = det == 0 ? new double[] { 1, 0, 0, 0, 1, 0, 0, 0, 1 } : new double[] {
                        (e * i2 - f2 * h) / det, (f2 * g - d * i2) / det, (d * h - e * g) / det,
                        (c * h - b * i2) / det, (a * i2 - c * g) / det, (b * g - a * h) / det,
                        (b * f2 - c * e) / det, (c * d - a * f2) / det, (a * e - b * d) / det };
                    // nm = the inverse transpose of the upper 3x3, row major: a normal goes through it as nm * n
                    foreach (object po in J.A(J.G(J.O(meshes[mesh]), "primitives")))
                    {
                        Dictionary<string, object> prim = J.O(po); int pm = J.I(J.G(prim, "mode"), 4); if (pm != 4 && pm != 5 && pm != 6) continue;
                        Dictionary<string, object> at = J.O(J.G(prim, "attributes")); if (at == null || J.G(at, "POSITION") == null) continue;
                        float[] P = ReadFloats(gltf, bin, J.I(J.G(at, "POSITION"), 0), 3); int nv = P.Length / 3; if (nv == 0) continue;
                        float[] N = J.G(at, "NORMAL") != null ? ReadFloats(gltf, bin, J.I(J.G(at, "NORMAL"), 0), 3) : null;
                        float[] U = J.G(at, "TEXCOORD_0") != null ? ReadFloats(gltf, bin, J.I(J.G(at, "TEXCOORD_0"), 0), 2) : new float[nv * 2];
                        int[] raw = J.G(prim, "indices") != null ? ReadIndices(gltf, bin, J.I(J.G(prim, "indices"), 0)) : null;
                        if (raw == null) { raw = new int[nv]; for (int i = 0; i < nv; i++) raw[i] = i; }
                        List<int> tri = new List<int>();
                        if (pm == 4) for (int i = 0; i + 2 < raw.Length; i += 3) { tri.Add(raw[i]); tri.Add(raw[i + 1]); tri.Add(raw[i + 2]); }
                        else if (pm == 5) for (int i = 0; i + 2 < raw.Length; i++) { if ((i & 1) == 0) { tri.Add(raw[i]); tri.Add(raw[i + 1]); tri.Add(raw[i + 2]); } else { tri.Add(raw[i + 1]); tri.Add(raw[i]); tri.Add(raw[i + 2]); } }
                        else for (int i = 1; i + 1 < raw.Length; i++) { tri.Add(raw[0]); tri.Add(raw[i]); tri.Add(raw[i + 1]); }
                        if (flip) for (int i = 0; i + 2 < tri.Count; i += 3) { int t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; }
                        // vertices to world space
                        float[] WP = new float[nv * 3], WN = new float[nv * 3];
                        for (int i = 0; i < nv; i++)
                        {
                            double x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
                            WP[i * 3] = (float)(W[0] * x + W[4] * y + W[8] * z + W[12]); WP[i * 3 + 1] = (float)(W[1] * x + W[5] * y + W[9] * z + W[13]); WP[i * 3 + 2] = (float)(W[2] * x + W[6] * y + W[10] * z + W[14]);
                        }
                        if (N != null)
                        {
                            for (int i = 0; i < nv; i++)
                            {
                                double x = N[i * 3], y = N[i * 3 + 1], z = N[i * 3 + 2];
                                // inverse transpose: the rows of the inverse matrix are the columns of its transpose
                                double wx = nm[0] * x + nm[1] * y + nm[2] * z, wy = nm[3] * x + nm[4] * y + nm[5] * z, wz = nm[6] * x + nm[7] * y + nm[8] * z; double l = Math.Sqrt(wx * wx + wy * wy + wz * wz); if (l < 1e-12) { wx = 0; wy = 1; wz = 0; l = 1; }
                                WN[i * 3] = (float)(wx / l); WN[i * 3 + 1] = (float)(wy / l); WN[i * 3 + 2] = (float)(wz / l);
                            }
                        }
                        else
                        {
                            for (int t = 0; t + 2 < tri.Count; t += 3)
                            {
                                int i0 = tri[t], i1 = tri[t + 1], i2b = tri[t + 2];
                                double ux = WP[i1 * 3] - WP[i0 * 3], uy = WP[i1 * 3 + 1] - WP[i0 * 3 + 1], uz = WP[i1 * 3 + 2] - WP[i0 * 3 + 2], vx = WP[i2b * 3] - WP[i0 * 3], vy = WP[i2b * 3 + 1] - WP[i0 * 3 + 1], vz = WP[i2b * 3 + 2] - WP[i0 * 3 + 2];
                                double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                                foreach (int vi in new int[] { i0, i1, i2b }) { WN[vi * 3] += (float)nx; WN[vi * 3 + 1] += (float)ny; WN[vi * 3 + 2] += (float)nz; }
                            }
                            for (int i = 0; i < nv; i++) { double l = Math.Sqrt(WN[i * 3] * WN[i * 3] + WN[i * 3 + 1] * WN[i * 3 + 1] + WN[i * 3 + 2] * WN[i * 3 + 2]); if (l < 1e-12) { WN[i * 3 + 1] = 1; } else { WN[i * 3] = (float)(WN[i * 3] / l); WN[i * 3 + 1] = (float)(WN[i * 3 + 1] / l); WN[i * 3 + 2] = (float)(WN[i * 3 + 2] / l); } }
                        }
                        int matIdx = J.I(J.G(prim, "material"), 0); if (matIdx < 0) matIdx = 0;
                        // append to the open geometry of this material (a new one when it would pass the vertex limit)
                        List<GlbGeom> lst; if (!open.TryGetValue(matIdx, out lst)) { lst = new List<GlbGeom>(); open[matIdx] = lst; }
                        GlbGeom cg = lst.Count > 0 ? lst[lst.Count - 1] : null;
                        if (cg == null || cg.Pos.Length / 3 + nv > MaxVerts)
                        {
                            cg = new GlbGeom(); cg.Mat = matIdx; cg.Pos = new float[0]; cg.Nrm = new float[0]; cg.Uv = new float[0]; cg.Idx = new int[0]; lst.Add(cg); m.Geoms.Add(cg);
                        }
                        int baseV = cg.Pos.Length / 3;
                        float[] np = new float[cg.Pos.Length + WP.Length]; Buffer.BlockCopy(cg.Pos, 0, np, 0, cg.Pos.Length * 4); Buffer.BlockCopy(WP, 0, np, cg.Pos.Length * 4, WP.Length * 4); cg.Pos = np;
                        float[] nn2 = new float[cg.Nrm.Length + WN.Length]; Buffer.BlockCopy(cg.Nrm, 0, nn2, 0, cg.Nrm.Length * 4); Buffer.BlockCopy(WN, 0, nn2, cg.Nrm.Length * 4, WN.Length * 4); cg.Nrm = nn2;
                        float[] nu = new float[cg.Uv.Length + U.Length]; Buffer.BlockCopy(cg.Uv, 0, nu, 0, cg.Uv.Length * 4); Buffer.BlockCopy(U, 0, nu, cg.Uv.Length * 4, U.Length * 4); cg.Uv = nu;
                        int[] ni2 = new int[cg.Idx.Length + tri.Count]; Buffer.BlockCopy(cg.Idx, 0, ni2, 0, cg.Idx.Length * 4); for (int i = 0; i < tri.Count; i++) ni2[cg.Idx.Length + i] = tri[i] + baseV; cg.Idx = ni2;
                    }
                }
            }
            foreach (object c in J.A(J.G(n, "children"))) AddNode(gltf, nodes, meshes, bin, J.I(c, 0), getWorld, m, open);
        }
    }
}
