# Nytt: Tilt-up Garage

Välj **Tilt-up Garage** för ett helt portblad som vinklas upp runt överkanten. Börja med **Opening angle = 90°**, **Speed = 45°/s**, **Extra lift when open = 0 m** och **Forward / back when open = 0 m**. Välj **Toward back** eller **Toward front** beroende på vilken sida som ska öppnas; modellens gröna pil visar framsidan. Negativ förskjutning flyttar porten bakåt, positiv framåt. Extra lift justerar slutlägets höjd och kan även vara negativ. Förskjutning och rotation sker samtidigt.

För den befintliga raka rörelsen väljer du **Vertical Garage**. **Lift height / opening distance** är antalet meter porten flyttas från sitt stängda läge, inte höjden över marken. Inställningen fanns även i förra versionen under namnet Opening distance.

Tippläget är en rigid port runt en toppaxel med valbar translation. Det återskapar inte en sektionsports leder, skenor eller exakt länkarmmekanik. Äldre projekt byter inte dörrtyp automatiskt. Efter val och justering måste resursen exporteras på nytt och ersättas på servern. Använd samma synkroniserade kommando/server-export som tidigare; automatisk närhetsöppning har inte lagts till.

Tipplägets geometri och collision bakas i lokala bredd-/djup-/höjdaxlar med pivot mitt på överkanten. Klienten applicerar hela modellens världsheading och lokal tippning med [SetEntityQuaternion](https://raw.githubusercontent.com/citizenfx/natives/master/ENTITY/SetEntityQuaternion.md). Collision sitter på samma objekt och får samma rotation och förskjutning. Dubbla tippblad öppnar åt samma håll med gemensamt serverläge. Controllerns serverprotokoll är oförändrat.

De automatiserade testerna täcker nu nio exporterade dörrblad, toppivotens collision-bounds, vridna MLO-/dörrplaceringar, tippningens mellan- och slutläge, återgång till stängt, förskjutningar, två simulerade klienter samt återinläsning efter streaming. Riktig FiveM-collision under denna nya rotation och flerklientbeteendet måste fortfarande speltestas. Den tidigare rapporten följer nedan; uppgifter om tre typer och sju testblad avser första testversionen.

---

# Dörrtyper och direkt YDR-import

Status: implementationen kompilerar och de automatiserade testerna passerar. Faktisk collision och nätverksfunktion i FiveM återstår att speltesta. Detta är en separat testversion, inte en spelverifierad release.

## Använd testversionen

Packa upp hela programkatalogen och starta `MloCreator.exe` därifrån. `ui`, `lib`, `models` och den nya katalogen `runtime` måste följa med. Skrivbordets installation ändras inte. För att testa ett befintligt projekt kan du kopiera dess projektfil och motsvarande `.files`-katalog till testversionens `projects`; behåll originalen.

I **Window / door models** finns nu Hinged, Vertical Garage och Sliding. Rörelseriktning, öppningsvinkel/sträcka, hastighet och dörrbladets collision sparas på placeringen. Vinkel och hastighet för Hinged anges i grader och grader/sekund; linjära typer använder meter och meter/sekund.

Hinged använder som standard den tidigare exporten och ditt befintliga dörrscript. Aktivera **Built-in synchronized controller** för att använda de nya rörelseinställningarna även för Hinged. Garage och Sliding använder alltid controllern. Dubbeldörrar finns kvar: bladen delar läge; Hinged och Sliding öppnar åt motsatta håll, medan garageblad lyfts åt samma håll.

Importera en `.ydr` och dess `.ytd` via **Add files**. Öppna modellverktyget och välj **Use as placeable model** vid den importerade filen. Välj Door eller Decoration, välj modellbilden och placera den. Byggnadsmodellen erbjuds inte som placerbar dekoration. YDR som aktiverats i biblioteket behandlas som modellkälla och undantas från byggnadens referens-/detaljmodeller.

Decoration skapar inga väggöppningar. Dess valbara collision är en fast boxapproximation. Dörrens collision är en box kring bladets kropp, utan utstickande handtag. Detta ersätter inte noggrant modellerad collision för exempelvis stolar eller ihåliga möbler.

## Analys av den ursprungliga exporten

Utgångspunkten är källkoden i den lokala installationens `source`, utan Git-metadata. Den är inte verifierad som identisk med senaste GitHub-versionen. Ingen kod har publicerats till GitHub.

`FitBakeGeoms` i `src/FitExport.cs` bakar skala, spegling och placeringsvinkel i geometrin. Ursprungligen får alla GLB-dörrar sidopivot mitt på höjden. Dubbeldörrar delas i två placeringar i `FM.exportSpec`; det andra bladet kan speglas.

`FitDoorBoundsXml` skriver en Composite med ett Box-barn direkt i YDR. Boxens transform placerar collision vid bladet i samma koordinatsystem som geometrin. `FitDoorArch` skriver archetype-flaggorna 604110848 (`0x24020000`), specialAttribute 7 och physicsDictionary med modellens namn. Dictionary-referensen är metadata; den skapar inte separat riggning eller rörelsebegränsningar. Någon fristående YFT eller rörelse-controller genererades inte.

`src/Exporter.cs` lägger ursprungligen dörrarna som `CEntityDef` i MLO:ns entities-lista. Room 1 refererar dem genom index efter byggnadsgrupperna. Världskoordinater beräknas med MLO-placeringens heading. Den äldre importerade YDR-vägen och GLB-biblioteket är separata flöden; den äldre vägen gav inte fri YDR-placering i modellverktyget.

Den gamla inställningen `solid` skapar collision i MLO:ns fasta YBN. Den står kvar i öppningen även när ett dörrscript öppnar bladet. Den behålls för gamla projekt men undantas alltid för styrda dörrar. Även byggnadens ursprungliga väggcollision måste fortfarande tas bort där öppningen ska vara.

## Natives och vald lösning

Cfx:s [dörrguide](https://docs.fivem.net/docs/assets-manual/beginner-series/part-8/) beskriver native-modeller med följande uppbyggnad:

| Typ | Pivot | Native specialAttribute |
|---|---|---|
| Hinged | Sidogångjärn | 7 |
| Sliding | Nedre hörn | 8 |
| Vertical Garage | Nederkantens mitt | 5 |

Native-stöd finns alltså. Modellerna behöver också korrekt drawable-/ben-/collision-uppbyggnad. [DoorSystemSetOpenRatio](https://raw.githubusercontent.com/citizenfx/natives/master/OBJECT/DoorSystemSetOpenRatio.md) ger ett normaliserat öppningsvärde, inte en universell inställning för godtyckligt antal meter. [AddDoorToSystem](https://raw.githubusercontent.com/citizenfx/natives/master/OBJECT/AddDoorToSystem.md) beskriver dessutom eventbaserad synkronisering av lokala dörrsystem. Dörrlägen kan inte appliceras innan [door physics är laddad](https://raw.githubusercontent.com/citizenfx/natives/master/OBJECT/DoorSystemSetDoorState.md).

För de återuppbyggda modellerna används därför en separat controller med explicit sträcka och hastighet. Garage- och Sliding-pivoterna följer tabellen. Både geometri och collision flyttas till rätt pivot före export. Styrda archetypes använder specialAttribute 0 och har dörrphysics-flaggan borttagen, så spelmotorns dörrfysik inte konkurrerar med scriptet. Övriga relevanta flaggor och physicsDictionary behålls för modeller med collision. Collision av tar bort både YDR-bounds och dictionary-referensen.

Styrda dörrar exporteras inte dessutom som MLO-entities. Klienten skapar i stället ett fryst objekt per blad och flyttar hela objektet, inklusive dess collision. Servern äger gruppens mål, aktuell övergång och revision. Klienterna får övergångar och periodiska snapshots med tidsuppskattning. Sen anslutning och återkomst till området använder aktuellt läge. Inga nätverkade props behöver byta ägare. Detta är synkroniserad logisk status med lokala collision-objekt; ingen serverfysik för dörrbladet och ingen exakt bildrutelåsning mellan klienter utlovas.

## Styrning i FiveM

Exporten lägger till `doors.lua`, `client/doors.lua` och `server/doors.lua` samt manifestreferenser och OneSync-beroende. Gruppnamnen finns i `doors.lua`.

Ge vald ACE-grupp rättigheten, exempelvis:

```cfg
add_ace group.admin mlo.doors allow
```

På klienten: `/mlodoor <gruppnamn> open`, `close` eller `toggle`. Servern kontrollerar ACE, åtta meters avstånd och anropsfrekvens. Från ett betrott serverscript:

```lua
exports['ditt_resource_namn']:SetDoorOpen('gruppnamn', true)
```

Det finns även `GetDoorOpen`. Dubbeldörrar har ett gemensamt gruppnamn. Läget startar stängt vid resource-omstart; det lagras inte permanent. Registrera inte samma styrda modell hos ytterligare ett dörrscript.

## YDR-begränsningar

Ingen GLB-fil behöver skapas. Adaptern läser YDR:s high-detail-mesh genom den befintliga CodeWalker-läsaren, med normals och UV. Inbäddade texturer och uttryckligen importerade YTD-filer används. Modellens egen namngivna YTD och därefter inbäddade texturer har företräde vid namnkrockar. Saknade diffuse-texturer ger en synlig varning och grått material.

Detta är inte en förlustfri import av alla GTA-assets: originalets shaders, shaderparametrar, alpha-cutout-effekter, skeleton, animationer, LOD-kedja och physics återskapas inte. Modeller med flera ben avvisas. Material/texturer går genom programmets befintliga förenklade export, med högst 1024 pixlars texturstorlek. Collision byggs om enligt det valda dörr-/dekorationsläget. YDR är heller inte ett komplett paket: externa texturer och separata YBN-filer kan behövas. Fullständig RPF-bläddring och ett sökbart GTA-katalogbibliotek ingår inte i denna ändring.

## Ändrade filer

| Fil | Ändring |
|---|---|
| `ui/js/fitmodels.js` | Typinställningar, exportdata, par, YDR-bibliotek, dekorationer |
| `ui/js/importmodel.js` | Modellkällor separeras från byggnadens referensmodeller |
| `src/FitExport.cs` | Inställningsläsning, pivoter, collision-transforms |
| `src/Exporter.cs` | Archetypes, MLO-entities, världskoordinater, controllerfiler och manifest |
| `src/GlbModels.cs` | Gemensam inläsning med YDR-adapter |
| `src/YdrModels.cs` | Ny direkt YDR-/YTD-läsning med begränsningsvarningar |
| `runtime/*_doors.lua` | Ny klient-/server-controller |
| `package.ps1` | Packar även controller-mallarna |
| `tests/*` | Export-, editor- och Lua-regressioner |

## Genomförda tester och kvarvarande speltest

Kompilering med .NET Framework-kompilatorn passerar. Node kontrollerar syntax och editor-export. Lua-testet kör själva controllerkoden mot simulerade natives och två klientmiljöer: behörighet, avstånd, frekvensbegränsning, vändning under rörelse, sen anslutning, gamla revisioner, stream-in, collision-anrop och städning.

C#-testet exporterar sju dörrblad, läser tillbaka binära YDR/YTYP med CodeWalker, kontrollerar MLO-antal, collision av/på och boxarnas bottenpivoter. Det återimporterar en exporterad YDR med YTD direkt. Även den befintliga lokala `prop_pris_door_02.ydr` har lästs direkt: 12 trianglar och en textur. GTA-filen ingår inte i leveransen.

Testerna finns i `tests/run.ps1`; de kräver Node och Python med `lupa`, alternativt Lua 5.4 för Lua-testfilen. Testkörningen sparar sina genererade fixtures separat.

Följande måste godkännas i en riktig OneSync-server med två klienter:

1. Stängd port stoppar både spelare och fordon på båda klienterna. Öppen port lämnar fri passage utan gammal collision i öppningen.
2. Collision följer bladet även under rörelse; testa båda riktningarna och vriden MLO-placering.
3. Öppna på klient A och kontrollera läget hos B, inklusive dubbeldörrar. Anslut B mitt under rörelsen och efter avslutad öppning.
4. Lämna streamingområdet och återvänd. Prova från båda klienterna samt resource-omstart och klientfrånkoppling.
5. Kontrollera äldre Hinged-projekt med deras vanliga dörrscript. Kontrollera att bara en controller äger varje styrd dörr.

Controllern är kinematisk och saknar klämskydd, hinderavkänning och realistiska kraftreaktioner. Synkroniserad målstatus ersätter inte detta. Den får inte beskrivas som fullständigt collision-/nätverksverifierad innan speltesterna ovan är utförda.
