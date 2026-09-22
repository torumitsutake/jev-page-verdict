/**
 * Google の検索結果に色帯を付ける content script。
 *
 * ここは描くだけ。色も文言も件数の上限も background から受け取る
 * （ラベル・閾値・定数を questions.js の外に散らさないため。content script は
 * ES モジュールを import できないので、この形でないと二重化する）。
 *
 * 設定でオンにして許可を取ったときだけ chrome.scripting.registerContentScripts で
 * 登録される。マニフェストには静的に書かない。
 */
(() => {
  const done = new Set(); // 処理済みの URL
  const verdicts = new Map(); // url -> 描いた判定。同じ URL が複数箇所に出るとき使う
  let limits = null; // background から受け取る上限と文言
  let budget = 0; // このページで残り何件見るか
  let snippetHalted = false; // レート制限に当たったらスニペット推定だけ止める
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
  // 「Ad」単体は拾わない。"Ad Age" のようなサイト名を広告と誤認するため。
  const AD_PREFIX = /^(スポンサー|広告|Sponsored)(\s|:|$)/;
  function isAd(block) {
    if (block.closest("[data-text-ad], #tads, #bottomads")) return true;
    return AD_PREFIX.test((block.innerText || "").trim());
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

  /** 未処理の結果を最大 n 件まで取る。判定済みの URL の再掲はその場で描く。 */
  function collect(n) {
    const items = [];
    for (const { block, a, h3 } of resultBlocks()) {
      if (items.length >= n) break;
      block.dataset.pvSeen = "1";

      const url = realUrl(a.href);
      if (!url || isAd(block)) continue;

      // 同じ URL がカルーセルと通常枠の両方に出ることがある。
      // 2つ目以降は判定し直さず、出ている判定をそのまま描く。
      if (done.has(url)) {
        const known = verdicts.get(url);
        if (known) paint(block, known, url);
        else paintGhost(block, url);
        continue;
      }

      done.add(url);
      const title = (h3.innerText || "").trim();
      items.push({ url, title, snippet: snippetOf(block, title), block });
    }
    return items;
  }

  /** 失敗した分は次の描画でやり直せるように戻す。 */
  function rollback(items) {
    for (const it of items) {
      done.delete(it.url);
      delete it.block.dataset.pvSeen;
    }
  }

  /* --- 描画 ------------------------------------------------------------ */

  function chipOf(block) {
    return block.querySelector(":scope > .pv-chip");
  }

  function ensureChip(block) {
    let chip = chipOf(block);
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "pv-chip";
      block.insertAdjacentElement("afterbegin", chip);
    }
    return chip;
  }

  function paint(block, verdict, url) {
    if (!block || !verdict) return;
    verdicts.set(url, verdict);
    block.classList.add("pv-block");
    block.classList.toggle("pv-estimated", !!verdict.estimated);
    block.style.setProperty("--pv-color", verdict.color);

    const chip = ensureChip(block);
    chip.classList.remove("pv-ghost", "pv-failed");
    chip.textContent = verdict.chip;
    chip.title = verdict.title || "";
    // 推定のままの結果は、押せば本文で確かめられる。確定済みは押せない。
    if (limits?.fetchMode && verdict.src === "snippet") chip.dataset.pvUrl = url;
    else delete chip.dataset.pvUrl;
  }

  /** 判定が無い結果に「本文で確かめる」ボタンだけ置く。 */
  function paintGhost(block, url) {
    if (!block || !limits?.fetchMode || chipOf(block)) return;
    const chip = ensureChip(block);
    chip.classList.add("pv-ghost");
    chip.textContent = limits.labels.check;
    chip.dataset.pvUrl = url;
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
      if (verdict) paint(byUrl.get(url), verdict, url);
    }

    // 2. 残りをスニペットから推定する（設定でオンのときだけ）。
    const rest = payload.filter((it) => !cached.verdicts?.[it.url]);
    if (cached.snippetMode && !snippetHalted && rest.length) {
      const judged = await ask({ type: "serpJudge", items: rest });
      if (!judged?.ok) return false;
      for (const [url, verdict] of Object.entries(judged.verdicts ?? {})) {
        if (verdict) paint(byUrl.get(url), verdict, url);
      }
      // レート制限やキー拒否が出たら、このページではもう推定を投げない。
      // キャッシュを見るだけの 1. と、押して取りに行く操作は続けられる。
      if (judged.halted) {
        console.warn("[Page Verdict]", judged.halted);
        snippetHalted = true;
      }
    }

    // 3. それでも判定が無いものに、押したら取りに行くボタンを置く。
    for (const { url } of payload) paintGhost(byUrl.get(url), url);
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
        if (!(await processBatch(items))) {
          rollback(items);
          budget += items.length;
          break;
        }
      }
    } finally {
      running = false;
    }
  }

  /* --- 押されたら、その1件だけ本文を取りに行く ------------------------- */

  document.addEventListener(
    "click",
    async (e) => {
      const chip = e.target?.closest?.(".pv-chip[data-pv-url]");
      if (!chip) return;
      // チップは結果のリンクの外にあるが、念のため遷移させない。
      e.preventDefault();
      e.stopPropagation();
      if (chip.dataset.pvBusy) return;

      const url = chip.dataset.pvUrl;
      chip.dataset.pvBusy = "1";
      chip.textContent = limits.labels.checking;

      const res = await ask({ type: "serpFetch", url });
      delete chip.dataset.pvBusy;

      if (res?.ok && res.verdict) {
        // chip は必ず対象ブロックの直下にある。closest(".pv-block") だと
        // 入れ子になった親の結果を塗ってしまう（Google は結果を入れ子にする）。
        paint(chip.parentElement, res.verdict, url);
      } else if (res?.ok) {
        // 取れたが確信度が閾値に届かなかった。断定はしないが、黙って元に戻すと
        // 「押しても何も起きない」にしか見えないので、そう言う。
        chip.classList.add("pv-failed");
        chip.textContent = limits.labels.undecided;
        chip.title = limits.labels.undecidedNote;
      } else {
        chip.classList.add("pv-failed");
        chip.textContent = limits.labels.failed;
        chip.title = res?.error ?? "";
      }
    },
    true
  );

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, limits?.debounceMs ?? 400);
  }

  schedule();

  // 検索結果は後から差し替わる（続きを読み込む・タブ切り替え）。
  const root = document.querySelector("#search") || document.body;
  if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
})();
