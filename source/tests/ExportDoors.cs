using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;
using System.Xml;
using MloCreator;
using CodeWalker.GameFiles;

class ExportDoors
{
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    static string B64(float[] a) { byte[] b = new byte[a.Length*4]; Buffer.BlockCopy(a,0,b,0,b.Length);return Convert.ToBase64String(b); }
    static string B64(int[] a) { byte[] b = new byte[a.Length*4]; Buffer.BlockCopy(a,0,b,0,b.Length);return Convert.ToBase64String(b); }
    static Dictionary<string,object> D(params object[] a) { var d=new Dictionary<string,object>();for(int i=0;i<a.Length;i+=2)d[(string)a[i]]=a[i+1];return d; }
    static void Main(string[] args)
    {
        string root=Path.GetFullPath(args[0]), dest=Path.GetFullPath(args[1]);
        ImportHost.Init(Path.Combine(dest,"projects"),Path.Combine(dest,"cache")); ImportHost.ModelsDir=Path.Combine(root,"models");
        string glb=Path.Combine(root,"models","door_wooden_old-18mb.glb"); GlbFile source=GlbFile.Load(glb);
        var items=new List<object>(); string[] types={"hinged","hinged","garage","garage","sliding","sliding","hinged","tilt","tilt"};
        for(int i=0;i<types.Length;i++) items.Add(D("f",Path.GetFileName(glb),"m",source.Models[0].Id,"kind","door","id","leaf"+i,"group","pair"+(i/2),"doorType",types[i],"managed",i==6,"cx",i*3,"cy",0,"zb",0,"yaw",i==8?0:Math.PI/2,"w",2,"d",0.15,"h",3,"hinge",i%2==0?"l":"r","mirror",i%2!=0,"direction",i%2==0?1:-1,"travel",(types[i]=="hinged"||types[i]=="tilt")?90:3,"speed",(types[i]=="hinged"||types[i]=="tilt")?90:1,"autoOpen",i==2,"autoDistance",8,"closeDelay",0,"oxDoorId",i==2?7:0,"tiltLift",0.5,"tiltOffset",-1,"collision",i!=5));
        float[] verts={0,0,0, 30,0,0, 0,30,0};
        var model=D("resource","doors_test","prefix","dt","label","Door regression","placement",D("x",100,"y",200,"z",30,"heading",90),
            "groups",new object[]{D("name","floor","room",1,"mats",new object[]{D("tex","floor","pos",B64(verts),"nrm",B64(new float[]{0,0,1,0,0,1,0,0,1}),"uv",B64(new float[]{0,0,1,0,0,1}),"idx",B64(new int[]{0,1,2}))})},
            "textures",new object[]{D("name","floor","size",4,"rgba",Convert.ToBase64String(new byte[64]))},
            "collision",D("verts",B64(verts),"tris",B64(new int[]{0,1,2,0})),"fitted",D("project","test","items",items));
        var result=Exporter.Run(model,dest); Check((bool)result["ok"],new JavaScriptSerializer().Serialize(result));
        string resource=Path.Combine(dest,"doors_test"), stream=Path.Combine(resource,"stream");
        Check(File.Exists(Path.Combine(resource,"server","doors.lua")),"server script must be inside resource");
        Check(File.Exists(Path.Combine(resource,"client","doors.lua")),"client script missing");
        string config=File.ReadAllText(Path.Combine(resource,"doors.lua"));Check(config.Contains("kind='garage'")&&config.Contains("kind='sliding'"),"missing types");
        Check(config.Contains("kind='tilt', x=100, y=221, z=33, heading=180, tiltLift=0.5, tiltOffset=-1"),"rotated tilt world transform or offsets");
        Check(config.Contains("kind='tilt', x=100, y=224, z=33, heading=90"),"unrotated tilt world transform");
        Check(config.Contains("autoOpen=true, autoDistance=8, closeDelay=0, oxDoorId=7, triggerX=100, triggerY=206, triggerZ=30.8"),"auto-open settings and doorway trigger export");
        var ytyp=new YtypFile();ytyp.Load(File.ReadAllBytes(Path.Combine(stream,"dt_types.ytyp")));
        int mloEntities=0,archCount=0;
        foreach(var arch in ytyp.AllArchetypes) { archCount++; var mlo=arch as MloArchetype;if(mlo!=null)mloEntities=mlo.entities.Length; }
        Check(archCount==11,"expected floor, 9 doors, MLO");Check(mloEntities==3,"managed doors must not be duplicated as MLO entities");
        for(int i=1;i<=9;i++) {
            string path=Path.Combine(stream,"dt_fd"+i+".ydr");var ydr=new YdrFile();ydr.Load(File.ReadAllBytes(path));
            Check(ydr.Drawable!=null,"YDR load failed");Check((ydr.Drawable.Bound!=null)==(i!=6),"collision on/off mismatch");
            string filename;string xml=MetaXml.GetXml(ydr,out filename,null);var doc=new XmlDocument();doc.LoadXml(xml);
            if(i==8||i==9) {
                var bottom=doc.SelectSingleNode("/Drawable/Bounds/BoxMin");var top=doc.SelectSingleNode("/Drawable/Bounds/BoxMax");
                Check(Math.Abs(double.Parse(bottom.Attributes["z"].Value,System.Globalization.CultureInfo.InvariantCulture)+3)<0.001,"top pivot collision bottom");
                Check(Math.Abs(double.Parse(top.Attributes["z"].Value,System.Globalization.CultureInfo.InvariantCulture))<0.001,"top pivot collision top");
                Check(Math.Abs(double.Parse(bottom.Attributes["x"].Value,System.Globalization.CultureInfo.InvariantCulture)+1)<0.001,"tilt width must stay on local X even for rotated placement");
                Check(Math.Abs(double.Parse(top.Attributes["x"].Value,System.Globalization.CultureInfo.InvariantCulture)-1)<0.001,"tilt width bounds");
            }
            if(i==3||i==4||i==5) {
                var min=doc.SelectSingleNode("/Drawable/Bounds/BoxMin");var max=doc.SelectSingleNode("/Drawable/Bounds/BoxMax");
                Check(Math.Abs(double.Parse(min.Attributes["z"].Value,System.Globalization.CultureInfo.InvariantCulture))<0.001,"bottom pivot collision minimum");
                Check(Math.Abs(double.Parse(max.Attributes["z"].Value,System.Globalization.CultureInfo.InvariantCulture)-3)<0.001,"bottom pivot collision maximum");
            }
        }
        // Reimport the actual exported YDR, without generating an intermediate GLB.
        var imported=GlbFile.Load(Path.Combine(stream,"dt_fd3.ydr"));
        Check(imported.Models.Count==1&&imported.Models[0].Tris>0,"direct YDR geometry import");
        Check(imported.Texs.Count>0,"YTD textures should resolve beside YDR");
        Check(Math.Abs(imported.Models[0].H-3)<0.001,"YDR dimensions changed");
        string inputs=ImportHost.FilesDir("test");Directory.CreateDirectory(inputs);
        File.Copy(Path.Combine(stream,"dt_fd3.ydr"),Path.Combine(inputs,"dt_fd3.ydr"),true);
        File.Copy(Path.Combine(stream,"dt_tex.ytd"),Path.Combine(inputs,"dt_tex.ytd"),true);
        var library=ImportHost.GlbLibrary("test",D("kinds",D("dt_fd3.ydr","prop"),"only","dt_fd3.ydr"));
        var records=J.A(library["files"]);Check(records.Count==1&&J.G(J.O(records[0]),"error")==null,"YDR library endpoint failed");
        model["resource"]="ydr_roundtrip";
        model["fitted"]=D("project","test","items",new object[]{
            D("f","dt_fd3.ydr","m",imported.Models[0].Id,"kind","prop","id","decor","cx",4,"cy",4,"w",2,"d",0.15,"h",3),
            D("f","dt_fd3.ydr","m",imported.Models[0].Id,"kind","door","doorType","garage","id","ydrgate","cx",8,"cy",4,"w",2,"d",0.15,"h",3)
        });
        var roundtrip=Exporter.Run(model,dest);Check((bool)roundtrip["ok"],new JavaScriptSerializer().Serialize(roundtrip));
        Check(File.Exists(Path.Combine(dest,"ydr_roundtrip","stream","dt_fm1.ydr")),"direct YDR decoration not baked");
        Check(File.Exists(Path.Combine(dest,"ydr_roundtrip","stream","dt_fd1.ydr")),"direct YDR door not baked");
        if(args.Length>2) {
            var original=GlbFile.Load(Path.GetFullPath(args[2]));
            Check(original.Models.Count>0&&original.Models[0].Tris>0,"supplied YDR failed");
            Console.WriteLine("PASS: supplied YDR read directly: "+Path.GetFileName(args[2])+", triangles="+original.Models[0].Tris+", textures="+original.Texs.Count);
        }
        Console.WriteLine("PASS: full export; 9 doors; native/managed separation; binary YDR bounds; collision disabled; direct YDR + YTD library, decoration and door export");
        Console.WriteLine(resource);
    }
}
