import { extractPageSignals } from "./extract.js";
import {
  API_URL,
  MODEL,
  OTHER_KEY,
  SERP,
  buildQuestions,
  buildSnippetQuestions,
  loadConfig,
  configFingerprint,
  labelOf,
  verdictColor,
  CONFIDENCE,
} from "./questions.js";
import { resolveLang, t } from "./i18n.js";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const CACHE_MAX_ENTRIES = 600;
const CACHE_PREFIX = "c3:";

// --- キャッシュ -----------------------------------------------------------
// ラベル構成を変えたら過去の判定は意味が変わる。fingerprint をキーに混ぜて、
// 構成が変われば自然に別エントリになるようにしている（古いものは TTL で消える）。
//
// src も混ぜる。同じ URL でも「本文から出した判定」と「スニペットから出した推定」は
// 別物で、混ざると弱いほうが本判定として出続ける。
function cacheKey(url, fp, src = "page") {
  try {
    const u = new URL(url);
    return `${CACHE_PREFIX}${fp}:${src}:${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return `${CACHE_PREFIX}${fp}:${src}:${url}`;
  }
}

async function readCache(key) {
  const store = await chrome.storage.local.get(key);
  const hit = store[key];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return hit;
}

async function writeCache(key, value) {
  await chrome.storage.local.set({ [key]: { ...value, at: Date.now() } });
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([k]) => k.startsWith(CACHE_PREFIX));
  if (entries.length > CACHE_MAX_ENTRIES) {
    entries.sort((a, b) => a[1].at - b[1].at);
    const drop = entries.slice(0, entries.length - CACHE_MAX_ENTRIES).map(([k]) => k);
    await chrome.storage.local.remove(drop);
  }
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

// --- Jev 呼び出し ---------------------------------------------------------
/** 文言は翻訳済みで返したいが、分岐は文字列比較したくない。code を別に付ける。 */
function tagged(err, code) {
  err.code = code;
  return err;
}

/**
 * 応答の形を1か所で検めてから返す。
 *
 * ここを通さないと、200 で想定外の形が返ったときに answers が undefined のまま
 * 30日 TTL でキャッシュに焼き付き、そのページは1か月「判定できず」を出し続ける。
 * エラーにもならないので原因が分からない。形が違ったら投げて、キャッシュに
 * 到達させないこと。
 *
 * 逆に、確率が割れただけの「判定できず」は正常な応答なので普通にキャッシュする。
 * 消すと、一番判定の難しいページで開くたびに課金されることになる。
 */
function checkAnswers(raw, questions, lang) {
  const answers = raw?.answers;
  const bad = (why) =>
    tagged(new Error(t("errShape", lang, { detail: why })), "shape");
  if (!answers || typeof answers !== "object") throw bad("no answers object");

  const num = (v) => typeof v === "number" && Number.isFinite(v);
  for (const [key, q] of Object.entries(questions)) {
    const a = answers[key];
    if (!a || typeof a !== "object") throw bad(`missing answer: ${key}`);

    if (q.type === "choice") {
      const allowed = Object.keys(q.criteria);
      if (!allowed.includes(a.choice)) throw bad(`${key}.choice=${a.choice}`);
      if (!num(a.confidence) || a.confidence < 0 || a.confidence > 1) {
        throw bad(`${key}.confidence=${a.confidence}`);
      }
    } else if (q.type === "score") {
      if (!num(a.score) || a.score < 0 || a.score > q.criteria.length - 1) {
        throw bad(`${key}.score=${a.score}`);
      }
    } else if (q.type === "noul") {
      if (!num(a.noul) || a.noul < 0 || a.noul > 1) throw bad(`${key}.noul=${a.noul}`);
    }
  }
  return answers;
}

async function callJev(state, questions, lang) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error(t("errNoKey", lang));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(t("errTimeout", lang));
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw tagged(new Error(t("errAuth", lang)), "auth");
  if (res.status === 429) throw tagged(new Error(t("errRate", lang)), "rate_limit");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(t("errHttp", lang, { status: res.status, detail: detail.slice(0, 200) }));
  }

  const raw = await res.json().catch(() => null);
  return { ...raw, answers: checkAnswers(raw, questions, lang) };
}

// --- 判定本体 -------------------------------------------------------------
async function classifyTab(tab, { force = false } = {}) {
  const config = await loadConfig();
  const lang = resolveLang(config);
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error(t("errUnsupported", lang));

  const fp = configFingerprint(config);
  const key = cacheKey(tab.url, fp, "page");

  if (!force) {
    // 検索結果から本文を取得して判定済みなら、それを使い回す。
    // ただし Cookie もスクリプトも無い状態で取ったものなので、出所は明示する
    // （黙って実訪問の判定として出さない。再判定ボタンで上書きできる）。
    const cached = (await readCache(key)) ?? (await readCache(cacheKey(tab.url, fp, "fetch")));
    if (cached) {
      await paintBadge(tab.id, cached, config);
      return { ...cached, cached: true, source: cached.src ?? "page", config };
    }
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageSignals,
  });
  const state = injection?.result;
  if (!state) throw new Error(t("errUnreadable", lang));

  const raw = await callJev(state, buildQuestions(config), lang);
  const result = {
    url: tab.url,
    src: "page",
    answers: raw.answers,
    usage: raw.usage ?? null,
    signals: {
      affiliate_link_count: state.link_profile.affiliate_link_count,
      affiliate_networks: state.link_profile.affiliate_networks,
      price_mentions: state.purchase_signals.price_mentions,
      external_link_count: state.link_profile.external_link_count,
    },
  };

  await writeCache(key, result);
  await paintBadge(tab.id, result, config);
  return { ...result, cached: false, source: "page", config };
}

// --- バッジ ---------------------------------------------------------------
async function paintBadge(tabId, result, config) {
  const g = result.answers?.genre;
  const known = g && g.confidence >= CONFIDENCE.hint;
  const label = known ? labelOf("genre", g.choice, config) : "?";
  // バッジに入るのは全角2字・半角4字程度。言語で切り方を変える。
  const width = resolveLang(config) === "ja" ? 2 : 4;
  try {
    await chrome.action.setBadgeText({ tabId, text: label.slice(0, width) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: verdictColor(g?.choice, known) });
  } catch {
    /* タブが閉じられた場合など */
  }
}

/* ======================================================================== *
 * 検索結果の色分け
 *
 * content script 側は色も文言も持たない。ここで組み立てて渡す
 * （ラベルと閾値を questions.js の外に散らさないため）。
 * ======================================================================== */

/** 判定結果を content script が描ける形にする。描くに値しなければ null。 */
function toVerdict(result, config, src) {
  const lang = resolveLang(config);
  const g = result?.answers?.genre;
  const conf = g?.confidence ?? 0;
  const floor = src === "snippet" ? CONFIDENCE.snippet : CONFIDENCE.hint;
  const noteKey =
    src === "snippet" ? "serpFromSnippet" : src === "fetch" ? "serpFromFetch" : "serpFromPage";
  // 該当なしに色を付けても読み手の役に立たない。無色のまま置く。
  if (!g || g.choice === OTHER_KEY || conf < floor) return null;

  const stance = result.answers?.stance;
  const stanceLabel =
    stance && stance.confidence >= CONFIDENCE.hint ? labelOf("stance", stance.choice, config) : "";

  return {
    genre: g.choice,
    label: labelOf("genre", g.choice, config),
    color: verdictColor(g.choice),
    confidence: conf,
    src,
    // スニペット推定は断定しない。点線と「推定」表示に落とす。
    estimated: src === "snippet",
    chip:
      src === "snippet"
        ? `${labelOf("genre", g.choice, config)} · ${t("serpEstimated", lang)}`
        : labelOf("genre", g.choice, config),
    title: [
      t(noteKey, lang),
      stanceLabel,
      `${Math.round(conf * 100)}%`,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

/** キャッシュだけを見る。API は呼ばない。本文判定を優先する。 */
async function serpLookup(urls, config) {
  const fp = configFingerprint(config);
  const sfp = configFingerprint(config, "snippet");
  const out = {};
  for (const url of urls.slice(0, SERP.batchSize)) {
    // 強い順に見る。本文 > 取得した本文 > スニペット推定。
    let src = "page";
    let hit = await readCache(cacheKey(url, fp, "page"));
    if (!hit) {
      hit = await readCache(cacheKey(url, fp, "fetch"));
      src = "fetch";
    }
    if (!hit && config.serp?.snippet) {
      hit = await readCache(cacheKey(url, sfp, "snippet"));
      src = "snippet";
    }
    out[url] = hit ? toVerdict(hit, config, src) : null;
  }
  return out;
}

/** スニペットだけで推定する。本文は取りにいかない。 */
async function judgeSnippet(item, config, lang) {
  const state = {
    source: "A single result on a Google search results page.",
    url: item.url,
    site_host: (() => {
      try {
        return new URL(item.url).hostname;
      } catch {
        return null;
      }
    })(),
    result_title: item.title,
    result_snippet: (item.snippet ?? "").slice(0, SERP.snippetChars),
  };
  const raw = await callJev(state, buildSnippetQuestions(config), lang);
  return { url: item.url, answers: raw.answers, usage: raw.usage ?? null };
}

async function serpJudge(items, config) {
  if (!config.serp?.enabled || !config.serp?.snippet) return { verdicts: {}, halted: null };
  const lang = resolveLang(config);
  const fp = configFingerprint(config, "snippet");

  const todo = items.filter((it) => /^https?:/.test(it.url || "")).slice(0, SERP.batchSize);

  const out = {};
  let cursor = 0;
  let halt = null; // レート制限・認証エラーが出たら残りは投げない
  const worker = async () => {
    while (cursor < todo.length && !halt) {
      const item = todo[cursor++];
      const key = cacheKey(item.url, fp, "snippet");
      try {
        let hit = await readCache(key);
        if (!hit) {
          hit = await judgeSnippet(item, config, lang);
          await writeCache(key, hit);
        }
        out[item.url] = toVerdict(hit, config, "snippet");
      } catch (err) {
        // 1件失敗しても他は出す。色が付かないだけで実害はない。
        // ただしレート制限とキー拒否は残り全部が同じ結果になるので、そこで止める。
        if (err?.code === "rate_limit" || err?.code === "auth") halt = err;
        out[item.url] = null;
        console.warn("[Page Verdict] snippet judge failed", item.url, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SERP.concurrency, todo.length) }, worker));
  return { verdicts: out, halted: halt ? String(halt.message) : null };
}

/* --- クリックした1件だけ本文を取りに行く ------------------------------- *
 *
 * 全件を自動で取りに行かない理由:
 *  - 開いてもいないページの全文が、検索のたびに外部へ出ることになる（設計判断4）
 *  - 自分の IP から検索ごとに数十ドメインへ自動アクセスする挙動になる
 *  - 検索結果には攻撃者が SEO で載せたページも混ざる。人間の判断を挟まずに
 *    その本文を state に入れるのは、インジェクションの的を自分で広げる
 * ユーザーが押した1件だけにすれば、どれも今までと同じ性質に戻る。
 * ------------------------------------------------------------------------ */

let offscreenPending = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  // 同時に複数走ると "Only a single offscreen document" で落ちるのでまとめる。
  if (!offscreenPending) {
    offscreenPending = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Parse a fetched search result page to extract judgement signals.",
      })
      .catch(async (err) => {
        if (!(await chrome.offscreen.hasDocument())) throw err;
      })
      .finally(() => {
        offscreenPending = null;
      });
  }
  await offscreenPending;
}

/**
 * 上限に達したら読むのをやめる。res.text() だと全部メモリに載せてから切ることになり、
 * 巨大なページや本文を垂れ流すサーバで詰まる。
 *
 * 文字コードはヘッダから取る。res.text() は常に UTF-8 で読むので、
 * Shift_JIS を宣言している日本語サイトが文字化けする。
 */
async function readCapped(res) {
  const charset = (res.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1];
  const decode = (bytes) => {
    try {
      return new TextDecoder(charset || "utf-8").decode(bytes);
    } catch {
      return new TextDecoder("utf-8").decode(bytes);
    }
  };
  if (!res.body) return decode(new Uint8Array(await res.arrayBuffer()).subarray(0, SERP.fetchMaxBytes));

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < SERP.fetchMaxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});

  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    buf.set(c, at);
    at += c.byteLength;
  }
  return decode(buf.subarray(0, SERP.fetchMaxBytes));
}

async function fetchState(url, lang) {
  const controller = new AbortController();
  // 本文を読み終えるまで止めない。ヘッダだけ即返して本文を垂れ流すサーバがあるため、
  // ここで clearTimeout すると永久に応答が返らず、チップが「取得中…」のまま固まる。
  const timer = setTimeout(() => controller.abort(), SERP.fetchTimeoutMs);
  let html;
  try {
    // Cookie は送らない。ログイン済みの中身を外に出さないため。
    const res = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw tagged(new Error(t("errFetchStatus", lang, { status: res.status })), "http");
    if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") || "")) {
      throw tagged(new Error(t("errNotHtml", lang)), "not_html");
    }
    html = await readCapped(res);
  } catch (err) {
    if (err?.code) throw err; // こちらで組み立てたエラーはそのまま出す
    throw new Error(t("errFetch", lang)); // 通信失敗・中断
  } finally {
    clearTimeout(timer);
  }

  await ensureOffscreen();
  const parsed = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "parseHtml",
    html,
    url: res.url || url,
  });
  if (!parsed?.ok || !parsed.state) throw new Error(t("errUnreadable", lang));

  // 取れた HTML がユーザーの見る画面と一致するとは限らない。同意画面や
  // スクリプトで組み立てるページを「本文」として判定すると害になるので弾く。
  if ((parsed.state.body_excerpt || "").length < SERP.fetchMinBodyChars) {
    throw new Error(t("errFetchThin", lang));
  }
  return parsed.state;
}

async function fetchJudge(url, config) {
  const lang = resolveLang(config);
  if (!config.serp?.enabled || !config.serp?.fetch) throw new Error(t("errUnsupported", lang));
  if (!/^https?:/.test(url || "")) throw new Error(t("errUnsupported", lang));

  const fp = configFingerprint(config);
  const key = cacheKey(url, fp, "fetch");
  let hit = await readCache(key);
  if (!hit) {
    const state = await fetchState(url, lang);
    const raw = await callJev(state, buildQuestions(config), lang);
    hit = {
      url,
      src: "fetch",
      answers: raw.answers,
      usage: raw.usage ?? null,
      // ポップアップで使い回すので、実訪問と同じ形にしておく。
      // 無いと「アフィリエイトリンク 0本」と嘘をつくことになる。
      signals: {
        affiliate_link_count: state.link_profile.affiliate_link_count,
        affiliate_networks: state.link_profile.affiliate_networks,
        price_mentions: state.purchase_signals.price_mentions,
        external_link_count: state.link_profile.external_link_count,
      },
    };
    await writeCache(key, hit);
  }
  return toVerdict(hit, config, "fetch");
}

// --- content script の登録 ------------------------------------------------
// 既定マニフェストには入れない。設定でオンにして許可を取ったときだけ登録する。
const SERP_SCRIPT_ID = "serp-highlight";

async function syncSerpScript() {
  const config = await loadConfig();
  const granted = await chrome.permissions.contains({ origins: SERP.origins }).catch(() => false);
  const want = !!config.serp?.enabled && granted;

  const existing = await chrome.scripting
    .getRegisteredContentScripts({ ids: [SERP_SCRIPT_ID] })
    .catch(() => []);

  if (want) {
    const def = {
      id: SERP_SCRIPT_ID,
      matches: SERP.origins,
      js: ["serp.js"],
      css: ["serp.css"],
      runAt: "document_idle",
      allFrames: false,
    };
    if (existing.length) await chrome.scripting.updateContentScripts([def]);
    else await chrome.scripting.registerContentScripts([def]);
  } else if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [SERP_SCRIPT_ID] });
  }
  return want;
}

chrome.runtime.onInstalled.addListener(syncSerpScript);
chrome.runtime.onStartup.addListener(syncSerpScript);
chrome.permissions.onAdded.addListener(syncSerpScript);
chrome.permissions.onRemoved.addListener(syncSerpScript);

// --- メッセージ -----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === "offscreen") return; // オフスクリーン文書宛。ここでは扱わない
  (async () => {
    try {
      if (msg.type === "classify") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ ok: true, data: await classifyTab(tab, { force: msg.force }) });
      } else if (msg.type === "peek") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const config = await loadConfig();
        const fp = configFingerprint(config);
        const cached = tab?.url
          ? (await readCache(cacheKey(tab.url, fp, "page"))) ??
            (await readCache(cacheKey(tab.url, fp, "fetch")))
          : null;
        sendResponse({
          ok: true,
          data: cached ? { ...cached, cached: true, source: cached.src ?? "page" } : null,
          url: tab?.url,
          config,
        });
      } else if (msg.type === "clearCache") {
        sendResponse({ ok: true, removed: await clearCache() });
      } else if (msg.type === "syncSerp") {
        sendResponse({ ok: true, active: await syncSerpScript() });
      } else if (msg.type === "serpConfig") {
        // content script に定数を持たせないため、上限もここから配る。
        const config = await loadConfig();
        const lang = resolveLang(config);
        sendResponse({
          ok: true,
          snippetMode: !!config.serp?.snippet,
          fetchMode: !!config.serp?.fetch,
          maxPerPage: SERP.maxPerPage,
          batchSize: SERP.batchSize,
          snippetChars: SERP.snippetChars,
          debounceMs: SERP.debounceMs,
          // content script に文言を持たせない
          labels: {
            check: t("serpCheck", lang),
            checking: t("serpChecking", lang),
            failed: t("serpCheckFailed", lang),
            undecided: t("undecided", lang),
            undecidedNote: t("serpUndecidedNote", lang),
          },
        });
      } else if (msg.type === "serpLookup") {
        const config = await loadConfig();
        sendResponse({
          ok: true,
          verdicts: await serpLookup(msg.urls ?? [], config),
          snippetMode: !!config.serp?.snippet,
        });
      } else if (msg.type === "serpFetch") {
        const config = await loadConfig();
        sendResponse({ ok: true, verdict: await fetchJudge(msg.url, config) });
      } else if (msg.type === "serpJudge") {
        const config = await loadConfig();
        sendResponse({ ok: true, ...(await serpJudge(msg.items ?? [], config)) });
      } else {
        // 応答しないと送信側が永久に待つ。将来 type を足したときの保険。
        sendResponse({ ok: false, error: `unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // 非同期応答
});
