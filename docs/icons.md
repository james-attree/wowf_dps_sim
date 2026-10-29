# Icons

Issue #107 (D10). Icons are hot-linked from a public image CDN. The repo stores
no icon file of its own making beyond the hand-made ones in `img/`.

## What shows an icon

| Where                                           | Icon                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| An ability, its buff and its log rows           | The hand-made file in `img/` where the ability has one (eleven do). Otherwise the CDN (Cold Blood).       |
| Instant and Deadly Poison log rows, DoT, debuff | The CDN, by the poison's icon name in the snapshot.                                                       |
| A talent or a talent tree                       | `talentIconUrl(talent)` and `iconUrl(tree.icon)`. The page has no talent view yet, so nothing draws them. |

The existing `img/*.jpg` stay as they are. Nothing was replaced.

The page's tab icon, `img/favicon.svg` (#155), is a plain SVG dagger drawn for
this repo in the page's own colours. It is not a game icon.

## How a name becomes a URL

The talentsforever snapshot names an icon for each talent, tree and spell, such
as `ability_rogue_eviscerate`. `js/icons.js` turns the name into
`base + size + / + name + extension`, read from the constant `icons.cdn`:

```
https://wow.zamimg.com/images/wow/icons/large/ability_rogue_eviscerate.jpg
```

A name that is empty, not in the form the export uses (lower case letters,
digits, underscores), or listed as missing in `data/icons.json`, resolves to the
fallback icon `inv_misc_questionmark` (constant `icons.fallback`).

If the browser still cannot load an icon (offline, blocked host), the page swaps
in the fallback once (`attachIconFallback`). If that fails too, it hides the
image. It never loops and never shows a broken-image glyph.

## The CDN

Wowhead's image CDN, `wow.zamimg.com`. Checked on 26 Oct 2026:

- It is a third-party host behind CloudFront. It is **not** hosted by Blizzard.
- It answers with `access-control-allow-origin: *`, and a plain `<img>` needs no
  CORS anyway.
- All 67 distinct icon names in the snapshot return HTTP 200, and so does the
  fallback. A name that does not exist returns 404.

OQ13 (hot-link icons from a public CDN and vendor nothing) is decided in issue
#107. The choice of this CDN and its URL pattern is the developer's proposal for
the coordinator to confirm. To change CDN, change `icons.cdn` in
`data/constants.js` and run `npm run provenance`. No other file holds the host.

## Refreshing

`npm run data:refresh` prints how many icon names the new snapshot has and how
many are new. Then run:

```
npm run icons:check             # read-only: HEAD every name, list any missing
npm run icons:check -- --write  # also update data/icons.json
```

`scripts/check-icons.mjs` sends one HEAD request per name (plus the fallback),
downloads no image, and writes names only. A 404 or 410 marks a name missing;
any other failure stops the run, so a flaky network never marks a real icon
missing. It is the only code that touches the CDN. `js/icons.js` builds URLs
without fetching, and the tests make no network call (they fail if one is
tried).

## Licence wording

The data is from [talentsforever.com](https://talentsforever.com/), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its manifest
(`data/talentsforever/manifest.json`) and export say: "Game names, icons, and
tooltip text belong to Blizzard Entertainment." The CC BY 4.0 licence covers the
data, not the icons. Icon names are data. The images are Blizzard's, which is
why they are linked from the CDN and not copied into this repo, and why this
project says it is not affiliated with Blizzard Entertainment.
