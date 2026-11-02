> Current catalogue: [Alla props](ALL-PROPS.md) adds full-index paged searching and more categories. The previous 1,573-item furniture subset remains available as Inredningsurval.

> Current update: the ten-prop selection limit is lifted for interior candidates. Original furniture now has a per-placement **Frys på plats** option. See [Expanded furniture](FROZEN-PROPS.md). Older counts and limits below describe the previous test build.

> Updated test build: furniture is now under Inredning; original door/window candidates are under Build. See [Original doors](ORIGINAL-DOORS.md) for current usage and limitations. The ten-prop limit below applies to interior furniture.

# Skrivskyddad RPF-katalog — teknisk analys och tiopropstest

## Resultat och användning

Testversionen kan indexera den lokala GTA V-installationens YDR-poster och läsa en vald modell direkt ur RPF till minnet. Ingen manuell extrahering eller GLB-konvertering behövs för de tio testmodellerna. Vanlig GLB-/YDR-import fungerar fortsatt separat under **Imported models**.

1. Packa upp hela testversionen i en ny katalog utanför GTA-installationen. Behåll din tidigare installation och projekt.
2. Öppna ett importprojekt och **Window / door models → Expand**.
3. Välj **Local GTA V · 10-prop pilot** som Catalogue source.
4. Kontrollera sökvägen till GTA V och klicka **Index local GTA**. Första körningen läser arkivstruktur och YTYP-metadata; den kan ta tid. Status visas under tiden.
5. Sök på modellnamn och välj kategori. Korten visar **Select to load** tills en modell väljs. Då läses dess geometri och texturer och dess mått visas.
6. Välj **Place this model**, placera, flytta och rotera i scenen. Originalstorleken behålls i pilotläget. Exportera som vanligt.

**Installation and search tags** innehåller sökväg, uppdatering och valbar import av en lokalt sparad `props_export.json`. Programmet laddar inte ned metadata eller bilder från externa tjänster. Projektets redan placerade GTA-referenser läses tillbaka när projektet öppnas eller dess modeller behövs; det innebär inte att hela katalogens geometri läses in.

## Befintlig läsning och återanvända bibliotek

`src/Vanilla.cs` använde redan `CodeWalker.Core.dll`: `GTA5Keys.LoadFromPath`, `RpfManager.Init`, `AllRpfs`, `RpfFileEntry` och `ExtractFile`. Den gamla uppslagstabellen använder filnamn och låter senare arkiv skriva över tidigare namn. Den räcker för programmets befintliga uppslag men skiljer inte alla arkivvarianter åt.

`src/ModelCut.cs` laddar tidigare importerade fristående YDR via `YdrFile`, omvandlar dem till CodeWalker-XML och läser vertexlayout, normals, UV och index. Den direkta modellimporten i `src/YdrModels.cs` använder detta för att bygga editorns interna modellformat, med texturer från importerade YTD eller inbäddade data. GLB-läsningen finns i `src/GlbModels.cs`.

De befintliga byggreferenserna är **CodeWalker.Core**, **SharpDX** och **SharpDX.Mathematics**, med övriga befintliga DLL-filer i `lib`. Ingen ny CodeWalker-version eller RPF Explorer-process har installerats. RPF Explorer-fönstret behöver inte vara öppet; katalogen återanvänder samma typ av biblioteksläsning direkt. Den [aktuella CodeWalker-källan](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/RpfManager.cs) har en annan Init-signatur än den lokala DLL-versionen, så implementationen är byggd och testad mot programmets faktiska bibliotek.

## Ny indexkedja

`src/RpfCatalogue.cs` skapar en separat arkivkatalog genom en läsande adapter till `Vanilla`. Identiteten är SHA-256 av arkivsökväg och intern sökväg, inte enbart modellnamnet. Flera arkivvarianter kan därför finnas kvar som separata poster. Katalogen undantar `mods`-arkiv och läser bara poster för YDR, YTD och YTYP.

Indexeringen läser RPF-struktur och YTYP-resurser. Den anropar inte YDR-laddaren. Följande metadata registreras:

- Modellnamn, arkivsökväg, intern sökväg och stabilt post-ID.
- Kategori baserad på modellnamn i denna begränsade pilot.
- YTYP-archetype, dess källa och direkt `textureDictionary`-referens med möjliga YTD-arkivplatser.
- Eventuell YTD med samma namn som modellen, uttryckligen märkt som kandidat och inte som bevisat beroende.

Hashar utan motsvarande extern YTD behålls som olösta referenser. Texturer kan ligga inbäddade i YDR och verifieras då först vid modellval. För testets tio props kunde alla använda texturer läsas utan varningar. Generella parent-TXD-kedjor och fullständig DLC-mountprioritet är inte implementerade; kandidaten med närmast gemensam arkivsökväg prioriteras. Det är en avgränsad katalog, inte en fullständig ersättning för CodeWalkers GameFileCache.

`cache/rpf_catalogue_v1.json` innehåller bara metadata. Cachekontrollen använder installationssökväg samt RPF-filernas sökvägar, storlekar och ändringstider; den hashar inte hela arkivens innehåll. Indexcache måste ligga utanför GTA-installationen. Inga nya skrivande RPF-anrop, arkivimporter eller arkivändringar används.

## Modellval, minne och befintlig import

Vid val läses exakt vald YDR-post och direkt identifierade YTD-resurser till minnet via CodeWalker. Inbäddade texturer läses från drawable-objektet. `ModelDoc.Load(YdrFile, null, ...)` skapar XML och vertexdata utan DDS-exportkatalog. Den interna YDR-konverteringen delas med filimporten, vars befintliga diskflöde och inställningar behålls.

Modell- och texturdata skickas bara till den lokala editorns webbsida. Katalogens cache omfattar högst tio avkodade pilotmodeller. Sökning, kategorifiltrering och metadataimport anropar inte geometriladdaren. Projektet sparar modellreferens, arkividentitet, bounds och transform — inga vertex- eller texturbuffertar från GTA.

Pilotens native props kan flyttas, vridas och dupliceras. Storleksändring och godtycklig omorientering är avstängda eftersom den befintliga MLO-entity-exporten inte säkert kan skala dessa game props. Kontroll av originalmått görs även i exportören. Vanliga importerade modeller har kvar sina storleksverktyg.

## Export och collision

`src/GamePropExport.cs` exporterar GTA-props som vanliga MLO-entities med spelets befintliga archetype-namn. Ingen ny archetype, YDR eller YTD skapas för dem. Editorns centrerade placering räknas om till modellens ursprungliga pivot; samma yaw används, och MLO-bounds utökas för placeringarna.

Originalets collision används av spelet. Ingen fast box läggs ovanpå native-propens collision. Editorns collision-walkthrough modellerar inte dessa native-props fullständigt. Collision, rumstillhörighet och streaming måste därför fortfarande kontrolleras i FiveM. Serverns spelbuild måste innehålla modellen, och andra resurser kan påverka vilken variant som laddas. Importerade GLB-/YDR-modeller fortsätter använda sina tidigare exportvägar.

## De två kategorireferenserna

[Sadler2/gtav-props](https://github.com/Sadler2/gtav-props) erbjuder JSON med modellnamn, beskrivningar och taggar. Beskrivningar och taggar uppges vara AI-genererade och kunna innehålla fel. Det nya JSON-stödet matchar exakta modellnamn och använder texten som **overifierade sökhjälpmedel**. Externa dimensionsfält ignoreras. Texten renderas som text, inte HTML. JSON-filen, databasen och bilderna distribueras inte med denna testversion. Licensen har granskats; ingen rättighet till GTA-assets antas följa av kodlicensen.

[Rivos propkatalog](https://rivo.tools/app/assets/props) är referens för kategoriupplägget, bland annat Seating, Tables & Desks, Storage, Kitchen och Electronics. Inga Rivo-modeller, bilder eller katalogdatabaser har hämtats till leveransen. Pilotens kategorier bygger på egna namnregler; frivilliga Sadler-taggar kompletterar sökningen utan att ändra arkivinformation eller uppmätta modellmått.

## Verifierat mot den lokala installationen

Den testade installationen var GTA V Legacy. Indexeringen hittade **86 690 YDR-arkivposter**, inklusive namnvarianter — det är inte 86 690 unika inredningsprops. Räknaren för geometriinläsningar var **0 efter indexering och metadatasökning**.

| Testmodell | Kategori | Trianglar | Lästa texturer |
|---|---|---:|---:|
| prop_chair_01a | Seating | 936 | 2 |
| prop_chair_02 | Seating | 596 | 1 |
| prop_table_02 | Tables & Desks | 304 | 1 |
| prop_table_04 | Tables & Desks | 156 | 1 |
| prop_table_05 | Tables & Desks | 440 | 1 |
| v_res_cabinet | Storage | 1 914 | 2 |
| prop_tv_flat_01 | Electronics | 386 | 6 |
| prop_microwave_1 | Kitchen | 408 | 1 |
| prop_kettle | Kitchen | 568 | 2 |
| v_res_tre_smallbookshelf | Storage | 812 | 7 |

Alla tio laddades utan texturvarningar. Upprepat val använder modellcachen. Indexerings-/valtestet kontrollerar att RPF-filernas storlekar och ändringstider är oförändrade och att indexcache inte innehåller extraherade YDR-, YTD- eller DDS-filer. Det är inte en fullständig filinnehållsjämförelse av hela GTA-installationen.

Binär export lästes tillbaka med CodeWalker: tio native-prop-entities plus testets egen golventity; bara golvet och MLO:t fick nya archetypes. Resursen fick en egen golv-YDR och golv-YTD, inga kopierade GTA-modeller eller texturer. Extern metadata testades med en separat schemafixture: taggsökning fungerar, inga geometrianrop sker och falska dimensionsfält påverkar inte modellen.

Webbvyn har verifierats med den faktiska lokala servern: indexering, sökning efter `table`, inläsning av en vald stol, mått och aktivering för placering. Tidigare GLB/YDR-, dörr-, tipport-, autoöppnings- och låstester passerar också.

## Ändrade filer och testkommandon

Nya: `src/RpfCatalogue.cs`, `src/CatalogueModels.cs`, `src/GamePropExport.cs`, `tests/RpfCatalogueTest.cs`, `tests/run-rpf.ps1` och denna dokumentation.

Anpassade: `src/Vanilla.cs`, `src/ImportHost.cs`, `src/ModelCut.cs`, `src/YdrModels.cs`, `src/Program.cs`, `src/FitExport.cs`, `src/Exporter.cs`, `ui/js/fitmodels.js`, `ui/app.css` och editorregressionerna. Ändringarna i de befintliga läsarna är små adaptrar/återanvändning; deras filimport-API och GLB/YDR-arbetsflöde behålls.

```powershell
powershell -File tests/run-rpf.ps1 -Gta 'D:\din\GTA-installation'
powershell -File tests/run.ps1
```

Kvarvarande avgränsningar: bara tio pilotprops kan väljas/exporteras från GTA-källan; metadataindexet och dess lokala sök-API omfattar fler YDR-poster. Ingen generell YFT-/YDD-, skinned-/animations-, Enhanced-/Gen9- eller RPF-redigeringsfunktion har lagts till. Fullständig mod-/DLC-variantprioritet och godtyckliga TXD-parentkedjor återstår. Slutligt speltest av native-placeringar, collision och rum/streaming i FiveM återstår.
