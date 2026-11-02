// Window and door models (from .glb files) placed with the Models tool, baked for the export: each placement is scaled to the size the user gave it, turned and moved to
// its place, so the game needs no entity scale (it ignores it). Windows become part of the interior's meshes; doors become props of their own (origin at the hinge, so a
// door script can swing them), because a door has to be able to move. C# 5.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace MloCreator
{
    public static partial class Exporter
    {
        class FitItem { public string File, Model, Kind, Hinge, Id, Type, Group; public double Cx, Cy, Zb, Yaw, W, D, H, Travel, Speed, TiltLift, TiltOffset, AutoDistance, CloseDelay; public int OxDoorId; public int Direction = 1; public int[] Rot; public bool Mirror, Managed, AutoOpen, Collision = true; }          // (Mirror: the model turned inside out left to right: the second leaf of a double door)
        class FitDoor { public GroupData G; public DoorData D; public string Name; public V3 Mn, Mx; public double W, D2, H, CenterU, CoreOff, Yaw; public int Mat = 70; public string Hinge; public FitItem Item; }
        class FitResult { public List<FitDoor> Doors = new List<FitDoor>(); public List<string> Credits = new List<string>(); public int Windows; }

        static string FitProject(string p) { return Regex.Replace(p ?? "", @"[^A-Za-z0-9 _\-]", "").Trim(); }

        // one bakes geometry: positions, normals, uvs and indices of a model placed as given (the origin shift is for doors: their origin is the hinge)
        class BakedGeom { public int Mat; public float[] Pos, Nrm, Uv; public int[] Idx; }
        static List<BakedGeom> FitBakeGeoms(GlbModel gm, FitItem it, bool door)
        {
            double sw = it.W / Math.Max(gm.W, 1e-6), sd = it.D / Math.Max(gm.D, 1e-6), sh = it.H / Math.Max(gm.H, 1e-6);
            double uc = (gm.Min[0] + gm.Max[0]) / 2, nc = (gm.Min[1] + gm.Max[1]) / 2, z0 = gm.Min[2], cs = Math.Cos(it.Type == "tilt" && door ? 0 : it.Yaw), sn = Math.Sin(it.Type == "tilt" && door ? 0 : it.Yaw);
            // the hinge of a door is on the left or the right as seen from the front (the front looks towards +n, so the viewer's left is +u)
            double hingeU = door ? FitPivotU(it) : 0;
            double ox = door ? 0 : it.Cx, oy = door ? 0 : it.Cy, oz = door ? 0 : it.Zb;
            List<BakedGeom> outp = new List<BakedGeom>();
            foreach (GlbGeom g in gm.Geoms)
            {
                int nv = g.Pos.Length / 3; BakedGeom b = new BakedGeom(); b.Mat = g.Mat; b.Pos = new float[nv * 3]; b.Nrm = new float[nv * 3]; b.Uv = g.Uv; b.Idx = g.Idx;
                double mir = it.Mirror ? -1 : 1;
                if (it.Mirror) { int[] fl = new int[g.Idx.Length]; for (int t = 0; t + 2 < fl.Length; t += 3) { fl[t] = g.Idx[t]; fl[t + 1] = g.Idx[t + 2]; fl[t + 2] = g.Idx[t + 1]; } b.Idx = fl; }          // (a mirror turns the faces inside out: the corners go round the other way)
                for (int i = 0; i < nv; i++)
                {
                    double lu = (g.Pos[i * 3] - uc) * sw * mir - hingeU, ln = (g.Pos[i * 3 + 1] - nc) * sd, lz = (g.Pos[i * 3 + 2] - z0) * sh - (door ? FitPivotZ(it) : 0);          // (the origin of a door is its hinge at mid height, like the game door)
                    b.Pos[i * 3] = (float)(ox + lu * cs - ln * sn); b.Pos[i * 3 + 1] = (float)(oy + lu * sn + ln * cs); b.Pos[i * 3 + 2] = (float)(oz + lz);
                    double nu = g.Nrm[i * 3] / sw * mir, nn = g.Nrm[i * 3 + 1] / sd, nz = g.Nrm[i * 3 + 2] / sh, l = Math.Sqrt(nu * nu + nn * nn + nz * nz); if (l < 1e-9) { nu = 0; nn = 1; nz = 0; l = 1; }
                    nu /= l; nn /= l; nz /= l;
                    b.Nrm[i * 3] = (float)(nu * cs - nn * sn); b.Nrm[i * 3 + 1] = (float)(nu * sn + nn * cs); b.Nrm[i * 3 + 2] = (float)nz;
                }
                outp.Add(b);
            }
            return outp;
        }

        // the texture of a material in the interior's texture dictionary (a picture of the file, or a small square of the material's colour)
        static void FitTexture(GlbFile gf, GlbMat gm, List<TexData> texs, HashSet<string> have)
        {
            if (gm.Glass || have.Contains(gm.Key)) return;
            have.Add(gm.Key); TexData t = new TexData(); t.Name = gm.Key; t.Alpha = false;
            if (gm.Tex >= 0)
            {
                GlbTex gt = gf.Texs[gm.Tex]; t.Size = gt.Size; t.Argb = new int[gt.Size * gt.Size];
                for (int i = 0; i < t.Argb.Length; i++) t.Argb[i] = Px(gt.Rgba[i * 4], gt.Rgba[i * 4 + 1], gt.Rgba[i * 4 + 2], 255);
            }
            else { t.Size = 8; t.Argb = new int[64]; int c = Px((int)Math.Round(gm.R * 255), (int)Math.Round(gm.G * 255), (int)Math.Round(gm.B * 255), 255); for (int i = 0; i < 64; i++) t.Argb[i] = c; }
            texs.Add(t);
        }

        // Reads the placements of this building (model["fitted"]) and bakes them: windows are appended to `groups` (as extra parts of the interior), doors are returned to be
        // written as props. The textures they use are added to `texs`.
        static FitResult FitBake(Dictionary<string, object> model, string P, List<GroupData> groups, List<TexData> texs, ref bool needGlass, List<string> log, List<string> warns)
        {
            FitResult res = new FitResult(); Dictionary<string, object> fs = J.O(J.G(model, "fitted")); if (fs == null) return res;
            string dir = ImportHost.FilesDir(FitProject(J.S(J.G(fs, "project"), "")));
            List<FitItem> items = new List<FitItem>();
            foreach (object o in J.A(J.G(fs, "items")))
            {
                Dictionary<string, object> d = J.O(o); if (J.S(J.G(d, "source"), "") == "gta") continue; FitItem it = new FitItem(); it.File = J.S(J.G(d, "f"), ""); it.Model = J.S(J.G(d, "m"), ""); it.Kind = J.S(J.G(d, "kind"), "window"); it.Hinge = J.S(J.G(d, "hinge"), "l"); it.Id = J.S(J.G(d, "id"), "");
                it.Cx = J.D(J.G(d, "cx"), 0); it.Cy = J.D(J.G(d, "cy"), 0); it.Zb = J.D(J.G(d, "zb"), 0); it.Yaw = J.D(J.G(d, "yaw"), 0); it.W = J.D(J.G(d, "w"), 1); it.D = J.D(J.G(d, "d"), 0.1); it.H = J.D(J.G(d, "h"), 1);
                it.Type = J.S(J.G(d, "doorType"), "hinged");
                if (it.Type != "hinged" && it.Type != "garage" && it.Type != "sliding" && it.Type != "tilt") throw new InvalidDataException("Unknown door type: " + it.Type);
                it.Managed = it.Type != "hinged" || J.B(J.G(d, "managed"), false);
                it.Collision = J.B(J.G(d, "collision"), true); it.Group = Safe(J.S(J.G(d, "group"), it.Id), "door", 60);
                it.Direction = J.D(J.G(d, "direction"), 1) < 0 ? -1 : 1;
                it.Travel = J.D(J.G(d, "travel"), (it.Type == "hinged" || it.Type == "tilt") ? 90 : (it.Type == "garage" ? it.H : it.W));
                it.Speed = J.D(J.G(d, "speed"), (it.Type == "hinged" || it.Type == "tilt") ? 90 : 1);
                if (double.IsNaN(it.Travel) || double.IsInfinity(it.Travel) || it.Travel <= 0 || it.Travel > ((it.Type == "hinged" || it.Type == "tilt") ? 180 : 100) || double.IsNaN(it.Speed) || double.IsInfinity(it.Speed) || it.Speed <= 0 || it.Speed > 100) throw new InvalidDataException("Invalid door travel or speed");
                it.TiltLift = J.D(J.G(d, "tiltLift"), 0); it.TiltOffset = J.D(J.G(d, "tiltOffset"), 0);
                if (double.IsNaN(it.TiltLift) || double.IsInfinity(it.TiltLift) || Math.Abs(it.TiltLift) > 20 || double.IsNaN(it.TiltOffset) || double.IsInfinity(it.TiltOffset) || Math.Abs(it.TiltOffset) > 20) throw new InvalidDataException("Invalid tilt-up offset");
                it.AutoOpen = J.B(J.G(d, "autoOpen"), false); it.AutoDistance = J.D(J.G(d, "autoDistance"), 6); it.CloseDelay = J.D(J.G(d, "closeDelay"), 3);
                double oxId = J.D(J.G(d, "oxDoorId"), 0);
                if (double.IsNaN(it.AutoDistance) || double.IsInfinity(it.AutoDistance) || it.AutoDistance < 1 || it.AutoDistance > 30 || double.IsNaN(it.CloseDelay) || double.IsInfinity(it.CloseDelay) || it.CloseDelay < 0 || it.CloseDelay > 120 || double.IsNaN(oxId) || double.IsInfinity(oxId) || oxId < 0 || oxId > int.MaxValue || oxId != Math.Floor(oxId)) throw new InvalidDataException("Invalid auto-open settings");
                it.OxDoorId = (int)oxId;
                it.Mirror = J.B(J.G(d, "mirror"), false);
                List<object> rl = J.A(J.G(d, "rot")); if (rl.Count == 9) { it.Rot = new int[9]; for (int ri = 0; ri < 9; ri++) it.Rot[ri] = J.I(rl[ri], 0); }
                if (it.File.Length > 0) items.Add(it);
            }
            if (items.Count == 0) return res;
            HashSet<string> have = new HashSet<string>(); foreach (TexData t in texs) have.Add(t.Name);
            Dictionary<string, GlbFile> files = new Dictionary<string, GlbFile>();
            int part = 0; GroupData grp = null; Dictionary<string, MatData> map = null; Dictionary<MatData, List<float>[]> lists = null; List<GroupData> fitGroups = new List<GroupData>();
            Action flush = delegate ()
            {
                if (grp == null) return;
                foreach (KeyValuePair<MatData, List<float>[]> kv in lists) { kv.Key.Pos = kv.Value[0].ToArray(); kv.Key.Nrm = kv.Value[1].ToArray(); kv.Key.Uv = kv.Value[2].ToArray(); }
                grp = null;
            };
            Dictionary<MatData, List<int>> idxLists = new Dictionary<MatData, List<int>>();
            int doorN = 0;
            foreach (FitItem it in items)
            {
                GlbFile gf; if (!files.TryGetValue(it.File, out gf))
                {
                    string path = ImportHost.GlbPath(FitProject(J.S(J.G(fs, "project"), "")), it.File);
                    if (path == null) { warns.Add("The model file " + it.File + " is not in the project files or the program's models folder, so a placed " + it.Kind + " was left out."); files[it.File] = null; continue; }
                    gf = GlbFile.Load(path); files[it.File] = gf;
                    string cr = gf.Title + (gf.Author.Length > 0 ? " by " + gf.Author : "") + (gf.License.Length > 0 ? ", " + gf.License : "") + (gf.Source.Length > 0 ? " (" + gf.Source + ")" : "");
                    if (cr.Trim().Length > 0 && !res.Credits.Contains(cr)) res.Credits.Add(cr);
                }
                if (gf == null) continue;
                foreach (string warning in gf.Warnings) if (!warns.Contains(warning)) warns.Add(warning);
                GlbModel gm = gf.Models.Find(delegate (GlbModel q) { return q.Id == it.Model; });
                if (gm == null) { warns.Add("The model " + it.Model + " is not in " + it.File + " any more, so a placed " + it.Kind + " was left out."); continue; }
                if (it.Rot != null && !GlbModel.IsIdent(it.Rot)) gm = gf.OrientedModel(gm, it.Rot);          // the model as it was set up in the editor (stood up, turned round)
                bool door = it.Kind == "door";
                List<BakedGeom> baked = FitBakeGeoms(gm, it, door);
                foreach (BakedGeom b in baked) { GlbMat mt = gf.Mats[Math.Min(b.Mat, gf.Mats.Count - 1)]; FitTexture(gf, mt, texs, have); if (mt.Glass) needGlass = true; }
                if (door)
                {
                    // a door is a prop of its own: positions relative to the hinge, which is also where the entity stands
                    doorN++; FitDoor fd = new FitDoor(); fd.Name = "fd" + doorN; GroupData g = new GroupData(); g.Name = fd.Name; g.Room = 1; g.Flags = 1572864; g.Lod = 100;
                    Dictionary<string, MatData> dm = new Dictionary<string, MatData>();
                    foreach (BakedGeom b in baked)
                    {
                        GlbMat mt = gf.Mats[Math.Min(b.Mat, gf.Mats.Count - 1)]; MatData md; if (!dm.TryGetValue(mt.Key, out md)) { md = new MatData(); md.Tex = mt.Key; md.Glass = mt.Glass; md.Pos = new float[0]; md.Nrm = new float[0]; md.Uv = new float[0]; md.Idx = new int[0]; dm[mt.Key] = md; g.Mats.Add(md); }
                        int baseV = md.Pos.Length / 3;
                        float[] np = new float[md.Pos.Length + b.Pos.Length]; Buffer.BlockCopy(md.Pos, 0, np, 0, md.Pos.Length * 4); Buffer.BlockCopy(b.Pos, 0, np, md.Pos.Length * 4, b.Pos.Length * 4); md.Pos = np;
                        float[] nn = new float[md.Nrm.Length + b.Nrm.Length]; Buffer.BlockCopy(md.Nrm, 0, nn, 0, md.Nrm.Length * 4); Buffer.BlockCopy(b.Nrm, 0, nn, md.Nrm.Length * 4, b.Nrm.Length * 4); md.Nrm = nn;
                        float[] nu = new float[md.Uv.Length + b.Uv.Length]; Buffer.BlockCopy(md.Uv, 0, nu, 0, md.Uv.Length * 4); Buffer.BlockCopy(b.Uv, 0, nu, md.Uv.Length * 4, b.Uv.Length * 4); md.Uv = nu;
                        int[] ni = new int[md.Idx.Length + b.Idx.Length]; Buffer.BlockCopy(md.Idx, 0, ni, 0, md.Idx.Length * 4); for (int i = 0; i < b.Idx.Length; i++) ni[md.Idx.Length + i] = b.Idx[i] + baseV; md.Idx = ni;
                    }
                    double hu = FitPivotU(it), cs = Math.Cos(it.Yaw), sn = Math.Sin(it.Yaw);
                    fd.D = new DoorData(); fd.D.Name = P + fd.Name; fd.D.X = it.Cx + hu * cs; fd.D.Y = it.Cy + hu * sn; fd.D.Z = it.Zb + FitPivotZ(it); fd.Item = it; fd.D.Heading = 0; fd.G = g;
                    Bounds(g, out fd.Mn, out fd.Mx);
                    // collision: one box the size of the leaf (see FitDoorBoundsXml); its middle is half a leaf away from the hinge
                    // (the leaf, not the knob: the thickness of the body of the model, and how far its middle is from the middle of the depth)
                    double sdv = it.D / Math.Max(gm.D, 1e-6); fd.D2 = Math.Max(0.04, (gm.CoreN1 - gm.CoreN0) * sdv + 0.01); fd.CoreOff = ((gm.CoreN0 + gm.CoreN1) / 2 - (gm.Min[1] + gm.Max[1]) / 2) * sdv;
                    fd.W = it.W; fd.H = it.H; fd.Yaw = it.Type == "tilt" ? 0 : it.Yaw; fd.CenterU = -FitPivotU(it); fd.Hinge = it.Hinge;
                    res.Doors.Add(fd);
                    continue;
                }
                res.Windows++;
                foreach (BakedGeom b in baked)
                {
                    GlbMat mt = gf.Mats[Math.Min(b.Mat, gf.Mats.Count - 1)]; int nv = b.Pos.Length / 3;
                    MatData md = null; if (map != null) map.TryGetValue(mt.Key, out md);
                    if (grp == null || (md != null && lists[md][0].Count / 3 + nv > 60000))
                    {
                        flush(); part++; grp = new GroupData(); grp.Name = "fm" + part; grp.Room = 1; grp.Flags = 1572864; grp.Lod = 300; fitGroups.Add(grp); map = new Dictionary<string, MatData>(); lists = new Dictionary<MatData, List<float>[]>(); md = null;
                    }
                    if (md == null) { md = new MatData(); md.Tex = mt.Key; md.Glass = mt.Glass; md.Idx = new int[0]; map[mt.Key] = md; grp.Mats.Add(md); lists[md] = new List<float>[] { new List<float>(), new List<float>(), new List<float>() }; idxLists[md] = new List<int>(); }
                    List<float>[] L = lists[md]; int baseV = L[0].Count / 3;
                    L[0].AddRange(b.Pos); L[1].AddRange(b.Nrm); L[2].AddRange(b.Uv); List<int> il = idxLists[md]; for (int i = 0; i < b.Idx.Length; i++) il.Add(b.Idx[i] + baseV);
                }
            }
            flush();
            foreach (GroupData g in fitGroups) { foreach (MatData md in g.Mats) md.Idx = idxLists[md].ToArray(); groups.Add(g); }
            if (res.Windows > 0) log.Add("window models placed: " + res.Windows + " (baked into " + fitGroups.Count + " part(s) of the interior)");
            return res;
        }

        // The collision of a door prop, written like the game's own doors (read from a vanilla door model): a composite bound whose child is a BOX
        // (a moving object cannot have a mesh bound), margin 1/8 of its thinnest side, wood material 70, the box placed by the child's CompositeTransform (turn about Z, then
        // the move to the middle of the leaf; the entity's origin is the hinge at mid height). Volume and inertia are those of the box.
        static double FitPivotU(FitItem it) { return it.Type == "garage" || it.Type == "tilt" ? 0 : (it.Hinge == "r" ? -it.W / 2 : it.W / 2); }

        static double FitPivotZ(FitItem it) { return it.Type == "tilt" ? it.H : (it.Type == "hinged" ? it.H / 2 : 0); }

        static string FitDoorBoundsXml(FitDoor fd)
        {
            double zoff = fd.H / 2 - FitPivotZ(fd.Item);
            double sx = fd.W, sy = Math.Max(0.04, fd.D2), sz = fd.H, cu = fd.CenterU, cs = Math.Cos(fd.Yaw), sn = Math.Sin(fd.Yaw), tx = cu * cs - fd.CoreOff * sn, ty = cu * sn + fd.CoreOff * cs;
            double hx = sx / 2, hy = sy / 2, hz = sz / 2, rad = Math.Sqrt(sx * sx + sy * sy + sz * sz) / 2, vol = sx * sy * sz, margin = 0.125 * Math.Min(sx, Math.Min(sy, sz));
            // the box in the entity's frame: its corners turned and moved (for the composite's own box and sphere)
            V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
            foreach (double qx in new double[] { -hx, hx }) foreach (double qy in new double[] { -hy, hy }) foreach (double qz in new double[] { -hz, hz })
                { double px = qx * cs - qy * sn + tx, py = qx * sn + qy * cs + ty; mn = new V3(Math.Min(mn.X, px), Math.Min(mn.Y, py), Math.Min(mn.Z, qz + zoff)); mx = new V3(Math.Max(mx.X, px), Math.Max(mx.Y, py), Math.Max(mx.Z, qz + zoff)); }
            V3 ctr = (mn + mx) * 0.5; double crad = (mx - mn).Len() * 0.5;
            string inertia = "x=\"" + F((sy * sy + sz * sz) / 12) + "\" y=\"" + F((sx * sx + sz * sz) / 12) + "\" z=\"" + F((sx * sx + sy * sy) / 12) + "\"";
            StringBuilder s = new StringBuilder();
            s.AppendLine(" <Bounds type=\"Composite\">");
            s.AppendLine("  " + Vec("BoxMin", mn)); s.AppendLine("  " + Vec("BoxMax", mx)); s.AppendLine("  " + Vec("BoxCenter", ctr)); s.AppendLine("  " + Vec("SphereCenter", ctr)); s.AppendLine("  <SphereRadius value=\"" + F(crad) + "\" />");
            s.AppendLine("  <Margin value=\"0\" />\n  <Volume value=\"" + F(vol) + "\" />\n  <Inertia " + inertia + " />\n  <MaterialIndex value=\"0\" />\n  <MaterialColourIndex value=\"0\" />\n  <ProceduralID value=\"0\" />\n  <RoomID value=\"0\" />\n  <PedDensity value=\"0\" />\n  <UnkFlags value=\"0\" />\n  <PolyFlags value=\"0\" />\n  <UnkType value=\"1\" />");
            s.AppendLine("  <Children>\n   <Item type=\"Box\">");
            s.AppendLine("    " + Vec("BoxMin", new V3(-hx, -hy, -hz))); s.AppendLine("    " + Vec("BoxMax", new V3(hx, hy, hz))); s.AppendLine("    " + Vec("BoxCenter", new V3(0, 0, 0))); s.AppendLine("    " + Vec("SphereCenter", new V3(0, 0, 0))); s.AppendLine("    <SphereRadius value=\"" + F(rad) + "\" />");
            s.AppendLine("    <Margin value=\"" + F(margin) + "\" />\n    <Volume value=\"" + F(vol) + "\" />\n    <Inertia " + inertia + " />\n    <MaterialIndex value=\"" + fd.Mat + "\" />\n    <MaterialColourIndex value=\"0\" />\n    <ProceduralID value=\"0\" />\n    <RoomID value=\"0\" />\n    <PedDensity value=\"0\" />\n    <UnkFlags value=\"0\" />\n    <PolyFlags value=\"0\" />\n    <UnkType value=\"1\" />");
            s.AppendLine("    <CompositeTransform>\n     " + F(cs) + " " + F(sn) + " 0 0\n     " + F(-sn) + " " + F(cs) + " 0 0\n     0 0 1 0\n     " + F(tx) + " " + F(ty) + " " + F(zoff) + " 1\n    </CompositeTransform>");
            s.AppendLine("    <CompositeFlags1>MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE</CompositeFlags1>");
            s.AppendLine("    <CompositeFlags2>VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, PLANT, PROJECTILE, EXPLOSION, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS</CompositeFlags2>");
            s.AppendLine("   </Item>\n  </Children>\n </Bounds>");
            return s.ToString();
        }

        // The archetype of a door prop: the same flags and special attribute as the game's own door archetype (read from int_lev_des.ytyp: flags 0x24020000 = object type, with the
        // ambient multiplier; special attribute 7, lod distance 30, hd texture distance 15). Without them the game makes a static piece of the building of it, which no door
        // script can find or move. All 453 of the game's doors that have collision also name a physics dictionary (the 8 with none have no collision), so the door names one too: its own name.
        static string FitDoorArch(string name, string txd, V3 mn, V3 mx)
        {
            return DrawableArch(name, txd, 30, mn, mx).Replace("<flags value=\"0\" />", "<flags value=\"604110848\" />").Replace("<specialAttribute value=\"0\" />", "<specialAttribute value=\"7\" />").Replace("<hdTextureDist value=\"30\" />", "<hdTextureDist value=\"15\" />").Replace("<physicsDictionary />", "<physicsDictionary>" + name + "</physicsDictionary>");
        }    }
}
