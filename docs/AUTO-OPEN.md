# Auto open och lås

Den här versionen lägger till **Auto open when players or vehicles approach** för dörrar med den inbyggda controllern. När en ny placering får typen Vertical Garage, Tilt-up Garage eller Sliding slås alternativet på om placeringen inte redan har ett uttryckligt val. Gamla projekt ändras inte automatiskt: markera porten och aktivera Auto open där.

## Inställningar

- **Auto-open distance:** standard 6 meter, justerbart 1–30 meter.
- **Close delay after area is clear:** standard 3 sekunder, justerbart 0–120 sekunder.
- **ox_doorlock state ID:** 0 betyder ingen koppling. Ett annat värde läser låsläget från den befintliga ox-posten med detta numeriska ID.

Exportera om resursen efter ändringen och ersätt den tidigare exporterade resursen på servern. Den nya exporten måste innehålla både konfigurationen och den nya `server/doors.lua`. OneSync krävs som tidigare. Inga nya spelresurser behöver installeras för olåst autoöppning.

Servern kontrollerar positioner för spelare och serverkända fordon var 500:e millisekund; även parkerade fordon kan hålla porten öppen. Avståndet mäts från dörröppningen, inte från portbladets öppna läge eller topplacerade pivot. När porten öppnats används två meters extra avstånd för att undvika att den växlar fram och tillbaka vid gränsen. Stängningsfördröjningen räknas från den senaste närvarodetekteringen. Ett dubbelpar har ett gemensamt läge och en gemensam övergång.

Klienterna skickar inga påståenden om närhet eller om att området är tomt. Rörelse och collision använder samma synkroniserade objekt och controller som tidigare. Det här är närhetsdetektion, inte exakt hinderavkänning eller klämskydd. Testa stora fordon, höjdskillnader och portens hela rörelsebana i spelet. Gruppens läge är gemensamt för resursens klienter; separat status per routing bucket ingår inte.

## Lås utan ox_doorlock

Ett betrott serverscript kan använda:

```lua
exports['din_mlo_resurs']:SetDoorLocked('gruppnamn', true)
exports['din_mlo_resurs']:SetDoorLocked('gruppnamn', false)
local locked = exports['din_mlo_resurs']:GetDoorLocked('gruppnamn')
```

Gruppnamnet står i exporterade `doors.lua`. Låsning stänger porten och stoppar autoöppning, manuella öppningskommandon och `SetDoorOpen(..., true)`. Upplåsning låter automatiken öppna när något är nära. Dessa egna lås lagras inte permanent: ditt serverscript behöver återställa önskat låsläge vid resursstart. Ett ox-lås, om kopplat, måste också vara upplåst; SetDoorLocked(false) kan inte kringgå det.

Manuella `/mlodoor`-kommandon kräver fortfarande ACE `mlo.doors` och närhet. Automatisk öppning av olåsta portar kräver ingen sådan ACE.

## Valbar ox_doorlock-koppling

ox_doorlock används här som **källa för låsläge**, via dess serverexport `getDoor(id)`. `0`/`false` är upplåst och `1`/`true` är låst. Se projektets [serverimplementation](https://github.com/overextended/ox_doorlock/blob/main/server/main.lua) och [API-beskrivning](https://github.com/overextended/ox_doorlock/blob/main/README.md).

Ange ett ID för en befintlig ox-post vars låsläge ska styra portgruppen. Controllern läser aktuellt läge även efter omstart. Om ox_doorlock inte är startat, posten inte finns, exporten ger fel eller läget är okänt hålls gruppen låst. Den återhämtar sig när ett giltigt låsläge kan läsas igen.

Kopplingen skapar inte en ox-post och ger inte automatiskt E-meny, nycklar, jobb- eller inventarieintegration på den nya porten. Registera inte den scriptstyrda portmodellen hos ytterligare en native-rörelsecontroller. ox_doorlocks vanliga klientkod registrerar modeller i GTA:s DoorSystem; den inbyggda controllern måste fortsätta ensam styra dessa specialportars rörelse. En befintlig ox-post eller en separat låsinteraktion kan användas som låskälla. Vanliga, ostyrda Hinged-dörrar använder fortfarande sitt vanliga dörrscript som tidigare.

## Verifiering

Kompilering, binär export, editorregressioner och tidigare rörelsetester passerar. Nya Lua-tester kör den faktiska servercontrollern med simulerade FiveM-/ox-anrop och kontrollerar spelare, fordon, dubbelpar, fördröjning, hysteres, dörröppningens triggerpunkt, gamla projekts standardläge samt låsning, spärrade öppningsförsök och ox-fel/återhämtning. Exporttestet kontrollerar också att räckvidd, nollsekunders fördröjning, ox-ID och triggerkoordinater kommer med.

Riktigt FiveM-test med två klienter och faktisk ox_doorlock-version återstår. Prova närmande, avlägsnande, parkerad bil, låst/upplåst läge, sen anslutning samt omstart av både MLO-resursen och ox_doorlock. Tidigare testversioners portar blir automatiska först när Auto open aktiveras och resursen exporteras om.
