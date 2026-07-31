# Paws & Politburo

An endless hopping game in the spirit of *Crossy Road*, starring cats and dogs
who have decided that collective ownership of the food bowl is not for them.
You hop forward, one metre at a time, while a red tide of marching comrades
rolls up the screen behind you. It never stops. It never gets tired. It gets
faster if you dawdle.

No build step, no dependencies, no assets — every animal, tank and banner is
drawn from canvas primitives at runtime.

## Play

Open `index.html` in any modern browser. That's it.

If you'd rather serve it:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Hop forward / back / sideways | Arrow keys or `W` `A` `S` `D` | Swipe, or tap ahead of your animal |
| Pause | `P` or `Esc` | ❚❚ button |
| Mute | `M` | 🔊 button |
| Restart | `R` | buttons on the game-over card |

## Rules

- **Score is distance.** Your furthest row is your score, in metres.
- **The Collective** advances from behind. Stand still for more than three
  seconds and it surges; get too far ahead and it closes the gap anyway.
  Touching it ends the run, and you cannot hop backwards into it.
- **Roads** carry requisitioned trucks, jeeps, tractors and the occasional
  tank, each driven by a very loyal pet. They do not brake.
- **Canals** drown you unless you land on a log or a raft. Logs drift; ride
  one too far and you go over the edge of the map.
- **Rails** flash red for about a second before the People's Express arrives.
- **Kibble** (golden bones) is scattered on grass, worth 5 each, plus a bonus
  of 1 per 5 metres at the end of a run. Spend it on new comrades.

## Comrades

Eight playable animals, two unlocked from the start. The rest cost kibble:
Boris (60), Duchess (90), Sputnik (120), Pierogi (150), Field Marshal Fluff
(220) and Laika (300). Progress, coins and your pick are saved to
`localStorage`.

## Project layout

```
index.html          markup for the canvas and every UI screen
css/style.css       HUD, menus, character cards
js/util.js          maths, colour, storage and canvas helpers
js/audio.js         synthesised sound effects (WebAudio, no files)
js/characters.js    the roster + the procedural cat/dog renderer
js/world.js         endless row generation and simulation
js/render.js        the faux-3D scene renderer
js/input.js         keyboard, swipe and tap handling
js/game.js          state machine, player physics, the chase
js/main.js          boot, DOM wiring, frame loop
```

Scripts are plain `<script>` tags in dependency order, sharing one `window.PP`
namespace, so the game runs straight off `file://` with no server or bundler.

### How the world works

Rows are generated lazily in bands (a run of 1–4 roads, then a couple of grass
rows, then a canal, and so on) and pruned once they fall far enough behind. Each
road and canal lays its vehicles or logs out around a fixed-length loop whose
gaps sum to exactly one lap, so spacing is preserved forever, nothing ever
overlaps, and there is no unfair hole where the loop wraps. Difficulty ramps
with distance: traffic speeds up, scenery thickens and the tide accelerates.

## Tone

It's a cartoon. The regime is made of stern-looking pets in ushankas, and the
worst thing that happens to you is being redistributed.
