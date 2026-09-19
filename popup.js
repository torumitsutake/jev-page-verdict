import {
  labelOf,
  resolveGenres,
  verdictColor,
  CONFIDENCE,
  loadConfig,
  saveConfig,
} from "./questions.js";
import { resolveLang, applyI18n, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const view = $("view");
const send = (msg) => chrome.runtime.sendMessage(msg);

let config = null;
let lang = "en";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function message(text, isError = false) {
  view.innerHTML = `<div class="msg${isError ? " err" : ""}">${esc(text)}</div>`;
}

const pct = (n) => `${Math.round(n * 100)}%`;

/** セクションを1つ組み立てる。開閉状態は config.sections に保存される。 */
function section(id, title, peek, bodyHtml) {
  if (!bodyHtml) return "";
  const open = config.sections?.[id] ? " open" : "";
  return `<details class="sec" data-sec="${id}"${open}>
    <summary>${esc(title)}${peek ? `<span class="sec-peek">${esc(peek)}</span>` : ""}</summary>
    <div class="sec-body">${bodyHtml}</div>
  </details>`;
}

function probRows(answer, kind) {
  const entries = Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  return entries
    .slice(0, 6)
    .map(
      ([k, p]) => `<div class="prob">
        <span class="prob-name">${esc(labelOf(kind, k, config))}</span>
        <span class="prob-bar"><span class="prob-fill" style="width:${(p * 100).toFixed(0)}%"></span></span>
        <span class="prob-num">${(p * 100).toFixed(0)}%</span>
      </div>`
    )
    .join("");
}

function render(data) {
  const a = data.answers || {};
  const genre = a.genre;
  const conf = genre?.confidence ?? 0;
  const sure = conf >= CONFIDENCE.assert;
  const hinted = conf >= CONFIDENCE.hint;

  const name = hinted ? labelOf("genre", genre.choice, config) : "";
  const headline = !hinted ? t("undecided", lang) : sure ? name : t("likely", lang, { label: name });
  document.documentElement.style.setProperty("--verdict", verdictColor(genre?.choice, hinted));

  // 2行目は stance と publisher を合成する。
  const parts = [];
  if (a.publisher && a.publisher.confidence >= CONFIDENCE.hint) {
    parts.push(labelOf("publisher", a.publisher.choice, config));
  }
  if (a.stance && a.stance.confidence >= CONFIDENCE.hint) {
    parts.push(labelOf("stance", a.stance.choice, config));
  }
  // 商品ページでないときは出さない。出すと毎回「商品ページではない」が並ぶ。
  if (
    a.product &&
    a.product.confidence >= CONFIDENCE.hint &&
    a.product.choice !== "not_product"
  ) {
    parts.push(labelOf("product", a.product.choice, config));
  }
  const join = t("subJoin", lang);
  const subline =
    (parts.length ? parts.join(join) : t("authorUnknown", lang)) +
    join +
    t("confidence", lang, { pct: pct(conf) });

  // --- ゲージ ---
  const score = a.independence?.score;
  const pos = typeof score === "number" ? Math.max(0, Math.min(1, score / 2)) * 100 : null;
  const gaugeBody =
    pos === null
      ? ""
      : `<div class="gauge-track">
           <span class="gauge-tick" style="left:0"></span>
           <span class="gauge-tick" style="left:50%"></span>
           <span class="gauge-tick" style="left:calc(100% - 1px)"></span>
           <span class="gauge-mark" style="left:${pos.toFixed(1)}%"></span>
         </div>
         <div class="gauge-scale">
           <span>${esc(t("scaleAd", lang))}</span>
           <span>${esc(t("scaleMixed", lang))}</span>
           <span>${esc(t("scaleIndependent", lang))}</span>
         </div>`;
  const gaugePeek =
    pos === null
      ? ""
      : pos > 66
      ? t("peekIndependent", lang)
      : pos < 33
      ? t("peekAd", lang)
      : t("peekMixed", lang);

  // --- 根拠 ---
  const flag = (key, text) => {
    const v = a[key]?.noul;
    if (typeof v !== "number") return "";
    return `<div class="fact"><span class="dot${v >= 0.5 ? " on" : ""}"></span>
      <span>${esc(text)}</span><span class="fact-val">${pct(v)}</span></div>`;
  };
  const aff = data.signals?.affiliate_link_count ?? 0;
  const factsBody =
    flag("firsthand", t("factFirsthand", lang)) +
    flag("sponsored_disclosure", t("factSponsored", lang)) +
    flag("thin_content", t("factThin", lang)) +
    `<div class="fact"><span class="dot${aff > 0 ? " on" : ""}"></span>
       <span>${esc(t("factAffiliate", lang))}</span>
       <span class="fact-val">${esc(t("countLinks", lang, { n: aff }))}</span></div>`;
  const hitCount =
    ["firsthand", "sponsored_disclosure", "thin_content"].filter((k) => (a[k]?.noul ?? 0) >= 0.5)
      .length + (aff > 0 ? 1 : 0);

  // --- 内訳 ---
  const probsBody = [
    ["genre", t("groupGenre", lang)],
    ["stance", t("groupStance", lang)],
    ["publisher", t("groupPublisher", lang)],
    ["product", t("groupProduct", lang)],
  ]
    .map(([k, heading]) => {
      const rows = probRows(a[k], k);
      return rows ? `<div class="prob-group"><h4>${esc(heading)}</h4>${rows}</div>` : "";
    })
    .join("");

  view.innerHTML = `
    <div class="verdict${hinted ? "" : " quiet"}">${esc(headline)}</div>
    <div class="subline" style="margin-bottom:14px">${esc(subline)}</div>
    ${section("gauge", t("secIndependence", lang), gaugePeek, gaugeBody)}
    ${section("facts", t("secEvidence", lang), t("countHits", lang, { n: hitCount }), factsBody)}
    ${section("probs", t("secBreakdown", lang), "", probsBody)}
    ${section("raw", t("secRaw", lang), "", `<pre class="raw">${esc(JSON.stringify(a, null, 1))}</pre>`)}
  `;

  // 開閉を覚える
  view.querySelectorAll("details.sec").forEach((el) => {
    el.addEventListener("toggle", async () => {
      const id = el.dataset.sec;
      config = await saveConfig({ sections: { ...config.sections, [id]: el.open } });
    });
  });
}

async function classify(force) {
  $("run").disabled = true;
  message(t(force ? "rejudging" : "judging", lang));
  const res = await send({ type: "classify", force });
  $("run").disabled = false;
  if (!res?.ok) return message(res?.error ?? t("failed", lang), true);
  if (res.data.config) {
    config = res.data.config;
    lang = resolveLang(config);
  }
  render(res.data);
  $("run").textContent = t("rerun", lang);
  const tokens = res.data.usage?.input_tokens;
  $("meta").textContent = res.data.cached
    ? t("cachedMeta", lang)
    : tokens
    ? t("usageMeta", lang, {
        tokens: tokens.toLocaleString(),
        classes: Object.keys(resolveGenres(config)).length,
      })
    : "";
}

$("run").addEventListener("click", () => classify(true));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  const res = await send({ type: "peek" });
  config = res?.config ?? (await loadConfig());
  lang = resolveLang(config);
  document.documentElement.lang = lang;
  applyI18n(document, lang);

  if (res?.url) {
    try {
      $("host").textContent = new URL(res.url).hostname;
    } catch {}
  }
  if (res?.data) {
    render(res.data);
    $("run").textContent = t("rerun", lang);
    $("meta").textContent = t("cachedMeta", lang);
  } else {
    message(t("notJudged", lang));
  }
})();
