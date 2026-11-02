# Alla props — paged local YDR catalogue

## Use

Open an import-building project → Inredning → Local GTA V → Refresh local index. The collection selector defaults to **Alla props**. Search names, archive locations or optional imported tags. Choose a category or Other / Uncategorised, and use Previous/Next to browse. **Inredningsurval** retains the earlier furniture subset. Doors, gates and windows remain under Build with their own paged search.

The tested installation indexes 86,690 YDR archive entries. After selecting one representative per model name, Alla props contains 80,591 non-door/window names; the building catalogue contains 2,099 names. Counts vary by GTA installation. These are searchable archive candidates, not a claim that every model is a usable standalone decoration. YDD/YFT models are not included.

Geometry/textures load only when selecting a usable card. A card marked **Archive only · no standalone archetype** cannot be selected: a raw YDR entry without a known archetype is not sufficient for reference-only placement with original collision. Skinned/multibone models also remain unsupported and return an explicit error. Other candidates may be huge structures, LOD pieces, DLC assets, or models without suitable collision. Categories are approximate model-name rules; unknown names remain searchable.

The new categories cover plants, tools/workshop, food/drink, rubbish/debris, bathroom, office/small items, sports/leisure, signs/street, containers/industrial and buildings/structure, alongside existing furniture categories. The optional local external metadata file still provides searchable tags/descriptions without overriding geometry or dimensions.

## Implementation

The read-only RPF index is reused. A cached, deduplicated metadata list and search text are built after index/cache loading and refreshed after importing optional labels. New `rpf-browse` requests specify query, category, scope (props/interior/building), offset, limit and order. Responses contain at most 100 records; the expanded catalogue requests 24 per page and the sidebar requests 6. Model-name order is stable; archive/file order is available. Height sorting is disabled for native metadata because it would require decoding all drawables.

Search input is debounced, stale responses cannot replace newer results, failed requests offer Retry, and leaving the modal cancels its pending search timer. The browser receives one metadata page rather than every archive record. Existing GLB/YDR file import remains unchanged. Original-model export now accepts valid native model references beyond the previous furniture-name whitelist. The existing original-size, placement and bound validation remains. Original collision and Frys på plats behavior are retained; no GTA assets are included in this build, projects or generated native-reference resources.

Model selection still uses the existing bounded backend decode cache. Representative selection prefers known archetypes and base archives; this is not a full DLC mount/load-order resolver. Texture dictionary limitations from the original RPF analysis remain. No automatic full-archive extraction is introduced.

## Validation

Automated tests exercise full-index metadata search, additional categories, unique nonoverlapping pages, maximum page size, out-of-range pages, collection separation, tag-cache refresh and zero geometry loads during browsing. DOM tests exercise search/page requests, delayed/stale responses, failure/retry, archive-only disable and collection/category changes without requesting geometry. Existing editor/import/export/door/controller/auto-open regressions remain in the suite.

Sample additional props are loaded and exported as original references with frozen/collision flags, alongside the earlier furniture and door samples. Multibone rejection is also tested. No whole-catalogue geometry or actual FiveM physics validation is performed. Test each selected model's collision, placement and freezing in FiveM before using it in a released map.
