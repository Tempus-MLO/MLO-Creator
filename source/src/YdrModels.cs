// Direct YDR input adapter for the placement library. This is a mesh import,
// not a lossless GTA asset roundtrip; unsupported features are reported.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.RegularExpressions;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public partial class GlbFile
    {
        public List<string> Warnings = new List<string>();

        static GlbTex YdrTexture(Texture texture, string name)
        {
            byte[] pixels = CodeWalker.Utils.DDSIO.GetPixels(texture, 0);
            if (pixels == null || pixels.Length < texture.Width * texture.Height * 4) throw new InvalidDataException("Cannot decode texture " + name);
            using (Bitmap bitmap = new Bitmap(texture.Width, texture.Height, PixelFormat.Format32bppArgb))
            {
                BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                try { for (int y = 0; y < bitmap.Height; y++) System.Runtime.InteropServices.Marshal.Copy(pixels, y * bitmap.Width * 4, IntPtr.Add(data.Scan0, y * data.Stride), bitmap.Width * 4); }
                finally { bitmap.UnlockBits(data); }
                using (MemoryStream png = new MemoryStream()) { bitmap.Save(png, ImageFormat.Png); return DecodeTexture(png.ToArray(), name); }
            }
        }

        static GlbFile LoadYdr(string path)
        {
            string scratch = Path.Combine(Path.GetTempPath(), "MloYdr_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(scratch);
            try
            {
                ModelDoc doc = ModelDoc.Load(File.ReadAllBytes(path), scratch, Path.GetFileNameWithoutExtension(path));
                GlbFile file = new GlbFile(); file.FileName = Path.GetFileName(path); file.Stem = Path.GetFileNameWithoutExtension(path); file.Title = Pretty(file.Stem);
                file.Kind = Regex.IsMatch(file.Stem, "door|gate", RegexOptions.IgnoreCase) ? "door" : "prop";
                file.Warnings.Add(file.FileName + ": mesh import rebuilds materials and collision; original shader effects, animations, skeleton and physics are not preserved.");
                if (doc.Doc.SelectSingleNode("/Drawable/Skeleton/Bones/Item[2]") != null)
                    throw new InvalidDataException("This YDR has multiple bones. Skinned/animated drawables need a static mesh before placement; importing them as a rigid prop would be incorrect.");
                Dictionary<string, Texture> textures = new Dictionary<string, Texture>(StringComparer.OrdinalIgnoreCase);
                // Explicitly imported dictionaries only: no GTA installation scan.
                string[] dictionaries = Directory.GetFiles(Path.GetDirectoryName(path), "*.ytd"); Array.Sort(dictionaries, StringComparer.OrdinalIgnoreCase);
                string own = Path.ChangeExtension(path, ".ytd");
                List<string> ordered = new List<string>(dictionaries); if (File.Exists(own)) { ordered.RemoveAll(delegate(string s) { return s.Equals(own, StringComparison.OrdinalIgnoreCase); }); ordered.Add(own); }
                foreach (string dictionary in ordered)
                {
                    try {
                        YtdFile ytd = new YtdFile(); ytd.Load(File.ReadAllBytes(dictionary));
                        if (ytd.TextureDict != null && ytd.TextureDict.Textures != null) foreach (Texture t in ytd.TextureDict.Textures.data_items) textures[t.Name.ToString()] = t;
                    } catch (Exception ex) { file.Warnings.Add(Path.GetFileName(dictionary) + ": " + ex.Message); }
                }
                // Embedded textures have priority over external names.
                foreach (string dds in Directory.GetFiles(scratch, "*.dds", SearchOption.AllDirectories)) textures[Path.GetFileNameWithoutExtension(dds)] = CodeWalker.Utils.DDSIO.GetTexture(File.ReadAllBytes(dds));
                return ConvertYdr(doc, file, textures);
            }
            finally { try { Directory.Delete(scratch, true); } catch { } }
        }
        public static GlbFile FromGameDrawable(YdrFile ydr, string name, Dictionary<string, Texture> textures)
        {
            var doc = ModelDoc.Load(ydr, null, name);
            if (doc.Doc.SelectSingleNode("/Drawable/Skeleton/Bones/Item[2]") != null) throw new InvalidDataException("This model has multiple bones. The catalogue preview supports rigid YDR models only; skinned or animated props cannot be placed yet");
            var file = new GlbFile(); file.FileName = name + ".ydr"; file.Stem = name; file.Title = Pretty(name); file.Kind = "prop";
            return ConvertYdr(doc, file, textures);
        }
        static GlbFile ConvertYdr(ModelDoc doc, GlbFile file, Dictionary<string, Texture> textures)
        {
                Dictionary<int, int> materials = new Dictionary<int, int>();
                GlbModel model = new GlbModel(); model.Id = "ydr_" + SafeId(file.Stem); model.Name = file.Title; model.Key = model.Id;
                foreach (GeomData source in doc.Geoms)
                {
                    if (source.Lod != 0) continue;
                    if (source.VertCount > 65535) throw new InvalidDataException("YDR geometry exceeds the editor's 65535 vertex limit.");
                    int mat;
                    if (!materials.TryGetValue(source.Shader, out mat))
                    {
                        GlbMat material = new GlbMat(); material.Name = source.Tex; material.Glass = source.ShaderName.IndexOf("glass", StringComparison.OrdinalIgnoreCase) >= 0;
                        material.Key = "y" + JenkHash.GenHash(file.Stem.ToLowerInvariant()).ToString("x8") + "_" + source.Shader;
                        Texture texture;
                        if (!material.Glass && textures.TryGetValue(source.Tex, out texture) && texture != null)
                        {
                            GlbTex t = YdrTexture(texture, material.Key); material.Tex = file.Texs.Count; file.Texs.Add(t);
                            long r = 0, g = 0, b = 0;
                            for (int i = 0; i < t.Rgba.Length; i += 4) { r += t.Rgba[i]; g += t.Rgba[i + 1]; b += t.Rgba[i + 2]; }
                            double count = t.Rgba.Length / 4.0 * 255;
                            material.AvgR = (float)(r / count); material.AvgG = (float)(g / count); material.AvgB = (float)(b / count); material.Key = t.Name;
                        }
                        else if (!material.Glass) { material.R = material.G = material.B = material.AvgR = material.AvgG = material.AvgB = 0.7f; file.Warnings.Add(file.FileName + ": diffuse texture '" + source.Tex + "' missing; import its YTD. A grey material is used."); }
                        mat = file.Mats.Count; file.Mats.Add(material); materials[source.Shader] = mat;
                    }
                    GlbGeom geometry = new GlbGeom(); geometry.Mat = mat; geometry.Pos = new float[source.VertCount * 3]; geometry.Nrm = new float[source.VertCount * 3]; geometry.Uv = new float[source.VertCount * 2]; geometry.Idx = source.Idx;
                    for (int v = 0; v < source.VertCount; v++)
                    {
                        for (int axis = 0; axis < 3; axis++) {
                            float value = source.V[v * source.Stride + source.PosOff + axis]; geometry.Pos[v * 3 + axis] = value;
                            geometry.Nrm[v * 3 + axis] = source.NrmOff < 0 ? (axis == 2 ? 1 : 0) : source.V[v * source.Stride + source.NrmOff + axis];
                            model.Min[axis] = Math.Min(model.Min[axis], value); model.Max[axis] = Math.Max(model.Max[axis], value);
                        }
                        if (source.UvOff >= 0) for (int axis = 0; axis < 2; axis++) geometry.Uv[v * 2 + axis] = source.V[v * source.Stride + source.UvOff + axis];
                    }
                    model.Geoms.Add(geometry); model.Tris += geometry.Idx.Length / 3;
                }
                if (model.Geoms.Count == 0) throw new InvalidDataException("The YDR has no readable high-detail geometry.");
                model.MeasureCore(); model.MeasureInner(); file.Models.Add(model); return file;
        }
    }
}
