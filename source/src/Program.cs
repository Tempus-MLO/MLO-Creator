// MLO Creator host: a small local web server (127.0.0.1 only), the builder UI in the program's own window (WebView2, see AppWindow.cs; an Edge app window as the fallback), and the exporter. C# 5.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace MloCreator
{
    static class Program
    {
        const string Version = "0.1.0";
        static string Root, UiDir, ProjDir, SettingsPath, Token, ExportLock = "x";
        static HttpListener Listener;
        static JavaScriptSerializer Json = new JavaScriptSerializer();
        static DateTime LastPing = DateTime.UtcNow; static bool EverPinged; static bool NoWindow;
        static ManualResetEvent Quit = new ManualResetEvent(false);

        [STAThread]
        static int Main(string[] args)
        {
            Json.MaxJsonLength = int.MaxValue; Json.RecursionLimit = 200;
            Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            UiDir = Path.Combine(Root, "ui"); ProjDir = Path.Combine(Root, "projects"); SettingsPath = Path.Combine(Root, "settings.json");
            Directory.CreateDirectory(ProjDir);
            ImportHost.Init(ProjDir, Path.Combine(Root, "cache")); ImportHost.ModelsDir = Path.Combine(Root, "models");
            System.Windows.Forms.Application.EnableVisualStyles();
            AppDomain.CurrentDomain.AssemblyResolve += delegate (object s, ResolveEventArgs e)
            {
                string n = new AssemblyName(e.Name).Name + ".dll";
                string p = Path.Combine(Root, "lib", n);
                return File.Exists(p) ? Assembly.LoadFrom(p) : null;
            };
            int port = 47770; bool dev = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--start" && i + 2 < args.Length) { HouseFit.ExtraStarts.Add(new double[] { double.Parse(args[i + 1], CultureInfo.InvariantCulture), double.Parse(args[i + 2], CultureInfo.InvariantCulture) }); i += 2; continue; }
                if (args[i] == "--grab" && i + 4 < args.Length)
                {
                    // command-line probe: MloCreator.exe --grab x y z heading   (prints what the house lookup finds)
                    try
                    {
                        double[] v = new double[4]; for (int k = 0; k < 4; k++) v[k] = double.Parse(args[i + 1 + k], CultureInfo.InvariantCulture);
                        Dictionary<string, object> r = HouseFit.Grab(v[0], v[1], v[2], v[3], "in", 1.06, GtaDefault(), Path.Combine(Root, "cache"));
                        Dictionary<string, object> info = (Dictionary<string, object>)r["info"];
                        foreach (string l in (List<string>)info["log"]) Console.WriteLine(l);
                        Directory.CreateDirectory(Path.Combine(Root, "cache")); File.WriteAllText(Path.Combine(Root, "cache", "last_grab.json"), Json.Serialize(r));
                        Console.WriteLine(Json.Serialize(new Dictionary<string, object> { { "frame", r["frame"] }, { "outline", r.ContainsKey("outline") ? r["outline"] : null }, { "door", r["door"] }, { "windows", r["windows"] } }));
                    }
                    catch (Exception ex) { Console.WriteLine("FAILED: " + ex); }
                    return 0;
                }
                if (args[i] == "--no-window") NoWindow = true;
                else if (args[i] == "--browser") UseBrowser = true;
                else if (args[i] == "--devtools") DevTools = true;
                else if (args[i] == "--port" && i + 1 < args.Length) port = int.Parse(args[++i]);
                else if (args[i] == "--dev") dev = true;
            }
            byte[] tk = new byte[16]; new Random().NextBytes(tk); Token = BitConverter.ToString(tk).Replace("-", "").ToLowerInvariant();
            if (dev) Token = "dev";

            for (int tries = 0; tries < 30; tries++, port++)
            {
                try
                {
                    Listener = new HttpListener(); Listener.Prefixes.Add("http://127.0.0.1:" + port + "/"); Listener.Start(); break;
                }
                catch (Exception) { Listener = null; }
            }
            if (Listener == null) { Console.Error.WriteLine("Could not open a local port."); return 1; }
            string url = "";
            foreach (string pf in Listener.Prefixes) url = pf;
            Console.WriteLine("MLO Creator " + Version + " listening on " + url);

            Thread loop = new Thread(AcceptLoop); loop.IsBackground = true; loop.Start();

            if (NoWindow)
            {
                // developer mode: stay up until killed (or /api/quit)
                Quit.WaitOne();
                return 0;
            }

            // the program's own window (WebView2 inside a form); the browser window only when that cannot be opened (or with --browser)
            if (!UseBrowser && TryOwnWindow(url, dev || DevTools)) { try { Listener.Stop(); } catch { } return 0; }
            Process win = OpenWindow(url);
            Thread watchdog = new Thread(delegate ()
            {
                while (!Quit.WaitOne(2000))
                {
                    if (EverPinged && (DateTime.UtcNow - LastPing).TotalSeconds > 45) { Quit.Set(); }
                    if (win != null) { try { if (win.HasExited) Quit.Set(); } catch { } }
                }
            });
            watchdog.IsBackground = true; watchdog.Start();
            Quit.WaitOne();
            try { Listener.Stop(); } catch { }
            return 0;
        }

        static bool UseBrowser, DevTools;

        static void LogWindow(string text)
        {
            try { string d = Path.Combine(Root, "logs"); Directory.CreateDirectory(d); File.AppendAllText(Path.Combine(d, "window.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text + "\r\n"); } catch (Exception) { }
        }

        // The editor in the program's own window. Returns true when that window was opened and has been closed; false when it could not be opened (WebView2 files or runtime missing).
        static bool TryOwnWindow(string url, bool devTools)
        {
            try
            {
                string appData = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Root, "MloCreator"); Directory.CreateDirectory(appData);
                string ver = AppWindow.RuntimeVersion(Path.Combine(Root, "lib"));
                LogWindow("own window, WebView2 runtime " + ver + ", " + url);
                AppWindow.Run(url, appData, devTools);
                LogWindow("window closed");
                return true;
            }
            catch (Exception ex)
            {
                LogWindow("the program's own window could not be opened (" + ex.GetType().Name + ": " + ex.Message + "); using a browser window instead");
                return false;
            }
        }

        static Process OpenWindow(string url)
        {
            string[] cands = new string[] {
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? "", @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", @"Google\Chrome\Application\chrome.exe")
            };
            string profile = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? Root, "MloCreator", "window");
            Directory.CreateDirectory(profile);
            foreach (string c in cands)
            {
                if (!File.Exists(c)) continue;
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(c, "--app=" + url + " --user-data-dir=\"" + profile + "\" --window-size=1600,960 --no-first-run --no-default-browser-check --disable-features=Translate");
                    psi.UseShellExecute = false;
                    return Process.Start(psi);
                }
                catch (Exception) { }
            }
            try { Process.Start(url); } catch (Exception) { }
            return null;
        }

        static void AcceptLoop()
        {
            while (Listener != null && Listener.IsListening)
            {
                HttpListenerContext ctx = null;
                try { ctx = Listener.GetContext(); } catch (Exception) { return; }
                ThreadPool.QueueUserWorkItem(delegate (object o)
                {
                    HttpListenerContext c = (HttpListenerContext)o;
                    try { Handle(c); }
                    catch (Exception ex)
                    {
                        try { Reply(c, 500, "{\"ok\":false,\"error\":" + Json.Serialize(ex.Message) + "}", "application/json"); } catch { }
                    }
                }, ctx);
            }
        }

        static void Reply(HttpListenerContext c, int code, string body, string type)
        {
            byte[] b = Encoding.UTF8.GetBytes(body);
            Reply(c, code, b, type);
        }

        static void Reply(HttpListenerContext c, int code, byte[] b, string type)
        {
            c.Response.StatusCode = code; c.Response.ContentType = type; c.Response.ContentLength64 = b.Length;
            c.Response.Headers["Cache-Control"] = "no-store";
            c.Response.OutputStream.Write(b, 0, b.Length); c.Response.OutputStream.Close();
        }

        static string Mime(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "application/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".ico": return "image/x-icon";
            }
            return "application/octet-stream";
        }

        static string ReadBody(HttpListenerContext c)
        {
            using (StreamReader r = new StreamReader(c.Request.InputStream, Encoding.UTF8)) return r.ReadToEnd();
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (string f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), false);
            foreach (string d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        static byte[] ReadBytes(HttpListenerContext c)
        {
            using (MemoryStream ms = new MemoryStream()) { c.Request.InputStream.CopyTo(ms); return ms.ToArray(); }
        }

        static void Json200(HttpListenerContext c, Dictionary<string, object> d) { Reply(c, 200, Json.Serialize(d), "application/json"); }

        // ---------- importing model files into a project ----------
        static void HandleImport(HttpListenerContext c, string api, string method, string name)
        {
            string proj = SafeName(name);
            if (proj.Length == 0) { Reply(c, 400, "{\"ok\":false,\"error\":\"no project name\"}", "application/json"); return; }
            Dictionary<string, object> r = new Dictionary<string, object>(); r["ok"] = true;
            if (api == "files") { r["files"] = ImportHost.List(proj); Json200(c, r); return; }
            if (api == "browse" && method == "POST")
            {
                string[] picked = ImportHost.Pick(c.Request.QueryString["mode"] == "folder"); List<string> added = new List<string>();
                if (picked != null) foreach (string p in picked) added.AddRange(ImportHost.AddPath(proj, p));
                r["added"] = added; r["files"] = ImportHost.List(proj); Json200(c, r); return;
            }
            if (api == "addpath" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                r["added"] = ImportHost.AddPath(proj, (J.S(J.G(body, "path"), "") ?? "").Trim().Trim('"')); r["files"] = ImportHost.List(proj); Json200(c, r); return;
            }
            if (api == "upload" && method == "POST")
            {
                r["added"] = new List<string> { ImportHost.Upload(proj, c.Request.QueryString["file"], ReadBytes(c)) }; r["files"] = ImportHost.List(proj); Json200(c, r); return;
            }
            if (api == "remove" && method == "POST") { ImportHost.Remove(proj, c.Request.QueryString["file"]); r["files"] = ImportHost.List(proj); Json200(c, r); return; }
            if (api == "rpf-index" && method == "POST") {
                var body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string gta = J.S(J.G(body, "gta"), ""); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                var result = RpfCatalogue.Build(gta, Path.Combine(Root, "cache"), J.B(J.G(body, "force"), false));
                var settings = Settings(); string labels = J.S(J.G(settings, "propTagsPath"), "");
                if (File.Exists(labels)) { try { result = RpfCatalogue.ImportLabels(labels); } catch (Exception ex) { result["labelWarning"] = "Optional tags were not loaded: " + ex.Message; } }
                settings["gtaPath"] = gta; File.WriteAllText(SettingsPath, Json.Serialize(settings), Encoding.UTF8);
                Json200(c, result); return;
            }
            if (api == "rpf-labels" && method == "POST") {
                var body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string path = J.S(J.G(body, "path"), ""); var result = RpfCatalogue.ImportLabels(path);
                var settings = Settings(); settings["propTagsPath"] = path; File.WriteAllText(SettingsPath, Json.Serialize(settings), Encoding.UTF8);
                Json200(c, result); return;
            }
            if (api == "rpf-status") { Json200(c, new Dictionary<string, object> { { "ok", true }, { "status", RpfCatalogue.Status }, { "gta", GtaDefault() }, { "ready", RpfCatalogue.Ready } }); return; }
            if (api == "rpf-browse") {
                Json200(c,RpfCatalogue.Browse(c.Request.QueryString["q"],c.Request.QueryString["category"],c.Request.QueryString["scope"] ?? "props",J.I(c.Request.QueryString["offset"],0),J.I(c.Request.QueryString["limit"],24),c.Request.QueryString["order"])); return;
            }
            if (api == "rpf-search") { Json200(c, RpfCatalogue.Search(c.Request.QueryString["q"], c.Request.QueryString["category"], J.I(c.Request.QueryString["offset"], 0), 100)); return; }
            if (api == "rpf-model" && method == "POST") {
                var body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string id = J.S(J.G(body, "id"), "");
                if (!RpfCatalogue.Ready) { string gta = J.S(J.G(body, "gta"), ""); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault(); RpfCatalogue.Build(gta, Path.Combine(Root, "cache"), false); }
                var response = ImportHost.CatalogueModel(RpfCatalogue.Load(id), RpfCatalogue.Record(id));
                response["ok"] = true; Json200(c, response); return;
            }
            if (api == "glb") { Dictionary<string, object> gb = method == "POST" ? Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object> : null; Dictionary<string, object> gl = ImportHost.GlbLibrary(proj, gb); gl["ok"] = true; Json200(c, gl); return; }
            if (api == "model")
            {
                List<string> log = new List<string>(); Dictionary<string, object> m = ImportHost.LoadModels(proj, c.Request.QueryString["target"], log);
                m["ok"] = true; m["log"] = log; Json200(c, m); return;
            }
            if (api == "cut" && method == "POST")
            {
                Dictionary<string, object> spec = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                Json200(c, ImportHost.CutPreview(proj, spec)); return;
            }
            if (api == "collision-preview" && method == "POST")
            {
                Dictionary<string, object> spec = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                Json200(c, ImportHost.CollisionPreview(proj, spec)); return;
            }
            if (api == "collision-polys" && method == "POST")
            {
                Dictionary<string, object> spec = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                Json200(c, ImportHost.CollisionPolys(proj, spec)); return;
            }
            if (api == "collision-final" && method == "POST")
            {
                Dictionary<string, object> spec = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                Json200(c, ImportHost.CollisionFinal(proj, spec)); return;
            }
            if (api == "game-collision" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["files"] = ImportHost.GameCollision(proj, J.S(J.G(body, "target"), ""), gta, J.O(J.G(body, "entity"))); Json200(c, r); return;
            }
            if (api == "game-occlusion" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["files"] = ImportHost.GameOcclusion(proj, J.S(J.G(body, "target"), ""), gta, J.O(J.G(body, "entity"))); Json200(c, r); return;
            }
            if (api == "places" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>; List<string> log = new List<string>(), names = new List<string>();
                foreach (object o in J.A(J.G(body, "files"))) names.Add(J.S(o, ""));
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault(); Dictionary<string, object> near = J.O(J.G(body, "near"));
                r["places"] = ImportHost.Places(proj, names, gta, J.B(J.G(body, "game"), false), near == null ? 0 : J.D(J.G(near, "x"), 0), near == null ? 0 : J.D(J.G(near, "y"), 0), log); r["log"] = log; Json200(c, r); return;
            }
            if (api == "prop-models" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>; List<string> names = new List<string>();
                foreach (object o in J.A(J.G(body, "names"))) names.Add(J.S(o, ""));
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["models"] = ImportHost.PropModels(names, gta); Json200(c, r); return;
            }
            if (api == "game-props" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["props"] = ImportHost.GameProps(proj, J.S(J.G(body, "target"), ""), gta, J.O(J.G(body, "entity")), J.G(body, "volumes"), J.B(J.G(body, "others"), false), J.G(body, "skip"), J.S(J.G(body, "region"), "all")); Json200(c, r); return;
            }
            if (api == "game-add" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>; List<string> names = new List<string>();
                foreach (object o in J.A(J.G(body, "names"))) names.Add(J.S(o, ""));
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["added"] = ImportHost.GameAdd(proj, names, gta); r["files"] = ImportHost.List(proj); Json200(c, r); return;
            }
            if (api == "game-entity" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>; List<string> log = new List<string>();
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                r["entities"] = ImportHost.EntitiesInGame(J.S(J.G(body, "target"), ""), gta, log); r["log"] = log;
                Dictionary<string, object> st = Settings(); st["gtaPath"] = gta; File.WriteAllText(SettingsPath, Json.Serialize(st), Encoding.UTF8);
                Json200(c, r); return;
            }
            Reply(c, 404, "{\"ok\":false,\"error\":\"unknown import call\"}", "application/json");
        }

        static string SafeName(string n)
        {
            n = Regex.Replace(n ?? "", @"[^A-Za-z0-9 _\-]", "").Trim();
            if (n.Length > 60) n = n.Substring(0, 60);
            return n;
        }

        // Where the game is: "gtaPath" in settings.json, else the GTA5_PATH environment variable, else the usual places (every Steam library, Rockstar, Epic). "" when it is nowhere.
        static string GtaDefault()
        {
            string s = null; try { s = J.S(J.G(Settings(), "gtaPath"), null); } catch { }
            if (!string.IsNullOrWhiteSpace(s)) return s;
            List<string> cands = new List<string>(); string env = Environment.GetEnvironmentVariable("GTA5_PATH"); if (!string.IsNullOrEmpty(env)) cands.Add(env);
            string[] steamKeys = new string[] { @"HKEY_CURRENT_USER\Software\Valve\Steam|SteamPath", @"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam|InstallPath" };
            foreach (string sk in steamKeys)
            {
                try
                {
                    string[] kv = sk.Split('|'); string steam = Microsoft.Win32.Registry.GetValue(kv[0], kv[1], null) as string; if (string.IsNullOrEmpty(steam)) continue; steam = steam.Replace('/', '\\');
                    cands.Add(Path.Combine(steam, "steamapps", "common", "Grand Theft Auto V"));
                    string vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
                    if (File.Exists(vdf)) foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\"")) cands.Add(Path.Combine(m.Groups[1].Value.Replace("\\\\", "\\"), "steamapps", "common", "Grand Theft Auto V"));
                }
                catch (Exception) { }
            }
            try { string rs = Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Rockstar Games\Grand Theft Auto V", "InstallFolder", null) as string; if (!string.IsNullOrEmpty(rs)) cands.Add(rs); } catch (Exception) { }
            cands.Add(@"C:\Program Files\Rockstar Games\Grand Theft Auto V"); cands.Add(@"C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V"); cands.Add(@"C:\Program Files\Epic Games\GTAV"); cands.Add(@"C:\Program Files (x86)\Epic Games\GTAV");
            foreach (DriveInfo drive in DriveInfo.GetDrives()) { try { if (drive.IsReady && drive.DriveType == DriveType.Fixed) cands.Add(Path.Combine(drive.RootDirectory.FullName, "SteamLibrary", "steamapps", "common", "Grand Theft Auto V")); } catch (Exception) { } }
            foreach (string c in cands) { try { if (File.Exists(Path.Combine(c, "GTA5.exe"))) return c; } catch (Exception) { } }
            return "";
        }

        static Dictionary<string, object> Settings()
        {
            Dictionary<string, object> s = null;
            try { if (File.Exists(SettingsPath)) s = Json.DeserializeObject(File.ReadAllText(SettingsPath)) as Dictionary<string, object>; } catch { }
            if (s == null) s = new Dictionary<string, object>();
            if (!s.ContainsKey("outDir")) s["outDir"] = Path.Combine(Root, "output");
            return s;
        }

        static void Handle(HttpListenerContext c)
        {
            string path = c.Request.Url.AbsolutePath;
            if (path.StartsWith("/api/"))
            {
                if (c.Request.Headers["X-Mlo-Token"] != Token) { Reply(c, 403, "{\"ok\":false,\"error\":\"bad token\"}", "application/json"); return; }
                HandleApi(c, path.Substring(5));
                return;
            }
            if (path == "/") path = "/index.html";
            string full = Path.GetFullPath(Path.Combine(UiDir, path.TrimStart('/').Replace('/', '\\')));
            if (!full.StartsWith(UiDir, StringComparison.OrdinalIgnoreCase) || !File.Exists(full)) { Reply(c, 404, "not found", "text/plain"); return; }
            if (Path.GetFileName(full).Equals("index.html", StringComparison.OrdinalIgnoreCase))
            {
                string html = File.ReadAllText(full, Encoding.UTF8).Replace("__TOKEN__", Token).Replace("__VERSION__", Version);
                Reply(c, 200, html, "text/html; charset=utf-8");
            }
            else Reply(c, 200, File.ReadAllBytes(full), Mime(full));
        }

        static void HandleApi(HttpListenerContext c, string api)
        {
            string method = c.Request.HttpMethod;
            string q = c.Request.QueryString["name"];
            if (api == "ping") { LastPing = DateTime.UtcNow; EverPinged = true; Reply(c, 200, "{\"ok\":true,\"version\":\"" + Version + "\"}", "application/json"); return; }
            if (api == "quit") { Reply(c, 200, "{\"ok\":true}", "application/json"); Quit.Set(); return; }
            if (api == "log" && method == "POST")
            {
                // what the page reports when something goes wrong: one line per error in logs\errors.log (the file turns over at 600 KB)
                try
                {
                    string body = ReadBody(c); if (body.Length > 40000) body = body.Substring(0, 40000);
                    string dir = Path.Combine(Root, "logs"); Directory.CreateDirectory(dir); string f = Path.Combine(dir, "errors.log");
                    FileInfo fi = new FileInfo(f);
                    if (fi.Exists && fi.Length > 600000) { string old = Path.Combine(dir, "errors.old.log"); if (File.Exists(old)) File.Delete(old); File.Move(f, old); }
                    File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + body.Replace("\r", "").Replace("\n", "\\n") + Environment.NewLine, new UTF8Encoding(false));
                }
                catch (Exception) { }
                Reply(c, 200, "{\"ok\":true}", "application/json"); return;
            }
            if (api == "settings")
            {
                if (method == "POST")
                {
                    Dictionary<string, object> s = Settings();
                    Dictionary<string, object> inc = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                    if (inc != null) foreach (KeyValuePair<string, object> kv in inc) s[kv.Key] = kv.Value;
                    File.WriteAllText(SettingsPath, Json.Serialize(s), Encoding.UTF8);
                }
                Reply(c, 200, Json.Serialize(Settings()), "application/json"); return;
            }
            if (api == "projects")
            {
                List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
                foreach (string f in Directory.GetFiles(ProjDir, "*.mlo.json"))
                {
                    Dictionary<string, object> e = new Dictionary<string, object>();
                    string pn = Path.GetFileName(f).Substring(0, Path.GetFileName(f).Length - ".mlo.json".Length);
                    e["name"] = pn;
                    e["modified"] = File.GetLastWriteTimeUtc(f).ToString("o");
                    e["bytes"] = new FileInfo(f).Length;
                    // the kind of project (it is near the start of the file) and the small picture saved with it, for the project list
                    string kind = "";
                    try { using (FileStream fs = File.OpenRead(f)) { byte[] buf = new byte[600]; int n = fs.Read(buf, 0, buf.Length); System.Text.RegularExpressions.Match km = System.Text.RegularExpressions.Regex.Match(Encoding.UTF8.GetString(buf, 0, n), "\"kind\"\\s*:\\s*\"(\\w+)\""); if (km.Success) kind = km.Groups[1].Value; } } catch (Exception) { }
                    e["kind"] = kind;
                    string tfile = Path.Combine(ProjDir, pn + ".thumb.jpg");
                    try { if (File.Exists(tfile) && new FileInfo(tfile).Length < 80000) e["thumb"] = "data:image/jpeg;base64," + Convert.ToBase64String(File.ReadAllBytes(tfile)); } catch (Exception) { }
                    list.Add(e);
                }
                list.Sort(delegate (Dictionary<string, object> a, Dictionary<string, object> b) { return string.CompareOrdinal((string)b["modified"], (string)a["modified"]); });
                Reply(c, 200, Json.Serialize(list), "application/json"); return;
            }
            if (api == "project-copy" && method == "POST")
            {
                // save as: the project file, its reference file and its imported files under a new name
                string from = SafeName(q), to = SafeName(c.Request.QueryString["to"]);
                if (from.Length == 0 || to.Length == 0) { Reply(c, 400, "{\"ok\":false,\"error\":\"no name\"}", "application/json"); return; }
                string sf = Path.Combine(ProjDir, from + ".mlo.json"), df = Path.Combine(ProjDir, to + ".mlo.json");
                if (!File.Exists(sf)) { Reply(c, 404, "{\"ok\":false,\"error\":\"The project is not saved yet.\"}", "application/json"); return; }
                if (File.Exists(df) || Directory.Exists(Path.Combine(ProjDir, to + ".files"))) { Reply(c, 409, "{\"ok\":false,\"error\":\"A project with that name already exists.\"}", "application/json"); return; }
                Dictionary<string, object> pj = Json.DeserializeObject(File.ReadAllText(sf, Encoding.UTF8)) as Dictionary<string, object>; pj["name"] = to;
                File.WriteAllText(df, Json.Serialize(pj), new UTF8Encoding(false));
                string sr = Path.Combine(ProjDir, from + ".ref.json"); if (File.Exists(sr)) File.Copy(sr, Path.Combine(ProjDir, to + ".ref.json"), false);
                string sd = Path.Combine(ProjDir, from + ".files"); if (Directory.Exists(sd)) CopyDir(sd, Path.Combine(ProjDir, to + ".files"));
                string st = Path.Combine(ProjDir, from + ".thumb.jpg"); if (File.Exists(st)) File.Copy(st, Path.Combine(ProjDir, to + ".thumb.jpg"), true);
                Reply(c, 200, "{\"ok\":true}", "application/json"); return;
            }
            if (api == "project-rename" && method == "POST")
            {
                // rename: the project file, its backup, reference file, picture and imported files all move to the new name (nothing is left behind)
                string from = SafeName(q), to = SafeName(c.Request.QueryString["to"]);
                if (from.Length == 0 || to.Length == 0) { Reply(c, 400, "{\"ok\":false,\"error\":\"no name\"}", "application/json"); return; }
                if (from == to) { Reply(c, 200, "{\"ok\":true}", "application/json"); return; }
                string sf = Path.Combine(ProjDir, from + ".mlo.json"), df = Path.Combine(ProjDir, to + ".mlo.json");
                if (!File.Exists(sf)) { Reply(c, 404, "{\"ok\":false,\"error\":\"The project is not saved yet.\"}", "application/json"); return; }
                if (File.Exists(df) || Directory.Exists(Path.Combine(ProjDir, to + ".files"))) { Reply(c, 409, "{\"ok\":false,\"error\":\"A project with that name already exists.\"}", "application/json"); return; }
                Dictionary<string, object> pj = Json.DeserializeObject(File.ReadAllText(sf, Encoding.UTF8)) as Dictionary<string, object>; pj["name"] = to;
                File.WriteAllText(df, Json.Serialize(pj), new UTF8Encoding(false));
                File.Delete(sf);
                foreach (string suffix in new string[] { ".mlo.json.bak", ".ref.json", ".thumb.jpg" })
                {
                    string a = Path.Combine(ProjDir, from + suffix), b = Path.Combine(ProjDir, to + suffix);
                    if (File.Exists(a)) { if (File.Exists(b)) File.Delete(b); File.Move(a, b); }
                }
                string fdir = Path.Combine(ProjDir, from + ".files"); if (Directory.Exists(fdir)) Directory.Move(fdir, Path.Combine(ProjDir, to + ".files"));
                Reply(c, 200, "{\"ok\":true}", "application/json"); return;
            }
            if (api == "thumb" && method == "POST")
            {
                // the small picture of the 3D view that the project list shows (base64 of a JPEG)
                string tn = SafeName(q);
                if (tn.Length == 0 || !File.Exists(Path.Combine(ProjDir, tn + ".mlo.json"))) { Reply(c, 404, "{\"ok\":false,\"error\":\"missing\"}", "application/json"); return; }
                try { byte[] jpg = Convert.FromBase64String(ReadBody(c).Trim()); if (jpg.Length > 0 && jpg.Length < 120000) File.WriteAllBytes(Path.Combine(ProjDir, tn + ".thumb.jpg"), jpg); }
                catch (Exception) { Reply(c, 400, "{\"ok\":false}", "application/json"); return; }
                Reply(c, 200, "{\"ok\":true}", "application/json"); return;
            }
            if (api == "project")
            {
                string name = SafeName(q);
                if (name.Length == 0) { Reply(c, 400, "{\"ok\":false,\"error\":\"no name\"}", "application/json"); return; }
                string file = Path.Combine(ProjDir, name + ".mlo.json");
                if (method == "GET")
                {
                    if (!File.Exists(file)) { Reply(c, 404, "{\"ok\":false,\"error\":\"missing\"}", "application/json"); return; }
                    Reply(c, 200, File.ReadAllText(file, Encoding.UTF8), "application/json"); return;
                }
                if (method == "POST")
                {
                    string tmp = file + ".tmp"; File.WriteAllText(tmp, ReadBody(c), new UTF8Encoding(false));
                    if (File.Exists(file)) File.Copy(file, file + ".bak", true);
                    File.Copy(tmp, file, true); File.Delete(tmp);
                    Reply(c, 200, "{\"ok\":true}", "application/json"); return;
                }
                if (method == "DELETE")
                {
                    if (File.Exists(file)) { File.Copy(file, file + ".deleted", true); File.Delete(file); }
                    string rfile = Path.Combine(ProjDir, name + ".ref.json"); if (File.Exists(rfile)) { File.Copy(rfile, rfile + ".deleted", true); File.Delete(rfile); }
                    string tfile2 = Path.Combine(ProjDir, name + ".thumb.jpg"); if (File.Exists(tfile2)) File.Delete(tfile2);
                    // imported model files are set aside too (not erased), so a new project of the same name starts empty
                    string fdir = Path.Combine(ProjDir, name + ".files");
                    if (Directory.Exists(fdir)) Directory.Move(fdir, fdir + ".deleted-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                    Reply(c, 200, "{\"ok\":true}", "application/json"); return;
                }
            }
            if (api.StartsWith("import/")) { HandleImport(c, api.Substring(7), method, q); return; }
            if (api == "vanilla/status") { Reply(c, 200, Json.Serialize(new Dictionary<string, object> { { "status", Vanilla.Status }, { "gta", GtaDefault() } }), "application/json"); return; }
            if (api == "vanilla/grab" && method == "POST")
            {
                Dictionary<string, object> body = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string gta = J.S(J.G(body, "gta"), null); if (string.IsNullOrWhiteSpace(gta)) gta = GtaDefault();
                try
                {
                    Dictionary<string, object> r = HouseFit.Grab(J.D(J.G(body, "x"), 0), J.D(J.G(body, "y"), 0), J.D(J.G(body, "z"), 0), J.D(J.G(body, "heading"), 0), J.S(J.G(body, "facing"), "in"), J.D(J.G(body, "pedOffset"), 1.06), gta, Path.Combine(Root, "cache"));
                    Dictionary<string, object> st = Settings(); st["gtaPath"] = gta; File.WriteAllText(SettingsPath, Json.Serialize(st), Encoding.UTF8);
                    Reply(c, 200, Json.Serialize(r), "application/json");
                }
                catch (Exception ex) { Vanilla.Status = ""; Reply(c, 200, Json.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", ex.Message } }), "application/json"); }
                return;
            }
            if (api == "ref")
            {
                string rn = SafeName(q); string rf = Path.Combine(ProjDir, rn + ".ref.json");
                if (rn.Length == 0) { Reply(c, 400, "{\"ok\":false}", "application/json"); return; }
                if (method == "POST") { File.WriteAllText(rf, ReadBody(c), new UTF8Encoding(false)); Reply(c, 200, "{\"ok\":true}", "application/json"); return; }
                if (method == "DELETE") { if (File.Exists(rf)) File.Delete(rf); Reply(c, 200, "{\"ok\":true}", "application/json"); return; }
                if (!File.Exists(rf)) { Reply(c, 404, "{\"ok\":false}", "application/json"); return; }
                Reply(c, 200, File.ReadAllText(rf, Encoding.UTF8), "application/json"); return;
            }
            if (api == "export" && method == "POST")
            {
                Dictionary<string, object> model = Json.DeserializeObject(ReadBody(c)) as Dictionary<string, object>;
                string outDir = J.S(J.G(model, "outDir"), null);
                if (string.IsNullOrWhiteSpace(outDir)) outDir = (string)Settings()["outDir"];
                Dictionary<string, object> result;
                Dictionary<string, object> patchSpec = J.O(J.G(model, "patch"));
                if (patchSpec != null) { if (string.IsNullOrWhiteSpace(J.S(J.G(patchSpec, "gta"), null))) patchSpec["gta"] = GtaDefault(); patchSpec["cache"] = Path.Combine(Root, "cache"); }
                Dictionary<string, object> cutSpec = J.O(J.G(model, "cutModel"));
                if (cutSpec != null) cutSpec["project"] = SafeName(J.S(J.G(cutSpec, "project"), ""));
                Dictionary<string, object> doorSpec = J.O(J.G(model, "doorModel"));
                if (doorSpec != null) doorSpec["project"] = SafeName(J.S(J.G(doorSpec, "project"), ""));
                lock (ExportLock) { Directory.CreateDirectory(outDir); result = Exporter.Run(model, outDir); }
                Reply(c, 200, Json.Serialize(result), "application/json"); return;
            }
            if (api == "reveal" && method == "POST")
            {
                string dir = Path.GetFullPath(q ?? "");
                string outRoot = Path.GetFullPath((string)Settings()["outDir"]);
                if (Directory.Exists(dir) && dir.StartsWith(outRoot, StringComparison.OrdinalIgnoreCase)) Process.Start("explorer.exe", "\"" + dir + "\"");
                Reply(c, 200, "{\"ok\":true}", "application/json"); return;
            }
            Reply(c, 404, "{\"ok\":false,\"error\":\"unknown api\"}", "application/json");
        }
    }
}
