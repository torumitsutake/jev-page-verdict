/**
 * Google の検索結果に色帯を付ける content script。
 *
 * ここは描くだけ。色も文言も件数の上限も background から受け取る
 * （閾値と定数を questions.js の外に散らさないため。content script は
 * ES モジュールを import できないので、この形でないと二重化する）。
 *
 * 設定でオンにして許可を取ったときだけ chrome.scripting.registerContentScripts で
 * 登録される。マニフェストには静的に書かない。
 */
(() => {
  const done = new Set(); // 処理済みの URL
  let limits = null; // background から受け取る上限
  let budget = 0; // このページで残り何件見るか
  let running = false;
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
        return q ? new URL(q).toString() : null;
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
    return cut.trim().slice(0, limits.snippetChars);
  }

  /** 未処理の結果を最大 n 件まで取る。 */
  function collect(n) {
    const items = [];
    for (const { block, a, h3 } of resultBlocks()) {
      if (items.length >= n) break;
      block.dataset.pvSeen = "1";
      if (isAd(block)) continue;
      const url = realUrl(a.href);
      if (!url || done.has(url)) continue;
      done.add(url);
      const title = (h3.innerText || "").trim();
      items.push({ url, title, snippet: snippetOf(block, title), block });
    }
    return items;
  }

  /* --- 描画 ------------------------------------------------------------ */

  function paint(block, verdict) {
    if (!block || !verdict || block.dataset.pvPainted) return;
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

  async function processBatch(items) {
    const byUrl = new Map(items.map((it) => [it.url, it.block]));
    const payload = items.map(({ url, title, snippet }) => ({ url, title, snippet }));

    // 1. 判定済みのものだけ先に塗る。ここでは何も送信されない。
    const cached = await ask({ type: "serpLookup", urls: payload.map((it) => it.url) });
    if (!cached?.ok) return false;
    for (const [url, verdict] of Object.entries(cached.verdicts ?? {})) {
      if (verdict) paint(byUrl.get(url), verdict);
    }

    // 2. 残りをスニペットから推定する（設定でオンのときだけ）。
    if (!cached.snippetMode) return true;
    const rest = payload.filter((it) => !cached.verdicts?.[it.url]);
    if (!rest.length) return true;

    const judged = await ask({ type: "serpJudge", items: rest });
    if (!judged?.ok) return false;
    for (const [url, verdict] of Object.entries(judged.verdicts ?? {})) {
      if (verdict) paint(byUrl.get(url), verdict);
    }
    // レート制限やキー拒否が出たら、このページではもう投げない。
    if (judged.halted) {
      console.warn("[Page Verdict]", judged.halted);
      budget = 0;
    }
    return true;
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      if (!limits) {
        const res = await ask({ type: "serpConfig" });
        if (!res?.ok) return;
        limits = res;
        budget = res.maxPerPage;
      }
      // そのページに出ている結果は全部見る。batchSize ずつ塗っていく。
      while (budget > 0) {
        const items = collect(Math.min(limits.batchSize, budget));
        if (!items.length) break;
        budget -= items.length;
        if (!(await processBatch(items))) break;
      }
    } finally {
      running = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, limits?.debounceMs ?? 400);
  }

  schedule();

  // 検索結果は後から差し替わる（続きを読み込む・タブ切り替え）。
  const root = document.querySelector("#search") || document.body;
  if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
})();
