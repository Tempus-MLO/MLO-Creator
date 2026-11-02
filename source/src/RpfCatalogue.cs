// Read-only GTA archive catalogue. Only metadata is persisted; selected drawables
// and texture dictionaries are decoded in memory and never copied to projects.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using CodeWalker.GameFiles;

namespace MloCreator
{
    public class CatalogueArchiveEntry
    {
        public string Key, Name, Archive, Path;
        public RpfFile Owner;
        public RpfFileEntry Entry;
    }
    public static partial class Vanilla
    {
        public static List<CatalogueArchiveEntry> CatalogueEntries()
        {
            lock (gate) {
                if (rpf == null) throw new InvalidOperationException("Initialize GTA archives first");
                var result = new List<CatalogueArchiveEntry>();
                foreach (RpfFile archive in rpf.AllRpfs) {
                    if (archive.Path.Replace('/', '\\').StartsWith("mods\\", StringComparison.OrdinalIgnoreCase) || archive.AllEntries == null) continue;
                    foreach (RpfEntry item in archive.AllEntries) {
                        var entry = item as RpfFileEntry; if (entry == null) continue;
                        string name = entry.Name.ToLowerInvariant();
                        if (!name.EndsWith(".ydr") && !name.EndsWith(".ytd") && !name.EndsWith(".ytyp")) continue;
                        string path = archive.Path + "|" + entry.Path;
                        result.Add(new CatalogueArchiveEntry { Key = path.ToLowerInvariant(), Name = name, Archive = archive.Path, Path = entry.Path, Owner = archive, Entry = entry });
                    }
                }
                return result;
            }
        }
    }
    public class CatalogueDependency
    {
        public string Name, Evidence;
        public List<string> Locations = new List<string>();
    }
    public class CatalogueRecord
    {
        public string Id, Name, Archive, EntryPath, Category, Archetype, ArchetypeSource;
        public List<CatalogueDependency> Dependencies = new List<CatalogueDependency>();
        public List<string> Tags = new List<string>();
        public string Description, LabelSource, Kind;
        public bool Pilot;
    }
    public class CatalogueCache
    {
        public string Signature;
        public List<CatalogueRecord> Records;
        public List<string> Warnings;
    }
    public static class RpfCatalogue
    {
        static readonly object gate = new object();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 100 };
        public static readonly string[] PilotNames = { "prop_chair_01a", "prop_chair_02", "prop_table_02", "prop_table_04", "prop_table_05", "v_res_cabinet", "prop_tv_flat_01", "prop_microwave_1", "prop_kettle", "v_res_tre_smallbookshelf" };
        static List<CatalogueRecord> records = new List<CatalogueRecord>();
        static Dictionary<string, CatalogueArchiveEntry> entries = new Dictionary<string, CatalogueArchiveEntry>();
        static Dictionary<string, CatalogueArchiveEntry> models = new Dictionary<string, CatalogueArchiveEntry>();
        static Dictionary<string, GlbFile> decoded = new Dictionary<string, GlbFile>();
        static Queue<string> lru = new Queue<string>();
        static List<CatalogueRecord> browseRecords = new List<CatalogueRecord>();
        static Dictionary<string,string> searchText = new Dictionary<string,string>();
        public static bool ValidModelName(string name) { return !string.IsNullOrEmpty(name) && name.Length <= 150 && System.Text.RegularExpressions.Regex.IsMatch(name,"^[a-z0-9_]+$"); }
        static void RebuildBrowse() {
            browseRecords = records.GroupBy(r=>r.Name).Select(g=>g.OrderBy(r=>r.Archetype == null ? 1 : 0).ThenBy(r=>r.Archive.StartsWith("update",StringComparison.OrdinalIgnoreCase)?1:0).ThenBy(r=>r.Archive,StringComparer.Ordinal).First()).OrderBy(r=>r.Name,StringComparer.Ordinal).ToList();
            searchText = browseRecords.ToDictionary(r=>r.Id,r=>(r.Name+" "+r.Archive+" "+r.EntryPath+" "+r.Description+" "+string.Join(" ",r.Tags)).ToLowerInvariant());
        }
        public static Dictionary<string,object> Browse(string query,string category,string scope,int offset,int limit,string order) {
            lock(gate) {
                if (!Ready) throw new InvalidOperationException("Index the local GTA installation first");
                if (scope != "props" && scope != "building" && scope != "interior") throw new InvalidDataException("Invalid catalogue scope");
                var words=(query??"").ToLowerInvariant().Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries);
                IEnumerable<CatalogueRecord> rows=browseRecords.Where(r=>(scope=="building" ? r.Kind!="prop" : r.Kind=="prop" && (scope!="interior" || IsInterior(r.Name))) && (string.IsNullOrEmpty(category) || category=="all" || r.Category==category) && words.All(w=>searchText[r.Id].Contains(w)));
                if(order=="file") rows=rows.OrderBy(r=>r.Archive,StringComparer.Ordinal).ThenBy(r=>r.EntryPath,StringComparer.Ordinal).ThenBy(r=>r.Id,StringComparer.Ordinal);
                var hits=rows.ToList();int start=Math.Max(0,offset),size=Math.Max(1,Math.Min(100,limit));
                return new Dictionary<string,object>{{"ok",true},{"total",hits.Count},{"offset",start},{"limit",size},{"items",hits.Skip(start).Take(size).ToList()},{"geometryReads",GeometryReads}};
            }
        }
        static List<string> warnings = new List<string>();
        static string signature, root;
        public static volatile string Status = "";
        public static int GeometryReads { get; private set; }
        public static bool Ready { get { return signature != null; } }
        static string Id(string value) { using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant(); }
        public static bool IsPilot(string name) { return Array.IndexOf(PilotNames, name) >= 0; }
        public static string BuildingKind(string name) {
            if (string.IsNullOrEmpty(name) || !System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-z0-9_]+$")) return null;
            if (name.Contains("door") || name.Contains("gate") || name.Contains("garage")) return "door";
            if (name.Contains("window") || name.Contains("winframe")) return "window";
            return null;
        }
        public static bool IsInterior(string name) {
            if (IsPilot(name)) return true;
            if (BuildingKind(name) != null || string.IsNullOrEmpty(name) || !System.Text.RegularExpressions.Regex.IsMatch(name,"^[a-z0-9_]+$")) return false;
            return System.Text.RegularExpressions.Regex.IsMatch(name, @"(^|_)(chair|armchair|sofa|couch|stool|bench|table|desk|shelf|shelves|bookshelf|cabinet|cupboard|wardrobe|bed|bedside|bedframe|bookcase|smallbookshelf|largebookshelf|lamp|lampstand|lamptbl|kettle|microwave|tv)(_|[0-9]|$)");
        }
        public static List<CatalogueRecord> InteriorRows() {
            return records.Where(r => IsInterior(r.Name) && r.Archetype != null).GroupBy(r=>r.Name).Select(g=>g.OrderBy(r=>r.Archive.StartsWith("update",StringComparison.OrdinalIgnoreCase)?1:0).ThenBy(r=>r.Archive,StringComparer.Ordinal).First()).OrderBy(r=>r.Name).ToList();
        }
        static readonly string[][] CategoryRules = {
            new[]{"Seating","chair","sofa","couch","stool","bench"},
            new[]{"Tables & Desks","table","desk"},
            new[]{"Storage","shelf","shelves","cabinet","cupboard","wardrobe","bookcase","drawer","locker"},
            new[]{"Kitchen","microwave","kettle","fridge","toaster","cooker","coffee","saucepan","frying","plate","cutlery","dish","kitchen"},
            new[]{"Electronics","tv_","television","laptop","computer","monitor","keyboard","mouse","printer","speaker","radio","phone","console"},
            new[]{"Lighting","lamp","light","chandelier","lantern"},
            new[]{"Bedroom","bed","mattress","pillow","duvet"},
            new[]{"Bathroom","toilet","bathtub","shower","sink","towel","soap","bathroom"},
            new[]{"Plants","plant","flower","palm","bush","tree","fern","cactus","pot_plant"},
            new[]{"Tools & Workshop","tool","hammer","wrench","drill","saw","workbench","vice","ladder","welder","screwdriver"},
            new[]{"Food & Drink","food","burger","pizza","sandwich","fruit","apple","banana","orange","bread","cake","donut","beer","wine","bottle","drink","soda","cup_"},
            new[]{"Rubbish & Debris","rubbish","trash","garbage","bin_","dumpster","debris","litter","rubble","scrap"},
            new[]{"Office & Small Items","book","paper","folder","file_","pen_","pencil","clipboard","notepad","magazine","clock"},
            new[]{"Sports & Leisure","sport","gym","barbell","dumbbell","tennis","golf","basketball","football","poolball","bicycle","skate"},
            new[]{"Signs & Street","sign","traffic","bollard","barrier","roadcone","cone_","parking","street","busstop","hydrant"},
            new[]{"Containers & Industrial","crate","box_","pallet","barrel","container","tank","pipe","cable","generator","industrial"},
            new[]{"Decorations","vase","painting","picture","frame","sculpt","statue","rug","carpet","curtain","cushion","ornament"},
            new[]{"Buildings & Structure","building","wall","roof","floor","stairs","stair","ceiling","pillar","column","fence","bridge"}
        };
        static string Category(string name) {
            string kind = BuildingKind(name);
            if(kind=="window") return "Windows";
            if(kind=="door") return name.Contains("gate") || name.Contains("garage") ? "Gates & Garages" : "Doors";
            foreach(var rule in CategoryRules) if(rule.Skip(1).Any(word=>name.Contains(word))) return rule[0];
            return "Other / Uncategorised";
        }
        static string Fingerprint(string gta) {
            var s = new StringBuilder(Path.GetFullPath(gta).ToLowerInvariant());
            foreach (string path in Directory.GetFiles(gta, "*.rpf", SearchOption.AllDirectories).OrderBy(p => p, StringComparer.OrdinalIgnoreCase)) {
                var file = new FileInfo(path); s.Append('|').Append(path.ToLowerInvariant()).Append(':').Append(file.Length).Append(':').Append(file.LastWriteTimeUtc.Ticks);
            }
            return Id(s.ToString());
        }
        public static Dictionary<string, object> Build(string gta, string cache, bool force)
        {
            lock (gate) {
                string gameRoot = Path.GetFullPath(gta).TrimEnd('\\', '/');
                string cacheRoot = Path.GetFullPath(cache).TrimEnd('\\', '/');
                if (cacheRoot.Equals(gameRoot, StringComparison.OrdinalIgnoreCase) || cacheRoot.StartsWith(gameRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The catalogue cache must be outside the GTA installation");
                Status = "Scanning archive metadata…";
                try {
                    string stamp = Fingerprint(gameRoot);
                    if (!force && signature == stamp) return Summary();
                    Vanilla.Init(gameRoot, cacheRoot, force || (signature != null && signature != stamp));
                    var all = Vanilla.CatalogueEntries(); entries = all.ToDictionary(e => e.Key);
                    models = new Dictionary<string, CatalogueArchiveEntry>(); decoded.Clear(); lru.Clear(); GeometryReads = 0;
                    var list = new List<CatalogueRecord>(); warnings = new List<string>();
                    string cacheFile = Path.Combine(cacheRoot, "rpf_catalogue_v1.json");
                    if (!force && File.Exists(cacheFile)) {
                        try { var old = json.Deserialize<CatalogueCache>(File.ReadAllText(cacheFile)); if (old.Signature == stamp) { list = old.Records; warnings = old.Warnings ?? warnings; } } catch (Exception) { }
                    }
                    if (list.Count == 0) {
                        var dictionaries = all.Where(e => e.Name.EndsWith(".ytd")).GroupBy(e => JenkHash.GenHash(Path.GetFileNameWithoutExtension(e.Name))).ToDictionary(g => g.Key, g => g.ToList());
                        var definitions = new Dictionary<uint, List<Tuple<Archetype, CatalogueArchiveEntry>>>();
                        int n = 0;
                        foreach (var entry in all.Where(e => e.Name.EndsWith(".ytyp"))) {
                            if (++n % 100 == 0) Status = "Reading archetype / YTD metadata: " + n;
                            try {
                                var ytyp = new YtypFile(); ytyp.Load(entry.Owner.ExtractFile(entry.Entry), entry.Entry);
                                if (ytyp.AllArchetypes == null) continue;
                                foreach (var a in ytyp.AllArchetypes) {
                                    uint asset = a.BaseArchetypeDef.assetName.Hash;
                                    List<Tuple<Archetype, CatalogueArchiveEntry>> variants;
                                    if (!definitions.TryGetValue(asset, out variants)) { variants = new List<Tuple<Archetype, CatalogueArchiveEntry>>(); definitions[asset] = variants; }
                                    variants.Add(Tuple.Create(a, entry));
                                }
                            } catch (Exception ex) { if (warnings.Count < 30) warnings.Add(entry.Archive + ": " + ex.Message); }
                        }
                        foreach (var entry in all.Where(e => e.Name.EndsWith(".ydr"))) {
                            string name = Path.GetFileNameWithoutExtension(entry.Name);
                            var row = new CatalogueRecord { Id = Id(entry.Key), Name = name, Archive = entry.Archive, EntryPath = entry.Path, Category = Category(name), Pilot = IsPilot(name) };
                            List<Tuple<Archetype, CatalogueArchiveEntry>> defs;
                            if (definitions.TryGetValue(JenkHash.GenHash(name), out defs)) {
                                var definition = defs.OrderByDescending(d => CommonPrefix(entry.Archive, d.Item2.Archive)).ThenBy(d => d.Item2.Key, StringComparer.Ordinal).First();
                                row.Archetype = definition.Item1.Name; row.ArchetypeSource = definition.Item2.Key;
                                uint txd = definition.Item1.TextureDict.Hash;
                                List<CatalogueArchiveEntry> hits;
                                if (txd != 0) {
                                    var dep = new CatalogueDependency { Name = "hash_" + txd.ToString("x8"), Evidence = "YTYP textureDictionary" };
                                    if (dictionaries.TryGetValue(txd, out hits)) { dep.Name = hits[0].Name; dep.Locations.AddRange(hits.Select(h => h.Key)); }
                                    row.Dependencies.Add(dep);
                                }
                            }
                            List<CatalogueArchiveEntry> sameName;
                            if (dictionaries.TryGetValue(JenkHash.GenHash(name), out sameName) && !row.Dependencies.Any(d => d.Name == sameName[0].Name)) row.Dependencies.Add(new CatalogueDependency { Name = sameName[0].Name, Evidence = "same-name candidate (not a proven dependency)", Locations = sameName.Select(d => d.Key).ToList() });
                            list.Add(row);
                        }
                        Directory.CreateDirectory(cacheRoot);
                        File.WriteAllText(cacheFile, json.Serialize(new CatalogueCache { Signature = stamp, Records = list, Warnings = warnings }), Encoding.UTF8);
                    }
                    foreach (var row in list) { row.Kind = BuildingKind(row.Name) ?? "prop"; row.Pilot = IsPilot(row.Name); row.Category = Category(row.Name); CatalogueArchiveEntry entry; if (entries.TryGetValue((row.Archive + "|" + row.EntryPath).ToLowerInvariant(), out entry)) models[row.Id] = entry; }
                    records = list; RebuildBrowse(); root = gameRoot; signature = stamp;
                    return Summary();
                } finally { Status = ""; }
            }
        }
        static int CommonPrefix(string a, string b) { int n = 0; while (n < a.Length && n < b.Length && char.ToLowerInvariant(a[n]) == char.ToLowerInvariant(b[n])) n++; return n; }
        public static Dictionary<string, object> Summary() {
            return new Dictionary<string, object> { { "ok", true }, { "root", root ?? Vanilla.GtaPath }, { "models", records.Count }, { "geometryReads", GeometryReads }, { "warnings", warnings }, { "pilot", PilotRows() }, { "uniqueModels", browseRecords.Count } };
        }
        public static List<CatalogueRecord> PilotRows() {
            return records.Where(r => r.Pilot).GroupBy(r => r.Name).Select(g => g.OrderBy(r => r.Archive.StartsWith("update", StringComparison.OrdinalIgnoreCase) ? 1 : 0).ThenBy(r => r.Archive, StringComparer.Ordinal).First()).OrderBy(r => r.Name).ToList();
        }
        public static List<CatalogueRecord> BuildingRows() {
            return records.Where(r => r.Kind == "door" || r.Kind == "window").GroupBy(r => r.Name).Select(g => g.OrderBy(r => r.Archetype == null ? 1 : 0).ThenBy(r => r.Archive.StartsWith("update", StringComparison.OrdinalIgnoreCase) ? 1 : 0).ThenBy(r => r.Archive, StringComparer.Ordinal).First()).OrderBy(r => r.Name).ToList();
        }
        public static Dictionary<string, object> Search(string query, string category, int offset, int limit) {
            lock (gate) {
                string[] words = (query ?? "").ToLowerInvariant().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                var found = records.Where(r => (string.IsNullOrEmpty(category) || category == "all" || r.Category == category) && words.All(w => (r.Name + " " + r.Archive + " " + r.Description + " " + string.Join(" ", r.Tags)).ToLowerInvariant().Contains(w))).OrderBy(r => r.Name).ThenBy(r => r.Archive);
                return new Dictionary<string, object> { { "ok", true }, { "total", found.Count() }, { "items", found.Skip(Math.Max(0, offset)).Take(Math.Max(1, Math.Min(100, limit))).ToList() }, { "geometryReads", GeometryReads } };
            }
        }
        public static CatalogueRecord Record(string id) { return records.FirstOrDefault(r => r.Id == id); }
        public static Dictionary<string, object> ImportLabels(string path) {
            lock (gate) {
                if (!Ready) throw new InvalidOperationException("Index the local GTA installation first");
                var info = new FileInfo(path); if (!info.Exists || info.Length > 30 * 1024 * 1024 || !info.Extension.Equals(".json", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Choose a props_export.json file smaller than 30 MB");
                var labels = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
                object parsed = json.DeserializeObject(File.ReadAllText(path));
                if (!(parsed is object[])) throw new InvalidDataException("Expected a JSON array of prop metadata");
                foreach (object value in J.A(parsed)) {
                    var item = J.O(value); string name = J.S(J.G(item, "name"), ""); if (name.Length > 0 && name.Length < 150) labels[name] = item;
                }
                int matches = 0;
                foreach (var row in records) {
                    row.Tags.Clear(); row.Description = null; row.LabelSource = null;
                    Dictionary<string, object> label; if (!labels.TryGetValue(row.Name, out label)) continue;
                    row.Tags = J.A(J.G(label, "tags")).Select(t => J.S(t, "")).Where(t => t.Length > 0 && t.Length <= 60).Take(40).ToList();
                    row.Description = J.S(J.G(label, "description"), ""); if (row.Description.Length > 1200) row.Description = row.Description.Substring(0, 1200);
                    row.LabelSource = "External AI metadata (unverified)"; matches++;
                }
                RebuildBrowse(); var response = Summary(); response["labelMatches"] = matches; return response;
            }
        }
        public static GlbFile Load(string id) {
            lock (gate) {
                var row = Record(id); if (row == null || !ValidModelName(row.Name) || string.IsNullOrEmpty(row.Archetype)) throw new InvalidOperationException("This archive entry has no known standalone archetype; it cannot be placed as an original game object");
                GlbFile ready; if (decoded.TryGetValue(id, out ready)) return ready;
                CatalogueArchiveEntry source; if (!models.TryGetValue(id, out source)) throw new InvalidOperationException("Archive entry is no longer available; rebuild the catalogue");
                var ydr = new YdrFile(); ydr.Load(source.Owner.ExtractFile(source.Entry), source.Entry); GeometryReads++;
                var textures = new Dictionary<string, Texture>(StringComparer.OrdinalIgnoreCase);
                foreach (var dep in row.Dependencies) {
                    var location = dep.Locations.Where(k => entries.ContainsKey(k)).OrderByDescending(k => CommonPrefix(source.Archive, entries[k].Archive)).ThenBy(k => k, StringComparer.Ordinal).FirstOrDefault();
                    if (location == null) continue;
                    var entry = entries[location]; var ytd = new YtdFile(); ytd.Load(entry.Owner.ExtractFile(entry.Entry), entry.Entry);
                    if (ytd.TextureDict != null && ytd.TextureDict.Textures != null) foreach (Texture texture in ytd.TextureDict.Textures.data_items) textures[texture.Name.ToString()] = texture;
                }
                var embedded = ydr.Drawable == null || ydr.Drawable.ShaderGroup == null ? null : ydr.Drawable.ShaderGroup.TextureDictionary;
                if (embedded != null && embedded.Textures != null) foreach (Texture texture in embedded.Textures.data_items) textures[texture.Name.ToString()] = texture;
                ready = GlbFile.FromGameDrawable(ydr, row.Name, textures); ready.FileName = "gta:" + id;
                ready.Models[0].Id = "gta:" + id;
                decoded[id] = ready; lru.Enqueue(id); while (lru.Count > 10) decoded.Remove(lru.Dequeue());
                return ready;
            }
        }
    }
}
