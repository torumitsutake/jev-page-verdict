/**
 * Jev に投げる質問の定義と、ユーザーが変更できるジャンル設定。
 *
 * 設計方針
 *  - 1軸のラベルを増やすより、軸を増やす。Choice は選択肢上の確率分布を返すので、
 *    意味の重なるラベルが並ぶと確率が割れて confidence が落ちる。質問は並列評価で
 *    増やしてもほぼタダなので、6ラベル×3軸のほうが解像度も確信度も高い。
 *  - instructions / criteria は英語。日本語は精度が落ちると公式に明記あり。
 *  - Choice には必ず「該当なし」を置く。
 *  - 閾値・重み付けはこのファイルに集約する。
 */

export const MODEL = "jev-latest";
export const API_URL = "https://api.typesafe.ai/v1/systemone";

/* ------------------------------------------------------------------ *
 * ジャンル辞書
 *
 * splits: このラベルが分割している親ラベル。親と子を同時に有効にすると
 *         確率が割れるため、設定画面で警告を出すのに使う。
 * ------------------------------------------------------------------ */
export const GENRE_CATALOG = {
  commerce: {
    ja: "販売・宣伝",
    en: "A page whose purpose is to make the reader buy, subscribe to, or sign up for something. Includes storefronts, landing pages, and ranking or comparison articles written to drive a purchase.",
  },
  experience: {
    ja: "体験・レビュー",
    en: "An account of the author's own experience with the subject, or an evaluation of it. The purpose is to tell the reader what it was actually like.",
  },
  news: {
    ja: "ニュース・報道",
    en: "Journalistic reporting of a recent event by a news outlet or wire service.",
  },
  explainer: {
    ja: "解説・資料",
    en: "Neutral explanation, tutorial, technical documentation, specification, or encyclopedic reference. The purpose is to teach or to put something on record.",
  },
  discussion: {
    ja: "議論・コミュニティ",
    en: "A forum thread, Q&A page, social feed, or comment-driven page where the substance comes from many participants.",
  },

  // --- 詳細プリセットで使う分割ラベル ---
  affiliate: {
    ja: "アフィリエイト",
    en: "A review- or ranking-shaped article whose main purpose is to earn a referral commission on outbound links.",
    splits: "commerce",
  },
  ecommerce: {
    ja: "通販・商品ページ",
    en: "A storefront or product detail page where the item itself can be bought on this page.",
    splits: "commerce",
  },
  official: {
    ja: "公式情報",
    en: "Information the organization publishes about itself: corporate notices, support pages, specifications, IR, policies.",
    splits: "explainer",
  },
  opinion: {
    ja: "意見・主張",
    en: "A column, editorial, or argument advancing the author's position on a topic.",
    splits: "discussion",
  },
  recruiting: {
    ja: "求人・採用",
    en: "A job posting or recruiting page for an organization.",
    splits: "commerce",
  },
  creative: {
    ja: "創作・エッセイ",
    en: "Fiction, poetry, diary, or a personal essay not centred on evaluating anything.",
    splits: "experience",
  },
  lowquality: {
    ja: "低品質・自動生成",
    en: "Scraped, auto-generated, or content-farm output with no identifiable author or original information.",
  },
};

export const OTHER_KEY = "other";
export const OTHER_LABEL = {
  ja: "該当なし",
  en: "None of the above describe the purpose of this page.",
};

/* ------------------------------------------------------------------ *
 * プリセット
 * ------------------------------------------------------------------ */
export const PRESETS = {
  standard: {
    ja: "標準（6分類）",
    note: "重なりのない5ラベル＋該当なし。迷ったらこれ。",
    genres: ["commerce", "experience", "news", "explainer", "discussion"],
  },
  minimal: {
    ja: "最小（4分類）",
    note: "売る気があるかないかだけ見たいとき。confidence が最も安定する。",
    genres: ["commerce", "experience", "explainer"],
  },
  detailed: {
    ja: "詳細（9分類）",
    note: "ラベルが重なるぶん確信度は下がる。閾値を下げて使うこと。",
    genres: ["affiliate", "ecommerce", "experience", "news", "explainer", "official", "discussion", "lowquality"],
  },
};

export const DEFAULT_CONFIG = {
  preset: "standard",
  genres: PRESETS.standard.genres,
  customGenres: [], // [{ key, ja, en }]
  axes: { stance: true, publisher: true },
  sections: { gauge: true, facts: true, probs: false, raw: false },
};

export async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  return {
    ...DEFAULT_CONFIG,
    ...(config ?? {}),
    axes: { ...DEFAULT_CONFIG.axes, ...(config?.axes ?? {}) },
    sections: { ...DEFAULT_CONFIG.sections, ...(config?.sections ?? {}) },
  };
}

export async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

/** 有効なジャンルを { key: {ja, en} } で返す。末尾に必ず該当なしを足す。 */
export function resolveGenres(config) {
  const out = {};
  for (const key of config.genres) {
    if (GENRE_CATALOG[key]) out[key] = GENRE_CATALOG[key];
  }
  for (const g of config.customGenres ?? []) {
    if (g.key && g.en) out[g.key] = { ja: g.ja || g.key, en: g.en, custom: true };
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

/** ラベル構成が変わったらキャッシュは無効。構成のハッシュをキーに混ぜる。 */
export function configFingerprint(config) {
  const src = JSON.stringify([
    Object.keys(resolveGenres(config)).sort(),
    (config.customGenres ?? []).map((g) => g.key + ":" + g.en).sort(),
    config.axes,
  ]);
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ *
 * 質問
 * ------------------------------------------------------------------ */
export const STANCE_LABELS = {
  seller: { ja: "売り手本人", en: "The seller, maker, or their agency speaking about their own product." },
  incentivized: { ja: "報酬あり", en: "A third party who is paid, sponsored, gifted the product, or earns a commission on referrals." },
  user: { ja: "利用者", en: "A user, customer, or visitor describing their own experience, with no visible commercial tie." },
  observer: { ja: "第三者", en: "A neutral third party reporting, explaining, or curating, not selling." },
  unclear: { ja: "判別不能", en: "The page does not give enough signal to tell who is speaking." },
};

export const PUBLISHER_LABELS = {
  official_site: { ja: "公式", en: "The organization's own site, speaking for itself." },
  media: { ja: "メディア", en: "A publication with an editorial staff: news outlet, magazine, trade press." },
  individual: { ja: "個人", en: "A personal blog or an individual's own site." },
  aggregator: { ja: "まとめ・比較", en: "A site that mainly collects, ranks, or restates content produced elsewhere." },
  platform: { ja: "プラットフォーム", en: "A marketplace, SNS, or hosting service showing user-submitted content." },
};

export const TRUST_SCALE = [
  "Reads as an advertisement.",
  "Mixed: some substance, but shaped around a product.",
  "Reads as an independent account written for the reader's benefit.",
];

export function buildQuestions(config) {
  const criteria = (labels) => Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.en]));

  const q = {
    genre: {
      type: "choice",
      instructions:
        "What kind of page is this? Judge by the author's purpose in publishing it, not by the topic it covers.",
      criteria: criteria(resolveGenres(config)),
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
  };

  if (config.axes?.stance) {
    q.stance = {
      type: "choice",
      instructions: "Who is speaking on this page, and what is their interest in the subject?",
      criteria: criteria(STANCE_LABELS),
    };
  }
  if (config.axes?.publisher) {
    q.publisher = {
      type: "choice",
      instructions: "What kind of site is publishing this page?",
      criteria: criteria(PUBLISHER_LABELS),
    };
  }
  return q;
}

/** 表示用のラベル引き。未知キーはそのまま返す。 */
export function labelOf(kind, key, config) {
  if (kind === "genre") return resolveGenres(config)[key]?.ja ?? key;
  if (kind === "stance") return STANCE_LABELS[key]?.ja ?? key;
  if (kind === "publisher") return PUBLISHER_LABELS[key]?.ja ?? key;
  return key;
}

/**
 * confidence ごとの扱い。詳細プリセットのようにラベルが増える構成では
 * 確率が割れるぶん全体に下がるので、閾値も下げて使うこと。
 */
export const CONFIDENCE = {
  assert: 0.75, // 断定して表示
  hint: 0.5,    // 「〜らしい」で表示
  // hint 未満は「判定できず」。判断はユーザーに返す
};
