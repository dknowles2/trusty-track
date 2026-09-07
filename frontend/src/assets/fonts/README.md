# Bundled fonts

Roboto and Roboto Condensed, the two families `docs/spec.md` names under
"UI & Branding (Official BSA Guidelines)" — plus Roboto Mono, bundled for the
same reason but not part of that branding spec (see below).

They are **bundled rather than linked** because of where this app runs. The
machine is usually a Raspberry Pi at a venue, on a LAN, frequently with no
internet at all — that is the whole deployment premise. A font fetched from
Google Fonts would fail exactly where it matters and succeed only on the
developer's laptop, which is the worst of both.

Before this, neither family was loaded from anywhere (issue #139): the CSS
named them, nothing fetched them, and every platform this ships to — Raspbian,
Windows, macOS — fell through to its own default sans-serif.

## What these files are

Variable fonts, Latin subset, taken from Google Fonts:

| File | Family | Axis |
| --- | --- | --- |
| `roboto-latin-variable.woff2` | Roboto | weight 100–900 |
| `roboto-condensed-latin-variable.woff2` | Roboto Condensed | weight 100–900 |
| `roboto-mono-latin-variable.woff2` | Roboto Mono | weight 100–700 |

One file per family rather than one per weight. The UI uses 400, 500, 600,
700, 800 and 900 across the operator screens and the projector overlay; as
static faces that is six downloads and any weight not bundled gets synthesised
by the browser, which looks like it sounds. A variable font renders every one
of them exactly, for less than the static pair would cost.

Latin only, because the app has no internationalisation (`docs/design.md` §9
lists i18n as a future consideration). Adding a language means adding its
subset here.

Roboto Mono was added for the two genuinely fixed-width uses in the app — the
serial traffic log and port name on `/timer-check`, and the Hardware Timer
panel's own copy of the same log (#821). Those were the one place a bare
`monospace` keyword was standing in for a real design requirement rather than
for tabular-figure alignment; everywhere else that asked for `monospace`
wanted digits that do not shift width as they change, which the bundled
Roboto's `tabular-nums` already gives without a second family (see
`--font-body` and `font-variant-numeric` at each call site).

## Licence

Roboto, Roboto Condensed and Roboto Mono are © Google, licensed under the
Apache License 2.0 — see `LICENSE.txt`. It permits redistribution, including
bundling into an application, with attribution and a copy of the licence.
