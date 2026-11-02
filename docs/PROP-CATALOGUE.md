# Modellkatalog

Öppna **Window / door models**. Modellbiblioteket har nu större kort med en förenklad förhandsbild snett framifrån, namn, kategori, format och mått. Klicka **Expand** för att öppna den stora katalogen.

- Sök på modellnamn eller filnamn. Flera sökord kan kombineras.
- Filtrera All, Decorations, Doors, Windows eller Frames.
- Filtrera YDR/GLB och sortera på namn, filnamn eller höjd.
- Välj ett kort för större bild och bredd, djup och höjd. Klicka **Place this model** och placera i scenen som tidigare.
- I sidopanelen kan du ändra kategorin för den valda modellens fil under **Use this file as**. Det påverkar filens bibliotekskategori; redan placerade objekt behåller sina inställningar.
- **+ Import models** använder samma import som tidigare. Importerade YDR-filer läggs till via **Imported YDR files → Add**.

Sidopanelen visar sex kort per sida och den stora katalogen upp till 24. Förhandsbilder cachas per modell, vy och bildstorlek. Sökning uppdaterar resultatlistan utan att förstöra textfältets fokus. Filvarningar finns under modellinformationen och exportvarningar behålls.

Katalogen visar projektets importerade modeller och de medföljande modellerna. Den innehåller inte ett nytt färdigfyllt GTA-propbibliotek eller nya möbelassets. Förhandsbilderna använder materialens förenklade färger; de är inte fullständiga spelrenderingar.

Verifiering: syntaxkontroll och befintliga editorregressioner passerar. Katalogens kompakta/stora vy, kategorifilter, sökning och modellval har kontrollerats visuellt i webbläsare med testgeometri. Bilden i leveransen visar testmodeller, som inte ingår som produktassets.

Ändrade programfiler: `ui/js/fitmodels.js`, `ui/js/ui.js` och `ui/app.css`. Dörrarnas export och Lua-controller är oförändrade i denna uppdatering; paketet innehåller även Tilt-up Garage från föregående version.
