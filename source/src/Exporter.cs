// Turns a project build model (meshes, collision, portals, textures) into a streamable FiveM map resource.
// CodeWalker XML -> ydr / ybn / ytd / ytyp / ymap / manifest ymf. C# 5.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public struct V3
    {
        public double X, Y, Z;
        public V3(double x, double y, double z) { X = x; Y = y; Z = z; }
        public static V3 operator +(V3 a, V3 b) { return new V3(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static V3 operator -(V3 a, V3 b) { return new V3(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public static V3 operator *(V3 a, double s) { return new V3(a.X * s, a.Y * s, a.Z * s); }
        public double Len() { return Math.Sqrt(X * X + Y * Y + Z * Z); }
    }

    class MatData { public string Tex; public bool Glass; public float[] Pos, Nrm, Uv; public int[] Idx; }
    class LightData { public double X, Y, Z; public int R, G, B; public double Intensity, Falloff, Exponent; }
    class GroupData
    {
        public string Name; public int Room, Flags; public double Lod;
        public List<MatData> Mats = new List<MatData>(); public List<LightData> Lights = new List<LightData>();
    }
    class PortalData { public int Flags; public double[] C; }
    class DoorData { public string Name; public int Flags = 1572864; public double X, Y, Z, Heading, ScaleXY = 1, ScaleZ = 1; }      // scale: the door model fitted to its opening
    class TexData { public string Name; public int Size; public bool Alpha; public int[] Argb; public string Usage = "DIFFUSE"; }

    public static class J
    {
        public static Dictionary<string, object> O(object o) { return o as Dictionary<string, object>; }
        public static List<object> A(object o)
        {
            List<object> l = new List<object>();
            IEnumerable e = o as IEnumerable;
            if (e != null && !(o is string)) foreach (object x in e) l.Add(x);
            return l;
        }
        public static object G(Dictionary<string, object> d, string k)
        {
            object v; if (d != null && d.TryGetValue(k, out v)) return v; return null;
        }
        public static double D(object o, double def) { if (o == null) return def; try { return Convert.ToDouble(o, CultureInfo.InvariantCulture); } catch { return def; } }
        public static int I(object o, int def) { if (o == null) return def; try { return Convert.ToInt32(Convert.ToDouble(o, CultureInfo.InvariantCulture)); } catch { return def; } }
        public static string S(object o, string def) { return o == null ? def : Convert.ToString(o, CultureInfo.InvariantCulture); }
        public static bool B(object o, bool def) { if (o == null) return def; if (o is bool) return (bool)o; return def; }
    }

    public static partial class Exporter
    {
        static string F(double v) { return v.ToString("0.######", CultureInfo.InvariantCulture); }
        static string Vec(string tag, V3 v) { return "<" + tag + " x=\"" + F(v.X) + "\" y=\"" + F(v.Y) + "\" z=\"" + F(v.Z) + "\" />"; }
        static string Safe(string s, string def, int max)
        {
            string t = Regex.Replace((s ?? "").ToLowerInvariant(), "[^a-z0-9_]", "_").Trim('_');
            if (t.Length == 0) t = def;
            if (t.Length > max) t = t.Substring(0, max);
            return t;
        }
        static float[] Floats(string b64)
        {
            if (string.IsNullOrEmpty(b64)) return new float[0];
            byte[] b = Convert.FromBase64String(b64); float[] f = new float[b.Length / 4]; Buffer.BlockCopy(b, 0, f, 0, f.Length * 4); return f;
        }
        static int[] Ints(string b64)
        {
            if (string.IsNullOrEmpty(b64)) return new int[0];
            byte[] b = Convert.FromBase64String(b64); int[] f = new int[b.Length / 4]; Buffer.BlockCopy(b, 0, f, 0, f.Length * 4); return f;
        }

        // ---------- glass textures made here so the pack always has them ----------
        static int Px(int r, int g, int b, int a) { return (a << 24) | (r << 16) | (g << 8) | b; }
        static TexData Solid(string name, int size, int argb, bool alpha, string usage)
        {
            TexData t = new TexData(); t.Name = name; t.Size = size; t.Alpha = alpha; t.Usage = usage;
            t.Argb = new int[size * size]; for (int i = 0; i < t.Argb.Length; i++) t.Argb[i] = argb;
            return t;
        }

        // ---------- drawable ----------
        static void Bounds(GroupData g, out V3 mn, out V3 mx)
        {
            mn = new V3(1e9, 1e9, 1e9); mx = new V3(-1e9, -1e9, -1e9);
            foreach (MatData m in g.Mats)
                for (int i = 0; i + 2 < m.Pos.Length; i += 3)
                {
                    mn = new V3(Math.Min(mn.X, m.Pos[i]), Math.Min(mn.Y, m.Pos[i + 1]), Math.Min(mn.Z, m.Pos[i + 2]));
                    mx = new V3(Math.Max(mx.X, m.Pos[i]), Math.Max(mx.Y, m.Pos[i + 1]), Math.Max(mx.Z, m.Pos[i + 2]));
                }
        }

        static string DrawableXml(string name, GroupData g, string px)
        {
            V3 mn, mx; Bounds(g, out mn, out mx);
            V3 ctr = (mn + mx) * 0.5; double rad = (mx - mn).Len() * 0.5;
            StringBuilder s = new StringBuilder();
            s.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
            s.AppendLine("<Drawable>");
            s.AppendLine(" <Name>" + name + ".#dr</Name>");
            s.AppendLine(" " + Vec("BoundingSphereCenter", ctr));
            s.AppendLine(" <BoundingSphereRadius value=\"" + F(rad) + "\" />");
            s.AppendLine(" " + Vec("BoundingBoxMin", mn));
            s.AppendLine(" " + Vec("BoundingBoxMax", mx));
            s.AppendLine(" <LodDistHigh value=\"9998\" />\n <LodDistMed value=\"9998\" />\n <LodDistLow value=\"9998\" />\n <LodDistVlow value=\"9998\" />");
            s.AppendLine(" <FlagsHigh value=\"1\" />\n <FlagsMed value=\"0\" />\n <FlagsLow value=\"0\" />\n <FlagsVlow value=\"0\" />");
            s.AppendLine(" <ShaderGroup>");
            s.AppendLine("  <Shaders>");
            foreach (MatData m in g.Mats)
            {
                s.AppendLine("   <Item>");
                if (m.Glass)
                {
                    s.AppendLine("    <Name>glass_env</Name>\n    <FileName>glass_env.sps</FileName>\n    <RenderBucket value=\"1\" />\n    <Parameters>");
                    s.AppendLine("     <Item name=\"DiffuseSampler\" type=\"Texture\">\n      <Name>" + px + "glass</Name>\n     </Item>");
                    s.AppendLine("     <Item name=\"BumpSampler\" type=\"Texture\">\n      <Name>" + px + "glass_n</Name>\n     </Item>");
                    s.AppendLine("     <Item name=\"SpecSampler\" type=\"Texture\">\n      <Name>" + px + "glass_s</Name>\n     </Item>");
                    s.AppendLine("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"bumpiness\" type=\"Vector\" x=\"0.1\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"specMapIntMask\" type=\"Vector\" x=\"1\" y=\"1\" z=\"1\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"specularIntensityMult\" type=\"Vector\" x=\"0.1\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"specularFalloffMult\" type=\"Vector\" x=\"220\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"specularFresnel\" type=\"Vector\" x=\"0.98\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />");
                }
                else
                {
                    s.AppendLine("    <Name>default</Name>\n    <FileName>default.sps</FileName>\n    <RenderBucket value=\"0\" />\n    <Parameters>");
                    s.AppendLine("     <Item name=\"DiffuseSampler\" type=\"Texture\">\n      <Name>" + px + m.Tex + "</Name>\n     </Item>");
                    s.AppendLine("     <Item name=\"matMaterialColorScale\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"1\" />");
                    s.AppendLine("     <Item name=\"HardAlphaBlend\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"useTessellation\" type=\"Vector\" x=\"0\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"wetnessMultiplier\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"globalAnimUV1\" type=\"Vector\" x=\"0\" y=\"1\" z=\"0\" w=\"0\" />");
                    s.AppendLine("     <Item name=\"globalAnimUV0\" type=\"Vector\" x=\"1\" y=\"0\" z=\"0\" w=\"0\" />");
                }
                s.AppendLine("    </Parameters>\n   </Item>");
            }
            s.AppendLine("  </Shaders>\n </ShaderGroup>");
            s.AppendLine(" <Skeleton>\n  <Unknown1C value=\"0\" />\n  <Unknown50 value=\"3283568608\" />\n  <Unknown54 value=\"3954038922\" />\n  <Unknown58 value=\"3624623659\" />\n  <Bones>\n   <Item>");
            s.AppendLine("    <Name>" + name + "</Name>\n    <Tag value=\"0\" />\n    <Index value=\"0\" />\n    <ParentIndex value=\"-1\" />\n    <SiblingIndex value=\"-1\" />");
            s.AppendLine("    <Flags>RotX, RotY, RotZ, TransX, TransY, TransZ</Flags>\n    <Translation x=\"0\" y=\"0\" z=\"0\" />\n    <Rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" />\n    <Scale x=\"1\" y=\"1\" z=\"1\" />\n    <TransformUnk x=\"0\" y=\"4\" z=\"-3\" w=\"0\" />");
            s.AppendLine("   </Item>\n  </Bones>\n </Skeleton>");
            s.AppendLine(" <DrawableModelsHigh>\n  <Item>\n   <RenderMask value=\"255\" />\n   <Flags value=\"0\" />\n   <HasSkin value=\"0\" />\n   <BoneIndex value=\"0\" />\n   <Unknown1 value=\"0\" />\n   <Geometries>");
            int shaderIndex = 0;
            foreach (MatData m in g.Mats)
            {
                V3 gmn = new V3(1e9, 1e9, 1e9), gmx = new V3(-1e9, -1e9, -1e9);
                int nv = m.Pos.Length / 3;
                for (int i = 0; i < nv; i++)
                {
                    gmn = new V3(Math.Min(gmn.X, m.Pos[i * 3]), Math.Min(gmn.Y, m.Pos[i * 3 + 1]), Math.Min(gmn.Z, m.Pos[i * 3 + 2]));
                    gmx = new V3(Math.Max(gmx.X, m.Pos[i * 3]), Math.Max(gmx.Y, m.Pos[i * 3 + 1]), Math.Max(gmx.Z, m.Pos[i * 3 + 2]));
                }
                s.AppendLine("    <Item>");
                s.AppendLine("     <ShaderIndex value=\"" + shaderIndex + "\" />");
                s.AppendLine("     <BoundingBoxMin x=\"" + F(gmn.X) + "\" y=\"" + F(gmn.Y) + "\" z=\"" + F(gmn.Z) + "\" w=\"" + F(gmn.X) + "\" />");
                s.AppendLine("     <BoundingBoxMax x=\"" + F(gmx.X) + "\" y=\"" + F(gmx.Y) + "\" z=\"" + F(gmx.Z) + "\" w=\"" + F(gmx.X) + "\" />");
                s.AppendLine("     <VertexBuffer>\n      <Flags value=\"0\" />\n      <Layout type=\"GTAV1\">\n       <Position />\n       <Normal />\n       <Colour0 />\n       <TexCoord0 />" + (m.Glass ? "\n       <Tangent />" : "") + "\n      </Layout>\n      <Data>");
                for (int i = 0; i < nv; i++)
                {
                    double nx = m.Nrm[i * 3], ny = m.Nrm[i * 3 + 1], nz = m.Nrm[i * 3 + 2];
                    string line = "       " + F(m.Pos[i * 3]) + " " + F(m.Pos[i * 3 + 1]) + " " + F(m.Pos[i * 3 + 2]) + "   " + F(nx) + " " + F(ny) + " " + F(nz) + "   255 255 255 255   " + F(m.Uv[i * 2]) + " " + F(m.Uv[i * 2 + 1]);
                    if (m.Glass)
                    {
                        // tangent = up x normal
                        double tx = -ny, ty = nx, tz = 0; double tl = Math.Sqrt(tx * tx + ty * ty); if (tl < 1e-9) { tx = 1; ty = 0; } else { tx /= tl; ty /= tl; }
                        line += "   " + F(tx) + " " + F(ty) + " " + F(tz) + " 1";
                    }
                    s.AppendLine(line);
                }
                s.AppendLine("      </Data>\n     </VertexBuffer>\n     <IndexBuffer>\n      <Data>");
                for (int i = 0; i < m.Idx.Length; i += 12)
                {
                    StringBuilder row = new StringBuilder("       ");
                    for (int k = i; k < Math.Min(i + 12, m.Idx.Length); k++) row.Append(m.Idx[k]).Append(' ');
                    s.AppendLine(row.ToString());
                }
                s.AppendLine("      </Data>\n     </IndexBuffer>\n    </Item>");
                shaderIndex++;
            }
            s.AppendLine("   </Geometries>\n  </Item>\n </DrawableModelsHigh>");
            if (g.Lights.Count > 0)
            {
                s.AppendLine(" <Lights>");
                int n = 0;
                foreach (LightData l in g.Lights)
                {
                    n++;
                    s.AppendLine("  <Item>");
                    s.AppendLine("   " + Vec("Position", new V3(l.X, l.Y, l.Z)));
                    s.AppendLine("   <Colour r=\"" + l.R + "\" g=\"" + l.G + "\" b=\"" + l.B + "\" />");
                    s.AppendLine("   <Flashiness value=\"0\" />\n   <Intensity value=\"" + F(l.Intensity) + "\" />\n   <Flags value=\"0\" />\n   <BoneId value=\"0\" />\n   <Type>Point</Type>\n   <GroupId value=\"0\" />\n   <TimeFlags value=\"16777215\" />");
                    s.AppendLine("   <Falloff value=\"" + F(l.Falloff) + "\" />\n   <FalloffExponent value=\"" + F(l.Exponent) + "\" />");
                    s.AppendLine("   <CullingPlaneNormal x=\"0\" y=\"0\" z=\"1\" />\n   <CullingPlaneOffset value=\"" + F(l.Falloff) + "\" />\n   <Unknown45 value=\"0\" />\n   <Unknown46 value=\"0\" />");
                    s.AppendLine("   <VolumeIntensity value=\"1\" />\n   <VolumeSizeScale value=\"1\" />\n   <VolumeOuterColour r=\"255\" g=\"255\" b=\"255\" />\n   <LightHash value=\"" + (600 + n * 7) + "\" />");
                    s.AppendLine("   <VolumeOuterIntensity value=\"1\" />\n   <CoronaSize value=\"0\" />\n   <VolumeOuterExponent value=\"1\" />\n   <LightFadeDistance value=\"0\" />\n   <ShadowBlur value=\"0\" />\n   <ShadowFadeDistance value=\"0\" />\n   <SpecularFadeDistance value=\"0\" />\n   <VolumetricFadeDistance value=\"0\" />\n   <ShadowNearClip value=\"0.1\" />");
                    s.AppendLine("   <CoronaIntensity value=\"0\" />\n   <CoronaZBias value=\"0.1\" />\n   <Direction x=\"0\" y=\"0\" z=\"-1\" />\n   <Tangent x=\"1\" y=\"0\" z=\"0\" />\n   <ConeInnerAngle value=\"5\" />\n   <ConeOuterAngle value=\"90\" />\n   <Extent x=\"1\" y=\"1\" z=\"1\" />\n   <ProjectedTextureHash />");
                    s.AppendLine("  </Item>");
                }
                s.AppendLine(" </Lights>");
            }
            else s.AppendLine(" <Lights />");
            s.AppendLine("</Drawable>");
            return s.ToString();
        }

        // ---------- collision ----------
        static string BoundsXml(float[] verts, int[] tris, int[][] mats)
        {
            V3 mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
            for (int i = 0; i + 2 < verts.Length; i += 3)
            {
                mn = new V3(Math.Min(mn.X, verts[i]), Math.Min(mn.Y, verts[i + 1]), Math.Min(mn.Z, verts[i + 2]));
                mx = new V3(Math.Max(mx.X, verts[i]), Math.Max(mx.Y, verts[i + 1]), Math.Max(mx.Z, verts[i + 2]));
            }
            V3 ctr = (mn + mx) * 0.5; double rad = (mx - mn).Len() * 0.5;
            StringBuilder s = new StringBuilder();
            s.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<BoundsFile>\n <Bounds type=\"Composite\">");
            Action<string> common = delegate (string pad)
            {
                s.AppendLine(pad + Vec("BoxMin", mn)); s.AppendLine(pad + Vec("BoxMax", mx));
                s.AppendLine(pad + Vec("BoxCenter", ctr)); s.AppendLine(pad + Vec("SphereCenter", ctr));
                s.AppendLine(pad + "<SphereRadius value=\"" + F(rad) + "\" />");
            };
            common("  ");
            s.AppendLine("  <Margin value=\"0\" />\n  <Volume value=\"1\" />\n  <Inertia x=\"1\" y=\"1\" z=\"1\" />\n  <MaterialIndex value=\"0\" />\n  <MaterialColourIndex value=\"0\" />\n  <ProceduralID value=\"0\" />\n  <RoomID value=\"0\" />\n  <PedDensity value=\"0\" />\n  <UnkFlags value=\"0\" />\n  <PolyFlags value=\"0\" />\n  <UnkType value=\"1\" />");
            s.AppendLine("  <Children>\n   <Item type=\"GeometryBVH\">");
            common("    ");
            s.AppendLine("    <Margin value=\"0.04\" />\n    <Volume value=\"1\" />\n    <Inertia x=\"1\" y=\"1\" z=\"1\" />\n    <MaterialIndex value=\"0\" />\n    <MaterialColourIndex value=\"0\" />\n    <ProceduralID value=\"0\" />\n    <RoomID value=\"0\" />\n    <PedDensity value=\"0\" />\n    <UnkFlags value=\"0\" />\n    <PolyFlags value=\"0\" />\n    <UnkType value=\"1\" />");
            s.AppendLine("    <CompositeTransform>\n     1 0 0 0\n     0 1 0 0\n     0 0 1 0\n     0 0 0 1\n    </CompositeTransform>");
            s.AppendLine("    <CompositeFlags1>MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE</CompositeFlags1>");
            s.AppendLine("    <CompositeFlags2>UNKNOWN, MAP_WEAPON, MAP_DYNAMIC, MAP_ANIMAL, MAP_COVER, MAP_VEHICLE, VEHICLE_NOT_BVH, VEHICLE_BVH, PED, RAGDOLL, ANIMAL, ANIMAL_RAGDOLL, OBJECT, OBJECT_ENV_CLOTH, PLANT, PROJECTILE, EXPLOSION, PICKUP, FOLIAGE, FORKLIFT_FORKS, TEST_WEAPON, TEST_CAMERA, TEST_AI, TEST_SCRIPT, TEST_VEHICLE_WHEEL, GLASS, MAP_RIVER, SMOKE, UNSMASHED, MAP_STAIRS, MAP_DEEP_SURFACE</CompositeFlags2>");
            s.AppendLine("    " + Vec("GeometryCenter", new V3(0, 0, 0)) + "\n    <UnkFloat1 value=\"0\" />\n    <UnkFloat2 value=\"0\" />");
            s.AppendLine("    <Materials>");
            foreach (int[] m in mats)
                s.AppendLine("     <Item>\n      <Type value=\"" + m[0] + "\" />\n      <ProceduralID value=\"0\" />\n      <RoomID value=\"" + m[1] + "\" />\n      <PedDensity value=\"0\" />\n      <Flags>NONE</Flags>\n      <MaterialColourIndex value=\"0\" />\n      <Unk value=\"0\" />\n     </Item>");
            s.AppendLine("    </Materials>\n    <Vertices>");
            for (int i = 0; i + 2 < verts.Length; i += 3)
                s.AppendLine("     " + F(verts[i]) + ", " + F(verts[i + 1]) + ", " + F(verts[i + 2]));
            s.AppendLine("    </Vertices>\n    <Polygons>");
            for (int i = 0; i + 3 < tris.Length; i += 4)
                s.AppendLine("     <Triangle m=\"" + tris[i + 3] + "\" v1=\"" + tris[i] + "\" v2=\"" + tris[i + 1] + "\" v3=\"" + tris[i + 2] + "\" f1=\"0\" f2=\"0\" f3=\"0\" />");
            s.AppendLine("    </Polygons>\n   </Item>\n  </Children>\n </Bounds>\n</BoundsFile>");
            return s.ToString();
        }

        // ---------- ytyp ----------
        static string DrawableArch(string name, string txd, double lod, V3 mn, V3 mx)
        {
            V3 c = (mn + mx) * 0.5; double r = (mx - mn).Len() * 0.5;
            return "  <Item type=\"CBaseArchetypeDef\">\n   <lodDist value=\"" + F(lod) + "\" />\n   <flags value=\"0\" />\n   <specialAttribute value=\"0\" />\n   " + Vec("bbMin", mn) + "\n   " + Vec("bbMax", mx) + "\n   " + Vec("bsCentre", c) + "\n   <bsRadius value=\"" + F(r) + "\" />\n   <hdTextureDist value=\"" + F(Math.Min(100.0, lod)) + "\" />\n   <name>" + name + "</name>\n   <textureDictionary>" + txd + "</textureDictionary>\n   <clipDictionary />\n   <drawableDictionary />\n   <physicsDictionary />\n   <assetType>ASSET_TYPE_DRAWABLE</assetType>\n   <assetName>" + name + "</assetName>\n   <extensions />\n  </Item>\n";
        }

        static string EntityXml(string arch, int flags, double lod)
        {
            string pad = "    ";
            return pad + "<Item type=\"CEntityDef\">\n" + pad + " <archetypeName>" + arch + "</archetypeName>\n" + pad + " <flags value=\"" + flags + "\" />\n" + pad + " <guid value=\"0\" />\n" + pad + " <position x=\"0\" y=\"0\" z=\"0\" />\n" + pad + " <rotation x=\"0\" y=\"0\" z=\"0\" w=\"1\" />\n" + pad + " <scaleXY value=\"1\" />\n" + pad + " <scaleZ value=\"1\" />\n" + pad + " <parentIndex value=\"-1\" />\n" + pad + " <lodDist value=\"" + F(lod) + "\" />\n" + pad + " <childLodDist value=\"0\" />\n" + pad + " <lodLevel>LODTYPES_DEPTH_ORPHANHD</lodLevel>\n" + pad + " <numChildren value=\"0\" />\n" + pad + " <priorityLevel>PRI_REQUIRED</priorityLevel>\n" + pad + " <extensions />\n" + pad + " <ambientOcclusionMultiplier value=\"255\" />\n" + pad + " <artificialAmbientOcclusion value=\"255\" />\n" + pad + " <tintValue value=\"0\" />\n" + pad + "</Item>\n";
        }

        // a prop placed inside the interior (a door): the same entity fields the game uses for this door in its own interiors
        static string PropEntityXml(string arch, double x, double y, double z, double headingDeg, double scaleXY, double scaleZ, int flags)
        {
            // a room entity's rotation is stored as the inverse of the real turn (CodeWalker and the game read it that way; the MLO instance itself is read directly)
            double r = -headingDeg * Math.PI / 360.0; string pad = "    ";
            return pad + "<Item type=\"CEntityDef\">\n" + pad + " <archetypeName>" + arch + "</archetypeName>\n" + pad + " <flags value=\"" + flags + "\" />\n" + pad + " <guid value=\"0\" />\n" + pad + " <position x=\"" + F(x) + "\" y=\"" + F(y) + "\" z=\"" + F(z) + "\" />\n" + pad + " <rotation x=\"0\" y=\"0\" z=\"" + F(Math.Sin(r)) + "\" w=\"" + F(Math.Cos(r)) + "\" />\n" + pad + " <scaleXY value=\"" + F(scaleXY) + "\" />\n" + pad + " <scaleZ value=\"" + F(scaleZ) + "\" />\n" + pad + " <parentIndex value=\"-1\" />\n" + pad + " <lodDist value=\"-1\" />\n" + pad + " <childLodDist value=\"0\" />\n" + pad + " <lodLevel>LODTYPES_DEPTH_ORPHANHD</lodLevel>\n" + pad + " <numChildren value=\"0\" />\n" + pad + " <priorityLevel>PRI_REQUIRED</priorityLevel>\n" + pad + " <extensions />\n" + pad + " <ambientOcclusionMultiplier value=\"255\" />\n" + pad + " <artificialAmbientOcclusion value=\"255\" />\n" + pad + " <tintValue value=\"0\" />\n" + pad + "</Item>\n";
        }

        static string YtypXml(string P, string mlo, string txd, List<GroupData> groups, List<PortalData> portals, V3 bmn, V3 bmx, string timecycle, List<DoorData> doors, string doorArch)
        {
            StringBuilder s = new StringBuilder();
            s.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapTypes>\n <extensions />\n <archetypes>");
            foreach (GroupData g in groups)
            {
                V3 mn, mx; Bounds(g, out mn, out mx);
                s.Append(DrawableArch(P + g.Name, txd, g.Lod, mn, mx));
            }
            if (doorArch != null) s.Append(doorArch);
            V3 bc = (bmn + bmx) * 0.5; double br = (bmx - bmn).Len() * 0.5;
            s.AppendLine("  <Item type=\"CMloArchetypeDef\">\n   <lodDist value=\"300\" />\n   <flags value=\"0\" />\n   <specialAttribute value=\"0\" />");
            s.AppendLine("   " + Vec("bbMin", bmn) + "\n   " + Vec("bbMax", bmx) + "\n   " + Vec("bsCentre", bc) + "\n   <bsRadius value=\"" + F(br) + "\" />\n   <hdTextureDist value=\"100\" />");
            s.AppendLine("   <name>" + mlo + "</name>\n   <textureDictionary />\n   <clipDictionary />\n   <drawableDictionary />\n   <physicsDictionary>" + mlo + "</physicsDictionary>\n   <assetType>ASSET_TYPE_ASSETLESS</assetType>\n   <assetName>" + mlo + "</assetName>\n   <extensions />\n   <mloFlags value=\"0\" />\n   <entities>");
            foreach (GroupData g in groups) s.Append(EntityXml(P + g.Name, g.Flags, g.Lod));
            foreach (DoorData d in doors) s.Append(PropEntityXml(d.Name, d.X, d.Y, d.Z, d.Heading, d.ScaleXY, d.ScaleZ, d.Flags));
            s.AppendLine("   </entities>");
            s.AppendLine("   <rooms itemType=\"CMloRoomDef\">");
            string rb = "<bbMin x=\"" + F(bmn.X) + "\" y=\"" + F(bmn.Y) + "\" z=\"" + F(bmn.Z) + "\" />\n     <bbMax x=\"" + F(bmx.X) + "\" y=\"" + F(bmx.Y) + "\" z=\"" + F(bmx.Z) + "\" />";
            for (int room = 0; room < 2; room++)
            {
                List<string> att = new List<string>();
                for (int i = 0; i < groups.Count; i++) if (groups[i].Room == room) att.Add(i.ToString());
                if (room == 1) for (int i = 0; i < doors.Count; i++) att.Add((groups.Count + i).ToString());
                string name = room == 0 ? "limbo" : mlo;
                s.AppendLine("    <Item>\n     <name>" + name + "</name>\n     " + rb + "\n     <blend value=\"1\" />\n     <timecycleName>" + timecycle + "</timecycleName>\n     <secondaryTimecycleName />\n     <flags value=\"96\" />\n     <portalCount value=\"" + portals.Count + "\" />\n     <floorId value=\"0\" />\n     <exteriorVisibiltyDepth value=\"-1\" />\n     <attachedObjects>" + string.Join(" ", att.ToArray()) + "</attachedObjects>\n    </Item>");
            }
            s.AppendLine("   </rooms>\n   <portals itemType=\"CMloPortalDef\">");
            foreach (PortalData p in portals)
            {
                s.AppendLine("    <Item>\n     <roomFrom value=\"1\" />\n     <roomTo value=\"0\" />\n     <flags value=\"" + p.Flags + "\" />\n     <mirrorPriority value=\"0\" />\n     <opacity value=\"0\" />\n     <audioOcclusion value=\"0\" />\n     <corners>");
                for (int k = 0; k < 4; k++) s.AppendLine("      <Item>" + F(p.C[k * 3]) + ", " + F(p.C[k * 3 + 1]) + ", " + F(p.C[k * 3 + 2]) + ", 0</Item>");
                s.AppendLine("     </corners>\n     <attachedObjects />\n    </Item>");
            }
            s.AppendLine("   </portals>\n   <entitySets itemType=\"CMloEntitySet\" />\n   <timeCycleModifiers itemType=\"CMloTimeCycleModifier\" />\n  </Item>");
            s.AppendLine(" </archetypes>\n <name>" + P + "types</name>\n <dependencies />\n <compositeEntityTypes itemType=\"CCompositeEntityType\" />\n</CMapTypes>");
            return s.ToString();
        }

        static string YmapXml(string mapName, string mlo, double px, double py, double pz, double qz, double qw, V3 emn, V3 emx)
        {
            string sext = "<streamingExtentsMin x=\"" + F(emn.X - 300) + "\" y=\"" + F(emn.Y - 300) + "\" z=\"" + F(emn.Z - 300) + "\" />\n <streamingExtentsMax x=\"" + F(emx.X + 300) + "\" y=\"" + F(emx.Y + 300) + "\" z=\"" + F(emx.Z + 300) + "\" />";
            string ext = "<entitiesExtentsMin x=\"" + F(emn.X) + "\" y=\"" + F(emn.Y) + "\" z=\"" + F(emn.Z) + "\" />\n <entitiesExtentsMax x=\"" + F(emx.X) + "\" y=\"" + F(emx.Y) + "\" z=\"" + F(emx.Z) + "\" />";
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CMapData>\n <name>" + mapName + "</name>\n <parent />\n <flags value=\"1\" />\n <contentFlags value=\"9\" />\n " + sext + "\n " + ext +
                "\n <entities>\n  <Item type=\"CMloInstanceDef\">\n   <archetypeName>" + mlo + "</archetypeName>\n   <flags value=\"32\" />\n   <guid value=\"0\" />\n   <position x=\"" + F(px) + "\" y=\"" + F(py) + "\" z=\"" + F(pz) + "\" />\n   <rotation x=\"0\" y=\"0\" z=\"" + F(qz) + "\" w=\"" + F(qw) + "\" />\n   <scaleXY value=\"1\" />\n   <scaleZ value=\"1\" />\n   <parentIndex value=\"-1\" />\n   <lodDist value=\"300\" />\n   <childLodDist value=\"0\" />\n   <lodLevel>LODTYPES_DEPTH_ORPHANHD</lodLevel>\n   <numChildren value=\"0\" />\n   <priorityLevel>PRI_REQUIRED</priorityLevel>\n   <extensions />\n   <ambientOcclusionMultiplier value=\"255\" />\n   <artificialAmbientOcclusion value=\"255\" />\n   <tintValue value=\"0\" />\n   <groupId value=\"0\" />\n   <floorId value=\"0\" />\n   <defaultEntitySets />\n   <numExitPortals value=\"0\" />\n   <MLOInstflags value=\"0\" />\n  </Item>\n </entities>\n" +
                " <containerLods itemType=\"rage__fwContainerLodDef\" />\n <boxOccluders itemType=\"BoxOccluder\" />\n <occludeModels itemType=\"OccludeModel\" />\n <physicsDictionaries />\n <instancedData>\n  <ImapLink />\n  <PropInstanceList itemType=\"rage__fwPropInstanceListDef\" />\n  <GrassInstanceList itemType=\"rage__fwGrassInstanceListDef\" />\n </instancedData>\n <timeCycleModifiers itemType=\"CTimeCycleModifier\" />\n <carGenerators itemType=\"CCarGen\" />\n <LODLightsSOA>\n  <direction itemType=\"FloatXYZ\" />\n  <falloff />\n  <falloffExponent />\n  <timeAndStateFlags />\n  <hash />\n  <coneInnerAngle />\n  <coneOuterAngleOrCapExt />\n  <coronaIntensity />\n </LODLightsSOA>\n <DistantLODLightsSOA>\n  <position itemType=\"FloatXYZ\" />\n  <RGBI />\n  <numStreetLights value=\"0\" />\n  <category value=\"0\" />\n </DistantLODLightsSOA>\n <block>\n  <version value=\"0\" />\n  <flags value=\"0\" />\n  <name>" + mapName + "</name>\n  <exportedBy>MLO Creator</exportedBy>\n  <owner></owner>\n  <time>" + DateTime.Now.ToString("d MMMM yyyy HH:mm", CultureInfo.InvariantCulture) + "</time>\n </block>\n</CMapData>\n";
        }

        static string ManifestXml(string P, string mlo)
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CPackFileMetaData>\n <MapDataGroups itemType=\"CMapDataGroup\" />\n <HDTxdBindingArray itemType=\"CHDTxdAssetBinding\" />\n <imapDependencies itemType=\"CImapDependency\" />\n <imapDependencies_2 itemType=\"CImapDependencies\">\n  <Item>\n   <imapName>" + P + "milo_</imapName>\n   <manifestFlags>INTERIOR_DATA</manifestFlags>\n   <itypDepArray>\n    <Item>" + P + "types</Item>\n   </itypDepArray>\n  </Item>\n </imapDependencies_2>\n <itypDependencies_2 itemType=\"CItypDependencies\">\n  <Item>\n   <itypName>" + P + "types</itypName>\n   <manifestFlags>INTERIOR_DATA</manifestFlags>\n   <itypDepArray />\n  </Item>\n </itypDependencies_2>\n <Interiors itemType=\"CInteriorBoundsFiles\">\n  <Item>\n   <Name>" + mlo + "</Name>\n   <Bounds>\n    <Item>" + mlo + "</Item>\n   </Bounds>\n  </Item>\n </Interiors>\n</CPackFileMetaData>\n";
        }

        static string TxdXml(List<TexData> texs, string px)
        {
            StringBuilder x = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<TextureDictionary>\n");
            foreach (TexData t in texs)
            {
                string n = px + t.Name;
                x.Append(" <Item>\n  <Name>" + n + "</Name>\n  <Unk32 value=\"128\" />\n  <Usage>" + t.Usage + "</Usage>\n  <UsageFlags>UNK24</UsageFlags>\n  <ExtraFlags value=\"0\" />\n  <Width value=\"" + t.Size + "\" />\n  <Height value=\"" + t.Size + "\" />\n  <MipLevels value=\"" + Dds.MipCount(t.Size) + "\" />\n  <Format>" + (t.Alpha ? "D3DFMT_DXT5" : "D3DFMT_DXT1") + "</Format>\n  <FileName>" + n + ".dds</FileName>\n </Item>\n");
            }
            x.Append("</TextureDictionary>\n");
            return x.ToString();
        }

        static long Save(string path, byte[] bytes, List<string> files)
        {
            File.WriteAllBytes(path, bytes);
            files.Add(Path.GetFileName(path) + "  (" + (bytes.Length / 1024.0).ToString("0.#", CultureInfo.InvariantCulture) + " KB)");
            return bytes.Length;
        }

        static void WriteText(string path, string text)
        {
            File.WriteAllText(path, text.Replace("\r\n", "\n"), new UTF8Encoding(false));
        }

        class InteriorInfo { public List<string> ControllerRows = new List<string>(); public List<string> DoorLines = new List<string>(); public List<string> Credits = new List<string>(); public string P, Label, Mlo, EntranceNote, DoorName; public double X, Y, Z, Heading; public int Doors; }

        // ---------- one interior (one building): meshes, collision, portals, doors, textures, ytyp, ymap and manifest go into the stream folder ----------
        static InteriorInfo WriteInterior(Dictionary<string, object> model, string outRoot, string stream, string work, List<string> log, List<string> files, List<string> warns, List<string> patchedFiles, ref long total, ref bool doorShipped)
        {
            string P = Safe(J.S(J.G(model, "prefix"), ""), "mlo1", 10) + "_";
            if (P.EndsWith("__")) P = P.TrimEnd('_') + "_";
            string label = J.S(J.G(model, "label"), P);
            string timecycle = J.S(J.G(model, "timecycle"), "hash_E83C53FC");
            string mlo = P + "mlo", txd = P + "tex";
            {
                // ---- parse groups ----
                List<GroupData> groups = new List<GroupData>();
                bool needGlass = false;
                foreach (object go in J.A(J.G(model, "groups")))
                {
                    Dictionary<string, object> gd = J.O(go);
                    GroupData g = new GroupData();
                    g.Name = Safe(J.S(J.G(gd, "name"), "part"), "part", 12);
                    g.Room = J.I(J.G(gd, "room"), 1); g.Flags = J.I(J.G(gd, "flags"), 1572864); g.Lod = J.D(J.G(gd, "lod"), 300);
                    foreach (object mo in J.A(J.G(gd, "mats")))
                    {
                        Dictionary<string, object> md = J.O(mo);
                        MatData m = new MatData();
                        m.Tex = Safe(J.S(J.G(md, "tex"), "paint"), "paint", 24); m.Glass = J.B(J.G(md, "glass"), false);
                        m.Pos = Floats(J.S(J.G(md, "pos"), "")); m.Nrm = Floats(J.S(J.G(md, "nrm"), "")); m.Uv = Floats(J.S(J.G(md, "uv"), "")); m.Idx = Ints(J.S(J.G(md, "idx"), ""));
                        if (m.Idx.Length == 0 || m.Pos.Length == 0) continue;
                        if (m.Pos.Length / 3 > 65000) throw new Exception("Part '" + g.Name + "' / texture '" + m.Tex + "' has " + (m.Pos.Length / 3) + " vertices; the game limit is 65535 per material. Use fewer or simpler walls.");
                        if (m.Glass) needGlass = true;
                        g.Mats.Add(m);
                    }
                    foreach (object lo in J.A(J.G(gd, "lights")))
                    {
                        Dictionary<string, object> ld = J.O(lo);
                        LightData l = new LightData(); l.X = J.D(J.G(ld, "x"), 0); l.Y = J.D(J.G(ld, "y"), 0); l.Z = J.D(J.G(ld, "z"), 2);
                        l.R = J.I(J.G(ld, "r"), 255); l.G = J.I(J.G(ld, "g"), 238); l.B = J.I(J.G(ld, "b"), 210);
                        l.Intensity = J.D(J.G(ld, "intensity"), 4); l.Falloff = J.D(J.G(ld, "falloff"), 6); l.Exponent = J.D(J.G(ld, "exponent"), 24);
                        g.Lights.Add(l);
                    }
                    if (g.Mats.Count > 0) groups.Add(g);
                }
                if (groups.Count == 0) throw new Exception("Nothing to export: the project has no walls or floors yet.");

                // ---- textures ----
                List<TexData> texs = new List<TexData>();
                foreach (object to in J.A(J.G(model, "textures")))
                {
                    Dictionary<string, object> td = J.O(to);
                    TexData t = new TexData(); t.Name = Safe(J.S(J.G(td, "name"), "tex"), "tex", 24); t.Size = J.I(J.G(td, "size"), 256); t.Alpha = false;
                    byte[] rgba = Convert.FromBase64String(J.S(J.G(td, "rgba"), ""));
                    if (rgba.Length != t.Size * t.Size * 4) throw new Exception("Texture " + t.Name + " has the wrong pixel data size.");
                    t.Argb = new int[t.Size * t.Size];
                    for (int i = 0; i < t.Argb.Length; i++) t.Argb[i] = Px(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
                    texs.Add(t);
                }
                // placed window and door models (Models tool): baked to their size and place; windows join the interior's meshes, doors are props
                FitResult fit = FitBake(model, P, groups, texs, ref needGlass, log, warns);
                List<GameProp> gameProps = GameProps(model);
                if (needGlass)
                {
                    texs.Add(Solid("glass", 64, Px(186, 206, 214, 70), true, "DIFFUSE"));
                    texs.Add(Solid("glass_n", 16, Px(128, 128, 255, 255), false, "NORMAL"));
                    texs.Add(Solid("glass_s", 16, Px(255, 255, 255, 255), false, "SPECULAR"));
                }
                HashSet<string> have = new HashSet<string>(); foreach (TexData t in texs) have.Add(t.Name);
                foreach (GroupData g in groups) foreach (MatData m in g.Mats) if (!m.Glass && !have.Contains(m.Tex)) warns.Add("texture '" + m.Tex + "' was used but not supplied");
                string ddsDir = Path.Combine(work, "dds"); Directory.CreateDirectory(ddsDir);
                foreach (TexData t in texs) Dds.Write(Path.Combine(ddsDir, P + t.Name + ".dds"), t.Argb, t.Size, t.Alpha);
                string txdXml = TxdXml(texs, P);

                // ---- collision ----
                Dictionary<string, object> col = J.O(J.G(model, "collision"));
                float[] cverts = Floats(J.S(J.G(col, "verts"), "")); int[] ctris = Ints(J.S(J.G(col, "tris"), ""));
                List<int[]> cmats = new List<int[]>();
                foreach (object mo in J.A(J.G(col, "mats"))) { List<object> mm = J.A(mo); cmats.Add(new int[] { J.I(mm[0], 1), J.I(mm[1], 0) }); }
                if (cmats.Count == 0) cmats.Add(new int[] { 1, 0 });
                if (cverts.Length / 3 > 65000) throw new Exception("Collision has " + (cverts.Length / 3) + " vertices; the game limit is 65535.");
                if (cverts.Length == 0 || ctris.Length == 0) throw new Exception("Nothing to export: the project has no collision geometry.");

                // ---- portals ----
                List<PortalData> portals = new List<PortalData>();
                foreach (object po in J.A(J.G(model, "portals")))
                {
                    Dictionary<string, object> pd = J.O(po);
                    PortalData p = new PortalData(); p.Flags = J.I(J.G(pd, "flags"), 0);
                    List<object> c = J.A(J.G(pd, "corners")); p.C = new double[12];
                    for (int i = 0; i < 12 && i < c.Count; i++) p.C[i] = J.D(c[i], 0);
                    portals.Add(p);
                }

                // ---- bounds ----
                V3 bmn = new V3(1e9, 1e9, 1e9), bmx = new V3(-1e9, -1e9, -1e9);
                foreach (GroupData g in groups) { V3 a, b; Bounds(g, out a, out b); bmn = new V3(Math.Min(bmn.X, a.X), Math.Min(bmn.Y, a.Y), Math.Min(bmn.Z, a.Z)); bmx = new V3(Math.Max(bmx.X, b.X), Math.Max(bmx.Y, b.Y), Math.Max(bmx.Z, b.Z)); }
                foreach (var prop in gameProps) { bmn = new V3(Math.Min(bmn.X, prop.Min.X), Math.Min(bmn.Y, prop.Min.Y), Math.Min(bmn.Z, prop.Min.Z)); bmx = new V3(Math.Max(bmx.X, prop.Max.X), Math.Max(bmx.Y, prop.Max.Y), Math.Max(bmx.Z, prop.Max.Z)); }
                bmn = bmn + new V3(-0.7, -0.7, -0.7); bmx = bmx + new V3(0.7, 0.7, 0.7);

                // ---- placement ----
                Dictionary<string, object> pl = J.O(J.G(model, "placement"));
                double px = J.D(J.G(pl, "x"), 0), py = J.D(J.G(pl, "y"), 0), pz = J.D(J.G(pl, "z"), 0), hd = J.D(J.G(pl, "heading"), 0);
                double rad = hd * Math.PI / 180.0, qz = Math.Sin(rad / 2.0), qw = Math.Cos(rad / 2.0), cs = Math.Cos(rad), sn = Math.Sin(rad);
                V3 emn = new V3(1e9, 1e9, 1e9), emx = new V3(-1e9, -1e9, -1e9);
                for (int ci = 0; ci < 8; ci++)
                {
                    double lx = (ci & 1) == 0 ? bmn.X : bmx.X, ly = (ci & 2) == 0 ? bmn.Y : bmx.Y, lz = (ci & 4) == 0 ? bmn.Z : bmx.Z;
                    double wx = px + lx * cs - ly * sn, wy = py + lx * sn + ly * cs, wz = pz + lz;
                    emn = new V3(Math.Min(emn.X, wx), Math.Min(emn.Y, wy), Math.Min(emn.Z, wz)); emx = new V3(Math.Max(emx.X, wx), Math.Max(emx.Y, wy), Math.Max(emx.Z, wz));
                }

                // ---- write game files ----
                YtdFile ytd = XmlYtd.GetYtd(txdXml, ddsDir);
                total += Save(Path.Combine(stream, txd + ".ytd"), ytd.Save(), files);
                log.Add("textures: " + texs.Count);

                foreach (GroupData g in groups)
                {
                    string xml = DrawableXml(P + g.Name, g, P);
                    YdrFile ydr = XmlYdr.GetYdr(xml, work);
                    total += Save(Path.Combine(stream, P + g.Name + ".ydr"), ydr.Save(), files);
                    int tris = 0; foreach (MatData m in g.Mats) tris += m.Idx.Length / 3;
                    log.Add(g.Name + ": " + tris + " triangles, " + g.Mats.Count + " materials" + (g.Lights.Count > 0 ? ", " + g.Lights.Count + " lights" : ""));
                }

                List<string> doorLines = new List<string>(); List<string> controllerRows = new List<string>();
                double wrad = hd * Math.PI / 180.0, wcs = Math.Cos(wrad), wsn = Math.Sin(wrad);
                foreach (FitDoor fd in fit.Doors)
                {
                    string dxml = DrawableXml(P + fd.Name, fd.G, P).Replace("</Drawable>", (fd.Item.Collision ? FitDoorBoundsXml(fd) : "") + "</Drawable>");
                    YdrFile dyd = XmlYdr.GetYdr(dxml, work);
                    total += Save(Path.Combine(stream, P + fd.Name + ".ydr"), dyd.Save(), files);
                    int dtris = 0; foreach (MatData m in fd.G.Mats) dtris += m.Idx.Length / 3;
                    // where the door stands in the world (the entity has no turn of its own: the interior's heading is its heading), for a door script (ox_doorlock...)
                    double wx = px + fd.D.X * wcs - fd.D.Y * wsn, wy = py + fd.D.X * wsn + fd.D.Y * wcs, wz = pz + fd.D.Z; uint dh = JenkHash.GenHash((P + fd.Name).ToLowerInvariant());
                    string dl = "`" + P + fd.Name + "` (model hash " + (int)dh + ", 0x" + dh.ToString("X8") + "): hinge at " + F(Math.Round(wx, 3)) + ", " + F(Math.Round(wy, 3)) + ", " + F(Math.Round(wz, 3)) + " (the middle of the door's height), heading " + F(Math.Round(hd, 3)) + ", the leaf is " + F(Math.Round(fd.W, 3)) + " m wide and swings about the hinge";
                    if (fd.Item.Managed) {
                        double angle = wrad + fd.Yaw;
                        controllerRows.Add(" { id='" + P + fd.Name + "', group='" + P + fd.Item.Group + "', model='" + P + fd.Name + "', kind='" + fd.Item.Type + "', x=" + F(wx) + ", y=" + F(wy) + ", z=" + F(wz) + ", heading=" + F(hd + (fd.Item.Type == "tilt" ? fd.Item.Yaw * 180 / Math.PI : 0)) + ", tiltLift=" + F(fd.Item.TiltLift) + ", tiltOffset=" + F(fd.Item.TiltOffset) + ", height=" + F(fd.H) + ", dx=" + F(fd.Item.Type == "sliding" ? Math.Cos(angle) : 0) + ", dy=" + F(fd.Item.Type == "sliding" ? Math.Sin(angle) : 0) + ", dz=" + (fd.Item.Type == "garage" ? "1" : "0") + ", direction=" + fd.Item.Direction + ", travel=" + F(fd.Item.Travel) + ", speed=" + F(fd.Item.Speed) + ", collision=" + (fd.Item.Collision ? "true" : "false") + ", autoOpen=" + (fd.Item.AutoOpen ? "true" : "false") + ", autoDistance=" + F(fd.Item.AutoDistance) + ", closeDelay=" + F(fd.Item.CloseDelay) + ", oxDoorId=" + fd.Item.OxDoorId + ", triggerX=" + F(px + fd.Item.Cx * wcs - fd.Item.Cy * wsn) + ", triggerY=" + F(py + fd.Item.Cx * wsn + fd.Item.Cy * wcs) + ", triggerZ=" + F(pz + fd.Item.Zb + Math.Min(0.8, fd.H / 2)) + " },");
                        dl = "`" + P + fd.Name + "`: " + fd.Item.Type + ", controller group `" + P + fd.Item.Group + "`, travel " + F(fd.Item.Travel) + ", speed " + F(fd.Item.Speed) + ", moving collision " + fd.Item.Collision;
                    }
                    doorLines.Add(dl);
                    log.Add("door " + fd.Name + ": " + dtris + " triangles, door model with exported collision settings; " + dl.Replace("`", ""));
                }

                YbnFile ybn = XmlYbn.GetYbn(BoundsXml(cverts, ctris, cmats.ToArray()));
                total += Save(Path.Combine(stream, mlo + ".ybn"), ybn.Save(), files);
                log.Add("collision: " + (ctris.Length / 4) + " triangles");

                // ---- doors placed with an imported door model ----
                List<DoorData> doors = new List<DoorData>(); string doorArch = null; string doorName = null;
                Dictionary<string, object> dmod = J.O(J.G(model, "doorModel"));
                if (dmod != null)
                {
                    doorName = Safe(J.S(J.G(dmod, "name"), ""), "", 60);
                    foreach (object o in J.A(J.G(model, "doors")))
                    {
                        Dictionary<string, object> dd = J.O(o); DoorData d = new DoorData(); d.Name = doorName; d.X = J.D(J.G(dd, "x"), 0); d.Y = J.D(J.G(dd, "y"), 0); d.Z = J.D(J.G(dd, "z"), 0); d.Heading = J.D(J.G(dd, "heading"), 0); d.ScaleXY = J.D(J.G(dd, "sxy"), 1); d.ScaleZ = J.D(J.G(dd, "sz"), 1); doors.Add(d);
                    }
                    // (a door model that the resource carries is defined once, in the first interior that places it; the others refer to it by name)
                    if (doors.Count > 0 && !doorShipped && J.B(J.G(dmod, "include"), false))
                    {
                        // a model that is not in the game: the resource carries it and defines it
                        string dproj = J.S(J.G(dmod, "project"), ""), src = Path.Combine(ImportHost.FilesDir(dproj), doorName + ".ydr");
                        if (!File.Exists(src)) warns.Add("The door model " + doorName + ".ydr is not in the project files, so it was not included.");
                        else
                        {
                            YdrFile dy = new YdrFile(); dy.Load(File.ReadAllBytes(src)); string dtxd = "";
                            string dsrc = Path.Combine(ImportHost.FilesDir(dproj), doorName + ".ytd");
                            if (File.Exists(dsrc)) { dtxd = doorName; total += Save(Path.Combine(stream, doorName + ".ytd"), File.ReadAllBytes(dsrc), files); }
                            total += Save(Path.Combine(stream, doorName + ".ydr"), File.ReadAllBytes(src), files);
                            V3 dmn = new V3(dy.Drawable.BoundingBoxMin.X, dy.Drawable.BoundingBoxMin.Y, dy.Drawable.BoundingBoxMin.Z), dmx = new V3(dy.Drawable.BoundingBoxMax.X, dy.Drawable.BoundingBoxMax.Y, dy.Drawable.BoundingBoxMax.Z);
                            doorArch = DrawableArch(doorName, dtxd, 100, dmn, dmx); doorShipped = true;
                        }
                    }
                    log.Add("doors placed with " + doorName + ": " + doors.Count + (doorArch != null ? " (model shipped in the resource)" : " (the game must already know this model)"));
                }

                if (fit.Doors.Count > 0)
                {
                    StringBuilder fa = new StringBuilder(doorArch ?? "");
                    foreach (FitDoor fd in fit.Doors) {
                        string arch = FitDoorArch(fd.D.Name, txd, fd.Mn, fd.Mx);
                        // Script-owned kinematic props must not also be instantiated by the MLO or driven by door physics.
                        if (fd.Item.Managed) arch = arch.Replace("<flags value=\"604110848\" />", "<flags value=\"537001984\" />").Replace("<specialAttribute value=\"7\" />", "<specialAttribute value=\"0\" />");
                        if (!fd.Item.Collision) arch = arch.Replace("<physicsDictionary>" + fd.D.Name + "</physicsDictionary>", "<physicsDictionary />");
                        fa.Append(arch); if (!fd.Item.Managed) doors.Add(fd.D);
                    }
                    doorArch = fa.ToString(); string fitNames = fit.Doors.Count == 1 ? fit.Doors[0].D.Name : fit.Doors[0].D.Name + " and " + (fit.Doors.Count - 1) + " more"; doorName = doorName == null ? fitNames : doorName + " and " + fitNames;
                    log.Add("door models placed: " + fit.Doors.Count);
                }

                int nativeIndex = 0;
                foreach (var prop in gameProps) {
                    if (prop.Moving) controllerRows.Add(NativeController(prop, P, ++nativeIndex, px, py, pz, hd));
                    else doors.Add(prop.Entity);
                }
                if (gameProps.Count > 0) log.Add("Native GTA prop references: " + gameProps.Count + "; no game models or textures copied");
                XmlDocument ytypDoc = new XmlDocument(); ytypDoc.LoadXml(YtypXml(P, mlo, txd, groups, portals, bmn, bmx, timecycle, doors, doorArch));
                total += Save(Path.Combine(stream, P + "types.ytyp"), XmlMeta.GetRSCData(ytypDoc), files);
                log.Add("portals: " + portals.Count);

                XmlDocument ymapDoc = new XmlDocument(); ymapDoc.LoadXml(YmapXml(P + "milo_", mlo, px, py, pz, qz, qw, emn, emx));
                total += Save(Path.Combine(stream, P + "milo_.ymap"), XmlMeta.GetRSCData(ymapDoc), files);

                XmlDocument mfDoc = new XmlDocument(); mfDoc.LoadXml(ManifestXml(P, mlo));
                total += Save(Path.Combine(stream, "_manifest_" + P.TrimEnd('_') + ".ymf"), XmlMeta.GetPSOData(mfDoc), files);

                // ---- vanilla house: cut the game's own door, window panes, solid collision and occluders ----
                Dictionary<string, object> pm = J.O(J.G(model, "patch"));
                if (pm != null && J.B(J.G(pm, "enabled"), false))
                {
                    PatchInput pin = new PatchInput(); Dictionary<string, object> fr = J.O(J.G(pm, "frame"));
                    pin.Ox = J.D(J.G(fr, "ox"), 0); pin.Oy = J.D(J.G(fr, "oy"), 0); pin.Oz = J.D(J.G(fr, "oz"), 0); pin.Heading = J.D(J.G(fr, "heading"), 0); pin.CeilH = J.D(J.G(pm, "ceilH"), 2.45);
                    pin.Gta = J.S(J.G(pm, "gta"), ""); pin.CacheDir = J.S(J.G(pm, "cache"), Path.Combine(outRoot, "cache"));
                    pin.Doors = J.B(J.G(pm, "doors"), true); pin.Windows = J.B(J.G(pm, "windows"), true); pin.Collision = J.B(J.G(pm, "collision"), true); pin.Occluders = J.B(J.G(pm, "occluders"), true);
                    foreach (object ro in J.A(J.G(pm, "rects"))) { List<object> rr = J.A(ro); if (rr.Count >= 4) pin.Rects.Add(new double[] { J.D(rr[0], 0), J.D(rr[1], 0), J.D(rr[2], 0), J.D(rr[3], 0) }); }
                    foreach (object oo in J.A(J.G(pm, "openings")))
                    {
                        Dictionary<string, object> od = J.O(oo); PatchOpening po = new PatchOpening();
                        po.O = J.S(J.G(od, "o"), "H"); po.Type = J.S(J.G(od, "type"), "window"); po.C = J.D(J.G(od, "c"), 0); po.U0 = J.D(J.G(od, "u0"), 0); po.U1 = J.D(J.G(od, "u1"), 0); po.Z0 = J.D(J.G(od, "z0"), 0); po.Z1 = J.D(J.G(od, "z1"), 2);
                        po.Inward = J.I(J.G(od, "inward"), 1); po.Entrance = J.B(J.G(od, "entrance"), false); pin.Openings.Add(po);
                    }
                    Dictionary<string, object> pr = Patcher.Run(pin, stream, log);
                    foreach (string f2 in (List<string>)pr["files"]) { files.Add("game file replaced: " + f2); patchedFiles.Add(f2); }
                    foreach (string w2 in (List<string>)pr["warnings"]) warns.Add(w2);
                }

                InteriorInfo info = new InteriorInfo(); info.P = P; info.Label = label; info.Mlo = mlo; info.X = px; info.Y = py; info.Z = pz; info.Heading = hd; info.Doors = doors.Count - gameProps.FindAll(g => !g.Moving).Count; info.DoorName = doorName; info.EntranceNote = J.S(J.G(model, "entranceNote"), "none set"); info.Credits = fit.Credits; info.DoorLines = doorLines; info.ControllerRows = controllerRows;
                return info;
            }
        }

        // ---------- main: one resource, one interior per building, and the model files cut by the openings of all of them ----------
        public static Dictionary<string, object> Run(Dictionary<string, object> model, string outRoot)
        {
            List<string> log = new List<string>(), files = new List<string>(), warns = new List<string>(), patchedFiles = new List<string>();
            string res = Safe(J.S(J.G(model, "resource"), ""), "mlo_resource", 40);
            string label = J.S(J.G(model, "resourceLabel"), J.S(J.G(model, "label"), res));
            string dir = Path.Combine(outRoot, res), stream = Path.Combine(dir, "stream"), client = Path.Combine(dir, "client");
            string work = Path.Combine(Path.GetTempPath(), "MloCreator_" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(stream); Directory.CreateDirectory(client); Directory.CreateDirectory(work);
            // clear old generated stream files of this resource so renamed parts don't linger
            foreach (string old in Directory.GetFiles(stream)) { try { File.Delete(old); } catch { } }

            try
            {
                // the first interior is the model itself, the others (more buildings of the same project) come in "more"
                List<Dictionary<string, object>> interiors = new List<Dictionary<string, object>>(); interiors.Add(model);
                foreach (object mo in J.A(J.G(model, "more"))) { Dictionary<string, object> md = J.O(mo); if (md != null) interiors.Add(md); }
                List<InteriorInfo> infos = new List<InteriorInfo>(); long total = 0; bool doorShipped = false;
                foreach (Dictionary<string, object> im in interiors)
                {
                    if (interiors.Count > 1) log.Add("---- " + J.S(J.G(im, "label"), "building") + " ----");
                    infos.Add(WriteInterior(im, outRoot, stream, work, log, files, warns, patchedFiles, ref total, ref doorShipped));
                }
                if (interiors.Count > 1) log.Add("---- the model files ----");

                // ---- imported model: the model file with the user's cutters and deleted faces applied (the openings of every building) ----
                Dictionary<string, object> cutSpec = J.O(J.G(model, "cutModel"));
                if (cutSpec != null)
                {
                    string cmsg = ImportHost.WriteCutModel(J.S(J.G(cutSpec, "project"), ""), cutSpec, stream, log);
                    if (cmsg != null) { files.Add("game file replaced: " + cmsg); patchedFiles.Add(cmsg); }
                    List<string> dfiles = new List<string>(); ImportHost.WriteDetailModels(J.S(J.G(cutSpec, "project"), ""), cutSpec, stream, log, dfiles);
                    foreach (string df in dfiles) { files.Add(df); patchedFiles.Add(df.Replace("game file replaced: ", "")); }
                    List<string> cfiles = new List<string>(); ImportHost.WriteCutCollision(J.S(J.G(cutSpec, "project"), ""), cutSpec, stream, log, cfiles, warns);
                    foreach (string cf in cfiles) { files.Add(cf); patchedFiles.Add(cf.Replace("game file replaced: ", "")); }
                    Dictionary<string, object> occ = J.O(J.G(cutSpec, "occluders"));
                    if (occ != null)
                    {
                        List<string> ofiles = new List<string>(); ImportHost.WriteCutOccluders(J.S(J.G(cutSpec, "project"), ""), occ, stream, log, ofiles);
                        foreach (string of in ofiles) { files.Add(of); patchedFiles.Add(of.Replace("game file replaced: ", "")); }
                    }
                }

                // ---- resource files ----
                StringBuilder fxs = new StringBuilder("fx_version 'cerulean'\ngame 'gta5'\nlua54 'yes'\nthis_is_a_map 'yes'\n\nauthor 'MLO Creator'\ndescription '" + label.Replace("'", "") + "'\nversion '1.0.0'\n\n-- registers the interior definitions; the manifest and the placement map stay in stream/\n");
                foreach (InteriorInfo ii in infos) fxs.Append("data_file 'DLC_ITYP_REQUEST' 'stream/" + ii.P + "types.ytyp'\n");
                fxs.Append("\nclient_script 'client/ipl.lua'\n");
                List<string> controllerRows = new List<string>(); foreach (InteriorInfo ii in infos) controllerRows.AddRange(ii.ControllerRows);
                if (controllerRows.Count > 0) {
                    Directory.CreateDirectory(Path.Combine(dir, "server"));
                    total += Save(Path.Combine(dir, "doors.lua"), Encoding.UTF8.GetBytes("MloDoors = {\n" + string.Join("\n", controllerRows.ToArray()) + "\n}\n"), files);
                    foreach (string side in new string[] { "client", "server" }) {
                        string template = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtime", side + "_doors.lua");
                        if (!File.Exists(template)) throw new FileNotFoundException("Door controller template missing", template);
                        total += Save(Path.Combine(dir, side, "doors.lua"), File.ReadAllBytes(template), files);
                    }
                    fxs.Append("shared_script 'doors.lua'\nclient_script 'client/doors.lua'\nserver_script 'server/doors.lua'\ndependency '/onesync'\n");
                }
                // bushes and trees the game's map places inside the rooms: hidden by a small client script (the map files themselves stay as they are)
                List<string> plantRows = new List<string>(); List<string> plantNames = new List<string>();
                foreach (object po in J.A(J.G(model, "hidePlants")))
                {
                    Dictionary<string, object> pd = J.O(po); string pn = pd == null ? "" : System.Text.RegularExpressions.Regex.Replace(J.S(J.G(pd, "n"), ""), "[^A-Za-z0-9_]", ""); if (pn.Length == 0) continue;
                    plantRows.Add("    { '" + pn + "', " + F(J.D(J.G(pd, "x"), 0)) + ", " + F(J.D(J.G(pd, "y"), 0)) + ", " + F(J.D(J.G(pd, "z"), 0)) + " },"); plantNames.Add(pn + " at " + F(J.D(J.G(pd, "x"), 0)) + ", " + F(J.D(J.G(pd, "y"), 0)) + ", " + F(J.D(J.G(pd, "z"), 0)));
                }
                if (plantRows.Count > 0)
                {
                    fxs.Append("client_script 'client/plants.lua'\n");
                    StringBuilder pl = new StringBuilder("-- Hides props of the game's own map that were taken out in the editor: bushes, trees, plants and other props (bins, boxes, fences...) inside the rooms, in front of the windows and doors, or picked by hand.\n-- Each row is a model and the spot it stands at; only that one prop is hidden (the radius is small), the same model elsewhere stays.\nlocal plants = {\n");
                    foreach (string row in plantRows) pl.Append(row + "\n");
                    pl.Append("}\nlocal radius = 0.6\n\nCreateThread(function()\n    Wait(1000)\n    for _, p in ipairs(plants) do\n        CreateModelHide(p[2], p[3], p[4], radius, GetHashKey(p[1]), true)\n    end\nend)\n\nAddEventHandler('onResourceStop', function(res)\n    if res ~= GetCurrentResourceName() then return end\n    for _, p in ipairs(plants) do\n        RemoveModelHide(p[2], p[3], p[4], radius, GetHashKey(p[1]), false)\n    end\nend)\n");
                    WriteText(Path.Combine(client, "plants.lua"), pl.ToString());
                    files.Add("client/plants.lua: hides " + plantRows.Count + " plant(s) of the game's map"); log.Add("plants hidden: " + plantRows.Count);
                }
                WriteText(Path.Combine(dir, "fxmanifest.lua"), fxs.ToString());
                StringBuilder ipl = new StringBuilder("-- Asks the game to load the placement map once at start (the usual way for a map resource).\nCreateThread(function()\n    Wait(3000)\n");
                foreach (InteriorInfo ii in infos) ipl.Append("    RequestIpl('" + ii.P + "milo_')\n");
                ipl.Append("end)\n");
                WriteText(Path.Combine(client, "ipl.lua"), ipl.ToString());
                StringBuilder rd = new StringBuilder("# " + label + "\n\nGenerated by MLO Creator.\n\n## Install\n\n1. Upload the `" + res + "` folder to the server's resources folder.\n2. `refresh`, then `ensure " + res + "` (or add `ensure " + res + "` to server.cfg).\n3. Remove any older copy of this resource first; archetype names (" + string.Join(", ", infos.ConvertAll<string>(delegate (InteriorInfo q) { return "`" + q.P + "...`"; }).ToArray()) + ") must be unique on the server.\n");
                rd.Append("\n## Where " + (infos.Count > 1 ? "they are" : "it is") + "\n\n");
                foreach (InteriorInfo ii in infos) rd.Append("- **" + ii.Label + "** (`" + ii.P + "...`): world position of the origin " + F(ii.X) + ", " + F(ii.Y) + ", " + F(ii.Z) + "  heading " + F(ii.Heading) + ". Entrance / test spot: " + ii.EntranceNote + (ii.Doors > 0 ? ". " + ii.Doors + " door(s) placed with `" + ii.DoorName + "` as MLO props (use your door script); managed doors are listed below and spawned by the built-in controller" : (ii.ControllerRows.Count > 0 ? ". Managed doors are spawned by the built-in controller; see the groups below" : ". Doors are open doorways: add a door script/prop of your choice")) + "\n");
                { List<string> cr = new List<string>(); foreach (InteriorInfo ii in infos) foreach (string c1 in ii.Credits) if (!cr.Contains(c1)) cr.Add(c1); if (cr.Count > 0) rd.Append("\n## Models used\n\nWindow and door models made by other people (check each licence before you use this resource on a server):\n\n- " + string.Join("\n- ", cr.ToArray()) + "\n"); }
                { List<string> dls = new List<string>(); foreach (InteriorInfo ii in infos) foreach (string d1 in ii.DoorLines) dls.Add(d1); if (dls.Count > 0) rd.Append("\n## Doors you placed (for your door script)\n\nUnmanaged hinged doors are MLO props for your existing door script. Managed entries identify their built-in controller group and must not also be registered with another door script. Collision follows the per-door setting. Models and coordinates:\n\n- " + string.Join("\n- ", dls.ToArray()) + "\n"); }
                if (controllerRows.Count > 0) rd.Append("\n## Synchronized doors\n\n`doors.lua` lists controller groups. Use `/mlodoor <group> open|close|toggle` within 8 metres; grant ACE `mlo.doors` first. Server integrations: `exports[GetCurrentResourceName()]:SetDoorOpen(group, true)` (replace the resource name when called from another resource). Server validates client permissions, proximity, and rate limits. Both leaves share one state. State resets closed on resource restart; late joins and stream-in receive the current transition. Collision belongs to each moving object, never a fixed doorway blocker. Do not register managed models with another door script. This kinematic controller does not simulate crushing or prevent trapping: keep the travel path clear. Test collision with players and vehicles and two clients before deployment.\n");
                if (controllerRows.Count > 0) rd.Append("\n## Automatic opening and locks\n\nPer-group settings are in `doors.lua`: autoOpen, autoDistance (metres), closeDelay (seconds), oxDoorId (0 = none). Auto open is decided by the server using player and vehicle positions. An open gate uses 2 m extra range and closes after the configured clear delay. Trusted server exports: SetDoorLocked(group, bool), GetDoorLocked(group), SetDoorOpen(group, bool). Locks block every opening path. Optional oxDoorId reads an existing ox_doorlock entry's state (0/false unlocked, 1/true locked); a missing provider or unknown entry keeps the gate locked. This does not create an ox entry or add ox interaction UI. Do not give a second native controller ownership of the same managed prop. Own locks reset on resource restart; ox-linked locks are read again. Test actual collision and two-client behaviour before deployment.\n");
                if (plantNames.Count > 0) rd.Append("\n## Props and plants hidden\n\nThe game's map places bushes, trees, weeds and other props (bins, boxes, fences...) as objects of their own. These were taken out in the editor (they stand inside the rooms or in front of the windows and doors, or were picked by hand). `client/plants.lua` hides each one (`CreateModelHide`, a 0.6 m radius around the spot, so the same model elsewhere stays). No map file is replaced. Delete the line of a plant in that file to get it back:\n\n- " + string.Join("\n- ", plantNames.ToArray()) + "\n");
                if (patchedFiles.Count > 0) rd.Append("\n## Game files this resource replaces\n\nThese files in stream/ are the game's own files with the openings you cut (model triangles, collision polygons, occluders) taken out; everything else is unchanged. Only one copy of a file with a given name can load: if another resource on your server ships a file with the same name, they conflict. Delete a file here and that cut goes away.\n\n- " + string.Join("\n- ", patchedFiles.ToArray()) + "\n");
                WriteText(Path.Combine(dir, "README.md"), rd.ToString());

                try { Directory.Delete(work, true); } catch { }
                Dictionary<string, object> ok = new Dictionary<string, object>();
                ok["ok"] = true; ok["dir"] = dir; ok["resource"] = res; ok["files"] = files; ok["log"] = log; ok["warnings"] = warns; ok["bytes"] = total;
                return ok;
            }
            catch (Exception ex)
            {
                try { Directory.Delete(work, true); } catch { }
                Dictionary<string, object> bad = new Dictionary<string, object>();
                bad["ok"] = false; bad["error"] = ex.Message; bad["detail"] = ex.ToString(); bad["log"] = log;
                return bad;
            }
        }
    }
}
