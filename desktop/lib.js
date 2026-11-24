'use strict';
// 不依賴 Electron 的小工具，方便單獨測試。

const SOURCE_URL =
  'https://www.callingtaiwan.com.tw/ubereats%E5%84%AA%E6%83%A0-%E6%9C%80%E6%96%B0%E9%A4%90%E5%BB%B3%E5%A4%96%E9%80%81%E9%A6%96%E8%B3%BC%E5%84%AA%E6%83%A0%E5%BA%8F%E8%99%9F-%E6%8A%98%E6%89%A3%E7%A2%BC-%E6%8E%A8%E8%96%A6%E7%A2%BC/';
const SCRIPT_UPDATE_URL =
  'https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js';

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

/** 會注入腳本、也可以使用橋接的網站 */
function isScriptHost(host) {
  return (
    host === 'ubereats.com' ||
    host.endsWith('.ubereats.com') ||
    host === 'callingtaiwan.com.tw' ||
    host.endsWith('.callingtaiwan.com.tw')
  );
}

/** GM_xmlhttpRequest 只允許抓優惠文章的網站（對應 userscript 的 @connect） */
function isSourceUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'www.callingtaiwan.com.tw' || u.hostname === 'callingtaiwan.com.tw');
  } catch (e) {
    return false;
  }
}

function versionOf(script) {
  const m = /@version\s+(\S+)/.exec(script || '');
  return m ? m[1] : '0';
}

function compareVersions(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 拿掉 Electron 與 App 名稱的標記，讓網站把它當一般 Chrome */
function browserLikeUserAgent(ua) {
  return ua.replace(/ Electron\/\S+/, '').replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/');
}

/** 與 Android 版相同：同一頁只注入一次 */
function buildInjection(shim, script) {
  return '(function(){if(window.__uepaLoaded)return;window.__uepaLoaded=true;\n' + shim + '\n' + script + '\n})();';
}

module.exports = {
  SOURCE_URL,
  SCRIPT_UPDATE_URL,
  hostOf,
  isScriptHost,
  isSourceUrl,
  versionOf,
  compareVersions,
  browserLikeUserAgent,
  buildInjection,
};
