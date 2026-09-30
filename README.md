# Paws & Politburo

An endless hopping game in the spirit of *Crossy Road*, starring cats and dogs
who have decided that collective ownership of the food bowl is not for them.
You hop forward, one metre at a time, while a red tide of marching comrades
rolls up the screen behind you. It never stops. It never gets tired. It gets
faster if you dawdle.

No build step, no dependencies, no assets — every animal, tank and banner is
drawn from canvas primitives at runtime.

## Play

**<https://cdft.github.io/Test-game/>** — no install, no account, works on phones.

Or open `index.html` in any modern browser. That's it.

If you'd rather serve it:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

### Sharing it as one file

`build.js` inlines the CSS and all nine scripts into single pages with no
external requests, for hosting or passing around:

```sh
node build.js            # writes both bundles below
node build.js --check    # fails if a committed bundle is out of date
```

- `dist/play.html` is a complete page: open it, host it, send it to a friend.
  It is also published at <https://cdft.github.io/Test-game/dist/play.html>.
- `dist/paws-and-politburo.html` is the same game without `<!doctype>`,
  `<html>`, `<head>` or `<body>`, for hosts that supply their own skeleton.

Both pin the canvas to the viewport and disable touch scrolling, which is what
makes them behave on a phone. CI rejects a push whose bundles are stale.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Hop forward | `↑` or `W` | Tap anywhere |
| Hop sideways / back | `←` `→` `↓` or `A` `D` `S` | Swipe that way |
| Pause | `P` or `Esc` | ❚❚ button |
| Mute | `M` | 🔊 button |
| Restart | `R` | buttons on the game-over card |

Nothing chases you until your first hop, so read the hint in peace.

## Rules

- **Score is distance.** Every row past the start line is a metre.
- **The Collective** advances from behind, starting with your first hop. Go
  more than three seconds without hopping forward and it surges; get too far
  ahead and it closes the gap anyway. Touching it ends the run, and you cannot
  hop backwards into it.
- **Roads** carry requisitioned trucks, jeeps, tractors and the occasional
  tank, each driven by a very loyal pet. They do not brake.
- **Canals** drown you unless you land on a log or a raft. Logs drift; ride
  one too far and you go over the edge of the map.
- **Rails** flash red for about a second before the People's Express arrives —
  wig-wag lamps, and striped boom arms that drop across the crossing.
- **Frozen rivers** offer ice floes as stepping stones. Your weight cracks
  them, then sinks them; they bob back up once you're gone. Keep moving.
- **May Day parades** cross the route in slow, dense squads. They will not
  trample you — they will recruit you. Walking into one starts the
  conversion on the spot.
- **The black car** handles anyone who thinks a big lead means they can
  stand still. Go about four seconds without a forward hop on dry land and
  tires screech, a ring locks
  onto your tile, and a secret police sedan tears across lawn, road or rail
  to collect you. You have about a second to move. On water and ice nobody
  needs to come for you — the river handles it.
- **Sector borders** wall the route every 50 metres — concrete, barbed wire,
  a watchtower, and one open gate. Slip through and the paperwork delays your
  pursuers: a 25-kibble bounty, a fanfare, and the tide pushed back two rows.
- **Momentum**: keep your forward hops onto new ground within a beat of each
  other and a 10-hop streak doubles every kibble you grab, with speed lines to
  prove it. Stop, or hop back, and it is gone.
- **Kibble** (golden bones) is scattered on grass, worth 5 each, plus a bonus
  of 1 per 5 metres when the run ends. It goes into the bank the moment you
  pick it up, so quitting or closing the tab never costs you any. Spend it on
  new comrades — directly, or through the lottery.
- **Your record** is drawn in the world: a dashed gold line at your best
  distance, with a little moment when you cross it.
- **Get caught** and you don't just lose — the colour drains out of you, a hat
  drops onto your head, a red star rises, and you fall into step with the rank
  you were running from.

## Sound

An original 8-bit parade march plays under the run: a minor-key tune with a
stomping root-and-fifth bass, fanfare leaps, and a snare on the backbeat. It
picks up tempo when the Collective gets within about five metres, and the march
gets a short victory cadence when it takes you. Three synthesised voices —
pulse lead, triangle bass, filtered-noise drums — scheduled against the audio
clock rather than a timer, so the beat holds steady through dropped frames.
`M` mutes everything, music included.

## The Daily Escape

One map a day, the same for everyone: the date is hashed into the world's
seed, so every road, canal, wall and gate is laid out identically for all
players until midnight. Your best Daily distance is shown on the title screen.
**Share** on the game-over card sends your distance and a link to the game
(`?daily` for Daily runs, which points your friend straight at today's map),
through the phone's share sheet or the clipboard.

## State Directives

Three rotating objectives sit on the title screen — cross four canals in one
run, pick up fifteen kibble off the street, dodge the black car, break your
record. Complete one mid-run and the bounty goes straight into the bank; a
fresh directive takes its place next run. Lifetime goals like "hop 500 times"
count from when they were issued.

## Comrades

Eight playable animals, two unlocked from the start. The rest cost kibble:
Boris (60), Duchess (90), Sputnik (120), Pierogi (150), Marshal Fluff (220)
and Laika (300) — or gamble 100 on **The People's Lottery**, which air-drops
a crate containing one guaranteed new comrade, chosen by the State. Progress,
coins and your pick are saved to `localStorage`.

There is also a ninth comrade. The file is classified. All that is known:
the black car has failed to collect them three times.

## Feel

Hops are pressed, not tapped: touching down crouches your animal and the hop
fires on release, so chained hops have a rhythm to them. Cars that shave past
you whoosh; drivers bearing down on your column beep. Hop sounds are pitched
by species — cats sit a few semitones above dogs. Deaths land with a beat of
slow motion. And the further you flee, the colder it gets: snow starts
falling around 25 metres, right where the rivers begin to freeze.

## Project layout

```
index.html          markup for the canvas and every UI screen
build.js            bundles the whole game into shareable single HTML files
css/style.css       HUD, menus, character cards
js/util.js          maths, colour, storage and canvas helpers
js/audio.js         synthesised sound effects (WebAudio, no files)
js/music.js         the 8-bit march: an original score and its sequencer
js/characters.js    the roster + the procedural cat/dog renderer
js/world.js         endless row generation and simulation
js/render.js        the faux-3D scene renderer
js/input.js         keyboard, swipe and tap handling
js/game.js          state machine, player physics, the chase
js/main.js          boot, DOM wiring, frame loop
tests/              the browser test suite (see Testing)
.github/workflows/  test on every push; publish to Pages only if green
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

Trees, missing ice floes and sector walls are the only obstacles that never
move out of your way, so the generator tracks which columns can be reached as
it builds each row. If a row would seal the way forward, it opens a tile, and
a sector wall always puts its gate somewhere you can get to. No world is a
dead end.

## Testing

```sh
npm install
npx playwright install chromium   # once
npm test
```

The suite drives the real game in headless Chromium. `Math.random` is seeded
and the frame clock is stepped by hand, so every run sees exactly the same
world and the same physics on any machine. It covers the level generator's
promises across dozens of seeds (spacing, passability, sector walls), every
way to move, score and die, directives and the save file, touch and keyboard
controls on phone-shaped screens, rendering at four screen sizes, and the
sound bank. Point it at another copy with `GAME_URL=https://… npm test`.

Every push runs the suite on GitHub Actions; the site is only republished when
it passes, and each build is stamped on the title screen so testers can say
which one they were playing.

## Tone

It's a cartoon. The regime is made of stern-looking pets in ushankas, and the
worst thing that happens to you is being redistributed.
