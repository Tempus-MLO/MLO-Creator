# Ändringar i vår MLO Creator-testversion

Datum: 2026-11-02. Utgångspunkt: Tempus-MLO/MLO-Creator. Detta är en vidareutvecklad testversion, inte en officiell upstream-release.

## Dörrar och portar

- Behåller befintliga vanliga dörrar och automatiska dubbeldörrar för importerade modeller.
- Dörrtyper: **Hinged**, **Vertical Garage**, **Sliding** och **Tilt-up Garage**.
- Inställningar för rörelseriktning, öppningsvinkel/sträcka, hastighet och dörrbladets collision.
- Tilt-up roterar en rigid port runt överkanten; extra lyft och framåt-/bakåtförskjutning kan justeras. Det är inte en animerad sektions-/rullport.
- Anpassad export av pivot, geometri, archetypes, fysik/collision och MLO-entities. Dörrar som controllern skapar exporteras inte dessutom som fasta MLO-entities.
- Exporterad Lua-controller med serverstyrt öppet/stängt läge, revisioner, snapshots för sen anslutning och återställning efter streaming.
- Collision sitter på samma objekt som flyttas/roteras. Klienterna skapar lokala objekt från gemensamt logiskt serverläge; det är inte separata nätverksägare som konkurrerar om samma objekt.
- Manuella kommandon och serverexports för öppning/stängning, med behörighets-, närhets- och frekvenskontroller. Dubbla importerade dörrblad delar läge.

## Automatisk öppning och lås

- Valbar **Auto open** för den inbyggda controllern, med avstånd och stängningsfördröjning.
- Servern läser positioner för spelare och fordon; hysteres minskar upprepade öppna/stäng-växlingar vid avståndsgränsen.
- Nya garage-/skjut-/tiltplaceringar får autoöppning när dörrtypen väljs, om inget tidigare uttryckligt val finns. Gamla placeringar ändras inte automatiskt.
- Serverexports för att låsa/låsa upp och läsa låsläge.
- Valbar läsning av låsläget för ett befintligt numeriskt ox_doorlock-ID. Okänd/stoppad låsleverantör håller dörren låst.
- Integrationen skapar inte ox_doorlock-poster eller interaktionsgränssnitt. Den inbyggda controllern ska ensam styra rörelsen för sina dörrar.

## Direkt YDR-import

- Placerbara stela `.ydr`-modeller kan importeras direkt; ingen manuell GLB-konvertering behövs för dessa modeller.
- Läser användarens importerade `.ytd`-texturer och inbäddade texturer.
- Importerade YDR-modeller kan användas som dekoration/dörrar utan att blandas ihop med byggnadsmodellen.
- Befintlig GLB-import behålls.
- Filimporten är en mesh-konvertering: material/collision byggs om vid export. Den bevarar inte alla ursprungliga shaders, animationer, skelett eller physics dictionaries. Multibone/skinnade modeller avvisas uttryckligen.

## Editor och modellkatalog

- Ny **Inredning**-flik: Import → Build → Inredning → Paint → Export för projekt med importerad byggnad.
- Möbler/props hanteras under Inredning; dörrar, portar, fönster och karmar ligger kvar i Build.
- Utökad Model Catalogue med kort, modellförhandsvisningar, sökning, filter, sortering, sidvisning och större katalogdialog.
- Flytta, vrid, duplicera och ta bort placerade objekt. Redan placerade projektdata behålls.

## Lokal RPF-katalog och originalmodeller

- Skrivskyddad indexering av användarens lokala GTA V-installation med befintliga CodeWalker/RPF-bibliotek.
- Indexerar YDR-namn, arkivplats, interna sökvägar, archetype-kopplingar och YTD-beroenden/kandidater. Metadata-cache ligger utanför GTA-installationen.
- Inga hela arkiv extraheras. Ingen modellgeometri läses vid indexering eller sökning.
- Geometri och texturer läses när en användbar modell väljs; backendens avkodningscache är begränsad.
- Började med tio testprops, utökades till ett möbelurval och har nu **Alla props** med sökning över hela det lokala YDR-indexet, uppdelat mellan Inredning och Build.
- På den testade installationen: 86 690 YDR-arkivposter; 80 591 unika namn i Alla props och 2 099 dörr-/port-/fönsterkandidater, varav 311 fönsterkandidater. Antal varierar mellan installationer. Detta är kandidater, inte lika många spelverifierade props.
- Sökning och sidvisning sker på servern: 24 poster per sida i dialogen, 6 i sidopanelen, maximalt 100 per API-svar. Alla tiotusentals poster skickas inte till webbläsaren samtidigt.
- Fördröjd textsökning, skydd mot gamla asynkrona svar och möjlighet att försöka igen vid sökfel.
- Ursprunglig storlek behålls för originalmodeller. Native export refererar spelets befintliga archetypes utan att kopiera GTA-modeller/texturer eller omdefiniera deras archetypes.
- Originaldörrar använder den synkroniserade controllern med korrigering mellan vald pivot och modellens ursprungliga origin. Originalfönster exporteras som statiska modellreferenser.
- Originaldörrblad kan inte skalas/speglas som importerade modeller; vänster/höger originalblad placeras separat och har i denna version separata controllergrupper.

## Kategorier och sökdata

- Utöver sittmöbler, bord, förvaring, kök, elektronik, belysning och sovrum finns badrum, växter, verktyg/verkstad, mat/dryck, skräp, kontor/småprylar, sport/fritid, skyltar/gatumiljö, industri/behållare, dekorationer och byggnadsdelar.
- Okända namn ligger kvar i **Other / Uncategorised**; kategoriseringen gömmer dem inte.
- Kategorisering bygger på modellnamn och är preliminär. Frivillig lokal Sadler2-liknande JSON kan ge beskrivningar/söktaggar; AI-uppgifter markeras som overifierade och får inte ersätta verkliga dimensioner.
- Inga externa propdatabaser eller bilder från Sadler2/Rivo följer med paketet.

## Frys på plats

- Valbart per placerad originalmöbel, med befintligt beteende som standard för gamla placeringar.
- Exporterar Static Entity-flagga 32 på just den MLO-placeringen; originalets collision och andra instanser påverkas inte.
- Avstängt behåller originalmodellens fysik. Modeller som redan är statiska blir inte automatiskt flyttbara.
- Importerade dekorationer är redan inbakade i det statiska interiöret.

## Snap to ground

- **Snap to ground vid placering** är på som standard under Inredning och kan stängas av.
- Separat **Snap to ground**-knapp för en redan placerad prop, med undo-stöd.
- Söker närmaste strukturyta under klickhöjden/objektets undersida och kontrollerar mitt plus fyra vridna hörn.
- Hanterar övervåningar, källare, genererade golv och lätt sluttande ytor utan att alltid välja höjd noll. Cutaway påverkar inte golvdetekteringen.
- Hittas ingen yta behålls höjden. Dörrar/fönster påverkas inte. Befintliga objekt flyttas inte automatiskt.
- Använder synlig strukturs geometri, inte en fullständig fysiksimulering; placerade props används inte som underlag och objekt lutar inte automatiskt med rampen.

## Tester och dokumentation

- C#-testexport med återläsning av binära YDR/YTYP-filer: pivot, collision-bounds, dörrtyper, MLO-entities, statisk flagga och referensexport.
- JavaScript-tester för befintliga dörrar/dubbelblad, native metadata/storlek, katalogsökning/sidvisning, gamla söksvar, frysning och golvsnappning.
- Lua-tester med simulerade klienter: behörighet, närhet, frekvensgräns, lägesbyte, sen anslutning, streaming, rörelse/pivot, collision-anrop, autoöppning och lås.
- RPF-test mot lokal GTA-installation: noll geometriläsningar under index/sökning, utvalda modell-/texturladdningar, ingen kopiering av GTA-assets vid referensexport och oförändrade RPF-storlekar/tidsstämplar.
- Dokumentation för dörrar/YDR, autoöppning/lås, RPF-katalog, originaldörrar, Alla props, frysning och golvsnappning.

## Viktiga kvarvarande begränsningar

- Automatiserade tester är inte fullständig FiveM-verifiering. Användaren har rapporterat fungerande portöppning och collision på testade möbler; detta verifierar inte alla modeller/rörelser eller verklig synk med två klienter.
- Testa utvalda modellers collision med spelare/fordon, frysta/överströmmande objekt, lås och två riktiga klienter innan publicerad användning.
- Ingen garanti att varje YDR är en användbar fristående prop. Arkivposter utan känd archetype visas men kan inte placeras. Multibone/skinnade modeller stöds inte i förhandsvisningen.
- Ingen fullständig resolver för DLC-mountordning eller alla ärvda texture dictionaries. Vissa modeller/texturer kan saknas eller vara otillgängliga i aktuell spelversion.
- Garage-/skjutcontrollern är kinematisk, utan klämskydd. Ingen uppdelning av dörrläge per routing bucket. Egna lås återställs vid resursomstart om inte ett annat serverscript sparar dem.
- Ursprungliga licenser, credits och tredjepartsnotiser behålls. Inga GTA V-assets distribueras.

## Huvudsakliga koddelar

I GitHub-strukturen ligger redigerbar kod under `source/`:

- `source/src/`: YdrModels, RpfCatalogue, CatalogueModels, GamePropExport samt ändringar i import, export och serverroutes.
- `source/runtime/`: client_doors.lua och server_doors.lua.
- `source/ui/js/`: fitmodels, app, ui, importui, importtools, importmodel och hints; även ändringar i ui/app.css.
- `source/tests/`: export-, RPF-, editor-, katalog-, snap- och Lua-tester.
- `source/docs/`: tekniska beskrivningar och användningsguider.
- Rotens `ui/`, `runtime/`, `docs/` och körbar fil är distributionskopian av samma version.
