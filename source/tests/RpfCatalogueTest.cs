using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using CodeWalker.GameFiles;
using MloCreator;

class RpfCatalogueTest
{
    static void Check(bool test, string message) { if (!test) throw new Exception(message); }
    static Dictionary<string,object> D(params object[] a) { var d=new Dictionary<string,object>();for(int i=0;i<a.Length;i+=2)d[(string)a[i]]=a[i+1];return d; }
    static string B64(Array a) { byte[] b=new byte[Buffer.ByteLength(a)];Buffer.BlockCopy(a,0,b,0,b.Length);return Convert.ToBase64String(b); }
    static void Main(string[] args)
    {
        string gta = Path.GetFullPath(args[0]), cache = Path.GetFullPath(args[1]);
        ImportHost.Init(cache+"-projects",cache);
        var before = Directory.GetFiles(gta, "*.rpf", SearchOption.AllDirectories).ToDictionary(p => p, p => new FileInfo(p).Length + ":" + File.GetLastWriteTimeUtc(p).Ticks);
        Console.WriteLine("Indexing local RPF metadata; no drawable loads requested...");
        var summary = RpfCatalogue.Build(gta, cache, false);
        Console.WriteLine("YDR index: " + summary["models"] + ", geometry reads: " + RpfCatalogue.GeometryReads);
        Check(RpfCatalogue.GeometryReads == 0, "Indexing must not load model geometry");
        var search = RpfCatalogue.Search("chair", "Seating", 0, 10);
        Check((int)search["total"] > 0 && RpfCatalogue.GeometryReads == 0, "Search must be metadata only");
        var allPage=RpfCatalogue.Browse("","all","props",0,100,"name");
        var nextPage=RpfCatalogue.Browse("","all","props",100,100,"name");
        var firstRows=(List<CatalogueRecord>)allPage["items"];var nextRows=(List<CatalogueRecord>)nextPage["items"];
        Check((int)allPage["total"]>RpfCatalogue.InteriorRows().Count && firstRows.Count==100 && nextRows.Count==100,"All-prop browsing did not expand/page results");
        Check(!firstRows.Select(r=>r.Name).Intersect(nextRows.Select(r=>r.Name)).Any() && firstRows.All(r=>r.Kind=="prop"),"Duplicate pagination or building entries in props");
        Check(((List<CatalogueRecord>)RpfCatalogue.Browse("","all","props",0,999,"name")["items"]).Count==100,"Page size must be capped");
        Check(((List<CatalogueRecord>)RpfCatalogue.Browse("","all","props",int.MaxValue,24,"name")["items"]).Count==0,"Out-of-range pages must be empty");
        foreach(string category in new[]{"Plants","Tools & Workshop","Food & Drink","Rubbish & Debris","Other / Uncategorised"})Check((int)RpfCatalogue.Browse("",category,"props",0,24,"name")["total"]>0,"Missing category "+category);
        Check((int)RpfCatalogue.Browse("prop_tool_hammer","Tools & Workshop","props",0,24,"name")["total"]>0,"Exact tool search failed");
        Check((int)RpfCatalogue.Browse("prop_tool_hammer","all","interior",0,24,"name")["total"]==0,"Interior subset ignored");
        Check(RpfCatalogue.GeometryReads==0,"Browsing pages/categories loaded geometry");
        Console.WriteLine("PASS: all-prop metadata browsing, stable unique pages, category/search scopes, bounded responses; "+allPage["total"]+" prop candidates");
        var pilot = RpfCatalogue.PilotRows();
        Console.WriteLine("Pilot entries found: " + pilot.Count);
        Check(pilot.Count == 10, "Expected all ten interior pilot props");
        var outcomes = new List<object>();
        var placements = new List<object>(); int successes = 0;
        foreach (string name in RpfCatalogue.PilotNames) {
            var row = pilot.FirstOrDefault(r => r.Name == name);
            if (row == null) { Console.WriteLine("MISSING: " + name); continue; }
            Console.WriteLine("SELECT " + row.Name + " | " + row.Archive + " | YTD: " + string.Join(",", row.Dependencies.Select(d => d.Name)));
            try {
                var model = RpfCatalogue.Load(row.Id);
                Console.WriteLine("  triangles=" + model.Models[0].Tris + ", textures=" + model.Texs.Count + ", warnings=" + model.Warnings.Count);
                foreach (string warning in model.Warnings) Console.WriteLine("  " + warning);
                Check(model.Models[0].Tris > 0, "Empty model");
                Check(model.Texs.Count > 0 && model.Warnings.Count == 0, "Pilot textures did not resolve cleanly");
                var geometry = model.Models[0];
                placements.Add(D("source","gta","kind","prop","gameName",row.Archetype,"gameId",row.Id,"gameMin",geometry.Min,"gameMax",geometry.Max,"cx",successes*3,"cy",2,"zb",0,"yaw",Math.PI/4,"w",geometry.W,"d",geometry.D,"h",geometry.H));
                successes++;
                int reads = RpfCatalogue.GeometryReads;
                Check(object.ReferenceEquals(model, RpfCatalogue.Load(row.Id)) && reads == RpfCatalogue.GeometryReads, "Selected model cache failed");
                outcomes.Add(new { name = row.Name, archive = row.Archive, archetype = row.Archetype, dependencies = row.Dependencies, triangles = model.Models[0].Tris, textures = model.Texs.Count, warnings = model.Warnings });
            } catch (Exception ex) { Console.WriteLine("  FAILED: " + ex.Message); outcomes.Add(new { name = row.Name, error = ex.Message }); }
        }
        Check(successes == 10, "Every pilot prop must load successfully");
        var interiors=RpfCatalogue.InteriorRows();
        Console.WriteLine("Expanded interior candidates: "+interiors.Count);
        Check(interiors.Count>10 && RpfCatalogue.GeometryReads==10,"Expanded catalogue eagerly loaded geometry or did not expand");
        foreach(string extra in new [] {"prop_chair_03","v_res_tre_sofa","v_res_m_lampstand"}) {
            var candidate=interiors.First(r=>r.Name==extra);var selected=RpfCatalogue.Load(candidate.Id);
            Check(selected.Models[0].Tris>0,"Additional candidate has no geometry");
            Console.WriteLine("EXTRA "+extra+": triangles="+selected.Models[0].Tris+", textures="+selected.Texs.Count+", warnings="+selected.Warnings.Count);
        }
        ((Dictionary<string,object>)placements[0])["frozen"]=true;
        // Export native references with a small floor created entirely by this test.
        float[] verts={0,0,0,40,0,0,0,10,0};
        var exportModel=D("resource","native_pilot","prefix","native","groups",new object[]{D("name","floor","room",1,"mats",new object[]{D("tex","floor","pos",B64(verts),"nrm",B64(new float[]{0,0,1,0,0,1,0,0,1}),"uv",B64(new float[]{0,0,1,0,0,1}),"idx",B64(new int[]{0,1,2}))})},"textures",new object[]{D("name","floor","size",4,"rgba",Convert.ToBase64String(new byte[64]))},"collision",D("verts",B64(verts),"tris",B64(new int[]{0,1,2,0})),"fitted",D("project","pilot","items",placements));
        string output=cache+"-export";var exported=Exporter.Run(exportModel,output);Check((bool)exported["ok"],new JavaScriptSerializer().Serialize(exported));
        string stream=Path.Combine(output,"native_pilot","stream");
        Check(Directory.GetFiles(stream,"*.ydr").Length==1 && Directory.GetFiles(stream,"*.ytd").Length==1,"Export copied game models/textures instead of only the test floor");
        var ytyp=new YtypFile();ytyp.Load(File.ReadAllBytes(Path.Combine(stream,"native_types.ytyp")));
        var mlo=ytyp.AllArchetypes.OfType<MloArchetype>().Single();Check(mlo.entities.Length==11,"Expected floor + ten native entities");Check(ytyp.AllArchetypes.Length==2,"Native archetypes must not be redefined");
        uint frozenFlags=mlo.entities.First(e=>e._Data.archetypeName.Hash==JenkHash.GenHash("prop_chair_01a"))._Data.flags;
        uint looseFlags=mlo.entities.First(e=>e._Data.archetypeName.Hash==JenkHash.GenHash("prop_chair_02"))._Data.flags;
        Check((frozenFlags&32)==32 && (looseFlags&32)==0 && (frozenFlags&4)==0 && (looseFlags&4)==0,"Freeze flag must be per placement and preserve collision");
        Console.WriteLine("PASS: binary MLO static flag only on selected furniture; original collision flags preserved");
        Console.WriteLine("PASS: reference-only binary export, ten native MLO entities, no redefined native archetypes");
        var building = RpfCatalogue.BuildingRows();
        Check(building.Count > 0 && building.All(r => r.Kind == "door" || r.Kind == "window"), "Building catalogue scope failed");
        Console.WriteLine("Building candidates: " + building.Count + "; windows=" + building.Count(r=>r.Kind=="window"));
        var doorRow = building.First(r=>r.Name=="prop_gar_door_01");
        var doorModel = RpfCatalogue.Load(doorRow.Id).Models[0];
        var nativeDoors = new List<object>(); int doorIndex = 0;
        foreach (string type in new [] { "hinged", "garage", "sliding", "tilt" }) nativeDoors.Add(D("source","gta","kind","door","id","door"+doorIndex,"doorType",type,"gameName",doorRow.Name,"gameMin",doorModel.Min,"gameMax",doorModel.Max,"cx",++doorIndex*5,"cy",2,"zb",0,"yaw",Math.PI/4,"w",doorModel.W,"d",doorModel.D,"h",doorModel.H,"travel",type=="hinged"||type=="tilt"?90:3,"speed",type=="hinged"||type=="tilt"?45:1,"autoOpen",true));
        exportModel["fitted"] = D("project","pilot","items",nativeDoors);
        string doorOutput=cache+"-doors-export";var doorExport=Exporter.Run(exportModel,doorOutput);Check((bool)doorExport["ok"],new JavaScriptSerializer().Serialize(doorExport));
        string doorRoot=Path.Combine(doorOutput,"native_pilot"), doorStream=Path.Combine(doorRoot,"stream");
        Check(Directory.GetFiles(doorStream,"*.ydr").Length==1 && Directory.GetFiles(doorStream,"*.ytd").Length==1,"Native doors copied assets");
        var doorYtyp=new YtypFile();doorYtyp.Load(File.ReadAllBytes(Path.Combine(doorStream,"native_types.ytyp")));
        Check(doorYtyp.AllArchetypes.OfType<MloArchetype>().Single().entities.Length==1,"Managed native doors duplicated in MLO entities");
        string rows=File.ReadAllText(Path.Combine(doorRoot,"doors.lua"));
        Check(rows.Split(new []{"native=true"},StringSplitOptions.None).Length==5 && rows.Contains("originX=") && rows.Contains("model='prop_gar_door_01'"),"Missing native controller origins/references");
        Console.WriteLine("PASS: native door references, all four motion types, original origins, no copied assets or duplicate MLO doors");
        var skinned=((List<CatalogueRecord>)RpfCatalogue.Browse("prop_rub_binbag_sd_01","all","props",0,100,"name")["items"]).First(r=>r.Name=="prop_rub_binbag_sd_01");
        bool rejectedSkinned=false;try{RpfCatalogue.Load(skinned.Id);}catch(InvalidDataException ex){rejectedSkinned=ex.Message.Contains("rigid");}Check(rejectedSkinned,"Multibone props must fail explicitly");
        var miscPlacements=new List<object>();int miscIndex=0;
        foreach(string name in new[]{"prop_tool_hammer","prop_plant_01a","prop_bin_04a","prop_cs_burger_01"}) {
            var hits=RpfCatalogue.Browse(name,"all","props",0,100,"name");var row=((List<CatalogueRecord>)hits["items"]).First(r=>r.Name==name);var file=RpfCatalogue.Load(row.Id);var gm=file.Models[0];
            Check(gm.Tris>0,"Missing misc prop geometry");Console.WriteLine("ALL-PROP SELECT "+name+": triangles="+gm.Tris+", textures="+file.Texs.Count+", warnings="+file.Warnings.Count);
            miscPlacements.Add(D("source","gta","kind","prop","frozen",true,"gameName",row.Archetype,"gameMin",gm.Min,"gameMax",gm.Max,"cx",++miscIndex*4,"cy",3,"zb",0,"yaw",0,"w",gm.W,"d",gm.D,"h",gm.H));
        }
        exportModel["fitted"]=D("project","pilot","items",miscPlacements);string miscOutput=cache+"-allprops-export";
        var miscResult=Exporter.Run(exportModel,miscOutput);Check((bool)miscResult["ok"],new JavaScriptSerializer().Serialize(miscResult));
        string miscStream=Path.Combine(miscOutput,"native_pilot","stream");Check(Directory.GetFiles(miscStream,"*.ydr").Length==1 && Directory.GetFiles(miscStream,"*.ytd").Length==1,"Misc prop export copied assets");
        var miscYtyp=new YtypFile();miscYtyp.Load(File.ReadAllBytes(Path.Combine(miscStream,"native_types.ytyp")));
        var miscEntities=miscYtyp.AllArchetypes.OfType<MloArchetype>().Single().entities;Check(miscEntities.Length==5 && miscEntities.Skip(1).All(e=>(e._Data.flags&32)!=0 && (e._Data.flags&4)==0),"Misc prop references/freeze/collision flags failed");
        Console.WriteLine("PASS: tool, plant, rubbish and food reference-only binary export; frozen props retain collision");
        // Optional external tags may enrich search, but cannot replace local geometry.
        string labels=Path.Combine(cache,"test-labels.json");File.WriteAllText(labels,"[{\"name\":\"prop_chair_01a\",\"description\":\"qa-synonym\",\"tags\":[\"qa-seat-tag\"],\"dimensions\":[999,999,999]}]");
        int beforeLabels=RpfCatalogue.GeometryReads;RpfCatalogue.ImportLabels(labels);Check((int)RpfCatalogue.Search("qa-seat-tag","all",0,10)["total"]>0 && beforeLabels==RpfCatalogue.GeometryReads,"Tag search must not load geometry");
        Check((int)RpfCatalogue.Browse("qa-seat-tag","all","props",0,24,"name")["total"]>0,"Tag browse cache was not refreshed");
        Check(RpfCatalogue.Load(pilot.First(r=>r.Name=="prop_chair_01a").Id).Models[0].W<999,"External dimensions replaced measured geometry");
        foreach (var file in before) Check(File.Exists(file.Key) && file.Value == new FileInfo(file.Key).Length + ":" + File.GetLastWriteTimeUtc(file.Key).Ticks, "GTA archive changed");
        Check(!Directory.GetFiles(cache, "*", SearchOption.AllDirectories).Any(f => new [] { ".ydr", ".ytd", ".dds" }.Contains(Path.GetExtension(f).ToLowerInvariant())), "Catalogue wrote GTA assets to disk");
        Directory.CreateDirectory(cache);
        File.WriteAllText(Path.Combine(cache, "pilot-results.json"), new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Serialize(outcomes));
        Console.WriteLine("PASS: metadata-only index/search, selection cache, no extracted assets, unchanged RPF sizes/timestamps");
    }
}
