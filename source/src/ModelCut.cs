// Reads a drawable (.ydr) through CodeWalker's XML export, cuts triangles out of it with oriented boxes (a boolean difference like in Blender,
// the triangles that cross the box are split along its faces) and deleted faces, and writes it back as a .ydr. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public class GeomData
    {
        public int Lod, Model, Index, Shader, Bucket; public XmlNode Node;
        public string[] Comps; public int[] Sizes; public bool[] IsInt;
        public int Stride, PosOff = -1, NrmOff = -1, UvOff = -1, TanOff = -1;
        public float[] V; public int[] Idx; public string Tex = "", ShaderName = "";
        public string VText, IText;                     // the XML text as loaded, put back for geometries nobody changed
        public int VertCount { get { return Stride == 0 ? 0 : V.Length / Stride; } }
    }

    public class GeomOut { public GeomData Src; public float[] V; public int[] Idx; public int[] TriSrc; public bool Changed; public int Removed, Added; }   // TriSrc: the original triangle each output triangle comes from

    // faces added to one geometry (a hole filled in the editor's Edges tool): points in the model's own coordinates and triangles over them.
    // Every point becomes a vertex of the geometry: an existing vertex when one lies there, otherwise a copy of the nearest vertex with the new position,
    // so the fill takes its normals and texture coordinates from the wall around it. Src: an original triangle next to the hole (which building it belongs to).
    public class FillSpec { public int Geom, Src; public double[][] Pts; public int[][] Tris; }

    // "Clear from the rooms": parts of a model that are inside the rooms are cut away. The room boxes only act on the parts of a kind that is switched on (windows,
    // vegetation, everything else) and that are not in Skip ("file|geometry number"). Counts = triangles of the original touched, per kind (windows, vegetation, other).
    public class ClearSpec
    {
        public List<CutBox> Boxes = new List<CutBox>(); public bool Win = true, Veg = true, Other = true; public HashSet<string> Skip = new HashSet<string>(); public int[] Counts = new int[3];
        public List<CutBox> WinBoxes;                         // the rooms as they act on windows (smaller: a window's frame may reach further into the room); null: the same as Boxes
        public List<CutBox> For(int kind) { return kind == 0 && WinBoxes != null && WinBoxes.Count > 0 ? WinBoxes : Boxes; }
        static readonly System.Text.RegularExpressions.Regex WinRx = new System.Text.RegularExpressions.Regex("(?<![a-z])(window|glass)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        static readonly System.Text.RegularExpressions.Regex VegRx = new System.Text.RegularExpressions.Regex("(?<![a-z])(crop|weed|bush|hedge|tree|grass|plant|leaf|leaves|foliage|shrub|vine|ivy|flower|palm|fern|veg|moss|cactus)", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        // what a part is, from its texture and shader names: 0 windows, 1 vegetation, 2 everything else (the editor has the same rule)
        public static int KindOf(string tex, string shader)
        {
            string s = (tex ?? "") + " " + (shader ?? "");
            if (WinRx.IsMatch(s)) return 0; if (VegRx.IsMatch(s)) return 1; return 2;
        }
        public bool Wants(string file, int geomNo, GeomData g)
        {
            if (Boxes.Count == 0 || Skip.Contains(file + "|" + geomNo)) return false;
            int k = KindOf(g.Tex, g.ShaderName); return k == 0 ? Win : (k == 1 ? Veg : Other);
        }
        public List<CutBox> BoxesFor(GeomData g) { return For(KindOf(g.Tex, g.ShaderName));
        }
    }

    // an oriented box: centre, rotation about Z, half sizes along its width (u), depth (n) and height (z)
    public class CutBox
    {
        public string Id = "", Type = "";
        public bool NoMesh;                                   // opens the collision only: the model is changed by deleted faces instead
        public bool Skin;                                     // a room that clears parts of the model: faces that look out of it through a wall (or up through the ceiling) close to that wall are the building's outside surface and stay
        public const double SkinDepth = 0.15;
        public double Cx, Cy, Cz, Yaw, Hu, Hn, Hz;
        public double[] Mn = new double[3], Mx = new double[3];
        public double[][] Nrm = new double[6][]; public double[] Off = new double[6];
        public int Removed;
        public void Prepare()
        {
            double ux = Math.Cos(Yaw), uy = Math.Sin(Yaw), nx = -Math.Sin(Yaw), ny = Math.Cos(Yaw);
            double[][] ax = new double[][] { new double[] { ux, uy, 0 }, new double[] { -ux, -uy, 0 }, new double[] { nx, ny, 0 }, new double[] { -nx, -ny, 0 }, new double[] { 0, 0, 1 }, new double[] { 0, 0, -1 } };
            double[] hs = new double[] { Hu, Hu, Hn, Hn, Hz, Hz };
            for (int k = 0; k < 6; k++) { Nrm[k] = ax[k]; Off[k] = ax[k][0] * Cx + ax[k][1] * Cy + ax[k][2] * Cz + hs[k]; }
            for (int a = 0; a < 3; a++) { Mn[a] = 1e30; Mx[a] = -1e30; }
            for (int i = 0; i < 8; i++)
            {
                double su = (i & 1) == 0 ? Hu : -Hu, sn = (i & 2) == 0 ? Hn : -Hn, sz = (i & 4) == 0 ? Hz : -Hz;
                double[] p = new double[] { Cx + su * ux + sn * nx, Cy + su * uy + sn * ny, Cz + sz };
                for (int a = 0; a < 3; a++) { if (p[a] < Mn[a]) Mn[a] = p[a]; if (p[a] > Mx[a]) Mx[a] = p[a]; }
            }
        }
    }

    public class ModelDoc
    {
        public string Name, TexDir; public XmlDocument Doc; public List<GeomData> Geoms = new List<GeomData>();
        public List<string> ShaderNames = new List<string>(); public List<string> ShaderTex = new List<string>(); public List<int> ShaderBucket = new List<int>();
        static readonly char[] WS = new char[] { ' ', '\t', '\r', '\n' };

        static void CompInfo(string name, out int size, out bool isInt)
        {
            isInt = false;
            if (name == "Position" || name == "Normal") { size = 3; return; }
            if (name.StartsWith("TexCoord")) { size = 2; return; }
            if (name == "Colour0" || name == "Colour1") { size = 4; isInt = true; return; }
            if (name == "Tangent" || name == "Binormal" || name == "BlendWeights") { size = 4; return; }
            if (name == "BlendIndices") { size = 4; isInt = true; return; }
            throw new Exception("The model uses a vertex component this program cannot cut (" + name + ").");
        }

        public static ModelDoc Load(byte[] ydrBytes, string texDir, string name)
        {
            YdrFile y = new YdrFile(); y.Load(ydrBytes);
            return Load(y, texDir, name);
        }
        public static ModelDoc Load(YdrFile y, string texDir, string name)
        {
            ModelDoc md = new ModelDoc(); md.Name = name; md.TexDir = texDir; if (texDir != null) Directory.CreateDirectory(texDir);
            if (y.Drawable == null) throw new Exception(name + " is not a model file the program can read.");
            string fn; string xml = MetaXml.GetXml(y, out fn, texDir);
            md.Doc = new XmlDocument(); md.Doc.LoadXml(xml);
            foreach (XmlNode sh in md.Doc.SelectNodes("/Drawable/ShaderGroup/Shaders/Item"))
            {
                XmlNode n = sh.SelectSingleNode("Name"), rb = sh.SelectSingleNode("RenderBucket"), df = sh.SelectSingleNode("Parameters/Item[@name='DiffuseSampler']/Name");
                if (df == null) df = sh.SelectSingleNode("Parameters/Item[@type='Texture']/Name");
                md.ShaderNames.Add(n == null ? "" : n.InnerText); md.ShaderTex.Add(df == null ? "" : df.InnerText.Trim());
                int b = 0; if (rb != null && rb.Attributes["value"] != null) int.TryParse(rb.Attributes["value"].Value, out b); md.ShaderBucket.Add(b);
            }
            XmlNodeList lods = md.Doc.SelectNodes("/Drawable/*");
            foreach (XmlNode ln in lods)
            {
                int lod = ln.Name == "DrawableModelsHigh" ? 0 : (ln.Name == "DrawableModelsMed" || ln.Name == "DrawableModelsMedium" ? 1 : (ln.Name == "DrawableModelsLow" ? 2 : (ln.Name == "DrawableModelsVeryLow" || ln.Name == "DrawableModelsVlow" ? 3 : -1)));
                if (lod < 0) continue;
                int mi = 0;
                foreach (XmlNode mdl in ln.SelectNodes("Item"))
                {
                    int gi = 0;
                    foreach (XmlNode gn in mdl.SelectNodes("Geometries/Item"))
                    {
                        GeomData g = new GeomData(); g.Lod = lod; g.Model = mi; g.Index = gi; g.Node = gn;
                        XmlNode si = gn.SelectSingleNode("ShaderIndex"); g.Shader = si != null ? int.Parse(si.Attributes["value"].Value, CultureInfo.InvariantCulture) : 0;
                        if (g.Shader >= 0 && g.Shader < md.ShaderNames.Count) { g.ShaderName = md.ShaderNames[g.Shader]; g.Tex = md.ShaderTex[g.Shader]; g.Bucket = md.ShaderBucket[g.Shader]; }
                        XmlNode lay = gn.SelectSingleNode("VertexBuffer/Layout"); XmlNode data = gn.SelectSingleNode("VertexBuffer/Data"), idx = gn.SelectSingleNode("IndexBuffer/Data");
                        if (lay == null || data == null || idx == null) { gi++; continue; }
                        List<string> comps = new List<string>(); List<int> sizes = new List<int>(); List<bool> ints = new List<bool>(); int stride = 0;
                        foreach (XmlNode c in lay.ChildNodes)
                        {
                            if (c.NodeType != XmlNodeType.Element) continue;
                            int sz; bool ii; CompInfo(c.Name, out sz, out ii); comps.Add(c.Name); sizes.Add(sz); ints.Add(ii);
                            if (c.Name == "Position") g.PosOff = stride; else if (c.Name == "Normal") g.NrmOff = stride; else if (c.Name == "TexCoord0") g.UvOff = stride; else if (c.Name == "Tangent") g.TanOff = stride;
                            stride += sz;
                        }
                        g.Comps = comps.ToArray(); g.Sizes = sizes.ToArray(); g.IsInt = ints.ToArray(); g.Stride = stride;
                        g.VText = data.InnerText; g.IText = idx.InnerText;
                        string[] tok = data.InnerText.Split(WS, StringSplitOptions.RemoveEmptyEntries);
                        if (stride == 0 || tok.Length % stride != 0 || g.PosOff < 0) throw new Exception("Geometry " + gi + " has a vertex layout the program cannot read.");
                        g.V = new float[tok.Length]; for (int i = 0; i < tok.Length; i++) g.V[i] = float.Parse(tok[i], CultureInfo.InvariantCulture);
                        string[] it = idx.InnerText.Split(WS, StringSplitOptions.RemoveEmptyEntries);
                        g.Idx = new int[it.Length - it.Length % 3]; for (int i = 0; i < g.Idx.Length; i++) g.Idx[i] = int.Parse(it[i], CultureInfo.InvariantCulture);
                        md.Geoms.Add(g); gi++;
                    }
                    mi++;
                }
            }
            return md;
        }

        static string FloatText(float v) { return v.ToString("R", CultureInfo.InvariantCulture); }

        // writes the cut geometry back into the XML and builds the .ydr
        public byte[] Save(List<GeomOut> outs)
        {
            // A geometry with no faces left is taken out of the file (an empty index buffer is not safe in the game). When that would leave a level of detail
            // with no geometry at all, one geometry stays with a single degenerate triangle. The cached document is put back as it was afterwards.
            List<GeomOut> empty = new List<GeomOut>(); foreach (GeomOut o in outs) if (o.Changed && (o.Idx == null || o.Idx.Length < 3)) empty.Add(o);
            List<XmlNode[]> removed = new List<XmlNode[]>(); List<XmlNode> stubs = new List<XmlNode>();
            Dictionary<XmlNode, List<GeomOut>> byLod = new Dictionary<XmlNode, List<GeomOut>>();
            foreach (GeomOut o in empty) { XmlNode lodNode = o.Src.Node.ParentNode.ParentNode.ParentNode; List<GeomOut> l; if (!byLod.TryGetValue(lodNode, out l)) { l = new List<GeomOut>(); byLod[lodNode] = l; } l.Add(o); }
            foreach (KeyValuePair<XmlNode, List<GeomOut>> kv in byLod)
            {
                int total = kv.Key.SelectNodes("Item/Geometries/Item").Count, keep = (total - kv.Value.Count <= 0) ? 0 : -1;
                for (int i = 0; i < kv.Value.Count; i++)
                {
                    XmlNode gn = kv.Value[i].Src.Node;
                    if (i == keep) { stubs.Add(gn); continue; }
                    XmlNode geoms = gn.ParentNode, model = geoms.ParentNode; removed.Add(new XmlNode[] { geoms, gn, gn.NextSibling });
                    geoms.RemoveChild(gn);
                    if (geoms.SelectNodes("Item").Count == 0 && model.ParentNode != null && model.ParentNode.SelectNodes("Item").Count > 1) { removed.Add(new XmlNode[] { model.ParentNode, model, model.NextSibling }); model.ParentNode.RemoveChild(model); }
                }
            }
            try { return SaveInner(outs, empty, stubs); }
            finally
            {
                for (int i = removed.Count - 1; i >= 0; i--) { XmlNode[] r = removed[i]; if (r[2] != null && r[2].ParentNode == r[0]) r[0].InsertBefore(r[1], r[2]); else r[0].AppendChild(r[1]); }
            }
        }

        byte[] SaveInner(List<GeomOut> outs, List<GeomOut> empty, List<XmlNode> stubs)
        {
            foreach (GeomOut o in outs)
            {
                if (empty.Contains(o))
                {
                    if (stubs.Contains(o.Src.Node) && o.Src.VText != null) { o.Src.Node.SelectSingleNode("VertexBuffer/Data").InnerText = o.Src.VText; o.Src.Node.SelectSingleNode("IndexBuffer/Data").InnerText = "0 0 0"; }
                    continue;
                }
                if (!o.Changed)
                {
                    if (o.Src.VText != null) { o.Src.Node.SelectSingleNode("VertexBuffer/Data").InnerText = o.Src.VText; o.Src.Node.SelectSingleNode("IndexBuffer/Data").InnerText = o.Src.IText; }
                    continue;
                }
                GeomData g = o.Src; int S = g.Stride, nv = o.V.Length / S;
                StringBuilder sb = new StringBuilder("\n");
                for (int v = 0; v < nv; v++)
                {
                    sb.Append("       "); int k = 0;
                    for (int c = 0; c < g.Comps.Length; c++)
                    {
                        if (c > 0) sb.Append("   ");
                        for (int j = 0; j < g.Sizes[c]; j++, k++)
                        {
                            if (j > 0) sb.Append(' ');
                            float f = o.V[v * S + k];
                            if (g.IsInt[c]) sb.Append(((int)Math.Round(f)).ToString(CultureInfo.InvariantCulture)); else sb.Append(FloatText(f));
                        }
                    }
                    sb.Append('\n');
                }
                sb.Append("      ");
                g.Node.SelectSingleNode("VertexBuffer/Data").InnerText = sb.ToString();
                StringBuilder ib = new StringBuilder();
                for (int i = 0; i < o.Idx.Length; i++) { if (i > 0) ib.Append(' '); ib.Append(o.Idx[i].ToString(CultureInfo.InvariantCulture)); }
                g.Node.SelectSingleNode("IndexBuffer/Data").InnerText = ib.ToString();
            }
            YdrFile y = XmlYdr.GetYdr(Doc, TexDir);
            return y.Save();
        }
    }

    public static class ModelCut
    {
        struct PV { public double W0, W1, W2, X, Y, Z; }
        const double EPS = 1e-7;

        static PV Lerp(PV a, PV b, double t)
        {
            PV r; r.W0 = a.W0 + (b.W0 - a.W0) * t; r.W1 = a.W1 + (b.W1 - a.W1) * t; r.W2 = a.W2 + (b.W2 - a.W2) * t;
            r.X = a.X + (b.X - a.X) * t; r.Y = a.Y + (b.Y - a.Y) * t; r.Z = a.Z + (b.Z - a.Z) * t; return r;
        }

        // splits a convex polygon by a plane; `pos` gets the part with dist > 0, `neg` the part with dist <= 0
        static void Split(List<PV> poly, double nx, double ny, double nz, double off, List<PV> pos, List<PV> neg)
        {
            int n = poly.Count;
            double[] d = new double[n]; int[] s = new int[n];
            for (int i = 0; i < n; i++) { d[i] = nx * poly[i].X + ny * poly[i].Y + nz * poly[i].Z - off; s[i] = d[i] > EPS ? 1 : (d[i] < -EPS ? -1 : 0); }
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                if (s[i] >= 0) pos.Add(poly[i]);
                if (s[i] <= 0) neg.Add(poly[i]);
                if (s[i] * s[j] == -1) { PV m = Lerp(poly[i], poly[j], d[i] / (d[i] - d[j])); pos.Add(m); neg.Add(m); }
            }
        }

        static double Area(List<PV> p)
        {
            double a = 0; for (int i = 1; i + 1 < p.Count; i++)
            {
                double ux = p[i].X - p[0].X, uy = p[i].Y - p[0].Y, uz = p[i].Z - p[0].Z, vx = p[i + 1].X - p[0].X, vy = p[i + 1].Y - p[0].Y, vz = p[i + 1].Z - p[0].Z;
                double cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; a += 0.5 * Math.Sqrt(cx * cx + cy * cy + cz * cz);
            }
            return a;
        }

        // the part of a polygon that is outside the box, as convex pieces
        static void ClipOutside(List<PV> poly, CutBox b, List<List<PV>> keep)
        {
            List<PV> cur = poly;
            for (int k = 0; k < 6; k++)
            {
                List<PV> pos = new List<PV>(), neg = new List<PV>();
                Split(cur, b.Nrm[k][0], b.Nrm[k][1], b.Nrm[k][2], b.Off[k], pos, neg);
                if (pos.Count >= 3 && Area(pos) > 1e-9) keep.Add(pos);
                if (neg.Count < 3) return;
                cur = neg;
            }
            // what is left is inside the box and is dropped
        }

        public static long Key(int geom, int tri) { return ((long)geom << 32) | (uint)tri; }

        // a convex polygon (as 3D points) with the parts inside the boxes cut away; touched = something was cut
        public static List<double[][]> ClipPolygon(double[][] pts, List<CutBox> boxes, out bool touched)
        {
            touched = false; List<PV> poly = new List<PV>();
            foreach (double[] p in pts) { PV v = new PV(); v.X = p[0]; v.Y = p[1]; v.Z = p[2]; poly.Add(v); }
            List<List<PV>> pieces = new List<List<PV>>(); pieces.Add(poly);
            foreach (CutBox bx in boxes)
            {
                List<List<PV>> next = new List<List<PV>>();
                foreach (List<PV> pc in pieces)
                {
                    bool clear = false;
                    for (int k = 0; k < 6 && !clear; k++) { bool all = true; foreach (PV p in pc) if (bx.Nrm[k][0] * p.X + bx.Nrm[k][1] * p.Y + bx.Nrm[k][2] * p.Z - bx.Off[k] <= EPS) { all = false; break; } if (all) clear = true; }
                    if (clear) { next.Add(pc); continue; }
                    touched = true; ClipOutside(pc, bx, next);
                }
                pieces = next; if (pieces.Count == 0) break;
            }
            List<double[][]> res = new List<double[][]>();
            foreach (List<PV> pc in pieces) { double[][] a = new double[pc.Count][]; for (int i = 0; i < pc.Count; i++) a[i] = new double[] { pc[i].X, pc[i].Y, pc[i].Z }; res.Add(a); }
            return res;
        }

        // true when the triangle is the outside surface of a room's wall (or roof): it looks out of the room through one of the 4 sides or the top, and all of it lies within SkinDepth of that side
        static bool IsSkin(CutBox b, double[] p0, double[] p1, double[] p2)
        {
            double ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
            double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.Sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-12) return false; nx /= l; ny /= l; nz /= l;
            for (int k = 0; k < 5; k++)
            {
                double[] N = b.Nrm[k]; if (N[0] * nx + N[1] * ny + N[2] * nz < 0.8) continue;
                bool near = true; foreach (double[] p in new double[][] { p0, p1, p2 }) { double d = N[0] * p[0] + N[1] * p[1] + N[2] * p[2] - b.Off[k]; if (d < -CutBox.SkinDepth || d > CutBox.SkinDepth) { near = false; break; } }
                if (near) return true;
            }
            return false;
        }

        public static GeomOut CutGeometry(GeomData g, int geomNo, List<CutBox> boxes, HashSet<long> deletes, List<FillSpec> fills)
        {
            GeomOut o = new GeomOut(); o.Src = g; o.V = g.V; o.Idx = g.Idx;
            if (g.V == null || g.Idx == null || g.PosOff < 0) return o;
            int S = g.Stride, nv = g.VertCount, nt = g.Idx.Length / 3;
            bool anyDel = false; if (deletes != null) foreach (long k in deletes) if ((k >> 32) == geomNo) { anyDel = true; break; }
            List<FillSpec> myFills = new List<FillSpec>(); if (fills != null) foreach (FillSpec f in fills) if (f.Geom == geomNo && f.Pts != null && f.Tris != null) myFills.Add(f);
            // quick reject: geometry bounds vs boxes
            double[] gmn = new double[] { 1e30, 1e30, 1e30 }, gmx = new double[] { -1e30, -1e30, -1e30 };
            for (int v = 0; v < nv; v++) for (int a = 0; a < 3; a++) { double p = g.V[v * S + g.PosOff + a]; if (p < gmn[a]) gmn[a] = p; if (p > gmx[a]) gmx[a] = p; }
            List<CutBox> near = new List<CutBox>();
            foreach (CutBox b in boxes) { bool hit = true; for (int a = 0; a < 3; a++) if (b.Mx[a] < gmn[a] || b.Mn[a] > gmx[a]) { hit = false; break; } if (hit) near.Add(b); }
            if (near.Count == 0 && !anyDel && myFills.Count == 0) return o;

            List<int> outIdx = new List<int>(g.Idx.Length); List<int> srcTris = new List<int>(nt); List<float> extra = new List<float>(); Dictionary<string, int> made = new Dictionary<string, int>();
            int removed = 0, added = 0;
            for (int t = 0; t < nt; t++)
            {
                int a = g.Idx[t * 3], b2 = g.Idx[t * 3 + 1], c = g.Idx[t * 3 + 2];
                if (anyDel && deletes.Contains(Key(geomNo, t))) { removed++; continue; }
                if (near.Count == 0 || a >= nv || b2 >= nv || c >= nv) { outIdx.Add(a); outIdx.Add(b2); outIdx.Add(c); srcTris.Add(t); continue; }
                int po = g.PosOff; int ia = a * S + po, ib = b2 * S + po, ic = c * S + po;
                double[] tmn = new double[3], tmx = new double[3];
                for (int ax = 0; ax < 3; ax++) { double p0 = g.V[ia + ax], p1 = g.V[ib + ax], p2 = g.V[ic + ax]; tmn[ax] = Math.Min(p0, Math.Min(p1, p2)); tmx[ax] = Math.Max(p0, Math.Max(p1, p2)); }
                List<CutBox> cand = new List<CutBox>(); double[] sp0 = null, sp1 = null, sp2 = null;
                foreach (CutBox bx in near)
                {
                    bool hit = true; for (int ax = 0; ax < 3; ax++) if (bx.Mx[ax] < tmn[ax] || bx.Mn[ax] > tmx[ax]) { hit = false; break; }
                    if (!hit) continue;
                    if (bx.Skin) { if (sp0 == null) { sp0 = new double[] { g.V[ia], g.V[ia + 1], g.V[ia + 2] }; sp1 = new double[] { g.V[ib], g.V[ib + 1], g.V[ib + 2] }; sp2 = new double[] { g.V[ic], g.V[ic + 1], g.V[ic + 2] }; } if (IsSkin(bx, sp0, sp1, sp2)) continue; }
                    cand.Add(bx);
                }
                if (cand.Count == 0) { outIdx.Add(a); outIdx.Add(b2); outIdx.Add(c); srcTris.Add(t); continue; }

                PV p0v = new PV(), p1v = new PV(), p2v = new PV();
                p0v.W0 = 1; p0v.X = g.V[ia]; p0v.Y = g.V[ia + 1]; p0v.Z = g.V[ia + 2];
                p1v.W1 = 1; p1v.X = g.V[ib]; p1v.Y = g.V[ib + 1]; p1v.Z = g.V[ib + 2];
                p2v.W2 = 1; p2v.X = g.V[ic]; p2v.Y = g.V[ic + 1]; p2v.Z = g.V[ic + 2];
                List<List<PV>> pieces = new List<List<PV>>(); pieces.Add(new List<PV> { p0v, p1v, p2v });
                bool touched = false;
                foreach (CutBox bx in cand)
                {
                    List<List<PV>> next = new List<List<PV>>(); int before = pieces.Count;
                    foreach (List<PV> pc in pieces)
                    {
                        // untouched piece: all its points on the outside of one face
                        bool clear = false;
                        for (int k = 0; k < 6 && !clear; k++) { bool all = true; foreach (PV p in pc) if (bx.Nrm[k][0] * p.X + bx.Nrm[k][1] * p.Y + bx.Nrm[k][2] * p.Z - bx.Off[k] <= EPS) { all = false; break; } if (all) clear = true; }
                        if (clear) { next.Add(pc); continue; }
                        touched = true; ClipOutside(pc, bx, next);
                    }
                    pieces = next; if (pieces.Count == 0) break;
                }
                if (!touched) { outIdx.Add(a); outIdx.Add(b2); outIdx.Add(c); srcTris.Add(t); continue; }
                removed++;
                int[] corner = new int[] { a, b2, c };
                foreach (List<PV> pc in pieces)
                {
                    int[] vi = new int[pc.Count];
                    for (int i = 0; i < pc.Count; i++)
                    {
                        PV p = pc[i];
                        if (p.W0 > 1 - 1e-9) { vi[i] = a; continue; }
                        if (p.W1 > 1 - 1e-9) { vi[i] = b2; continue; }
                        if (p.W2 > 1 - 1e-9) { vi[i] = c; continue; }
                        string key = t + "|" + Math.Round(p.W0 * 1e7) + "|" + Math.Round(p.W1 * 1e7); int ex;
                        if (made.TryGetValue(key, out ex)) { vi[i] = ex; continue; }
                        float[] at = new float[S];
                        for (int k = 0; k < S; k++) at[k] = (float)(p.W0 * g.V[a * S + k] + p.W1 * g.V[b2 * S + k] + p.W2 * g.V[c * S + k]);
                        int off = 0;
                        for (int ci = 0; ci < g.Comps.Length; ci++)
                        {
                            int sz = g.Sizes[ci];
                            if (g.IsInt[ci]) for (int j = 0; j < sz; j++) at[off + j] = (float)Math.Max(0, Math.Min(255, Math.Round(at[off + j])));
                            else if (g.Comps[ci] == "Normal" || g.Comps[ci] == "Tangent")
                            {
                                double l = Math.Sqrt(at[off] * at[off] + at[off + 1] * at[off + 1] + at[off + 2] * at[off + 2]);
                                if (l > 1e-9) { at[off] = (float)(at[off] / l); at[off + 1] = (float)(at[off + 1] / l); at[off + 2] = (float)(at[off + 2] / l); }
                                if (g.Comps[ci] == "Tangent") at[off + 3] = g.V[a * S + off + 3];
                            }
                            off += sz;
                        }
                        at[g.PosOff] = (float)p.X; at[g.PosOff + 1] = (float)p.Y; at[g.PosOff + 2] = (float)p.Z;
                        int ni = nv + extra.Count / S; extra.AddRange(at); made[key] = ni; vi[i] = ni;
                    }
                    for (int i = 1; i + 1 < vi.Length; i++) { if (vi[0] == vi[i] || vi[i] == vi[i + 1] || vi[0] == vi[i + 1]) continue; outIdx.Add(vi[0]); outIdx.Add(vi[i]); outIdx.Add(vi[i + 1]); srcTris.Add(t); added++; }
                }
            }
            // filled holes: triangles over the fill's points (vertices of the geometry or copies of the nearest one)
            foreach (FillSpec f in myFills)
            {
                int[] vi = new int[f.Pts.Length];
                for (int p = 0; p < f.Pts.Length; p++)
                {
                    double[] pt = f.Pts[p]; int best = -1; double bd = 1e30;
                    for (int v = 0; v < nv; v++)
                    {
                        double dx = g.V[v * S + g.PosOff] - pt[0], dy = g.V[v * S + g.PosOff + 1] - pt[1], dz = g.V[v * S + g.PosOff + 2] - pt[2], d = dx * dx + dy * dy + dz * dz;
                        if (d < bd) { bd = d; best = v; }
                    }
                    if (best < 0) { vi[p] = -1; continue; }
                    if (bd < 1e-8) { vi[p] = best; continue; }                                  // a vertex of the model is right there (0.1 mm)
                    string key = "f|" + Math.Round(pt[0] * 1e5) + "|" + Math.Round(pt[1] * 1e5) + "|" + Math.Round(pt[2] * 1e5); int ex;
                    if (made.TryGetValue(key, out ex)) { vi[p] = ex; continue; }
                    float[] at = new float[S]; Array.Copy(g.V, best * S, at, 0, S);
                    at[g.PosOff] = (float)pt[0]; at[g.PosOff + 1] = (float)pt[1]; at[g.PosOff + 2] = (float)pt[2];
                    int ni = nv + extra.Count / S; extra.AddRange(at); made[key] = ni; vi[p] = ni;
                }
                foreach (int[] t in f.Tris)
                {
                    if (t == null || t.Length < 3) continue; int a = t[0] >= 0 && t[0] < vi.Length ? vi[t[0]] : -1, b = t[1] >= 0 && t[1] < vi.Length ? vi[t[1]] : -1, c = t[2] >= 0 && t[2] < vi.Length ? vi[t[2]] : -1;
                    if (a < 0 || b < 0 || c < 0 || a == b || b == c || a == c) continue;
                    outIdx.Add(a); outIdx.Add(b); outIdx.Add(c); srcTris.Add(Math.Max(0, Math.Min(nt - 1, f.Src))); added++;
                }
            }
            o.Removed = removed; o.Added = added;
            if (removed == 0 && added == 0) return o;
            // append the new vertices, then drop the ones nothing uses any more
            float[] all2 = new float[g.V.Length + extra.Count]; Array.Copy(g.V, all2, g.V.Length); extra.CopyTo(all2, g.V.Length);
            int total = all2.Length / S; int[] remap = new int[total]; bool[] used = new bool[total];
            foreach (int ix in outIdx) used[ix] = true;
            int cnt = 0; for (int i = 0; i < total; i++) remap[i] = used[i] ? cnt++ : -1;
            if (cnt > 65535) throw new Exception("Cutting made geometry " + geomNo + " too big for the game (" + cnt + " vertices, the limit is 65535). Use smaller cutters.");
            float[] nvv = new float[cnt * S]; for (int i = 0; i < total; i++) if (remap[i] >= 0) Array.Copy(all2, i * S, nvv, remap[i] * S, S);
            int[] nix = new int[outIdx.Count]; for (int i = 0; i < nix.Length; i++) nix[i] = remap[outIdx[i]];
            o.V = nvv; o.Idx = nix; o.TriSrc = srcTris.ToArray(); o.Changed = true;
            return o;
        }

        // cuts every geometry; cutters report how many original triangles they touched
        public static List<GeomOut> Apply(ModelDoc md, List<CutBox> boxes, HashSet<long> deletes) { return Apply(md, boxes, deletes, null); }
        public static List<GeomOut> Apply(ModelDoc md, List<CutBox> boxes, HashSet<long> deletes, List<FillSpec> fills) { return Apply(md, boxes, deletes, fills, null); }
        public static List<GeomOut> Apply(ModelDoc md, List<CutBox> boxes, HashSet<long> deletes, List<FillSpec> fills, ClearSpec clear)
        {
            // a box marked NoMesh only opens the collision (an opening made from deleted faces): it must not clip the model
            List<CutBox> meshBoxes = new List<CutBox>();
            foreach (CutBox b in boxes) { b.Prepare(); b.Removed = 0; if (!b.NoMesh) meshBoxes.Add(b); }
            if (clear != null) { foreach (CutBox b in clear.Boxes) b.Prepare(); if (clear.WinBoxes != null) foreach (CutBox b in clear.WinBoxes) b.Prepare(); clear.Counts = new int[3]; }
            List<GeomOut> res = new List<GeomOut>();
            for (int gi = 0; gi < md.Geoms.Count; gi++)
            {
                GeomData g = md.Geoms[gi]; List<CutBox> use = meshBoxes;
                if (clear != null && clear.Wants(md.Name + ".ydr", gi, g))
                {
                    List<CutBox> cb = clear.BoxesFor(g); use = new List<CutBox>(meshBoxes); use.AddRange(cb);
                    // how many triangles of the original the rooms touch, for the counts (the visible level of detail only)
                    if (g.Lod == 0) clear.Counts[ClearSpec.KindOf(g.Tex, g.ShaderName)] += CutGeometry(g, gi, cb, null, null).Removed;
                }
                res.Add(CutGeometry(g, gi, use, deletes, fills));
            }
            return res;
        }
    }
}
