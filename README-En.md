# Rice Bowl for DSH Whale · dsh-whale-ricebowl

An independent add-on for the **DSH whale balance widget** (`dsh-whale-widget`).

> **Load rice for the whale (1 bowl = 1,000,000 tokens). Every turn eats rice according to real token usage. When the rice runs out, the whale starts begging.**

It does not modify the host widget, does not add a hunger/leveling system, and never feeds automatically. **If the host widget is not installed, nothing is shown.**

![3 bowls loaded](docs/screenshot-idle.png)

Eating close-up (whale art belongs to the host widget): a grin with one little fang, a wooden spoon scooping rice, a rice ball flying into the mouth:

![eating](docs/screenshot-eat.png)

| Feed menu | Per-turn report |
| --- | --- |
| ![menu](docs/screenshot-menu.png) | ![report](docs/screenshot-report.png) |

| Begging when empty | Starving after a while | Per-conversation ledger |
| --- | --- | --- |
| ![begging](docs/screenshot-beg.png) | ![starving](docs/screenshot-starving.png) | ![ledger](docs/screenshot-settings.png) |

> Screenshots come from the local `npm run demo` preview. The whale art is loaded from the host plugin `dsh-whale-widget` (`DSniang1.png`) for demonstration only; this package bundles no upstream art.

## What it is / is not

| | |
| --- | --- |
| Host | The DSH whale balance widget `dsh-whale-widget`. This plugin is an add-on, not a replacement. |
| Gameplay | Each conversation has its own rice pot: click the bowl to load a small bowl (250K tokens) / half bowl (500K) / one bowl (1M). Every turn eats real tokens; at turn end a bubble reports "ate X · Y bowls left". At zero it begs 10 times, then after 10 quiet minutes turns into a starving whale (and stays gray until fed). |
| Visuals | Transparent glass bowl with a solid mound of cooked rice (grain texture on the surface). Main bowl + up to 4 bowl slots show the stock (max 5 bowls on screen; beyond that the ledger keeps counting while the UI stays unchanged). The whale grins (one fang), a wooden spoon scoops, a rice ball flies into its mouth, plus cuter synthesized scoop / clink / chew sounds (WebAudio, no audio files). |
| Ledger | Per conversation (DSH session): loaded / eaten / remaining. Switching conversations switches pots; survives page refresh. |
| Not | Not a pet-raising game, no levels or memory, no auto-estimation, does not read conversation content, no network upload. |

Compared with `dsh-whale-food-expack` (feeding + hunger pet): that one raises a pet, this one is "load rice → eat → report → beg". **Both place a bowl next to the whale; install only one.** Coexistence is detected and reported in the console.

## Requirements & install

* DSH 0.2.x (tested on `0.2.0-rc.2`)
* Host widget `dsh-whale-widget@^0.4.2`

```bash
dsh plugin --profile web add dsh-whale-widget
dsh plugin --profile web add dsh-whale-ricebowl
```



Desktop (Electron): the host HTML is served statically, so this plugin also registers a `webserver/index-inject` row. Host changes require a full app restart; asset-only changes need just a page refresh.

## Usage

1. **Load rice**: click the bowl → load a small bowl (250K tokens) / half bowl (500K) / one bowl (1M). You can also load before a conversation — it is parked as "pending rice" and poured into the next conversation's pot when its first turn starts.
2. **Each turn**: after `turn/start`, real usage makes the whale eat; the rice level drops.
3. **Turn end**: a bubble reports e.g. "ate 5.4K · 3 bowls left". Short turns are replayed so at least one bite is always shown before the report.
4. **Bowls**: 1 bowl = 1,000,000 tokens; main bowl + 4 slots = 5 visible bowls max (slots sit on the **same table line** as the main bowl, to its **left**, and hide while the feed menu is open). More than 5 bowls keeps counting but the UI stays the same.
5. **Begging → starving**: at zero the whale begs 10 times (bobs / tilts, opens its mouth, random bubbles, never the same twice in a row). After that it waits quietly for 10 minutes and then becomes "starving" — desaturated, droopy sway, a "starving…" label and weak bubbles. Feed it any time and it recovers instantly — and until you do, it stays gray: new turns, clicks and page reloads no longer clear the starving state (since 0.5.8 it is saved per conversation).
6. **Settings**: right-click the bowl → toggles (begging / eating animation / sound / rice particles / number label), per-conversation ledger (loaded / eaten / remaining), and "clear ledger".
7. **Refresh**: the ledger lives in localStorage; assets are served `no-store`.

> The mouth overlay is calibrated for the host default art `DSniang1.png` (`mouth.x=0.555 / y=0.735`, width ≈ 8% of the art width). To use another skin, adjust `mouth` in `assets/config.json` or turn off the eating animation.

## Eating animation consistency

v0.5.0 uses a **serial chewing queue**:

* One bite at a time: open mouth → spoon scoop → rice ball flies (0.2s) → chomp on arrival → finish; the next bite waits.
* Each bite removes a planned share of rice, so the mound drops discretely and stays in sync with the mouth.
* Every turn is animated: missed deltas (short turns, hidden tab) are replayed quickly at turn end before the report bubble.
* Adaptive polling: 500ms while running, 1600ms idle; paused while the page is hidden.

## Accounting

* Actual = cumulative `usage.inputTokens + usage.outputTokens` of `assistant/message` events in the turn.
* `inputTokens` is non-cached input; `outputTokens` includes reasoning; `cacheReadTokens` is not counted (toggle `COUNT_CACHE_READ` in `lib/state.js`).
* The host half folds DSH session events and serves `/dsh-whale-rice/turn.json`; the browser polls it and keeps the ledger locally.

## Configuration

| File | What |
| --- | --- |
| `assets/config.json` | `tokensPerBowl` (default 1,000,000), `maxBowls` (5), `feedOptions` (small bowl 250K / half 500K / one 1M), `biteTokens`, `begTimes` (default 10), `starveDelayMs` (10 min), `starveIntervalMs`, polling / report timings, mouth anchor |
| `assets/lines.json` | line pools (begging / feeding / onboarding) |
| `lib/state.js` | accounting toggle `COUNT_CACHE_READ` |

Tip: set `tokensPerBowl` to `100000` if you want the bowl level to visibly move each turn.

## Privacy

Only DSH session state events are subscribed (turns, assistant usage, tool calls); conversation content is never read. Ledger and settings stay in your browser localStorage (`dshwr-` prefix). Nothing is uploaded. `/dsh-whale-rice/*` routes are read-only local routes on the DSH web server.

## Compatibility & limitations

* Tested with DSH `0.2.0-rc.2` + `dsh-whale-widget@0.4.2` on Web and the desktop injection path.
* With 1 bowl = 1,000,000 tokens a normal 5K-token turn is only 0.5% of a bowl, so the visual change is small — the label and per-turn report carry the numbers. Lower `tokensPerBowl` if you want a more visible drain.
* The mouth overlay matches the host default art only; other skins need `config.mouth` tweaks.
* The overlay relies on public host DOM anchors (`window.__dshWhaleRoot` / `.dshwv-root` / `.dshwv-img`); if they change, the layer hides silently instead of breaking the page.
* Multi-session: follows the most recently active session; each conversation keeps its own pot.
* Screenshots show host art for demonstration only; no upstream art is bundled.

## Development

```bash
npm test          # node --test (21 tests)
npm run demo      # local preview at http://127.0.0.1:19480/
```

## Release checklist (npm + GitHub + dshbase)

* Repository: <https://github.com/LuChen0820/dsh-whale-ricebowl> (topic `dsh-plugin`); `repository` / `homepage` / `bugs` / `author` are set in `package.json`.
* `npm publish --access public`; create a GitHub repo with topic `dsh-plugin` and a `v0.5.0` release.
* Submit to dshbase / the DSH plugin market after npm publishing (category: UI & Skins; note the `dsh-whale-widget` dependency).
* Before release: `npm test`, `npm pack --dry-run`, clean-profile tarball install, and an end-to-end manual run (load → eat → report → beg → add).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Not an official DeepSeek product. Host widget by [@MeteorNOX](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) (MIT); no upstream code or art is bundled.
