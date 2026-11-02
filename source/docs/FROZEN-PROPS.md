> Current catalogue: [Alla props](ALL-PROPS.md) adds full-index paged searching and more categories. The previous 1,573-item furniture subset remains available as Inredningsurval.

# Expanded interior catalogue and per-placement freeze

## Use

Open an import project → Inredning → Local GTA V → Refresh local index. Furniture candidates now include seating, tables/desks, storage, beds, lamps and selected appliances, rather than only ten pilot props. The tested installation returns 1,573 unique interior candidates with an associated archetype. Counts vary by installation. Geometry/textures are still decoded only when a model is selected, with a bounded decode cache. Candidates are matched by model names and can include parts, unsuitable models or unavailable DLC. Skinned/multibone preview limitations remain; not every candidate has been tested.

Select a placed original GTA furniture prop and enable **Frys på plats**. Export and reload the resource to apply. This sets the per-placement CEntityDef Static Entity bit (32), preserving the existing flags and original collision. It does not modify the original archetype or affect other instances of the same model. With the option off, original physics behavior remains; an already-static original model may still be immovable. Existing projects default to the previous behavior. Duplication retains the selected setting. Imported GLB/YDR decorations are already baked into the static interior and do not need this option.

This setting applies to furniture, not doors; moving doors continue to use their existing controller. Loose furniture physics/network behavior is unchanged. Frozen objects are static MLO placements that each client streams with the map. No new runtime ownership or moving-object synchronization is introduced.

## Validation

- Binary YTYP roundtrip: one original chair has static bit 32, another retains its old flags; embedded-collision disable bit 4 remains clear on both.
- Original dimensions and model references are retained; no GTA geometry/textures are copied to projects or exported resources.
- Expanded catalogue construction loads no geometry. Original ten pilot props and three additional candidates load successfully: prop_chair_03, v_res_tre_sofa, v_res_m_lampstand. These additional models resolved textures without warnings.
- Existing import, door, auto-open, lock, export and Lua controller regressions pass.
- RPF archive sizes/timestamps remain unchanged.

Actual freeze/physics behavior needs a FiveM test: place two copies of the same chair/table, freeze only one, export/reload, then try pushing both. Confirm that both retain collision and only the unchecked dynamic model moves. Also check resource restart/stream-in and a second client. This build has not been game-tested by the coding agent.

Reference for the entity bit: [CodeWalker entity flags](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker/Project/Panels/EditYmapEntityPanel.Designer.cs#L192).
