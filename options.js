import {
  GENRE_CATALOG,
  PRESETS,
  DEFAULT_CONFIG,
  SERP,
  loadConfig,
  saveConfig,
  resolveGenres,
  findOverlaps,
} from "./questions.js";
import { LANG_CHOICES, resolveLang, applyI18n, pick, t } from "./i18n.js";

const ALL_SITES = ["http://*/*", "https://*/*"];

const $ = (id) => document.getElementById(id);
let config;
let lang = "en";

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const flash = (el, text) => {
  el.textContent = text;
  setTimeout(() => (el.textContent = ""), 2400);
};

/* --- APIキー --------------------------------------------------------- */
chrome.storage.local.get("apiKey").then(({ apiKey }) => {
  if (apiKey) $("key").value = apiKey;
});

$("saveKey").addEventListener("click", async () => {
  const apiKey = $("key").value.trim();
  if (!apiKey) return flash($("keyStatus"), t("optKeyEmpty", lang));
  await chrome.storage.local.set({ apiKey });
  flash($("keyStatus"), t("optSaved", lang));
});

/* --- 描画 ------------------------------------------------------------ */
function renderLang() {
  $("lang").innerHTML = Object.entries(LANG_CHOICES)
    .map(([k, v]) => `<option value="${k}">${esc(pick(v, lang))}</option>`)
    .join("");
  $("lang").value = config.lang ?? "auto";
}

function renderPreset() {
  $("preset").innerHTML =
    Object.entries(PRESETS)
      .map(([k, p]) => `<option value="${k}">${esc(pick(p.name, lang))}</option>`)
      .join("") + `<option value="custom">${esc(t("optCustomPreset", lang))}</option>`;
  $("preset").value = config.preset;
  $("presetNote").textContent =
    config.preset === "custom"
      ? t("optCustomPresetNote", lang)
      : pick(PRESETS[config.preset]?.note, lang) ?? "";
}

function renderLabels() {
  const on = new Set(config.genres);
  $("labels").innerHTML = Object.entries(GENRE_CATALOG)
    .map(([key, v]) => {
      const parent = v.splits ? pick(GENRE_CATALOG[v.splits].name, lang) : null;
      return `<label class="label-row">
        <input type="checkbox" data-genre="${key}"${on.has(key) ? " checked" : ""} />
        <span class="label-main">
          <span class="label-ja">${esc(pick(v.name, lang))}</span>
          ${parent ? `<span class="label-tag">${esc(t("optSplitTag", lang, { parent }))}</span>` : ""}
          <br /><span class="label-en">${esc(v.criteria)}</span>
        </span>
      </label>`;
    })
    .join("");

  const total = Object.keys(resolveGenres(config)).length;
  $("count").innerHTML = t("optCount", lang, { n: total });

  const hits = findOverlaps(config);
  const pairs = hits
    .map(
      ([c, p]) =>
        `<b>${esc(pick(GENRE_CATALOG[c].name, lang))}</b> / <b>${esc(pick(GENRE_CATALOG[p].name, lang))}</b>`
    )
    .join(", ");
  $("overlap").innerHTML = !hits.length
    ? ""
    : t(config.preset === "detailed" ? "optOverlapDetailed" : "optOverlapWarn", lang, { pairs });
}

function renderCustom() {
  $("customList").innerHTML = (config.customGenres ?? [])
    .map(
      (g, i) => `<div class="custom-row">
        <input type="text" value="${esc(g.name?.en ?? "")}" data-cen-name="${i}" />
        <input type="text" value="${esc(g.name?.ja ?? "")}" data-cja-name="${i}" />
        <input type="text" value="${esc(g.criteria ?? "")}" data-ccrit="${i}" />
        <button class="del" data-del="${i}">${esc(t("optDelete", lang))}</button>
      </div>`
    )
    .join("");
}

function renderToggles() {
  const axes = [
    ["stance", t("axisStance", lang), t("axisStanceNote", lang)],
    ["publisher", t("axisPublisher", lang), t("axisPublisherNote", lang)],
    ["product", t("axisProduct", lang), t("axisProductNote", lang)],
  ];
  $("axes").innerHTML = axes
    .map(
      ([k, name, note]) => `<label class="label-row">
        <input type="checkbox" data-axis="${k}"${config.axes[k] ? " checked" : ""} />
        <span class="label-main"><span class="label-ja">${esc(name)}</span>
        <br /><span class="label-en">${esc(note)}</span></span>
      </label>`
    )
    .join("");

  const secs = [
    ["gauge", t("secIndependence", lang)],
    ["facts", t("secEvidence", lang)],
    ["probs", t("secBreakdown", lang)],
    ["raw", t("secRaw", lang)],
  ];
  $("sections").innerHTML = secs
    .map(
      ([k, name]) => `<label class="label-row">
        <input type="checkbox" data-section="${k}"${config.sections[k] ? " checked" : ""} />
        <span class="label-main"><span class="label-ja">${esc(name)}</span></span>
      </label>`
    )
    .join("");
}

function renderSerp() {
  const rows = [
    ["enabled", t("serpEnable", lang), t("serpEnableNote", lang), false],
    [
      "snippet",
      t("serpSnippet", lang),
      t("serpSnippetNote", lang, { n: SERP.maxPerPage }),
      !config.serp.enabled,
    ],
    ["fetch", t("serpFetch", lang), t("serpFetchNote", lang), !config.serp.enabled],
  ];
  $("serp").innerHTML = rows
    .map(
      ([k, name, note, disabled]) => `<label class="label-row">
        <input type="checkbox" data-serp="${k}"${config.serp[k] ? " checked" : ""}${
        disabled ? " disabled" : ""
      } />
        <span class="label-main"><span class="label-ja">${esc(name)}</span>
        <br /><span class="label-en">${esc(note)}</span></span>
      </label>`
    )
    .join("");
}

function renderAll() {
  lang = resolveLang(config);
  document.documentElement.lang = lang;
  applyI18n(document, lang);
  renderLang();
  renderPreset();
  renderLabels();
  renderCustom();
  renderToggles();
  renderSerp();
}

/* --- 操作 ------------------------------------------------------------ */
$("lang").addEventListener("change", async () => {
  // saveConfig の戻りで config を置き換えないこと。保存前の編集（ラベルの
  // チェックなど）が保存済みの値で上書きされ、画面と保存内容がずれる。
  config.lang = $("lang").value;
  await saveConfig({ lang: config.lang });
  renderAll();
});

$("preset").addEventListener("change", () => {
  const v = $("preset").value;
  config.preset = v;
  if (v !== "custom") config.genres = [...PRESETS[v].genres];
  renderPreset();
  renderLabels();
});

$("labels").addEventListener("change", (e) => {
  const key = e.target.dataset?.genre;
  if (!key) return;
  const set = new Set(config.genres);
  e.target.checked ? set.add(key) : set.delete(key);
  config.genres = [...set];
  config.preset = "custom";
  renderPreset();
  renderLabels();
});

$("axes").addEventListener("change", (e) => {
  const key = e.target.dataset?.axis;
  if (key) config.axes[key] = e.target.checked;
});

$("sections").addEventListener("change", (e) => {
  const key = e.target.dataset?.section;
  if (key) config.sections[key] = e.target.checked;
});

/**
 * 検索結果の色分けだけは「保存」を待たずに反映する。
 * 権限の要求はユーザー操作の直後でないと Chrome に拒否されるため。
 */
$("serp").addEventListener("change", async (e) => {
  const key = e.target.dataset?.serp;
  if (!key) return;
  $("serpWarn").textContent = "";

  if (e.target.checked) {
    // 本文取得は結果のドメインが事前に分からないので全サイトの許可が要る。
    // 色分け本体は Google の検索ページだけ。要求する範囲を分けてある。
    const origins = key === "fetch" ? ALL_SITES : SERP.origins;
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    if (!granted) {
      e.target.checked = false;
      $("serpWarn").textContent = t("serpPermDenied", lang);
      return;
    }
  }

  const next = { ...config.serp, [key]: e.target.checked };
  if (!next.enabled) {
    // 親を切ったら子も切る
    next.snippet = false;
    next.fetch = false;
  }
  // 本文取得を切ったら全サイトの許可も返す。使わない権限を残さない。
  if (!next.fetch && config.serp.fetch) {
    await chrome.permissions.remove({ origins: ALL_SITES }).catch(() => {});
  }
  config.serp = next; // ここも config 全体を差し替えない（未保存の編集を残す）
  await saveConfig({ serp: next });
  await chrome.runtime.sendMessage({ type: "syncSerp" });
  renderSerp();
});

$("addCustom").addEventListener("click", () => {
  const en = $("newEnName").value.trim();
  const ja = $("newJaName").value.trim();
  const criteria = $("newCriteria").value.trim();
  if (!en || !criteria) return flash($("status"), t("optNeedBoth", lang));
  const key = `custom_${Date.now().toString(36)}`;
  config.customGenres = [...(config.customGenres ?? []), { key, name: { en, ja: ja || en }, criteria }];
  $("newEnName").value = "";
  $("newJaName").value = "";
  $("newCriteria").value = "";
  renderCustom();
  renderLabels();
});

$("customList").addEventListener("click", (e) => {
  const i = e.target.dataset?.del;
  if (i === undefined) return;
  config.customGenres.splice(Number(i), 1);
  renderCustom();
  renderLabels();
});

$("customList").addEventListener("input", (e) => {
  const d = e.target.dataset;
  const g = config.customGenres[Number(d.cenName ?? d.cjaName ?? d.ccrit)];
  if (!g) return;
  if (d.cenName !== undefined) g.name.en = e.target.value;
  if (d.cjaName !== undefined) g.name.ja = e.target.value;
  if (d.ccrit !== undefined) g.criteria = e.target.value;
});

$("save").addEventListener("click", async () => {
  // 該当なしは常に足されるので、有効なラベルが1つでもあれば2以上になる。
  // 数だけ見ると criteria が空のラベルが素通りし、全ページが「判定できず」になる。
  if (Object.keys(resolveGenres(config)).length < 2) {
    return flash($("status"), t("optNoLabels", lang));
  }
  // 分類まわりだけ保存する。この画面が開いている間にポップアップ側で変わった
  // 開閉状態や、別に保存済みの serp / lang を古い値で上書きしないため。
  config = await saveConfig({
    preset: config.preset,
    genres: config.genres,
    customGenres: config.customGenres,
    axes: config.axes,
    sections: config.sections,
  });
  flash($("status"), t("optSavedApplies", lang));
});

$("reset").addEventListener("click", async () => {
  config = await saveConfig({
    ...DEFAULT_CONFIG,
    lang: config.lang,
    genres: [...PRESETS.standard.genres],
    serp: config.serp, // 権限が絡むので分類のリセットでは触らない
  });
  renderAll();
  flash($("status"), t("optResetDone", lang));
});

$("clear").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "clearCache" });
  flash($("status"), t("optCleared", lang, { n: res?.removed ?? 0 }));
});

/* --- 起動 ------------------------------------------------------------ */
(async () => {
  config = await loadConfig();
  // chrome://extensions 側で許可を外されることがある。その場合 background は
  // content script を解除するが、設定は有効のまま残るので画面と実態がずれる。
  if (config.serp.enabled) {
    const granted = await chrome.permissions.contains({ origins: SERP.origins }).catch(() => true);
    if (!granted) {
      config.serp = { ...config.serp, enabled: false, snippet: false, fetch: false };
      await saveConfig({ serp: config.serp });
    }
  }
  if (config.serp.fetch) {
    const granted = await chrome.permissions.contains({ origins: ALL_SITES }).catch(() => true);
    if (!granted) {
      config.serp = { ...config.serp, fetch: false };
      await saveConfig({ serp: config.serp });
    }
  }
  renderAll();
})();
