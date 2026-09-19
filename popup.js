import {
  labelOf,
  resolveGenres,
  STANCE_LABELS,
  PUBLISHER_LABELS,
  CONFIDENCE,
  loadConfig,
  saveConfig,
} from "./questions.js";

const $ = (id) => document.getElementById(id);
const view = $("view");
const send = (msg) => chrome.runtime.sendMessage(msg);

let config = null;

const SELLING = new Set(["commerce", "affiliate", "ecommerce", "recruiting"]);
const FIRSTHAND = new Set(["experience", "discussion", "creative", "opinion"]);

function verdictColor(key, known) {
  if (!known) return "#697480";
  if (SELLING.has(key)) return "#b4341f";
  if (FIRSTHAND.has(key)) return "#2f7a4e";
  if (key === "lowquality") return "#8a6d1f";
  if (key === "other") return "#697480";
  return "#33566e";
}

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

  const label = hinted ? labelOf("genre", genre.choice, config) : "判定できず";
  document.documentElement.style.setProperty("--verdict", verdictColor(genre?.choice, hinted));

  // 2行目は stance と publisher を合成する。
  const parts = [];
  if (a.publisher && a.publisher.confidence >= CONFIDENCE.hint) {
    parts.push(PUBLISHER_LABELS[a.publisher.choice]?.ja ?? a.publisher.choice);
  }
  if (a.stance && a.stance.confidence >= CONFIDENCE.hint) {
    parts.push(STANCE_LABELS[a.stance.choice]?.ja ?? a.stance.choice);
  }
  const subline = (parts.length ? parts.join("・") : "書き手は特定できず") + `・確信度 ${pct(conf)}`;

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
         <div class="gauge-scale"><span>広告そのもの</span><span>混在</span><span>独立した記事</span></div>`;
  const gaugePeek =
    pos === null ? "" : pos > 66 ? "独立寄り" : pos < 33 ? "広告寄り" : "混在";

  // --- 根拠 ---
  const flag = (key, text) => {
    const v = a[key]?.noul;
    if (typeof v !== "number") return "";
    return `<div class="fact"><span class="dot${v >= 0.5 ? " on" : ""}"></span>
      <span>${esc(text)}</span><span class="fact-val">${pct(v)}</span></div>`;
  };
  const aff = data.signals?.affiliate_link_count ?? 0;
  const factsBody =
    flag("firsthand", "自分で使った話が書かれている") +
    flag("sponsored_disclosure", "PR・アフィリエイトの表示がある") +
    flag("thin_content", "中身が薄い・引き写しが多い") +
    `<div class="fact"><span class="dot${aff > 0 ? " on" : ""}"></span>
       <span>アフィリエイトリンク</span><span class="fact-val">${aff}本</span></div>`;
  const hitCount = ["firsthand", "sponsored_disclosure", "thin_content"].filter(
    (k) => (a[k]?.noul ?? 0) >= 0.5
  ).length + (aff > 0 ? 1 : 0);

  // --- 内訳 ---
  const probsBody = [
    ["genre", "ジャンル"],
    ["stance", "書き手の立場"],
    ["publisher", "発信主体"],
  ]
    .map(([k, t]) => {
      const rows = probRows(a[k], k);
      return rows ? `<div class="prob-group"><h4>${t}</h4>${rows}</div>` : "";
    })
    .join("");

  view.innerHTML = `
    <div class="verdict${hinted ? "" : " quiet"}">${esc(label)}${sure || !hinted ? "" : "らしい"}</div>
    <div class="subline" style="margin-bottom:14px">${esc(subline)}</div>
    ${section("gauge", "独立性", gaugePeek, gaugeBody)}
    ${section("facts", "根拠", `${hitCount}件`, factsBody)}
    ${section("probs", "分類の内訳", "", probsBody)}
    ${section("raw", "生の応答", "", `<pre class="raw">${esc(JSON.stringify(a, null, 1))}</pre>`)}
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
  message(force ? "再判定中…" : "判定中…");
  const res = await send({ type: "classify", force });
  $("run").disabled = false;
  if (!res?.ok) return message(res?.error ?? "判定に失敗しました。", true);
  if (res.data.config) config = res.data.config;
  render(res.data);
  $("run").textContent = "再判定";
  const tokens = res.data.usage?.input_tokens;
  $("meta").textContent = res.data.cached
    ? "保存済みの判定"
    : tokens
    ? `${tokens.toLocaleString()} トークン・${Object.keys(resolveGenres(config)).length}分類`
    : "";
}

$("run").addEventListener("click", () => classify(true));
$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
  const res = await send({ type: "peek" });
  config = res?.config ?? (await loadConfig());
  if (res?.url) {
    try {
      $("host").textContent = new URL(res.url).hostname;
    } catch {}
  }
  if (res?.data) {
    render(res.data);
    $("run").textContent = "再判定";
    $("meta").textContent = "保存済みの判定";
  } else {
    message("このページはまだ判定していません。");
  }
})();
