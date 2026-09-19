/**
 * ページから「判定に必要な事実」だけを抜き出す。
 * chrome.scripting.executeScript から関数として注入される想定。
 *
 * Jev の state はオブジェクト形式が推奨。各フィールドに説明的な名前を付けると
 * モデルが関係性を名前から読む。無関係な情報を入れるほど精度が落ちるので、
 * ここで削れるものは削っておく。
 */
function extractPageSignals() {
  const MAX_BODY_CHARS = 3500;
  const MAX_HEADINGS = 12;
  const MAX_LINK_SAMPLE = 400;

  // --- アフィリエイト系ドメイン / パラメータ -------------------------------
  // コードで判定できることはコードで判定する（Jev には聞かない）
  const AFFILIATE_PATTERNS = [
    /(^|\.)a8\.net$/i,
    /(^|\.)valuecommerce\.com$/i,
    /(^|\.)ck\.jp\.ap\.valuecommerce\.com$/i,
    /(^|\.)af\.moshimo\.com$/i,
    /(^|\.)accesstrade\.net$/i,
    /(^|\.)h\.accesstrade\.net$/i,
    /(^|\.)amzn\.to$/i,
    /(^|\.)hb\.afl\.rakuten\.co\.jp$/i,
    /(^|\.)click\.linksynergy\.com$/i,
    /(^|\.)go\.skimresources\.com$/i,
    /(^|\.)shareasale\.com$/i,
    /(^|\.)impact\.com$/i,
    /(^|\.)tradedoubler\.com$/i,
    /(^|\.)felmat\.net$/i,
  ];
  const AFFILIATE_QUERY_KEYS = ["tag", "affid", "af_id", "a8", "yclid_af", "ref_aff"];

  const text = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const metaOf = (sel) => text(document.querySelector(sel)?.getAttribute("content"));

  // --- 本文 ---------------------------------------------------------------
  const clone = document.body ? document.body.cloneNode(true) : null;
  if (clone) {
    clone
      .querySelectorAll("script,style,noscript,template,nav,header,footer,aside,iframe,svg,form")
      .forEach((n) => n.remove());
  }
  const bodyText = text(clone?.innerText || "").slice(0, MAX_BODY_CHARS);

  // --- 見出し -------------------------------------------------------------
  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .map((h) => text(h.innerText))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);

  // --- リンク統計 ---------------------------------------------------------
  const here = location.hostname;
  const anchors = [...document.querySelectorAll("a[href]")].slice(0, MAX_LINK_SAMPLE);
  let external = 0;
  let affiliate = 0;
  const affiliateHosts = new Set();

  for (const a of anchors) {
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (u.hostname === here) continue;
    external += 1;

    const hostHit = AFFILIATE_PATTERNS.some((re) => re.test(u.hostname));
    const queryHit = AFFILIATE_QUERY_KEYS.some((k) => u.searchParams.has(k));
    if (hostHit || queryHit) {
      affiliate += 1;
      affiliateHosts.add(u.hostname);
    }
  }

  // --- 構造化データ -------------------------------------------------------
  const schemaTypes = new Set();
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (o) => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (typeof o["@type"] === "string") schemaTypes.add(o["@type"]);
        if (Array.isArray(o["@type"])) o["@type"].forEach((t) => schemaTypes.add(t));
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(node.textContent));
    } catch {
      /* 壊れた JSON-LD は無視 */
    }
  }

  // --- 価格・購入導線 -----------------------------------------------------
  const priceHits = (bodyText.match(/(¥|￥|\$)\s?[\d,]{3,}|[\d,]{3,}\s?円/g) || []).length;
  const ctaWords = ["購入", "申し込", "無料登録", "資料請求", "今すぐ", "カートに入れる", "Buy now", "Sign up"];
  const ctaHits = ctaWords.filter((w) => bodyText.includes(w));

  return {
    page: {
      url: location.href,
      site_host: here,
      title: text(document.title),
      meta_description: metaOf('meta[name="description"]') || null,
      og_type: metaOf('meta[property="og:type"]') || null,
      og_site_name: metaOf('meta[property="og:site_name"]') || null,
      published_time: metaOf('meta[property="article:published_time"]') || null,
      author: metaOf('meta[name="author"]') || null,
      lang: document.documentElement.lang || null,
    },
    headings,
    body_excerpt: bodyText,
    link_profile: {
      external_link_count: external,
      affiliate_link_count: affiliate,
      affiliate_networks: [...affiliateHosts].slice(0, 10),
    },
    structured_data_types: [...schemaTypes].slice(0, 10),
    purchase_signals: {
      price_mentions: priceHits,
      call_to_action_phrases: ctaHits,
    },
  };
}

// executeScript({ func }) は関数を文字列化して注入するため、
// この関数は外側のスコープを一切参照していない必要がある。
export { extractPageSignals };
