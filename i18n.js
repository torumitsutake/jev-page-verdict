/**
 * 画面に出る文言。判定そのものに関わる定義（ラベル・閾値・criteria）は
 * questions.js 側に置く。ここは UI の飾り文字だけを持つ。
 *
 * chrome.i18n / _locales は使っていない。あれはブラウザの UI 言語に従う仕組みで、
 * 拡張の設定画面から切り替えられないため。既定は auto（UI 言語から推定）。
 */

export const LANG_CHOICES = {
  auto: { en: "Follow browser language", ja: "ブラウザの言語に合わせる" },
  en: { en: "English", ja: "English" },
  ja: { en: "日本語", ja: "日本語" },
};

export function detectLang() {
  try {
    return /^ja\b/i.test(chrome.i18n.getUILanguage()) ? "ja" : "en";
  } catch {
    return "en";
  }
}

export function resolveLang(config) {
  const l = config?.lang ?? "auto";
  return l === "en" || l === "ja" ? l : detectLang();
}

/** { en, ja } から現在の言語を取り出す。ja が無ければ en に落とす。 */
export function pick(obj, lang) {
  if (!obj) return "";
  return obj[lang] ?? obj.en ?? "";
}

const S = {
  /* --- ポップアップ --- */
  loading: { en: "Loading…", ja: "読み込み中…" },
  notJudged: { en: "This page has not been judged yet.", ja: "このページはまだ判定していません。" },
  judging: { en: "Judging…", ja: "判定中…" },
  rejudging: { en: "Judging again…", ja: "再判定中…" },
  run: { en: "Judge this page", ja: "判定する" },
  rerun: { en: "Judge again", ja: "再判定" },
  openOptions: { en: "Settings", ja: "設定" },
  failed: { en: "Could not judge this page.", ja: "判定に失敗しました。" },
  cachedMeta: { en: "saved verdict", ja: "保存済みの判定" },
  usageMeta: { en: "{tokens} tokens · {classes} classes", ja: "{tokens} トークン・{classes}分類" },

  undecided: { en: "Undecided", ja: "判定できず" },
  likely: { en: "Likely {label}", ja: "{label}らしい" },
  authorUnknown: { en: "author unclear", ja: "書き手は特定できず" },
  confidence: { en: "confidence {pct}", ja: "確信度 {pct}" },
  subJoin: { en: " · ", ja: "・" },

  secIndependence: { en: "Independence", ja: "独立性" },
  secEvidence: { en: "Evidence", ja: "根拠" },
  secBreakdown: { en: "Class breakdown", ja: "分類の内訳" },
  secRaw: { en: "Raw response", ja: "生の応答" },

  scaleAd: { en: "Advertisement", ja: "広告そのもの" },
  scaleMixed: { en: "Mixed", ja: "混在" },
  scaleIndependent: { en: "Independent", ja: "独立した記事" },
  peekAd: { en: "ad-leaning", ja: "広告寄り" },
  peekMixed: { en: "mixed", ja: "混在" },
  peekIndependent: { en: "independent-leaning", ja: "独立寄り" },

  factFirsthand: { en: "Describes first-hand use", ja: "自分で使った話が書かれている" },
  factSponsored: { en: "Discloses PR or affiliate links", ja: "PR・アフィリエイトの表示がある" },
  factThin: { en: "Thin or restated content", ja: "中身が薄い・引き写しが多い" },
  factMachine: { en: "Reads as machine-generated", ja: "機械が書いたように読める" },
  factAffiliate: { en: "Affiliate links", ja: "アフィリエイトリンク" },
  countLinks: { en: "{n}", ja: "{n}本" },
  countHits: { en: "{n}", ja: "{n}件" },

  groupGenre: { en: "Genre", ja: "ジャンル" },
  groupStance: { en: "Stance", ja: "書き手の立場" },
  groupPublisher: { en: "Publisher", ja: "発信主体" },
  groupProduct: { en: "Who is selling it", ja: "誰が売っているか" },

  /* --- 検索結果の色分け --- */
  serpEstimated: { en: "estimated", ja: "推定" },
  serpFromSnippet: {
    en: "Estimated from the search snippet only",
    ja: "検索結果のスニペットだけからの推定",
  },
  serpFromPage: { en: "Judged from the full page", ja: "ページ本文からの判定" },

  /* --- background が返すエラー --- */
  errNoKey: {
    en: "No API key. Add one in the settings page.",
    ja: "APIキーが未設定です。設定画面で登録してください。",
  },
  errTimeout: { en: "Jev did not respond within 15 seconds.", ja: "Jev が15秒以内に応答しませんでした。" },
  errAuth: { en: "The API key was rejected.", ja: "APIキーが拒否されました。" },
  errRate: {
    en: "Rate limited. Wait a moment and try again.",
    ja: "レート制限に達しました。少し待って再試行してください。",
  },
  errHttp: { en: "Jev error {status}: {detail}", ja: "Jev エラー {status}: {detail}" },
  errUnsupported: { en: "This page cannot be judged.", ja: "このページは判定できません。" },
  errUnreadable: { en: "Could not read the page contents.", ja: "ページの内容を読み取れませんでした。" },

  /* --- 設定画面 --- */
  optTitle: { en: "Page Verdict settings", ja: "Page Verdict の設定" },
  optSub: { en: "Verdicts come from Jev (TypeSafe AI).", ja: "判定は Jev（TypeSafe AI）で行います。" },

  optLangHead: { en: "Language", ja: "表示言語" },
  optLangHint: {
    en: "Applies to this extension's own screens. Questions sent to Jev stay in English either way, because accuracy drops in other languages.",
    ja: "この拡張の画面に使う言語です。Jev に送る質問はどちらを選んでも英語のままです（他言語では精度が落ちるため）。",
  },

  optKeyHead: { en: "API key", ja: "APIキー" },
  optKeyHint: {
    en: "Issued at console.typesafe.ai under Settings → API keys.",
    ja: "console.typesafe.ai の Settings → API keys で発行したキー。",
  },
  optSave: { en: "Save", ja: "保存する" },
  optSaved: { en: "Saved.", ja: "保存しました。" },
  optKeyEmpty: { en: "The key is empty.", ja: "キーが空です。" },

  optGenreHead: { en: "Genre classes", ja: "ジャンルの分類" },
  optGenreHint: {
    en: "Choice returns a probability distribution over the options, so two overlapping labels split the probability between them and confidence drops. Start from the standard six and add only what you miss.",
    ja: "Choice は選択肢上の確率分布を返すので、意味の重なるラベルを並べると確率がそこで割れて確信度が落ちます。標準の6分類を出発点にして、足りないものだけ足すのが安全です。",
  },
  optCustomPreset: { en: "Pick my own", ja: "自分で選ぶ" },
  optCustomPresetNote: { en: "Uses whatever you tick below.", ja: "チェックした組み合わせを使います。" },
  optCount: {
    en: "Now <strong>{n} classes</strong> (including none-of-the-above). Six is the sweet spot, nine the ceiling.",
    ja: "いま <strong>{n}分類</strong>（該当なしを含む）。目安は6、多くても9まで。",
  },
  optSplitTag: { en: "(splits {parent})", ja: "（{parent}を分割）" },
  optOverlapDetailed: {
    en: "{pairs} overlap in meaning. That is expected in the detailed preset, but confidence drops because the probability splits between them. If you see too many undecided verdicts, lower <code>CONFIDENCE.hint</code> in <code>questions.js</code> to around 0.4.",
    ja: "{pairs} は意味が重なります。詳細プリセットでは想定内ですが、この2つで確率が割れるぶん確信度は下がります。「判定できず」が多いと感じたら <code>questions.js</code> の <code>CONFIDENCE.hint</code> を 0.4 前後まで下げてください。",
  },
  optOverlapWarn: {
    en: "Overlapping labels are enabled together: {pairs}. As is, probability splits between them and undecided verdicts increase. Turn one off, or lower <code>CONFIDENCE.hint</code>.",
    ja: "意味が重なるラベルが同時に有効です：{pairs}。このままだと両者で確率が割れて「判定できず」が増えます。片方を外すか、<code>CONFIDENCE.hint</code> を下げてください。",
  },

  optExtraHead: { en: "Extra labels", ja: "追加のラベル" },
  optExtraHint: {
    en: "The English description becomes the criteria sent to Jev. Accuracy is decided here, so write it at a grain an expert could judge in seconds, and keep it from overlapping the other labels.",
    ja: "英語の説明文がそのまま Jev の criteria になります。ここの書き方で精度が決まるので、「専門家が数秒で判定できる」粒度で、他のラベルと重ならないように書いてください。",
  },
  optNameEn: { en: "Name (English)", ja: "表示名（英語）" },
  optNameJa: { en: "Name (Japanese)", ja: "表示名（日本語）" },
  optCriteria: { en: "Criteria, in English", ja: "criteria（英語）" },
  optAdd: { en: "Add", ja: "追加" },
  optDelete: { en: "Delete", ja: "削除" },
  optNeedBoth: {
    en: "An English name and an English description are both required.",
    ja: "英語の表示名と英語の説明の両方が要ります。",
  },

  optAxesHead: { en: "Axes", ja: "判定の軸" },
  optAxesHint: {
    en: "Questions are evaluated in parallel, so extra axes barely add latency.",
    ja: "質問は並列評価されるので、軸を足しても応答時間はほとんど伸びません。",
  },
  axisStance: { en: "Stance of the author", ja: "書き手の立場" },
  axisStanceNote: {
    en: "Seller / incentivized / user / observer. This is the axis that separates advertising from affiliate content.",
    ja: "売り手 / 報酬あり / 利用者 / 第三者。宣伝とアフィリエイトを分けるのはこの軸。",
  },
  axisPublisher: { en: "Kind of publisher", ja: "発信主体" },
  axisPublisherNote: {
    en: "Official site / media / individual / aggregator / platform.",
    ja: "公式 / メディア / 個人 / まとめ / プラットフォーム。",
  },

  axisProduct: { en: "Who is selling it", ja: "誰が売っているか" },
  axisProductNote: {
    en: "For pages showing a product: the brand itself / an authorized seller / a marketplace listing / a third party promoting it. Separate from stance — an authorized seller is still a seller, but not the maker.",
    ja: "商品が出ているページで、公式（作り手自身）/ 正規の販売店 / マーケットプレイス出品 / 第三者の宣伝 のどれか。「書き手の立場」とは別物で、正規販売店は売り手だが作り手ではない。",
  },

  optSerpHead: { en: "Colour-code Google results", ja: "Google 検索結果での色分け" },
  optSerpHint: {
    en: "Adds a coloured bar to each result on the Google results page, automatically. Off by default; turning it on asks for permission to run on Google search pages. These two take effect immediately — no need to press Save.",
    ja: "Google の検索結果ページで、各結果に自動で色帯を付けます。既定はオフで、オンにするときに Google 検索ページで動く許可を求めます。この2つは保存ボタンを押さなくてもすぐ反映されます。",
  },
  serpEnable: { en: "Colour results already judged", ja: "判定済みの結果を色分けする" },
  serpEnableNote: {
    en: "Uses only verdicts already in the local cache. No API call, nothing sent anywhere.",
    ja: "ローカルのキャッシュにある判定だけを使います。API 呼び出しも送信も発生しません。",
  },
  serpSnippet: { en: "Also estimate unjudged results from their snippet", ja: "未判定の結果をスニペットから推定する" },
  serpSnippetNote: {
    en: "Sends the title, URL and snippet that Google already shows to Jev, for every result on the page (up to {n}). The page body behind the link is never fetched. Estimates are drawn dotted and never stated as fact.",
    ja: "Google が既に表示しているタイトル・URL・スニペットを、そのページに出ている結果すべて（最大{n}件）について Jev に送ります。リンク先の本文は取得しません。推定は点線で描かれ、断定はしません。",
  },
  serpPermDenied: {
    en: "Permission was not granted, so the setting stays off.",
    ja: "許可されなかったため、この設定はオフのままです。",
  },

  optSectionsHead: { en: "Popup sections", ja: "ポップアップの表示" },
  optSectionsHint: {
    en: "Initial state of each section. Opening or closing one in the popup saves that state.",
    ja: "各セクションの初期状態。ポップアップで開閉すると、その状態が保存されます。",
  },

  optSaveConfig: { en: "Save classification settings", ja: "分類設定を保存" },
  optReset: { en: "Reset to standard", ja: "標準に戻す" },
  optClear: { en: "Delete saved verdicts", ja: "判定の保存を消す" },
  optSavedApplies: {
    en: "Saved. Applies from the next verdict.",
    ja: "保存しました。次の判定から反映されます。",
  },
  optResetDone: { en: "Reset to standard.", ja: "標準に戻しました。" },
  optCleared: { en: "Deleted {n} saved verdicts.", ja: "保存していた判定を {n} 件消しました。" },
  optNoLabels: { en: "No labels are enabled.", ja: "ラベルが1つもありません。" },

  noteCacheHead: { en: "Changing settings starts a fresh cache.", ja: "設定を変えるとキャッシュは別扱いになります。" },
  noteCache: {
    en: "A hash of the label set is mixed into the cache key, so pages are re-judged automatically after you change the classes. Old verdicts expire in 30 days.",
    ja: "ラベル構成のハッシュをキャッシュキーに混ぜているため、分類を変えた後のページは自動で再判定されます。古い判定は30日で消えます。",
  },
  noteKeyHead: { en: "Where the API key lives.", ja: "APIキーの保存場所。" },
  noteKey: {
    en: "In <code>chrome.storage.local</code>, in plain text. Anyone who can load the extension can read it. On a work machine, use a key issued for this extension alone with a tight spending cap.",
    ja: "<code>chrome.storage.local</code> に平文で置かれます。拡張を読み込める人は誰でも取り出せます。業務端末で使うなら、この拡張専用に発行して上限を絞ったキーを使ってください。",
  },
  noteSentHead: { en: "What leaves your machine.", ja: "外部に送られるもの。" },
  noteSent: {
    en: "Only for pages where you press the icon: the URL, title, headings, the first 3,500 characters of the body, and link statistics go to api.typesafe.ai. Pages you do not press are never sent. With Google colour-coding on, the title, URL and snippet of the results shown on the search page are sent as well.",
    ja: "アイコンを押したページに限り、URL・タイトル・見出し・本文の冒頭3,500文字・リンク統計が api.typesafe.ai に送信されます。押していないページは送信されません。Google の色分けをオンにした場合は、検索結果に表示されているタイトル・URL・スニペットも送信されます。",
  },
};

/** t("usageMeta", "en", { tokens: 3000, classes: 6 }) */
export function t(key, lang, vars) {
  let s = pick(S[key], lang) || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/**
 * data-i18n（textContent）/ data-i18n-html（innerHTML）/ data-i18n-ph（placeholder）を
 * 一括で埋める。HTML 側には英語を直書きしておき、これが上書きする。
 */
export function applyI18n(root, lang) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n, lang);
  }
  for (const el of root.querySelectorAll("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml, lang);
  }
  for (const el of root.querySelectorAll("[data-i18n-ph]")) {
    el.placeholder = t(el.dataset.i18nPh, lang);
  }
}
