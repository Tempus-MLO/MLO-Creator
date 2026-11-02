using System;
using System.Collections.Generic;

namespace MloCreator
{
    public static partial class ImportHost
    {
        public static Dictionary<string, object> CatalogueModel(GlbFile g, CatalogueRecord record)
        {
            var file = new Dictionary<string, object> { { "file", g.FileName }, { "kind", "prop" }, { "title", g.Title }, { "warnings", g.Warnings }, { "game", record } };
            var mats = new List<object>();
            foreach (GlbMat m in g.Mats) mats.Add(new Dictionary<string, object> { { "name", m.Name }, { "key", m.Key }, { "color", new double[] { m.AvgR, m.AvgG, m.AvgB, m.A } }, { "tex", m.Tex < 0 ? "" : g.Texs[m.Tex].Name }, { "glass", m.Glass } });
            file["mats"] = mats;
            var textures = new List<object>();
            foreach (GlbTex t in g.Texs) textures.Add(new Dictionary<string, object> { { "name", t.Name }, { "w", t.Size }, { "h", t.Size }, { "rgba", Convert.ToBase64String(t.Rgba) } });
            var models = new List<object>();
            foreach (GlbModel m in g.Models) {
                var geoms = new List<object>();
                foreach (GlbGeom gg in m.Geoms) {
                    var ix = new ushort[gg.Idx.Length]; for (int i = 0; i < ix.Length; i++) ix[i] = checked((ushort)gg.Idx[i]);
                    geoms.Add(new Dictionary<string, object> { { "mat", gg.Mat }, { "pos", B64(gg.Pos) }, { "nrm", B64(gg.Nrm) }, { "uv", B64(gg.Uv) }, { "idx", B64(ix) } });
                }
                models.Add(new Dictionary<string, object> { { "id", m.Id }, { "name", m.Name }, { "min", m.Min }, { "max", m.Max }, { "tris", m.Tris }, { "geoms", geoms } });
            }
            file["models"] = models;
            return new Dictionary<string, object> { { "files", new object[] { file } }, { "textures", textures } };
        }
    }
}
