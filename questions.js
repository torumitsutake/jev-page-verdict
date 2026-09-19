/**
 * Jev に投げる質問の定義と、ユーザーが変更できるジャンル設定。
 *
 * 設計方針
 *  - 1軸のラベルを増やすより、軸を増やす。Choice は選択肢上の確率分布を返すので、
 *    意味の重なるラベルが並ぶと確率が割れて confidence が落ちる。質問は並列評価で
 *    増やしてもほぼタダなので、6ラベル×3軸のほうが解像度も確信度も高い。
 *  - criteria と instructions は英語固定。表示名だけ name: { en, ja } で持つ。
 *    日本語は精度が落ちると公式に明記あり。表示言語を切り替えても質問は英語のまま。
 *  - Choice には必ず「該当なし」を置く。
 *  - 閾値・重み・色はこのファイルに集約する。UI の飾り文字だけ i18n.js。
 */

import { resolveLang, pick } from "./i18n.js";

export const MODEL = "jev-latest";
export const API_URL = "https://api.typesafe.ai/v1/systemone";

/* ------------------------------------------------------------------ *
 * ジャンル辞書
 *
 * name:     表示用。判定には使わない。
 * criteria: Jev に渡す英語の定義。ここの書き方で精度が決まる。
 * splits:   このラベルが分割している親ラベル。親と子を同時に有効にすると
 *           確率が割れるため、設定画面で警告を出すのに使う。
 * ------------------------------------------------------------------ */
export const GENRE_CATALOG = {
  commerce: {
    name: { en: "Selling", ja: "販売・宣伝" },
    criteria:
      "A page whose purpose is to make the reader buy, subscribe to, or sign up for something. Includes storefronts, landing pages, and ranking or comparison articles written to drive a purchase.",
  },
  experience: {
    name: { en: "First-hand", ja: "体験・レビュー" },
    criteria:
      "An account of the author's own experience with the subject, or an evaluation of it. The purpose is to tell the reader what it was actually like.",
  },
  news: {
    name: { en: "News", ja: "ニュース・報道" },
    criteria: "Journalistic reporting of a recent event by a news outlet or wire service.",
  },
  explainer: {
    name: { en: "Reference", ja: "解説・資料" },
    criteria:
      "Neutral explanation, tutorial, technical documentation, specification, or encyclopedic reference. The purpose is to teach or to put something on record.",
  },
  discussion: {
    name: { en: "Discussion", ja: "議論・コミュニティ" },
    criteria:
      "A forum thread, Q&A page, social feed, or comment-driven page where the substance comes from many participants.",
  },

  // --- 詳細プリセットで使う分割ラベル ---
  affiliate: {
    name: { en: "Affiliate", ja: "アフィリエイト" },
    criteria:
      "A review- or ranking-shaped article whose main purpose is to earn a referral commission on outbound links.",
    splits: "commerce",
  },
  ecommerce: {
    name: { en: "Storefront", ja: "通販・商品ページ" },
    criteria: "A storefront or product detail page where the item itself can be bought on this page.",
    splits: "commerce",
  },
  official: {
    name: { en: "Official", ja: "公式情報" },
    criteria:
      "Information the organization publishes about itself: corporate notices, support pages, specifications, IR, policies.",
    splits: "explainer",
  },
  opinion: {
    name: { en: "Opinion", ja: "意見・主張" },
    criteria: "A column, editorial, or argument advancing the author's position on a topic.",
    splits: "discussion",
  },
  recruiting: {
    name: { en: "Recruiting", ja: "求人・採用" },
    criteria: "A job posting or recruiting page for an organization.",
    splits: "commerce",
  },
  creative: {
    name: { en: "Creative", ja: "創作・エッセイ" },
    criteria: "Fiction, poetry, diary, or a personal essay not centred on evaluating anything.",
    splits: "experience",
  },
};

export const OTHER_KEY = "other";
export const OTHER_LABEL = {
  name: { en: "None of these", ja: "該当なし" },
  criteria: "None of the above describe the purpose of this page.",
};

/* ------------------------------------------------------------------ *
 * プリセット
 * ------------------------------------------------------------------ */
export const PRESETS = {
  standard: {
    name: { en: "Standard (6 classes)", ja: "標準（6分類）" },
    note: {
      en: "Five non-overlapping labels plus none-of-the-above. Start here.",
      ja: "重なりのない5ラベル＋該当なし。迷ったらこれ。",
    },
    genres: ["commerce", "experience", "news", "explainer", "discussion"],
  },
  minimal: {
    name: { en: "Minimal (4 classes)", ja: "最小（4分類）" },
    note: {
      en: "For when all you want to know is whether it is selling. Confidence is steadiest here.",
      ja: "売る気があるかないかだけ見たいとき。confidence が最も安定する。",
    },
    genres: ["commerce", "experience", "explainer"],
  },
  detailed: {
    name: { en: "Detailed (8 classes)", ja: "詳細（8分類）" },
    note: {
      en: "Overlapping labels cost confidence. Lower the thresholds to match.",
      ja: "ラベルが重なるぶん確信度は下がる。閾値を下げて使うこと。",
    },
    genres: ["affiliate", "ecommerce", "experience", "news", "explainer", "official", "discussion"],
  },
};

export const DEFAULT_CONFIG = {
  lang: "auto", // auto | en | ja。auto はブラウザの UI 言語から推定する
  preset: "standard",
  genres: PRESETS.standard.genres,
  customGenres: [], // [{ key, name: { en, ja }, criteria }]
  axes: { stance: true, publisher: true, product: true },
  sections: { gauge: true, facts: true, probs: false, raw: false },
  serp: { enabled: false, snippet: false, fetch: false },
};

/** 旧形式 { key, ja, en } の独自ラベルを新形式に寄せる。en は criteria だった。 */
function migrateCustom(list) {
  return (list ?? []).map((g) =>
    g.name
      ? g
      : { key: g.key, name: { en: g.ja ?? g.key, ja: g.ja ?? g.key }, criteria: g.en ?? "" }
  );
}

export async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
    customGenres: migrateCustom(config?.customGenres),
    axes: { ...DEFAULT_CONFIG.axes, ...(config?.axes ?? {}) },
    sections: { ...DEFAULT_CONFIG.sections, ...(config?.sections ?? {}) },
    serp: { ...DEFAULT_CONFIG.serp, ...(config?.serp ?? {}) },
  };
}

export async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

/** 有効なジャンルを { key: { name, criteria } } で返す。末尾に必ず該当なしを足す。 */
export function resolveGenres(config) {
  const out = {};
  for (const key of config.genres) {
    if (GENRE_CATALOG[key]) out[key] = GENRE_CATALOG[key];
  }
  for (const g of config.customGenres ?? []) {
    if (g.key && g.criteria) out[g.key] = { name: g.name, criteria: g.criteria, custom: true };
  }
  out[OTHER_KEY] = OTHER_LABEL;
  return out;
}

/** 親ラベルと分割ラベルが同時に有効になっている組を返す。設定画面の警告用。 */
export function findOverlaps(config) {
  const on = new Set(config.genres);
  const hits = [];
  for (const key of on) {
    const parent = GENRE_CATALOG[key]?.splits;
    if (parent && on.has(parent)) hits.push([key, parent]);
  }
  return hits;
}

function hash(src) {
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * ラベル構成が変わったらキャッシュは無効。構成のハッシュをキーに混ぜる。
 *
 * kind="snippet" のときは、スニペット用の質問が実際に使うもの（ジャンルと stance）
 * だけを見る。publisher や product を切り替えただけで検索結果の推定を投げ直すのは、
 * 同じ質問に同じ金を2回払うことになる。
 */
export function configFingerprint(config, kind = "page") {
  const genres = Object.keys(resolveGenres(config)).sort();
  const custom = (config.customGenres ?? []).map((g) => g.key + ":" + g.criteria).sort();
  // オブジェクトをそのまま JSON にするとキーの挿入順でハッシュが変わり、
  // 同じ設定なのにキャッシュが外れる。並べ替えて真偽に正規化しておく。
  const axes = Object.entries(config.axes ?? {})
    .map(([k, v]) => `${k}:${v ? 1 : 0}`)
    .sort();
  if (kind === "snippet") {
    return "s" + hash(JSON.stringify([genres, custom, !!config.axes?.stance]));
  }
  return hash(JSON.stringify([genres, custom, axes]));
}

/* ------------------------------------------------------------------ *
 * 質問
 * ------------------------------------------------------------------ */
export const STANCE_LABELS = {
  seller: {
    name: { en: "The seller", ja: "売り手本人" },
    criteria: "The seller, maker, or their agency speaking about their own product.",
  },
  incentivized: {
    name: { en: "Incentivized", ja: "報酬あり" },
    criteria:
      "A third party who is paid, sponsored, gifted the product, or earns a commission on referrals.",
  },
  user: {
    name: { en: "A user", ja: "利用者" },
    criteria:
      "A user, customer, or visitor describing their own experience, with no visible commercial tie.",
  },
  observer: {
    name: { en: "An observer", ja: "第三者" },
    criteria: "A neutral third party reporting, explaining, or curating, not selling.",
  },
  unclear: {
    name: { en: "Unclear", ja: "判別不能" },
    criteria: "The page does not give enough signal to tell who is speaking.",
  },
};

export const PUBLISHER_LABELS = {
  official_site: {
    name: { en: "Official site", ja: "公式" },
    criteria: "The organization's own site, speaking for itself.",
  },
  media: {
    name: { en: "Media", ja: "メディア" },
    criteria: "A publication with an editorial staff: news outlet, magazine, trade press.",
  },
  individual: {
    name: { en: "Individual", ja: "個人" },
    criteria: "A personal blog or an individual's own site.",
  },
  aggregator: {
    name: { en: "Aggregator", ja: "まとめ・比較" },
    criteria: "A site that mainly collects, ranks, or restates content produced elsewhere.",
  },
  platform: {
    name: { en: "Platform", ja: "プラットフォーム" },
    criteria: "A marketplace, SNS, or hosting service showing user-submitted content.",
  },
};

/**
 * 商品を出しているページで「誰が出しているのか」を見る軸。
 *
 * stance（売り手 / 報酬あり / 利用者 / 第三者）と重なりそうに見えるが、別物。
 * stance は「書き手の利害」、こちらは「その商品の作り手との関係」を聞いている。
 * 正規販売店は stance=seller だが作り手ではないし、公式ストアと
 * マーケットプレイス出品は stance では区別できない。
 *
 * 末尾の not_product が「該当なし」にあたる。商品ページでないときの逃げ道が
 * ないと、無関係なページで確率が散る。
 */
export const PRODUCT_LABELS = {
  brand_official: {
    name: { en: "From the brand", ja: "公式（作り手自身）" },
    criteria:
      "The maker or brand of the product is presenting it themselves: their own storefront, product page, specification, or announcement.",
  },
  authorized_seller: {
    name: { en: "Authorized seller", ja: "正規の販売店" },
    criteria:
      "A named retailer, dealer, or distributor selling the product with the maker's sanction. It sells the product but did not make it.",
  },
  marketplace_listing: {
    name: { en: "Marketplace listing", ja: "マーケットプレイス出品" },
    criteria:
      "An item posted by an individual or a shop on a marketplace, auction, or flea-market platform, where the platform is not the seller.",
  },
  third_party_promo: {
    name: { en: "Third-party promotion", ja: "第三者の宣伝" },
    criteria:
      "Someone other than the maker or an authorized seller promoting the product to earn from it: an affiliate or ranking article, a sponsored post, or an ad landing page.",
  },
  not_product: {
    name: { en: "Not a product page", ja: "商品ページではない" },
    criteria: "The page does not present a specific purchasable product.",
  },
};

export const TRUST_SCALE = [
  "Reads as an advertisement.",
  "Mixed: some substance, but shaped around a product.",
  "Reads as an independent account written for the reader's benefit.",
];

const criteriaOf = (labels) =>
  Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.criteria]));

export function buildQuestions(config) {
  const q = {
    genre: {
      type: "choice",
      instructions:
        "What kind of page is this? Judge by the author's purpose in publishing it, not by the topic it covers.",
      criteria: criteriaOf(resolveGenres(config)),
    },
    independence: {
      type: "score",
      instructions: "How independent of commercial interest does this page read to an ordinary reader?",
      criteria: TRUST_SCALE,
    },
    firsthand: {
      type: "noul",
      instructions:
        "The author describes their own direct experience with the subject, including specific details only someone who used it would know.",
    },
    sponsored_disclosure: {
      type: "noul",
      instructions:
        "The page discloses that it is sponsored, gifted, PR, an advertisement, or contains affiliate links.",
    },
    thin_content: {
      type: "noul",
      instructions:
        "The body is padded, generic, or mostly restates the product description without adding information.",
    },
    // 「機械が書いたか」は目的ではなく品質の属性で、genre のどのラベルとも直交する。
    // genre 軸に置くと全ラベルと意味が重なって確率が割れるため、独立した Noul にしてある。
    // 「AI っぽいか」ではなく、state から確かめられる証拠で書くこと。
    machine_written: {
      type: "noul",
      instructions:
        "Reads as machine-generated or mass-produced rather than written by a person with something to say: no identifiable author, no dates or specifics that only someone actually present would know, uniform section structure, and wording that restates common knowledge without committing to anything.",
    },
  };

  if (config.axes?.stance) {
    q.stance = {
      type: "choice",
      instructions: "Who is speaking on this page, and what is their interest in the subject?",
      criteria: criteriaOf(STANCE_LABELS),
    };
  }
  if (config.axes?.publisher) {
    q.publisher = {
      type: "choice",
      instructions: "What kind of site is publishing this page?",
      criteria: criteriaOf(PUBLISHER_LABELS),
    };
  }
  if (config.axes?.product) {
    q.product = {
      type: "choice",
      instructions:
        "If this page presents a specific product for sale, what is the publisher's relationship to whoever makes that product? Judge from who runs the page, not from how favourable the wording is.",
      criteria: criteriaOf(PRODUCT_LABELS),
    };
  }
  return q;
}

/**
 * 検索結果のスニペットだけで判定するときの質問。
 *
 * 本文もリンク統計も無い状態なので、本文判定のうち意味が残るものだけに絞る。
 * independence / firsthand / thin_content は120字のスニペットでは答えようがない。
 * スニペットは SEO のために書かれた文なので、そこも明示して渡す。
 */
export function buildSnippetQuestions(config) {
  const q = {
    genre: {
      type: "choice",
      instructions:
        "Judge only from this search result: its title, the URL, and the snippet the search engine shows. Decide what kind of page the link most likely leads to, from the publisher's purpose. The snippet is written to attract clicks, so treat promotional wording as weak evidence rather than proof, and answer with low confidence when the result could plausibly be more than one of these.",
      criteria: criteriaOf(resolveGenres(config)),
    },
  };
  if (config.axes?.stance) {
    q.stance = {
      type: "choice",
      instructions:
        "From this search result alone, who is most likely speaking on the page it links to, and what is their interest in the subject?",
      criteria: criteriaOf(STANCE_LABELS),
    };
  }
  return q;
}

/** 表示用のラベル引き。未知キーはそのまま返す。 */
const LABEL_TABLES = {
  stance: STANCE_LABELS,
  publisher: PUBLISHER_LABELS,
  product: PRODUCT_LABELS,
};

export function labelOf(kind, key, config) {
  const lang = resolveLang(config);
  const table = kind === "genre" ? resolveGenres(config) : LABEL_TABLES[kind] ?? {};
  return pick(table[key]?.name, lang) || key;
}

/* ------------------------------------------------------------------ *
 * 色
 *
 * 「売る気があるか」の一次元に割り当てる。ラベルを増やしても色は増やさない。
 * バッジ・ポップアップ・検索結果の色分けで同じ表を使う。
 * ------------------------------------------------------------------ */
const SELLING = new Set(["commerce", "affiliate", "ecommerce", "recruiting"]);
const FIRSTHAND = new Set(["experience", "discussion", "creative", "opinion"]);

export const VERDICT_COLORS = {
  selling: "#b4341f",
  firsthand: "#2f7a4e",
  neutral: "#33566e",
  unknown: "#697480",
};

export function verdictColor(key, known = true) {
  if (!known || !key) return VERDICT_COLORS.unknown;
  if (SELLING.has(key)) return VERDICT_COLORS.selling;
  if (FIRSTHAND.has(key)) return VERDICT_COLORS.firsthand;
  if (key === OTHER_KEY) return VERDICT_COLORS.unknown;
  return VERDICT_COLORS.neutral;
}

/* ------------------------------------------------------------------ *
 * 検索結果の色分け
 * ------------------------------------------------------------------ */
export const SERP = {
  // 許可を求めるホスト。増やすほど権限ダイアログが重くなるので必要な分だけ。
  origins: ["https://www.google.com/search*", "https://www.google.co.jp/search*"],

  // そのページに出ている結果は全部見る。maxPerPage は安全弁で、
  // Google 自身のページあたり最大表示件数と同じ。無限スクロールで
  // 際限なく増えるのを止めるためだけにある。
  maxPerPage: 100,
  batchSize: 20, // 1往復で扱う件数。描画を早く始めるために分ける
  concurrency: 4, // 同時リクエスト数
  snippetChars: 320, // スニペットの切り詰め
  debounceMs: 400, // DOM が落ち着くのを待つ時間

  // クリックした1件だけ本文を取りに行くときの制限。
  // 全件取得にしない理由は README と CLAUDE.md を参照。
  fetchTimeoutMs: 10000,
  fetchMaxBytes: 800000, // これ以上は切る。巨大ページでパーサを詰まらせない
  fetchMinBodyChars: 400, // これ未満は同意画面か JS レンダリング。判定しない
};

/**
 * confidence ごとの扱い。詳細プリセットのようにラベルが増える構成では
 * 確率が割れるぶん全体に下がるので、閾値も下げて使うこと。
 */
export const CONFIDENCE = {
  assert: 0.75, // 断定して表示
  hint: 0.5, // 「〜らしい」で表示
  // hint 未満は「判定できず」。判断はユーザーに返す

  // スニペット推定は材料が少ないぶん確率が散る。断定はさせず、
  // この値を下回ったら何も描かない（間違った色を置くより無色のほうがまし）。
  snippet: 0.5,
};
