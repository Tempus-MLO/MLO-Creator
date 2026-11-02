using System;
using System.Collections.Generic;
using System.IO;

namespace MloCreator
{
    public static partial class Exporter
    {
        class GameProp { public DoorData Entity; public V3 Min, Max; public Dictionary<string, object> Item; public double[] BoundsMin, BoundsMax; public bool Moving; }
        static double NativeNumber(Dictionary<string, object> item, string key, double fallback, double min, double max) {
            double value = J.D(J.G(item, key), fallback);
            if (double.IsNaN(value) || double.IsInfinity(value) || value < min || value > max) throw new InvalidDataException("Invalid native door setting: " + key);
            return value;
        }
        static string NativeController(GameProp prop, string prefix, int index, double px, double py, double pz, double hd) {
            var item = prop.Item; var mn = prop.BoundsMin; var mx = prop.BoundsMax;
            string type = J.S(J.G(item, "doorType"), "hinged");
            if (type != "hinged" && type != "tilt" && type != "garage" && type != "sliding") throw new InvalidDataException("Invalid native door type");
            bool angular = type == "hinged" || type == "tilt";
            double height = mx[2] - mn[2], width = mx[0] - mn[0];
            double travel = NativeNumber(item, "travel", angular ? 90 : type == "garage" ? height : width, .001, angular ? 180 : 100);
            double speed = NativeNumber(item, "speed", angular ? 90 : 1, .001, 100);
            double distance = NativeNumber(item, "autoDistance", 6, 1, 30), delay = NativeNumber(item, "closeDelay", 3, 0, 120);
            double lift = NativeNumber(item, "tiltLift", 0, -20, 20), offset = NativeNumber(item, "tiltOffset", 0, -20, 20);
            double ox = NativeNumber(item, "oxDoorId", 0, 0, int.MaxValue);
            if (ox != Math.Floor(ox)) throw new InvalidDataException("Invalid native door lock ID");
            double yaw = prop.Entity.Heading * Math.PI / 180, a = (hd + prop.Entity.Heading) * Math.PI / 180, c = Math.Cos(hd * Math.PI / 180), sn = Math.Sin(hd * Math.PI / 180);
            double pivotX = type == "hinged" ? (J.S(J.G(item, "hinge"), "l") == "r" ? mx[0] : mn[0]) : (mn[0] + mx[0]) / 2;
            double pivotY = (mn[1] + mx[1]) / 2, pivotZ = type == "tilt" ? mx[2] : mn[2];
            double lx = prop.Entity.X + pivotX * Math.Cos(yaw) - pivotY * Math.Sin(yaw), ly = prop.Entity.Y + pivotX * Math.Sin(yaw) + pivotY * Math.Cos(yaw);
            string id = prefix + "native" + index;
            var values = new Dictionary<string, double> { {"x", px + lx*c - ly*sn}, {"y", py + lx*sn + ly*c}, {"z", pz + prop.Entity.Z + pivotZ}, {"heading",hd+prop.Entity.Heading}, {"originX",-pivotX}, {"originY",-pivotY}, {"originZ",-pivotZ}, {"dx",type=="sliding"?Math.Cos(a):0}, {"dy",type=="sliding"?Math.Sin(a):0}, {"dz",type=="garage"?1:0}, {"travel",travel}, {"speed",speed}, {"direction",NativeNumber(item,"direction",1,-1,1)<0?-1:1}, {"height",height}, {"tiltLift",lift}, {"tiltOffset",offset}, {"autoDistance",distance}, {"closeDelay",delay}, {"oxDoorId",ox}, {"triggerX",px+prop.Entity.X*c-prop.Entity.Y*sn}, {"triggerY",py+prop.Entity.X*sn+prop.Entity.Y*c}, {"triggerZ",pz+prop.Entity.Z+mn[2]+Math.Min(.8,height/2)} };
            var row = new System.Text.StringBuilder(" { id='"+id+"', group='"+id+"', model='"+prop.Entity.Name+"', kind='"+type+"', native=true");
            foreach (var pair in values) row.Append(", ").Append(pair.Key).Append("=").Append(F(pair.Value));
            row.Append(", collision=").Append(J.B(J.G(item,"collision"),true)?"true":"false").Append(", autoOpen=").Append(J.B(J.G(item,"autoOpen"),false)?"true":"false").Append(" },");
            return row.ToString();
        }
        static double[] GameVector(object value) {
            var list = J.A(value); if (list.Count != 3) throw new InvalidDataException("GTA prop bounds are missing; select the model again");
            var result = new double[3]; for (int i = 0; i < 3; i++) { result[i] = J.D(list[i], double.NaN); if (double.IsNaN(result[i]) || double.IsInfinity(result[i]) || Math.Abs(result[i]) > 10000) throw new InvalidDataException("Invalid GTA prop bounds"); }
            return result;
        }
        static List<GameProp> GameProps(Dictionary<string, object> model)
        {
            var result = new List<GameProp>();
            foreach (object value in J.A(J.G(J.O(J.G(model, "fitted")), "items"))) {
                var item = J.O(value); if (J.S(J.G(item, "source"), "") != "gta") continue;
                string name = J.S(J.G(item, "gameName"), "");
                string kind = J.S(J.G(item, "kind"), "");
                if (!(kind == "prop" && RpfCatalogue.ValidModelName(name)) && !(kind == RpfCatalogue.BuildingKind(name) && (kind == "door" || kind == "window"))) throw new InvalidDataException("Model does not belong to the selected native catalogue category");
                if (J.B(J.G(item, "double"), false)) throw new InvalidDataException("Place original GTA door leaves separately; native models cannot be mirrored");
                var mn = GameVector(J.G(item, "gameMin")); var mx = GameVector(J.G(item, "gameMax"));
                string[] dims = { "w", "d", "h" };
                for (int i = 0; i < 3; i++) if (mx[i] <= mn[i] || Math.Abs(J.D(J.G(item, dims[i]), 0) - (mx[i] - mn[i])) > .001) throw new InvalidDataException("Native GTA props retain their original size; place the model again");
                double x = J.D(J.G(item, "cx"), double.NaN), y = J.D(J.G(item, "cy"), double.NaN), z = J.D(J.G(item, "zb"), double.NaN), yaw = J.D(J.G(item, "yaw"), double.NaN);
                foreach (double v in new double[] { x, y, z, yaw }) if (double.IsNaN(v) || double.IsInfinity(v)) throw new InvalidDataException("Invalid GTA prop placement");
                double cs = Math.Cos(yaw), sn = Math.Sin(yaw), u = (mn[0] + mx[0]) / 2, n = (mn[1] + mx[1]) / 2;
                var entity = new DoorData { Name = name, X = x - u * cs + n * sn, Y = y - u * sn - n * cs, Z = z - mn[2], Heading = yaw * 180 / Math.PI, Flags = 1572864 | (kind == "prop" && J.B(J.G(item,"frozen"),false) ? 32 : 0) };
                var prop = new GameProp { Entity = entity, Item = item, BoundsMin = mn, BoundsMax = mx, Moving = kind == "door", Min = new V3(1e9, 1e9, 1e9), Max = new V3(-1e9, -1e9, -1e9) };
                foreach (double px in new double[] { mn[0], mx[0] }) foreach (double py in new double[] { mn[1], mx[1] }) foreach (double pz in new double[] { mn[2], mx[2] }) {
                    var point = new V3(entity.X + px * cs - py * sn, entity.Y + px * sn + py * cs, entity.Z + pz);
                    prop.Min = new V3(Math.Min(prop.Min.X, point.X), Math.Min(prop.Min.Y, point.Y), Math.Min(prop.Min.Z, point.Z));
                    prop.Max = new V3(Math.Max(prop.Max.X, point.X), Math.Max(prop.Max.Y, point.Y), Math.Max(prop.Max.Z, point.Z));
                }
                result.Add(prop);
            }
            return result;
        }
    }
}
