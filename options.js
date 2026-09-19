import {
  GENRE_CATALOG,
  PRESETS,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  resolveGenres,
  findOverlaps,
} from "./questions.js";

const $ = (id) => document.getElementById(id);
let config;

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
  if (!apiKey) return flash($("keyStatus"), "キーが空です。");
  await chrome.storage.local.set({ apiKey });
  flash($("keyStatus"), "保存しました。");
});

/* --- 描画 ------------------------------------------------------------ */
function renderPreset() {
  $("preset").innerHTML =
    Object.entries(PRESETS)
      .map(([k, p]) => `<option value="${k}">${esc(p.ja)}</option>`)
      .join("") + `<option value="custom">自分で選ぶ</option>`;
  $("preset").value = config.preset;
  $("presetNote").textContent =
    config.preset === "custom" ? "チェックした組み合わせを使います。" : PRESETS[config.preset]?.note ?? "";
}

function renderLabels() {
  const on = new Set(config.genres);
  $("labels").innerHTML = Object.entries(GENRE_CATALOG)
    .map(([key, v]) => {
      const parent = v.splits ? GENRE_CATALOG[v.splits].ja : null;
      return `<label class="label-row">
        <input type="checkbox" data-genre="${key}"${on.has(key) ? " checked" : ""} />
        <span class="label-main">
          <span class="label-ja">${esc(v.ja)}</span>
          ${parent ? `<span class="label-tag">（${esc(parent)}を分割）</span>` : ""}
          <br /><span class="label-en">${esc(v.en)}</span>
        </span>
      </label>`;
    })
    .join("");

  const total = Object.keys(resolveGenres(config)).length;
  $("count").innerHTML = `いま <strong>${total}分類</strong>（該当なしを含む）。目安は6、多くても9まで。`;

  const hits = findOverlaps(config);
  const pairs = hits
    .map(([c, p]) => `<b>${esc(GENRE_CATALOG[c].ja)}</b> と <b>${esc(GENRE_CATALOG[p].ja)}</b>`)
    .join("、");
  $("overlap").innerHTML = !hits.length
    ? ""
    : config.preset === "detailed"
    ? `${pairs} は意味が重なります。詳細プリセットでは想定内ですが、この2つで確率が割れるぶん確信度は下がります。「判定できず」が多いと感じたら <code>questions.js</code> の <code>CONFIDENCE.hint</code> を 0.4 前後まで下げてください。`
    : `意味が重なるラベルが同時に有効です：${pairs}。このままだと両者で確率が割れて「判定できず」が増えます。片方を外すか、<code>CONFIDENCE.hint</code> を下げてください。`;
}

function renderCustom() {
  $("customList").innerHTML = (config.customGenres ?? [])
    .map(
      (g, i) => `<div class="custom-row">
        <input type="text" value="${esc(g.ja)}" data-cja="${i}" />
        <input type="text" value="${esc(g.en)}" data-cen="${i}" />
        <button class="del" data-del="${i}">削除</button>
      </div>`
    )
    .join("");
}

function renderToggles() {
  const axes = [
    ["stance", "書き手の立場", "売り手 / 報酬あり / 利用者 / 第三者。宣伝とアフィリエイトを分けるのはこの軸。"],
    ["publisher", "発信主体", "公式 / メディア / 個人 / まとめ / プラットフォーム。"],
  ];
  $("axes").innerHTML = axes
    .map(
      ([k, ja, en]) => `<label class="label-row">
        <input type="checkbox" data-axis="${k}"${config.axes[k] ? " checked" : ""} />
        <span class="label-main"><span class="label-ja">${esc(ja)}</span>
        <br /><span class="label-en">${esc(en)}</span></span>
      </label>`
    )
    .join("");

  const secs = [
    ["gauge", "独立性ゲージ"],
    ["facts", "根拠"],
    ["probs", "分類の内訳"],
    ["raw", "生の応答"],
  ];
  $("sections").innerHTML = secs
    .map(
      ([k, ja]) => `<label class="label-row">
        <input type="checkbox" data-section="${k}"${config.sections[k] ? " checked" : ""} />
        <span class="label-main"><span class="label-ja">${esc(ja)}</span></span>
      </label>`
    )
    .join("");
}

function renderAll() {
  renderPreset();
  renderLabels();
  renderCustom();
  renderToggles();
}

/* --- 操作 ------------------------------------------------------------ */
$("preset").addEventListener("change", () => {
  const v = $("preset").value;
  config.preset = v;
  if (v !== "custom") config.genres = [...PRESETS[v].genres];
  renderAll();
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

$("addCustom").addEventListener("click", () => {
  const ja = $("newJa").value.trim();
  const en = $("newEn").value.trim();
  if (!ja || !en) return flash($("status"), "表示名と英語の説明の両方が要ります。");
  const key = `custom_${Date.now().toString(36)}`;
  config.customGenres = [...(config.customGenres ?? []), { key, ja, en }];
  $("newJa").value = "";
  $("newEn").value = "";
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
  const { cja, cen } = e.target.dataset;
  if (cja !== undefined) config.customGenres[Number(cja)].ja = e.target.value;
  if (cen !== undefined) config.customGenres[Number(cen)].en = e.target.value;
});

$("save").addEventListener("click", async () => {
  if (!config.genres.length && !config.customGenres.length) {
    return flash($("status"), "ラベルが1つもありません。");
  }
  config = await saveConfig(config);
  flash($("status"), "保存しました。次の判定から反映されます。");
});

$("reset").addEventListener("click", async () => {
  config = await saveConfig({ ...DEFAULT_CONFIG, genres: [...PRESETS.standard.genres] });
  renderAll();
  flash($("status"), "標準に戻しました。");
});

$("clear").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "clearCache" });
  flash($("status"), `保存していた判定を ${res?.removed ?? 0} 件消しました。`);
});

/* --- 起動 ------------------------------------------------------------ */
loadConfig().then((c) => {
  config = c;
  renderAll();
});
