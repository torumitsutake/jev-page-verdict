import { extractPageSignals } from "./extract.js";
import {
  API_URL,
  MODEL,
  buildQuestions,
  loadConfig,
  configFingerprint,
  resolveGenres,
  CONFIDENCE,
} from "./questions.js";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const CACHE_MAX_ENTRIES = 600;
const CACHE_PREFIX = "c2:";

// --- キャッシュ -----------------------------------------------------------
// ラベル構成を変えたら過去の判定は意味が変わる。fingerprint をキーに混ぜて、
// 構成が変われば自然に別エントリになるようにしている（古いものは TTL で消える）。
function cacheKey(url, fp) {
  try {
    const u = new URL(url);
    return `${CACHE_PREFIX}${fp}:${u.origin}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return `${CACHE_PREFIX}${fp}:${url}`;
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
async function callJev(state, config) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("APIキーが未設定です。設定画面で登録してください。");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state, questions: buildQuestions(config) }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Jev が15秒以内に応答しませんでした。");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) throw new Error("APIキーが拒否されました。");
  if (res.status === 429) throw new Error("レート制限に達しました。少し待って再試行してください。");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Jev エラー ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.json();
}

// --- 判定本体 -------------------------------------------------------------
async function classifyTab(tab, { force = false } = {}) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("このページは判定できません。");

  const config = await loadConfig();
  const fp = configFingerprint(config);
  const key = cacheKey(tab.url, fp);

  if (!force) {
    const cached = await readCache(key);
    if (cached) {
      await paintBadge(tab.id, cached, config);
      return { ...cached, cached: true, config };
    }
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPageSignals,
  });
  const state = injection?.result;
  if (!state) throw new Error("ページの内容を読み取れませんでした。");

  const raw = await callJev(state, config);
  const result = {
    url: tab.url,
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
  return { ...result, cached: false, config };
}

// --- バッジ ---------------------------------------------------------------
// 色は「売る気があるか」の一次元に割り当てる。ラベルを増やしても色は増やさない。
const SELLING = new Set(["commerce", "affiliate", "ecommerce", "recruiting"]);
const FIRSTHAND = new Set(["experience", "discussion", "creative", "opinion"]);

function badgeColor(key) {
  if (SELLING.has(key)) return "#b4341f";
  if (FIRSTHAND.has(key)) return "#2f7a4e";
  if (key === "lowquality") return "#8a6d1f";
  if (key === "other" || !key) return "#6b6b6b";
  return "#33566e";
}

async function paintBadge(tabId, result, config) {
  const g = result.answers?.genre;
  const known = g && g.confidence >= CONFIDENCE.hint;
  const ja = known ? resolveGenres(config)[g.choice]?.ja ?? "?" : "?";
  try {
    await chrome.action.setBadgeText({ tabId, text: ja.slice(0, 2) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor(known ? g.choice : null) });
  } catch {
    /* タブが閉じられた場合など */
  }
}

// --- メッセージ -----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "classify") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        sendResponse({ ok: true, data: await classifyTab(tab, { force: msg.force }) });
      } else if (msg.type === "peek") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const config = await loadConfig();
        const cached = tab?.url ? await readCache(cacheKey(tab.url, configFingerprint(config))) : null;
        sendResponse({
          ok: true,
          data: cached ? { ...cached, cached: true } : null,
          url: tab?.url,
          config,
        });
      } else if (msg.type === "clearCache") {
        sendResponse({ ok: true, removed: await clearCache() });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // 非同期応答
});
