/**
 * fetch した HTML をパースするためだけのオフスクリーン文書。
 *
 * MV3 の service worker には DOMParser が無い。正規表現で代用すると精度が落ちるので、
 * ここで本物の Document を作り、タブに注入するのと同じ extractPageSignals を通す。
 * 抽出ロジックを2つ持たないための構成。
 */
import { extractPageSignals } from "./extract.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return; // background 宛のメッセージは無視する
  if (msg.type !== "parseHtml") return;

  try {
    const doc = new DOMParser().parseFromString(msg.html, "text/html");
    sendResponse({ ok: true, state: extractPageSignals(doc, msg.url) });
  } catch (err) {
    sendResponse({ ok: false, error: String(err?.message || err) });
  }
  return true;
});
