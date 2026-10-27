# MLO Creator

*Read this in other languages: [Português](README.pt-BR.md)*

A Windows program for building FiveM interiors (MLOs) inside an existing GTA V building model, then exporting a ready-to-upload resource folder.

You import the model files of a building (for example a vanilla house), cut doors and windows through its walls, build the rooms inside, place lights and doors, paint, and press Export. Nothing is generated for you: every wall, opening, light and cut comes from something you did. It runs on your PC, outside the game.

> **Status:** everything it writes loads in [CodeWalker](https://github.com/dexyfex/CodeWalker) and the output is checked file by file, but streaming, lighting, portals, collision and door behaviour still have to be seen in the game. Report what you find.

## What it does

- **Import** `.ydr` models, `.ytd` textures, `.ybn` collision and `.ymap` files (or look them up in your own GTA V install).
- **Frame** the grid onto the building, then **draw rooms**, cut-outs and partitions.
- **Cut doors, windows and archways** through the model and its collision, like a boolean in Blender.
- **Door and window models** from your own `.glb` files, placed by hand, including double doors.
- **Clean up the model**: delete faces, remove model parts, fill holes, clear the model out of the rooms, edit its collision, build your own collision boxes.
- **Props and plants**: find the map's bushes, trees and props across the whole model, see them in the view, and remove the ones you pick (written as a small client script).
- **Finish the inside**: floor and wall paint with built-in and your own textures, ceiling lights, scale figure.
- **Check it**: checklist, collision walk-through, then **export** a resource with `fxmanifest.lua`, `client/ipl.lua` and a README that lists every game file it replaces and a test spot to teleport to.

A second, simpler project type builds a whole new house on a grid. Details of every tool are in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Requirements

- Windows 10 or 11, 64-bit, with the .NET Framework 4.8 (part of Windows).
- The [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already part of Windows 11 and of Edge). Without it the program falls back to an Edge or Chrome app window.
- A copy of GTA V, and [CodeWalker](https://github.com/dexyfex/CodeWalker) to extract the game files you work on (see below). The "look it up in the game files" buttons read your install directly. The program finds Steam, Rockstar and Epic installs by itself; otherwise set `{"gtaPath": "D:\\Games\\Grand Theft Auto V"}` in `settings.json` next to the program, or the `GTA5_PATH` environment variable.

No game files are included. You supply the models you want to work on.

## Getting the GTA V files (CodeWalker is required)

MLO Creator works on files taken from the game: the building's model (`.ydr`), textures (`.ytd`), collision (`.ybn`) and map placement (`.ymap`). **You need [CodeWalker](https://github.com/dexyfex/CodeWalker) to get them.** Open your GTA V folder in CodeWalker, find the building in its RPF Explorer or World View, extract those files, and add them in MLO Creator's Import tab (Add files, Add a folder, or drag them onto the window). The same goes for any other GTA asset you want to bring in: get it out of the game's archives with CodeWalker first.

MLO Creator also uses CodeWalker's library itself (it is built against it, see [lib/README.md](lib/README.md)), and its lookup buttons (where the model stands, its collision, occlusion files, plants and props) read your own GTA V install directly. CodeWalker is still the way to get the model files.

## Run it

Unzip the release anywhere you can write to and double-click `MloCreator.exe`. Projects, cache, settings and exports are kept next to the program (`projects\`, `cache\`, `output\`, `settings.json`). The exe is not signed, so Windows may ask once ("More info", then "Run anyway").

Command line options: `--browser` (use an Edge or Chrome app window), `--devtools` (allow F12), `--no-window` (server only, for testing), `--port N`.

## Build it yourself

You need Windows and the .NET Framework C# compiler that ships with it (no SDK). Then:

1. Get the libraries into `lib\` (see [lib/README.md](lib/README.md)): CodeWalker's DLLs from a CodeWalker build, and WebView2's with `tools\fetch-webview2.ps1`.
2. `powershell -ExecutionPolicy Bypass -File build.ps1` builds `MloCreator.exe` (`-CodeWalker <folder>` or `CODEWALKER_DIR` to copy the CodeWalker DLLs the first time; `-Out name.exe` builds beside a running copy).
3. `powershell -ExecutionPolicy Bypass -File package.ps1` makes the folder and zip you can hand to others.

The editor is plain HTML, CSS and JavaScript in `ui\` (WebGL, no framework, no build step); it is served from disk, so editing it only needs a page reload. Changes to `src\*.cs` need a rebuild. `tools\verify_export.ps1 -Res <exported folder>` opens every exported file with CodeWalker and prints what is inside.

## Layout

| Folder | Content |
|---|---|
| `src\` | The program: local server and window (`Program.cs`, `AppWindow.cs`), import and cutting (`ImportHost.cs`, `ModelCut.cs`, `CollisionCut.cs`), export (`Exporter.cs`, `FitExport.cs`), game-file lookups (`Vanilla.cs`) |
| `ui\` | The editor |
| `models\` | Three window and door models that come with the program (see their credits) |
| `tools\` | Helper scripts |
| `docs\` | How the program works |

## Credits and licences

MLO Creator uses [CodeWalker](https://github.com/dexyfex/CodeWalker)'s library to read and write GTA V files, SharpDX, and Microsoft's WebView2, and ships three third-party 3D models. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [models/CREDITS.txt](models/CREDITS.txt). One of the models is licensed for non-commercial use only.

GTA V and its assets belong to Rockstar Games. This project is not affiliated with Rockstar Games, Take-Two, or the FiveM team.

## Support

MLO Creator is free and open source. If it saves you time, you can leave a tip on [Ko-fi](https://ko-fi.com/tempusmlos). Thank you, it really helps.

## Licence

MLO Creator's own code is released under the [MIT licence](LICENSE). The MIT licence covers this project only: CodeWalker, SharpDX, WebView2 and the three models in `models\` keep their own licences (see above), and GTA V's files belong to Rockstar Games.
