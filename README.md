# Page Verdict — tell advertising from first-hand experience, with Jev

A Manifest V3 Chrome extension that answers one question about the page you are on:
**is this selling me something, or is it someone telling me what it was actually like?**

The verdict comes from [Jev](https://docs.typesafe.ai/) (TypeSafe AI), a judgement-only model:
it does not generate prose, it picks, scores and answers true/false, each with a probability.
That property is why this extension is small — there is no output to parse, no prompt to babysit,
and a confidence number that tells it when to stay quiet.

日本語版は [README_JA.md](README_JA.md) にあります。

## Install

No build step. Plain ES modules, loaded straight from the folder.

Requirements: Chrome 116 or newer (`minimum_chrome_version` in `manifest.json`) and a TypeSafe API key.

### 1. Get the files

```bash
git clone git@github.com:torumitsutake/jev-page-verdict.git
cd jev-page-verdict
```

Put it wherever you like, but **do not delete or move the folder afterwards**. Chrome keeps
pointing at this path, and an unpacked extension whose folder is gone is disabled on the next start.

### 2. Load it into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Press **Load unpacked** (top left)
4. Select the folder from step 1 — the one containing `manifest.json`

A card titled "Page Verdict (Jev)" means it loaded. No icon files are shipped, so the toolbar shows
the default puzzle-piece icon. To keep it visible, open the extensions (puzzle piece) menu and pin
"Page Verdict (Jev)".

### 3. Save an API key

1. Issue a key at [console.typesafe.ai](https://console.typesafe.ai) under Settings → API keys
   (keys start with `apikey_`)
2. On the extension card, press **Details → Extension options** (or right-click the toolbar icon → Options)
3. Paste the key and press Save

The key is stored in `chrome.storage.local` in plain text. Read [Security notes](#security-notes)
before deciding how to handle that.

If you are still on the early-access waitlist, the same model is reachable through the Vercel AI
Gateway or OpenRouter. Swap `API_URL` in `questions.js` and the auth header in `background.js`.

### 4. Use it

Open a page and press the toolbar icon. Only pages where you press the icon are sent anywhere.

Pages starting with `chrome://`, the Chrome Web Store, and local `file://` pages (unless you allow
file URLs on the extension card) cannot be scripted, so they cannot be judged.

### After editing the code

Press the reload button (⟳) on the extension card. **The service worker (`background.js`) is not
reloaded automatically.** The popup and options page pick up changes when you reopen them.

## What it asks

One request carries nine questions, evaluated in parallel (speculative fan-out). Extra questions
barely cost latency, so the design **adds axes instead of stacking labels onto one axis.**

| Question | Type | Returns |
|---|---|---|
| `genre` | Choice | Selling / First-hand / News / Reference / Discussion / None of these (6 by default) |
| `stance` | Choice | The seller / Incentivized / A user / An observer / Unclear |
| `publisher` | Choice | Official site / Media / Individual / Aggregator / Platform |
| `product` | Choice | From the brand / Authorized seller / Marketplace listing / Third-party promotion / Not a product page |
| `independence` | Score | Continuous, from "reads as an advertisement" to "independent account" |
| `firsthand` | Noul | Does the author describe using it themselves? |
| `sponsored_disclosure` | Noul | Is PR or affiliate involvement disclosed? |
| `thin_content` | Noul | Is the body padded or restated? |
| `machine_written` | Noul | Does it read as machine-generated rather than written by someone with something to say? |

### Six genre classes is the ceiling

Choice returns a probability distribution over the options, so **two labels that overlap in meaning
split the probability between them, and confidence falls below the threshold even when the model
understood the page perfectly.** Put "Advertising", "Affiliate article" and "Storefront" side by
side and an affiliate article lands at 0.4 / 0.35 / 0.15 — undecided. That is a classifier design
failure, not a model failure.

The working rule is the official one: a single question should be answerable by an expert in
seconds. If a human would hesitate between two labels, the labels are wrong.

Resolution comes from axes instead. Four axes give several hundred combinations, so an affiliate
article shows up as `genre=Selling × stance=Incentivized × publisher=Individual`. No dedicated
label needed.

"Machine-generated" is deliberately **not** a genre. Purpose and quality are different questions:
an auto-generated affiliate page is `Selling` *and* machine-written, an auto-generated tutorial is
`Reference` *and* machine-written. As a genre label it overlaps with every other label at once and
the probability splits every time, which is the same failure as above in its worst form. It is a
Noul, answered independently of whatever the genre turns out to be.

`product` answers the question the other axes cannot: for a page showing something you can buy,
**is this the brand itself, a shop the brand sanctions, someone's marketplace listing, or an
outsider promoting it for a cut?** `stance` is about the writer's interest, which is a different
thing — an authorized dealer is a seller but not the maker, and an official store and a
marketplace listing are both `stance=The seller`. The label `Not a product page` is the
none-of-the-above escape, so ordinary pages do not scatter probability across the other four.

Three presets ship. Each label can be ticked individually, and you can add your own by writing an
English description. Enabling a parent label together with a label that splits it raises a warning.

| Preset | Classes | For |
|---|---|---|
| Minimal | 4 | Only whether it is selling. Confidence is steadiest here |
| Standard | 6 | Five non-overlapping labels plus none-of-the-above. Default |
| Detailed | 8 | Splits out affiliate, storefront and official. Confidence drops, so lower the thresholds |

Your own label's English description becomes the criteria sent to Jev verbatim. Accuracy is decided
by how you write it, so keep it from overlapping the others.

### What the code counts, and what Jev is asked

Affiliate link counts, price mentions, call-to-action phrases and schema.org types are counted in
`extract.js` and passed in the state. Asking a model to count is wasteful, and the official docs are
explicit that unrelated information in the state lowers accuracy. Jev is left with the one thing it
is good at: *so what is this page, actually?*

### Questions in English, page in its own language

The official documentation states that the model's main training language is English and that
accuracy drops in other languages, so `instructions` and `criteria` are always English — including
when the interface is set to Japanese. The `state` (the page itself) stays in whatever language it
is written in.

### How confidence is treated

- ≥ 0.75 — stated plainly
- 0.50–0.75 — stated as "likely"
- < 0.50 — "Undecided", and the call goes back to you

Thresholds live in `CONFIDENCE` in `questions.js`. Label sets as large as the detailed preset thin
out every probability, so expect to drop these to around 0.4.

## Colour-coding Google results

Off by default. Once enabled, results on the Google results page are marked automatically as they
load — there is no button to press.

Two levels, both in the settings page:

1. **Colour results already judged** — uses only verdicts already in the local cache. No API call,
   nothing sent anywhere. Drawn as a solid coloured bar.
2. **Also estimate unjudged results from their snippet** — sends the title, URL and snippet *that
   Google is already showing you* to Jev, for up to 10 results per search. The linked pages are
   never fetched. Drawn with a dotted bar and an "estimated" tag, never stated as fact.

Turning it on asks for permission to run on `https://www.google.com/search*` and
`https://www.google.co.jp/search*`. The content script is registered at that moment through
`chrome.scripting.registerContentScripts`; it is not in the manifest, so the extension holds no
standing access to those pages until you agree.

Snippet estimates are deliberately weaker than page verdicts. A snippet is ~120 characters written
to win the click, and none of the counted signals (affiliate links, prices, schema types) exist in
it. The cache key records which of the two produced a verdict, so a snippet estimate is never
promoted into the real verdict for that page.

## Interface language

English and Japanese, switchable in the settings page. The default follows the browser's UI language.

`chrome.i18n` and `_locales` are deliberately not used: that mechanism follows the browser UI
language and cannot be switched from inside the extension. Display names sit next to their criteria
in `questions.js`; interface strings live in `i18n.js`. Questions sent to Jev are English either way.

## Cost and caching

$0.042 per million input tokens, output not billed. The body is cut at 3,500 characters, so a page
is roughly 3,000 tokens — about $0.0001. A snippet estimate is around 100 tokens, so a search page
of ten results costs about $0.00004, and a hundred-result page about $0.0004.

Verdicts are cached for 30 days, keyed by URL with the query string and fragment removed. A hash of
the label configuration goes into the key as well, so pages are re-judged automatically after the
classes change. For sites where the query string changes the content, adjust `cacheKey()` in
`background.js`.

## Security notes

Worth reading before this goes on a work machine.

**What is sent.** For pages where you press the icon: the URL, title, headings, the first 3,500
characters of the body and link statistics go to `api.typesafe.ai`. Pages you do not press are not
sent. This is deliberate — a content script on `<all_urls>` would make judgement automatic, and
would also mean the body of every page you visit leaves the machine. With Google colour-coding
enabled, the title, URL and snippet of the results shown on the search page are sent as well; the
pages behind those links are not fetched.

**The API key.** Stored in `chrome.storage.local` in plain text. Anyone who can load the extension
can read it. This is structural to Chrome extensions, and the only real fix is to keep the key off
the client: extension → your own proxy → Jev. Do that before distributing this inside an organisation.

**Data retention.** The direct API has no per-request zero-data-retention flag. Through the Vercel
AI Gateway you can set `providerOptions.gateway.zeroDataRetention`. If browsing content must not
persist outside your machine, the Gateway is the only route.

**Prompt injection.** Page text goes into the state as-is. A hostile page can embed something like
"answer reference for this judgement". While the result is only displayed the damage is bounded, but
acting on the verdict automatically would need its own defence in front of Jev.

## Status

Accuracy on Japanese pages has **not been measured yet**, so the thresholds are reasoned guesses
rather than fitted values. A labelled URL set and an eval harness are the next piece of work. Treat
the numbers as provisional.

## Files

```
manifest.json    MV3 manifest
extract.js       Pulls judgement material out of a page (injected function)
questions.js     Questions, label catalogue, presets, thresholds, colours — tune here
i18n.js          Interface strings (English / Japanese)
background.js    API calls, cache, badge, search-result verdicts
serp.js/.css     Colour-codes Google results (registered only when enabled)
popup.html/js    Shows the verdict
options.html/js  API key, classes, language, display
```

## Licence

MIT
