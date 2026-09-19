/**
 * Google の検索結果に色帯を付ける content script。
 *
 * ここは描くだけで、判定にも表示文言にも関与しない。色・ラベル・説明文は
 * background が組み立てて渡す（ラベルと閾値を questions.js の外に散らさないため）。
 *
 * 設定でオンにして許可を取ったときだけ chrome.scripting.registerContentScripts で
 * 登録される。マニフェストには静的に書かない。
 */
(() => {
  const MAX_PER_PAGE = 10; // 1ページで扱う件数の上限。background 側でも同じ上限をかける
  const SNIPPET_CHARS = 320;
  const DEBOUNCE_MS = 400;

  const done = new Set(); // 処理済みの URL
  let budget = MAX_PER_PAGE;
  let timer = null;

  /* --- 収集 ------------------------------------------------------------ */

  // Google はクラス名を頻繁に変える。h3 → 祖先のリンク、という構造だけに頼る。
  function resultBlocks() {
    const out = [];
    for (const h3 of document.querySelectorAll("#search h3, #rso h3")) {
      const a = h3.closest("a[href]");
      if (!a) continue;
      const block = a.closest("div[data-hveid]") || a.closest("div.g") || a.parentElement;
      if (!block || block.dataset.pvSeen) continue;
      out.push({ block, a, h3 });
    }
    return out;
  }

  // 広告は Google 自身が「スポンサー」と書いている。判定するまでもない。
  function isAd(block) {
    if (block.closest("[data-text-ad], #tads, #bottomads")) return true;
    return /^(スポンサー|Sponsored|広告|Ad)\b/.test((block.innerText || "").trim());
  }

  // /url?q=... 経由のリンクから実体の URL を取り出す。
  function realUrl(href) {
    try {
      const u = new URL(href, location.href);
      if (/(^|\.)google\./.test(u.hostname) && u.pathname === "/url") {
        const q = u.searchParams.get("q") || u.searchParams.get("url");
        if (q) return new URL(q).toString();
        return null;
      }
      if (!/^https?:$/.test(u.protocol)) return null;
      if (/(^|\.)google\./.test(u.hostname)) return null; // 検索内リンクは対象外
      return u.toString();
    } catch {
      return null;
    }
  }

  function snippetOf(block, title) {
    const text = (block.innerText || "").replace(/\s+/g, " ").trim();
    const cut = title && text.startsWith(title) ? text.slice(title.length) : text;
    return cut.trim().slice(0, SNIPPET_CHARS);
  }

  /* --- 描画 ------------------------------------------------------------ */

  function paint(block, verdict) {
    if (!verdict || block.dataset.pvPainted) return;
    block.dataset.pvPainted = "1";
    block.classList.add("pv-block");
    if (verdict.estimated) block.classList.add("pv-estimated");
    block.style.setProperty("--pv-color", verdict.color);

    const chip = document.createElement("span");
    chip.className = "pv-chip";
    chip.textContent = verdict.chip;
    chip.title = verdict.title || "";
    block.insertAdjacentElement("afterbegin", chip);
  }

  /* --- 実行 ------------------------------------------------------------ */

  async function ask(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      // 拡張がリロードされた直後など。次の描画で拾い直す。
      return null;
    }
  }

  async function run() {
    if (budget <= 0) return;

    const items = [];
    for (const { block, a, h3 } of resultBlocks()) {
      block.dataset.pvSeen = "1";
      if (isAd(block)) continue;
      const url = realUrl(a.href);
      if (!url || done.has(url)) continue;
      done.add(url);
      items.push({
        url,
        title: (h3.innerText || "").trim(),
        snippet: snippetOf(block, (h3.innerText || "").trim()),
        block,
      });
      if (items.length >= budget) break;
    }
    if (!items.length) return;
    budget -= items.length;

    const byUrl = new Map(items.map((it) => [it.url, it.block]));

    // 1. 判定済みのものだけ先に塗る。ここでは何も送信されない。
    const cached = await ask({ type: "serpLookup", urls: items.map((it) => it.url) });
    if (!cached?.ok) return;
    for (const [url, verdict] of Object.entries(cached.verdicts ?? {})) {
      if (verdict) paint(byUrl.get(url), verdict);
    }

    // 2. 残りをスニペットから推定する（設定でオンのときだけ）。
    if (!cached.snippetMode) return;
    const rest = items
      .filter((it) => !cached.verdicts?.[it.url])
      .map(({ url, title, snippet }) => ({ url, title, snippet }));
    if (!rest.length) return;

    const judged = await ask({ type: "serpJudge", items: rest });
    if (!judged?.ok) return;
    for (const [url, verdict] of Object.entries(judged.verdicts ?? {})) {
      if (verdict) paint(byUrl.get(url), verdict);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, DEBOUNCE_MS);
  }

  schedule();

  // 検索結果は後から差し替わる（続きを読み込む・タブ切り替え）。
  const root = document.querySelector("#search") || document.body;
  if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
})();
