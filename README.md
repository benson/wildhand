# wildhand

a 3d open-world creature card battler that runs in the browser. explore an 8km continent across eight zones, run into roaming creatures, and fight them with balatro-style poker hands (chips × mult). bind the creatures you beat into your deck, collect charms, level up to 30, take down zone bosses, and duel other players.

**play:** https://wildhand.bensonperry.com

## the continent

| zone | levels | outpost | boss |
| --- | --- | --- | --- |
| hearthvale (meadows) | 1–5 | hearthtown | old bristle |
| whisperwood (old forest) | 5–10 | mossgate | the drowsing king |
| coral reach (palm coast) | 6–11 | driftmoor | captain pincer |
| saltmarsh (swamp) | 9–14 | reedwatch | the mirefather |
| sunscorch (desert mesas) | 12–17 | dustwell | the dune colossus |
| frostpeak (snow mountains) | 16–22 | cold hollow | hoarfang |
| ember caldera (volcano, lava) | 20–26 | ashfall | the pyrelord |
| the shattered highlands (ruins) | 24–30 | last light | the last warden |

every outpost has a hearth (heal), a merchant (stock and prices scale with the zone) and a waystone. touch a waystone to attune it, then travel between attuned waystones from any of them. press `r` to ride an elk, `m` for the world map.

## how it plays

- **explore.** wasd / arrows to move, shift to run, space to jump, drag to orbit the camera, scroll to zoom. on touch devices the left thumb moves and the right thumb looks.
- **battle.** walk into a wild creature. choose up to 5 of your 8 cards and play a poker hand. the hand type sets base chips × mult, each scoring card adds its rank in chips, and charms and bound creatures add more. the total is your damage. the creature attacks after each hand, and its next move is shown in advance.
- **elements.** tide › ember › grove › volt › tide. if most of your scoring cards beat the creature's element you get ×1.5 mult. if they're weak to it you get ×0.75.
- **grow.** wins pay gold and let you pick a reward: bind the creature as a card with its own ability, take an enhanced card (foil, holo, prism, gilded), or take a charm. the merchant in hearthtown sells charms, card packs, tomes that level up hand types, and card removal.
- **danger.** creatures get stronger the farther you go from town, and the strongest ones chase you. rest at the hearth to heal. if you faint you lose half your gold.
- **duel.** walk up to another player and press `f`. each of you plays 4 hands from your own deck, and the higher total score wins.

## tech

- plain es modules with no build step. three.js r170 loads from jsdelivr through an import map.
- the continent is procedural and seeded, so every client generates the same world. it streams in 128m chunks generated in web workers, with four levels of detail out to ~1.3km, merged per-chunk trees and props, and colliders and creature spawns that load and unload with their chunks. it has gpu instanced grass (~160k wind-animated blades that wrap around the player), fluffy alpha-card foliage with spherical normals, a stylized water shader (depth tint, shoreline foam bands, sun glints), a gradient sky with clouds, soft shadows, bloom and a color grade.
- zones blend at their borders and change fog, sky, ambient light and particles (pollen, fireflies, snow, embers, dust); the caldera's low ground is lava and the marsh has murky pools.
- **multiplayer** is serverless webrtc via [trystero](https://github.com/dmotz/trystero), using public nostr relays only for signaling. the bundle is vendored in `vendor/trystero-nostr.js`. creature positions are a pure function of a seed and the wall clock, so everyone sees the same roaming creatures without a server. defeats are broadcast to peers. because there is no server, progress is saved in localStorage and duels are trust-based.
- `?q=low` forces the low graphics preset (the default on phones).

## files

```
index.html, style.css      page + ui styles
src/game.js                main loop, hud, battles, duels, networking glue
src/world/                 terrain, grass, water, sky, trees, props, town
src/entities/              player controller, creatures, remote players
src/cards/                 card data, hand scoring, battle state machine, profile
src/ui/                    card rendering, battle overlay, menus, portraits
src/net.js                 trystero + broadcastchannel transport
assets/models/             kenney + kaykit glb models (cc0)
```

## local dev

```
npx serve . -l 3000
```

## credits

- creature and nature models: [kenney](https://kenney.nl) (cube pets, nature kit), cc0
- character models: [kaykit adventurers](https://kaylousberg.com) by kay lousberg, cc0
- three.js, trystero (mit)
