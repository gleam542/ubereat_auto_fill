// ==UserScript==
// @name         UberEats 優惠碼自動填入
// @namespace    https://github.com/gleam542/ubereat_auto_fill
// @version      1.3.0
// @description  從 callingtaiwan.com.tw 的 Uber Eats 優惠文章抓出所有優惠碼，並逐一自動填入 ubereats.com 的優惠碼欄位
// @homepageURL  https://github.com/gleam542/ubereat_auto_fill
// @updateURL    https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js
// @match        https://www.ubereats.com/*
// @match        https://ubereats.com/*
// @match        https://m.ubereats.com/*
// @match        https://www.callingtaiwan.com.tw/*
// @match        https://callingtaiwan.com.tw/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      www.callingtaiwan.com.tw
// @connect      callingtaiwan.com.tw
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_SOURCE =
    'https://www.callingtaiwan.com.tw/ubereats%E5%84%AA%E6%83%A0-%E6%9C%80%E6%96%B0%E9%A4%90%E5%BB%B3%E5%A4%96%E9%80%81%E9%A6%96%E8%B3%BC%E5%84%AA%E6%83%A0%E5%BA%8F%E8%99%9F-%E6%8A%98%E6%89%A3%E7%A2%BC-%E6%8E%A8%E8%96%A6%E7%A2%BC/';
  const UBER_EATS_HOME = 'https://www.ubereats.com/tw';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clock = () => performance.now();
  const normSpace = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isAscii = (s) => /^[\x20-\x7e]+$/.test(s);
  const keyOf = (code) => (isAscii(code) ? code.toUpperCase() : code);
  const escapeHtml = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ------------------------------------------------------------------ */
  /* 儲存 / 網路                                                          */
  /* ------------------------------------------------------------------ */

  const store = {
    get(key, fallback) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key);
          return v === undefined || v === null ? fallback : JSON.parse(v);
        }
      } catch (e) {
        /* fall through to localStorage */
      }
      try {
        const raw = localStorage.getItem('uepa:' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, raw);
          return;
        }
      } catch (e) {
        /* fall through */
      }
      try {
        localStorage.setItem('uepa:' + key, raw);
      } catch (e) {
        /* storage unavailable: keep in memory only */
      }
    },
  };

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      let xhr = null;
      if (typeof GM_xmlhttpRequest === 'function') xhr = GM_xmlhttpRequest;
      else if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') xhr = GM.xmlHttpRequest.bind(GM);
      if (!xhr) {
        fetch(url, { credentials: 'omit' })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
          .then(resolve, reject);
        return;
      }
      xhr({
        method: 'GET',
        url,
        timeout: 30000,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status))),
        onerror: () => reject(new Error('網路錯誤')),
        ontimeout: () => reject(new Error('連線逾時')),
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 從文章擷取優惠碼                                                      */
  /* ------------------------------------------------------------------ */

  const CODE_KW =
    '(?:優惠代碼|優惠序號|優惠碼|折扣碼|折扣序號|折價碼|序號|推薦碼|邀請碼|促銷代碼|促銷碼|兌換碼|代碼|promo\\s*code|coupon\\s*code|coupon|code)';
  const CJK_KW = '(?:優惠代碼|優惠序號|優惠碼|折扣碼|折扣序號|折價碼|序號|推薦碼|邀請碼|促銷代碼|促銷碼|兌換碼|代碼)';
  const OPEN_Q = '「『【"“＂';
  const CLOSE_Q = '」』】"”＂';

  const RE_KW_BRACKET = new RegExp(
    '(?<![A-Za-z])' + CODE_KW + '[^' + OPEN_Q + '\\n]{0,8}?[' + OPEN_Q + ']\\s*([^' + CLOSE_Q + '\\s]{2,30}?)\\s*[' + CLOSE_Q + ']',
    'gi'
  );
  const RE_INPUT_BRACKET = new RegExp('輸入\\s*[' + OPEN_Q + ']\\s*([^' + CLOSE_Q + '\\s]{2,30}?)\\s*[' + CLOSE_Q + ']', 'g');
  const RE_KW_ASCII = new RegExp(
    '(?<![A-Za-z])' + CODE_KW + '\\s*(?:為|是)?\\s*([:：])?\\s*([A-Za-z0-9][A-Za-z0-9_-]{2,29})(?![A-Za-z0-9_-])',
    'gi'
  );
  const RE_KW_CJK = new RegExp(
    CJK_KW + '\\s*(?:為|是)?\\s*[:：]\\s*([\\u3400-\\u9fffA-Za-z0-9]{2,12})(?=[\\s，,。.！!、；;）)（(]|$)',
    'g'
  );
  const RE_KW_ANY = new RegExp(CODE_KW, 'i');
  const RE_KW_BEFORE = new RegExp('(?:' + CJK_KW + '|輸入|promo\\s*code|code)\\s*(?:為|是)?\\s*[:：]?\\s*$', 'i');
  const RE_HEADER_CODE = /(優惠碼|折扣碼|序號|代碼|推薦碼|兌換碼|promo|code)/i;
  const RE_EXPIRY_HINT = /(期限|期間|到期|截止|有效|止|~|～|至)/;

  const ASCII_BLACKLIST = new Set(
    (
      'UBER UBEREATS EATS UBERONE ONE CODE CODES PROMO PROMOCODE COUPON APP IOS ANDROID LINE LINEPAY VISA JCB ' +
      'MASTER MASTERCARD AMEX PAY APPLE APPLEPAY GOOGLE GOOGLEPAY NT NTD TWD USD FAQ HTTP HTTPS WWW COM TW ' +
      'FREE NEW OFF VIP QR PDF IG FB YOUTUBE FOODPANDA PANDA'
    ).split(' ')
  );
  const CJK_GENERIC = new Set(['無', '新用戶', '新戶', '舊用戶', '舊戶', '首購', '會員', '限時', '免運', '優惠', '折扣', '推薦']);
  const CJK_NOISE = /(優惠碼|折扣碼|推薦碼|序號|代碼|點此|點我|點擊|按此|複製|連結|領取|網址|下方|以下|如下|官網|輸入|無需|不需|不用|自動套用|請見|請參考|詳見)/;

  function cleanCode(raw) {
    return String(raw || '')
      .replace(/[​-‍﻿]/g, '')
      .trim()
      .replace(/^[\s"'“”「」『』【】()（）:：]+|[\s"'“”「」『』【】()（）。，,.!！、;；:：]+$/g, '');
  }

  function isPlausibleCode(raw) {
    const s = cleanCode(raw);
    if (s.length < 2 || s.length > 30 || /\s/.test(s)) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^\$?\d+([.,/\-]\d+)*(元|%|折)?$/.test(s)) return false;
    if (/(https?|www\.|\.com|\.tw)/i.test(s)) return false;
    if (isAscii(s)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/.test(s)) return false;
      if (!/[A-Za-z]/.test(s)) return false;
      if (ASCII_BLACKLIST.has(s.toUpperCase())) return false;
      if (/^(NT|TWD|USD)\d+$/i.test(s)) return false;
      if (/\d/.test(s)) return true;
      // 沒有數字的英文碼：必須是全大寫且至少 4 字（例如 TSIB），避免抓到一般英文單字
      return s.length >= 4 && /^[A-Z_-]+$/.test(s);
    }
    if (s.length > 12) return false;
    if (!/^[㐀-鿿A-Za-z0-9]+$/.test(s)) return false;
    if (CJK_GENERIC.has(s)) return false;
    if (CJK_NOISE.test(s)) return false;
    return true;
  }

  const BLOCK_TAGS = new Set(
    'P DIV LI UL OL TABLE TR TD TH TBODY THEAD TFOOT H1 H2 H3 H4 H5 H6 BLOCKQUOTE SECTION ARTICLE FIGURE FIGCAPTION DL DT DD PRE HR HEADER FOOTER ASIDE NAV MAIN'.split(
      ' '
    )
  );
  const SCAN_SEL = 'p,li,td,th,h1,h2,h3,h4,h5,h6,dd,dt,figcaption,pre,blockquote,div,section,article';

  /** 取得元素文字，<br> 與區塊元素會變成換行。ownOnly=true 時跳過巢狀的區塊（它們會被各自掃描）。 */
  function textOf(node, ownOnly) {
    let out = '';
    (function walk(n, depth) {
      if (n.nodeType === 3) {
        out += n.nodeValue;
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
      if (tag === 'BR') {
        out += '\n';
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block && ownOnly && depth > 0) {
        out += '\n';
        return;
      }
      if (block) out += '\n';
      for (const c of n.childNodes) walk(c, depth + 1);
      if (block) out += '\n';
    })(node, 0);
    return out
      .replace(/[ \t 　]+/g, ' ')
      .replace(/ *\n[\n ]*/g, '\n')
      .trim();
  }

  function parseExpiry(text) {
    const re = /(20\d{2})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/g;
    let best = null;
    let m;
    while ((m = re.exec(String(text || '')))) {
      const y = +m[1];
      const mo = +m[2];
      const d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (!best || iso > best) best = iso;
    }
    return best;
  }

  function isExpired(isoDate, nowMs) {
    if (!isoDate) return false;
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).getTime() < nowMs;
  }

  function contentRoot(doc) {
    const sels = ['.entry-content', '.post-content', '.article-content', 'article', 'main', '#content', '#main'];
    for (const s of sels) {
      const el = doc.querySelector(s);
      if (el && normSpace(el.textContent).length > 100) return el;
    }
    return doc.body || doc.documentElement;
  }

  /**
   * 從文件（或 HTML 字串）擷取優惠碼。
   * 回傳 [{ code, context, expiry, expired, confidence, checked }]，依文章順序排列。
   */
  function extractCodes(input, opts) {
    const now = (opts && opts.now) || Date.now();
    const doc = typeof input === 'string' ? new DOMParser().parseFromString(input, 'text/html') : input;
    const root = contentRoot(doc).cloneNode(true);
    root
      .querySelectorAll(
        'script,style,noscript,template,iframe,nav,footer,aside,form,#comments,.comments-area,.comment-list,.comment,' +
          '.sharedaddy,.jp-relatedposts,.related-posts,.yarpp-related,.post-navigation,.widget,.sidebar'
      )
      .forEach((el) => el.remove());

    const order = new Map();
    order.set(root, 0);
    Array.from(root.getElementsByTagName('*')).forEach((el, i) => order.set(el, i + 1));

    const RANK = { high: 3, medium: 2, low: 1 };
    const found = new Map();

    const blockOf = (el) => (el.closest && el.closest('p,li,td,th,h1,h2,h3,h4,h5,h6,dd,dt,figcaption,pre,blockquote,div')) || root;

    const expiryNear = (lines, lineIdx, blockEl) => {
      let exp = parseExpiry(lines[lineIdx]);
      for (let i = lineIdx + 1; !exp && i <= lineIdx + 2 && i < lines.length; i++) exp = parseExpiry(lines[i]);
      if (!exp && blockEl) {
        const row = blockEl.closest && blockEl.closest('tr');
        if (row) exp = parseExpiry(textOf(row));
      }
      if (!exp && blockEl) {
        let sib = blockEl.nextElementSibling;
        for (let i = 0; !exp && sib && i < 2; i++, sib = sib.nextElementSibling) {
          const t = textOf(sib);
          if (RE_EXPIRY_HINT.test(t)) exp = parseExpiry(t);
        }
      }
      return exp;
    };

    const add = (rawCode, confidence, context, expiry, el) => {
      const code = cleanCode(rawCode);
      if (!isPlausibleCode(code)) return;
      const k = keyOf(code);
      const pos = order.has(el) ? order.get(el) : 1e9;
      const prev = found.get(k);
      if (!prev) {
        found.set(k, { code, context: normSpace(context).slice(0, 200), expiry: expiry || null, confidence, pos });
        return;
      }
      if (RANK[confidence] > RANK[prev.confidence]) prev.confidence = confidence;
      if (!prev.expiry && expiry) prev.expiry = expiry;
      if (pos < prev.pos) prev.pos = pos;
    };

    // 1) 有「複製」按鈕的屬性
    root
      .querySelectorAll('[data-clipboard-text],[data-code],[data-coupon],[data-promo],[data-copy],[data-coupon-code]')
      .forEach((el) => {
        const v =
          el.getAttribute('data-clipboard-text') ||
          el.getAttribute('data-code') ||
          el.getAttribute('data-coupon') ||
          el.getAttribute('data-coupon-code') ||
          el.getAttribute('data-promo') ||
          el.getAttribute('data-copy');
        const block = blockOf(el);
        const ctx = textOf(block);
        add(v, 'high', ctx, parseExpiry(ctx), el);
      });
    root.querySelectorAll('input[readonly][value],.coupon-code,.promo-code,.couponcode,.code-text').forEach((el) => {
      const v = el.tagName === 'INPUT' ? el.getAttribute('value') : textOf(el);
      const block = blockOf(el);
      const ctx = textOf(block);
      add(v, 'high', ctx, parseExpiry(ctx), el);
    });

    // 2) 表格中標題為「優惠碼」的欄位
    root.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) return;
      const headCells = Array.from(rows[0].children);
      const idx = headCells.findIndex((c) => RE_HEADER_CODE.test(textOf(c)));
      if (idx < 0) return;
      rows.slice(1).forEach((row) => {
        const cell = row.children[idx];
        if (!cell) return;
        const rowText = Array.from(row.children)
          .map((c) => textOf(c))
          .join(' | ');
        const exp = parseExpiry(rowText);
        textOf(cell)
          .split(/[\n、,，/／]+|\s+/)
          .forEach((tok) => add(tok, 'high', rowText, exp, cell));
      });
    });

    // 3) 文字規則：「優惠碼「XXX」」「輸入【XXX】」「折扣碼：XXX」…
    [root, ...root.querySelectorAll(SCAN_SEL)].forEach((block) => {
      const text = textOf(block, true);
      if (!text) return;
      const lines = text.split('\n');
      lines.forEach((line, li) => {
        let m;
        const exp = () => expiryNear(lines, li, block);
        RE_KW_BRACKET.lastIndex = 0;
        while ((m = RE_KW_BRACKET.exec(line))) add(m[1], 'high', line, exp(), block);
        RE_INPUT_BRACKET.lastIndex = 0;
        while ((m = RE_INPUT_BRACKET.exec(line))) add(m[1], 'high', line, exp(), block);
        RE_KW_ASCII.lastIndex = 0;
        while ((m = RE_KW_ASCII.exec(line))) add(m[2], m[1] ? 'high' : 'medium', line, exp(), block);
        RE_KW_CJK.lastIndex = 0;
        while ((m = RE_KW_CJK.exec(line))) {
          if (!isAscii(m[1])) add(m[1], 'low', line, exp(), block);
        }
      });
    });

    // 4) 粗體 / 程式碼樣式的文字，且所在段落有提到優惠碼
    root.querySelectorAll('strong,b,code,kbd,mark,em,u,span[style*="color"],span[style*="background"]').forEach((el) => {
      const t = cleanCode(textOf(el));
      if (!isPlausibleCode(t)) return;
      const block = blockOf(el);
      const blockText = textOf(block);
      const at = blockText.indexOf(t);
      const before = at >= 0 ? blockText.slice(Math.max(0, at - 14), at) : '';
      if (isAscii(t)) {
        if (!RE_KW_ANY.test(blockText)) return;
        if (!/\d/.test(t) && !RE_KW_BEFORE.test(before)) return;
      } else if (!RE_KW_BEFORE.test(before)) {
        return;
      }
      const lines = blockText.split('\n');
      const li = Math.max(0, lines.findIndex((l) => l.includes(t)));
      add(t, 'medium', lines[li] || blockText, expiryNear(lines, li, block), el);
    });

    return Array.from(found.values())
      .sort((a, b) => a.pos - b.pos)
      .map(({ pos, ...c }) => {
        const expired = isExpired(c.expiry, now);
        return { ...c, expired, checked: !expired && c.confidence !== 'low' };
      });
  }

  function looksBlocked(html) {
    return /(challenge-platform|cf-browser-verification|cf_chl_|<title>\s*Just a moment)/i.test(html);
  }

  function mergeCodes(existing, incoming) {
    const map = new Map();
    existing.forEach((c) => map.set(keyOf(c.code), c));
    let added = 0;
    incoming.forEach((f) => {
      const k = keyOf(f.code);
      const prev = map.get(k);
      if (prev) {
        Object.assign(prev, { context: f.context, expiry: f.expiry, expired: f.expired, confidence: f.confidence });
        return;
      }
      map.set(k, { status: 'pending', message: '', ...f });
      added++;
    });
    return { codes: Array.from(map.values()), added };
  }

  /* ------------------------------------------------------------------ */
  /* Uber Eats 頁面操作                                                    */
  /* ------------------------------------------------------------------ */

  const PROMO_HINT = /(promo|優惠|促銷|折扣|coupon|voucher|兌換|代碼|code)/i;
  const NOT_PROMO = /(搜尋|search|地址|address|email|郵件|電話|phone|password|密碼|姓名|備註|note|instruction|說明|外送員|zip|postal|郵遞|驗證碼|verification|otp)/i;
  const APPLY_EXACT = /^(套用|使用|新增|確認|確定|兌換|送出|儲存|完成|加入|apply|add|redeem|submit|save|confirm|done|use)$/i;
  const APPLY_LOOSE = /(套用|apply|兌換|redeem|新增|add)/i;
  const OPENER_RE = /(新增優惠碼|新增優惠|輸入優惠碼|新增促銷|促銷代碼|兌換優惠|add promo|enter promo|add a promo|promo code|redeem)/i;

  const RATE_RE = /(太多次|次數過多|過於頻繁|稍後再試|請稍後|too many|try again later|rate limit|temporarily)/i;
  const ALREADY_RE = /(已使用過|已兌換過|已經新增|已新增過|已套用過|已經套用|已領取過|already)/i;
  const FAIL_RE =
    /(無效|錯誤|過期|已結束|不符合|不適用|不可用|無法|失敗|不存在|找不到|僅限|invalid|expired|not valid|isn't valid|is not valid|not eligible|ineligible|unable|error|couldn't|could not|can't|cannot|not found|doesn't exist|does not exist|only for|not available)/i;
  const SUCCESS_RE = /(已套用|已新增|已加入|已兌換|套用成功|新增成功|兌換成功|成功|applied|added|success|redeemed|saved|you've got|you got|enjoy)/i;
  const RELEVANT_SEL =
    '[role="alert"],[role="status"],[aria-live],[data-baseweb="toast"],[data-baseweb="notification"],[data-baseweb="snackbar-element"],[data-baseweb="form-control-caption"]';

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  const isDisabled = (el) => !!el.disabled || el.getAttribute('aria-disabled') === 'true';
  const labelOf = (el) =>
    normSpace(el.value && el.tagName === 'INPUT' && el.type === 'submit' ? el.value : el.getAttribute('aria-label') || el.textContent);

  function describeInput(el) {
    const parts = [
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('name'),
      el.id,
      el.getAttribute('data-testid'),
    ];
    if (el.labels) Array.from(el.labels).forEach((l) => parts.push(l.textContent));
    const by = el.getAttribute('aria-labelledby');
    if (by)
      by.split(/\s+/).forEach((id) => {
        const t = document.getElementById(id);
        if (t) parts.push(t.textContent);
      });
    return parts.filter(Boolean).join(' ');
  }

  function makeLocator(el) {
    const id = el.id && !/[:]/.test(el.id) ? el.id : '';
    return {
      tag: el.tagName.toLowerCase(),
      id,
      name: el.getAttribute('name') || '',
      placeholder: el.getAttribute('placeholder') || '',
      aria: el.getAttribute('aria-label') || '',
      testid: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
      text: el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? '' : normSpace(el.textContent).slice(0, 30),
    };
  }

  function matchLocator(loc, selector, scope) {
    if (!loc) return null;
    let best = null;
    let bestScore = 0;
    (scope || document).querySelectorAll(selector).forEach((el) => {
      if (!isVisible(el)) return;
      let s = 0;
      const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || '';
      if (loc.testid && testid === loc.testid) s += 5;
      if (loc.id && el.id === loc.id) s += 4;
      if (loc.name && el.getAttribute('name') === loc.name) s += 3;
      if (loc.placeholder && el.getAttribute('placeholder') === loc.placeholder) s += 3;
      if (loc.aria && el.getAttribute('aria-label') === loc.aria) s += 3;
      if (loc.text && normSpace(el.textContent) === loc.text) s += 3;
      if (s > bestScore) {
        best = el;
        bestScore = s;
      }
    });
    return best;
  }

  function findPromoInput() {
    const taught = matchLocator(store.get('locator.input', null), 'input,textarea');
    if (taught) return taught;
    let best = null;
    let bestScore = 0;
    document.querySelectorAll('input,textarea').forEach((el) => {
      if (!isVisible(el) || el.disabled || el.readOnly) return;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (el.tagName === 'INPUT' && !['text', 'search', 'tel'].includes(type)) return;
      const d = describeInput(el);
      let score = 0;
      if (NOT_PROMO.test(d)) score -= 20;
      else if (PROMO_HINT.test(d)) score += 10;
      const dialog = el.closest('[role="dialog"],[aria-modal="true"]');
      if (dialog) {
        score += 3;
        if (PROMO_HINT.test(normSpace(dialog.textContent).slice(0, 400))) score += 5;
      }
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return bestScore >= 8 ? best : null;
  }

  function scopeOf(input) {
    const s = input.closest('[role="dialog"],[aria-modal="true"],form');
    if (s) return s;
    let el = input;
    for (let i = 0; i < 5 && el.parentElement; i++) el = el.parentElement;
    return el;
  }

  function findApplyButton(input) {
    const scope = scopeOf(input);
    const taught = matchLocator(store.get('locator.button', null), 'button,[role="button"],input[type="submit"],a', document);
    if (taught) return taught;
    const buttons = Array.from(scope.querySelectorAll('button,[role="button"],input[type="submit"]')).filter(isVisible);
    let btn = buttons.find((b) => APPLY_EXACT.test(labelOf(b)));
    if (!btn) btn = buttons.find((b) => APPLY_LOOSE.test(labelOf(b)) && labelOf(b).length <= 12);
    if (!btn) btn = buttons.find((b) => (b.getAttribute('type') || '').toLowerCase() === 'submit');
    return btn || null;
  }

  function findOpener() {
    const els = document.querySelectorAll('button,[role="button"],a');
    for (const el of els) {
      if (!isVisible(el)) continue;
      const t = labelOf(el);
      if (t && t.length <= 30 && OPENER_RE.test(t)) return el;
    }
    return null;
  }

  /** 用原生 setter 設值，React 之類的受控輸入框才會收到變更 */
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    if (el.form && typeof el.form.requestSubmit === 'function') {
      try {
        el.form.requestSubmit();
      } catch (e) {
        /* ignore */
      }
    }
  }

  async function waitFor(fn, timeoutMs, shouldAbort) {
    const end = clock() + timeoutMs;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (clock() > end || (shouldAbort && shouldAbort())) return null;
      await sleep(200);
    }
  }

  /** 監看頁面新出現的文字（錯誤訊息、toast 等） */
  function watchMessages(scope, code) {
    const texts = [];
    const codeKey = code.toUpperCase();
    const consider = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el) return;
      const text = normSpace(node.nodeType === 1 ? node.innerText || node.textContent : node.textContent);
      if (text.length < 2 || text.length > 300) return;
      const relevant = scope.contains(el) || !!el.closest(RELEVANT_SEL) || text.toUpperCase().includes(codeKey);
      if (relevant && !texts.includes(text)) texts.push(text);
    };
    const obs = new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === 'characterData') consider(m.target);
        m.addedNodes.forEach(consider);
      });
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    return { texts, stop: () => obs.disconnect() };
  }

  function classify(texts) {
    for (const t of texts) if (RATE_RE.test(t)) return { status: 'rate_limited', message: t };
    for (const t of texts) if (ALREADY_RE.test(t)) return { status: 'already', message: t };
    for (const t of texts) if (FAIL_RE.test(t)) return { status: 'fail', message: t };
    for (const t of texts) if (SUCCESS_RE.test(t)) return { status: 'success', message: t };
    return null;
  }

  async function waitOutcome(input, watcher, timeoutMs) {
    const end = clock() + timeoutMs;
    let goneAt = 0;
    while (clock() < end) {
      await sleep(200);
      const verdict = classify(watcher.texts);
      if (verdict) return verdict;
      if (!isVisible(input)) {
        if (!goneAt) goneAt = clock();
        else if (clock() - goneAt > 1000) return { status: 'success', message: '輸入框已關閉（推測已套用）' };
      }
    }
    const tail = watcher.texts.slice(-3).join(' / ');
    return { status: 'unknown', message: tail ? '無法判斷：' + tail : '等待逾時，沒有看到任何回應訊息' };
  }

  async function ensureInput(onWaiting, shouldAbort) {
    let input = findPromoInput();
    if (input) return input;
    const opener = findOpener();
    if (opener) {
      opener.click();
      input = await waitFor(findPromoInput, 4000, shouldAbort);
      if (input) return input;
    }
    if (onWaiting) onWaiting();
    return waitFor(findPromoInput, 120000, shouldAbort);
  }

  async function applyOne(code, opts) {
    const o = opts || {};
    const input = await ensureInput(o.onWaiting, o.shouldAbort);
    if (!input) return { status: 'error', message: '找不到優惠碼輸入框', fatal: true };

    input.focus();
    setNativeValue(input, '');
    setNativeValue(input, code);
    await sleep(250);

    const btn = await waitFor(
      () => {
        const b = findApplyButton(input);
        return b && !isDisabled(b) ? b : null;
      },
      3000,
      o.shouldAbort
    );

    const watcher = watchMessages(scopeOf(input), code);
    try {
      if (btn) btn.click();
      else pressEnter(input);
      return await waitOutcome(input, watcher, o.timeoutMs || 10000);
    } finally {
      watcher.stop();
      if (input.isConnected) {
        try {
          setNativeValue(input, '');
        } catch (e) {
          /* ignore */
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 面板 UI                                                              */
  /* ------------------------------------------------------------------ */

  const STATUS_LABEL = {
    pending: '待填入',
    running: '填入中…',
    success: '✅ 成功',
    already: '⚠️ 已擁有/已用過',
    fail: '❌ 失敗',
    unknown: '❓ 無法判斷',
    error: '⛔ 錯誤',
    rate_limited: '⏸ 嘗試過多',
  };

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 370px; max-width: calc(100vw - 32px); max-height: 78vh;
      display: flex; flex-direction: column; box-sizing: border-box; background: #fff; color: #161616; border: 1px solid #d9d9d9; border-radius: 12px;
      box-shadow: 0 10px 32px rgba(0,0,0,.2); z-index: 2147483647; overflow: hidden;
      font: 13px/1.45 -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #161616; color: #fff; }
    header b { flex: 1; min-width: 0; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .count, .mini { font-size: 12px; white-space: nowrap; }
    .mini { display: none; color: #ffd27a; }
    .panel.min .mini { display: inline; }
    header button { background: transparent; color: #fff; border: 1px solid #555; padding: 2px 9px; }
    .body { padding: 10px 12px 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
    .panel.min .body { display: none; }
    button { font: inherit; border: 1px solid #c8c8c8; background: #f5f5f5; color: #161616; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    button:hover:not(:disabled) { background: #ebebeb; }
    button.primary { background: #0a8a4a; border-color: #0a8a4a; color: #fff; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #087a41; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input[type=text], input[type=number], textarea { font: inherit; color: inherit; background: #fff; border: 1px solid #c8c8c8; border-radius: 8px; padding: 6px 8px; box-sizing: border-box; }
    input.src, textarea { width: 100%; }
    textarea { min-height: 64px; resize: vertical; }
    input.delay { width: 64px; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .status { background: #f1f6f3; border-radius: 8px; padding: 7px 9px; white-space: pre-wrap; }
    .summary { color: #555; font-size: 12px; }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .item { display: grid; grid-template-columns: auto 1fr auto; gap: 2px 8px; align-items: center; padding: 6px 8px; border: 1px solid #ececec; border-radius: 8px; }
    .item.expired code { text-decoration: line-through; color: #888; }
    .item code { font: 600 13px/1.3 ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
    .item .ctx, .item .msg { grid-column: 2 / 4; color: #666; font-size: 12px; }
    .item .msg { color: #333; }
    .tags { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: middle; }
    .tag, .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eee; white-space: nowrap; font-weight: 400; }
    .tag.warn { background: #fdeccf; color: #7a4b00; }
    .badge.s-success { background: #dcf3e6; color: #05683a; }
    .badge.s-fail, .badge.s-error { background: #fde2e1; color: #a11b12; }
    .badge.s-already, .badge.s-rate_limited { background: #fdeccf; color: #7a4b00; }
    .badge.s-running { background: #dde9fb; color: #1a4fa0; }
    details { border-top: 1px solid #eee; padding-top: 6px; }
    summary { cursor: pointer; color: #333; }
    details .row { margin-top: 6px; }
    a { color: #0a6b3a; }
    /* 手機：貼齊底部、最多佔半個螢幕 */
    @media (max-width: 600px) {
      .panel { left: 8px; right: 8px; bottom: 8px; width: auto; max-width: none; max-height: 50vh; }
      header { padding: 8px 10px; }
      header b { font-size: 13px; }
      button { padding: 8px 10px; }
    }
  `;

  function createShadowHost() {
    const existing = document.getElementById('uepa-host');
    if (existing) existing.remove();
    const host = document.createElement('div');
    host.id = 'uepa-host';
    const root = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
    return { host, root };
  }

  const state = {
    codes: [],
    running: false,
    stopRequested: false,
    lastRun: null,
    settings: { source: DEFAULT_SOURCE, delaySec: 3, skipDone: true, minimized: false },
  };

  function loadState() {
    state.codes = store.get('codes', []);
    state.settings = Object.assign({}, state.settings, store.get('settings', {}));
  }
  const saveCodes = () => store.set('codes', state.codes);
  const saveSettings = () => store.set('settings', state.settings);

  function mountUberPanel() {
    loadState();
    const { host, root } = createShadowHost();
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="panel ${state.settings.minimized ? 'min' : ''}">
        <header><b>Uber Eats 優惠碼自動填入</b><span class="count"></span><span class="mini"></span><button data-act="min" title="縮小/展開">–</button></header>
        <div class="body">
          <input class="src" type="text" spellcheck="false" title="優惠碼來源網址">
          <div class="row">
            <button data-act="fetch">① 抓取優惠碼</button>
            <button data-act="run" class="primary">② 開始填入</button>
            <button data-act="stop" disabled>停止</button>
          </div>
          <div class="status"></div>
          <div class="summary"></div>
          <div class="list"></div>
          <details>
            <summary>手動新增 / 設定</summary>
            <textarea class="manual" placeholder="一行一個優惠碼，也可以貼上整段文章"></textarea>
            <div class="row"><button data-act="add">加入清單</button><button data-act="all">全選</button><button data-act="none">全不選</button><button data-act="reset">重設狀態</button><button data-act="clear">清空清單</button></div>
            <div class="row"><label>每組間隔 <input class="delay" type="number" min="0" step="0.5"> 秒</label>
              <label><input class="skipdone" type="checkbox"> 略過已成功/已擁有的</label></div>
            <div class="row"><span>自動找不到欄位時：</span><button data-act="teach-input">指定輸入框</button><button data-act="teach-button">指定套用按鈕</button><button data-act="untaught">清除指定</button></div>
          </details>
        </div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const panel = $('.panel');
    const setStatus = (msg) => {
      $('.status').textContent = msg;
    };
    // 需要使用者點頁面時先把面板縮小（手機上面板會蓋住頁面），之後再恢復
    const peek = (hint) => {
      panel.classList.add('min');
      $('.mini').textContent = hint;
    };
    const unpeek = () => {
      panel.classList.toggle('min', !!state.settings.minimized);
      $('.mini').textContent = '';
    };

    $('.src').value = state.settings.source;
    $('.delay').value = state.settings.delaySec;
    $('.skipdone').checked = state.settings.skipDone;

    function render() {
      const list = $('.list');
      list.innerHTML = state.codes
        .map((c, i) => {
          const tags = [];
          if (c.expired) tags.push(`<span class="tag warn">已過期${c.expiry ? ' ' + escapeHtml(c.expiry) : ''}</span>`);
          else if (c.expiry) tags.push(`<span class="tag">至 ${escapeHtml(c.expiry)}</span>`);
          if (c.confidence === 'low') tags.push('<span class="tag warn">可能不是優惠碼</span>');
          return `<label class="item ${c.expired ? 'expired' : ''}">
            <input type="checkbox" data-idx="${i}" ${c.checked ? 'checked' : ''}>
            <span><code>${escapeHtml(c.code)}</code><span class="tags">${tags.join('')}</span></span>
            <span class="badge s-${escapeHtml(c.status || 'pending')}">${escapeHtml(STATUS_LABEL[c.status || 'pending'] || c.status)}</span>
            ${c.message ? `<span class="msg">${escapeHtml(c.message)}</span>` : ''}
            ${c.context ? `<span class="ctx" title="${escapeHtml(c.context)}">${escapeHtml(c.context.slice(0, 90))}${c.context.length > 90 ? '…' : ''}</span>` : ''}
          </label>`;
        })
        .join('');
      const n = (s) => state.codes.filter((c) => c.status === s).length;
      const selected = state.codes.filter((c) => c.checked).length;
      $('.count').textContent = state.codes.length ? `已選 ${selected}/${state.codes.length}` : '';
      $('.summary').textContent = state.codes.length
        ? `共 ${state.codes.length} 組，已勾選 ${selected} 組｜成功 ${n('success')}・已擁有 ${n('already')}・失敗 ${n('fail')}・無法判斷 ${n('unknown')}`
        : '';
      $('[data-act=run]').disabled = state.running;
      $('[data-act=fetch]').disabled = state.running;
      $('[data-act=stop]').disabled = !state.running;
    }

    async function doFetch() {
      const url = $('.src').value.trim() || DEFAULT_SOURCE;
      state.settings.source = url;
      saveSettings();
      setStatus('正在下載文章…');
      try {
        const html = await fetchText(url);
        const found = extractCodes(html, { now: Date.now() });
        if (!found.length) {
          setStatus(
            looksBlocked(html)
              ? '來源網站擋下了自動下載（防機器人驗證）。\n請直接打開該文章頁面，按右下角「擷取本頁優惠碼」，再回到這裡。'
              : '文章裡沒找到優惠碼。可以打開文章頁面按「擷取本頁優惠碼」，或在「手動新增」貼上。'
          );
          return;
        }
        const { codes, added } = mergeCodes(state.codes, found);
        state.codes = codes;
        saveCodes();
        const expired = found.filter((c) => c.expired).length;
        setStatus(
          `抓到 ${found.length} 組優惠碼（新增 ${added} 組${expired ? `，其中 ${expired} 組已過期、預設不勾選` : ''}）。\n` +
            '請檢查勾選，然後按「② 開始填入」。'
        );
      } catch (e) {
        setStatus(`下載失敗：${e.message}\n可以直接打開文章頁面，按右下角「擷取本頁優惠碼」。`);
      }
      render();
    }

    async function doRun() {
      const queue = state.codes.filter(
        (c) => c.checked && !(state.settings.skipDone && (c.status === 'success' || c.status === 'already'))
      );
      if (!queue.length) {
        setStatus('沒有要填入的優惠碼（請先抓取或勾選）。');
        return;
      }
      state.running = true;
      state.stopRequested = false;
      state.lastRun = null;
      render();
      const delayMs = Math.max(0, Number(state.settings.delaySec) || 0) * 1000;
      let unknownStreak = 0;
      let stopReason = '';
      for (let i = 0; i < queue.length; i++) {
        if (state.stopRequested) {
          stopReason = '已手動停止。';
          break;
        }
        const item = queue[i];
        item.status = 'running';
        item.message = '';
        setStatus(`(${i + 1}/${queue.length}) 正在填入 ${item.code} …`);
        $('.mini').textContent = `填入中 ${i + 1}/${queue.length}`;
        render();
        const r = await applyOne(item.code, {
          shouldAbort: () => state.stopRequested,
          onWaiting: () => {
            setStatus(
              '找不到優惠碼輸入框。\n請手動打開「新增優惠碼」視窗（結帳頁的「新增優惠碼」，或左上選單 →「優惠」），偵測到後會自動繼續…'
            );
            peek('請打開「新增優惠碼」');
          },
        });
        item.status = r.status;
        item.message = r.message || '';
        // 失敗的碼自動取消勾選，下次不會再試（想重試可以手動勾回去）
        if (r.status === 'fail') item.checked = false;
        item.time = Date.now();
        saveCodes();
        render();
        if (r.status === 'rate_limited') {
          stopReason = 'Uber Eats 回應嘗試次數過多，已自動停止，請過一段時間再繼續。';
          break;
        }
        if (r.fatal) {
          stopReason = state.stopRequested ? '已手動停止。' : '找不到優惠碼輸入框，已停止。可以用「指定輸入框」手動指定。';
          if (state.stopRequested) item.status = 'pending';
          break;
        }
        unknownStreak = r.status === 'unknown' ? unknownStreak + 1 : 0;
        if (unknownStreak >= 3) {
          stopReason = '連續 3 組都無法判斷結果，已停止。頁面結構可能不同，請用「指定輸入框 / 指定套用按鈕」後再試。';
          break;
        }
        if (i < queue.length - 1 && delayMs) await sleep(delayMs + Math.random() * 500);
      }
      state.running = false;
      state.lastRun = { at: Date.now(), reason: stopReason };
      unpeek();
      saveCodes();
      const ok = queue.filter((c) => c.status === 'success').length;
      const failed = queue.filter((c) => c.status === 'fail').length;
      setStatus(
        `${stopReason ? stopReason + '\n' : '全部填完！\n'}本次成功 ${ok} 組` +
          (failed ? `，失敗的 ${failed} 組已自動取消勾選（想重試可以再勾回去）` : '') +
          '。\n點優惠碼下方的訊息可以看到 Uber Eats 的回應。'
      );
      render();
    }

    function teach(kind) {
      setStatus(kind === 'input' ? '請在頁面上點一下「優惠碼輸入框」…' : '請在頁面上點一下「套用」按鈕…');
      peek(kind === 'input' ? '請點優惠碼輸入框' : '請點套用按鈕');
      const handler = (e) => {
        if (e.composedPath().includes(host)) return;
        const sel = kind === 'input' ? 'input,textarea' : 'button,[role="button"],input[type="submit"],a';
        const el = e.target.closest && e.target.closest(sel);
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('click', handler, true);
        store.set('locator.' + kind, makeLocator(el));
        unpeek();
        setStatus(kind === 'input' ? '已記住輸入框。' : '已記住套用按鈕。');
      };
      document.addEventListener('click', handler, true);
    }

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'min') {
        state.settings.minimized = !state.settings.minimized;
        panel.classList.toggle('min', state.settings.minimized);
        saveSettings();
      } else if (act === 'fetch') doFetch();
      else if (act === 'run') doRun();
      else if (act === 'stop') {
        state.stopRequested = true;
        setStatus('會在目前這組完成後停止…');
      } else if (act === 'add') {
        const text = $('.manual').value;
        const lines = text.split('\n').map(cleanCode).filter(Boolean);
        // 一行一個碼 → 直接加入；否則當成文章內容去擷取
        const simpleList = lines.length > 0 && lines.every((l) => l.length >= 2 && l.length <= 30 && !/\s/.test(l));
        const found = simpleList
          ? lines.map((code) => ({ code, context: '手動新增', expiry: null, expired: false, confidence: 'high', checked: true }))
          : extractCodes(`<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`, { now: Date.now() });
        const { codes, added } = mergeCodes(state.codes, found);
        state.codes = codes;
        saveCodes();
        $('.manual').value = '';
        setStatus(`已加入 ${added} 組。`);
        render();
      } else if (act === 'all' || act === 'none') {
        state.codes.forEach((c) => (c.checked = act === 'all'));
        saveCodes();
        render();
      } else if (act === 'reset') {
        state.codes.forEach((c) => {
          c.status = 'pending';
          c.message = '';
        });
        saveCodes();
        render();
      } else if (act === 'clear') {
        if (state.running) return;
        state.codes = [];
        saveCodes();
        render();
      } else if (act === 'teach-input') teach('input');
      else if (act === 'teach-button') teach('button');
      else if (act === 'untaught') {
        store.set('locator.input', null);
        store.set('locator.button', null);
        setStatus('已清除手動指定，改回自動偵測。');
      }
    });

    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('input[data-idx]')) {
        const c = state.codes[Number(t.getAttribute('data-idx'))];
        if (c) c.checked = t.checked;
        saveCodes();
        render();
      } else if (t.matches('.delay')) {
        state.settings.delaySec = Math.max(0, Number(t.value) || 0);
        saveSettings();
      } else if (t.matches('.skipdone')) {
        state.settings.skipDone = t.checked;
        saveSettings();
      } else if (t.matches('.src')) {
        state.settings.source = t.value.trim() || DEFAULT_SOURCE;
        saveSettings();
      }
    });

    // 在別的分頁擷取過優惠碼，回到這個分頁時同步
    window.addEventListener('focus', () => {
      if (state.running) return;
      state.codes = store.get('codes', state.codes);
      render();
    });

    setStatus(
      state.codes.length
        ? '已載入上次的優惠碼清單。按「② 開始填入」，或先「① 抓取優惠碼」更新。'
        : '步驟：按「① 抓取優惠碼」→ 檢查勾選 → 按「② 開始填入」。\n（會自動嘗試打開「新增優惠碼」視窗；打不開時會請你手動打開）'
    );
    render();
  }

  function mountSourcePanel() {
    const path = decodeURIComponent(location.pathname).toLowerCase();
    if (!/uber\s*eats|ubereats/i.test(path + ' ' + document.title)) return;
    const { root } = createShadowHost();
    root.innerHTML = `
      <style>${CSS} .panel { width: 300px; }</style>
      <div class="panel">
        <header><b>Uber Eats 優惠碼自動填入</b></header>
        <div class="body">
          <button data-act="grab" class="primary">擷取本頁優惠碼</button>
          <div class="status">按下按鈕後，優惠碼會存起來，再到 ubereats.com 開始填入。</div>
          <div class="list"></div>
        </div>
      </div>`;
    root.querySelector('[data-act=grab]').addEventListener('click', () => {
      const found = extractCodes(document, { now: Date.now() });
      const { codes, added } = mergeCodes(store.get('codes', []), found);
      store.set('codes', codes);
      const status = root.querySelector('.status');
      status.innerHTML = `擷取到 ${found.length} 組（新增 ${added} 組）。<br><a href="${UBER_EATS_HOME}" target="_blank" rel="noopener">前往 Uber Eats 開始填入 →</a>`;
      root.querySelector('.list').innerHTML = found
        .map(
          (c) =>
            `<div class="item ${c.expired ? 'expired' : ''}"><span></span><code>${escapeHtml(c.code)}</code><span class="badge">${
              c.expired ? '已過期' : c.confidence === 'low' ? '待確認' : '可用'
            }</span></div>`
        )
        .join('');
    });
  }

  function main() {
    const host = location.hostname;
    if (/(^|\.)ubereats\.com$/.test(host)) mountUberPanel();
    else if (/(^|\.)callingtaiwan\.com\.tw$/.test(host)) mountSourcePanel();
  }

  const api = {
    extractCodes,
    isPlausibleCode,
    parseExpiry,
    mergeCodes,
    findPromoInput,
    findApplyButton,
    applyOne,
    classify,
    state,
    store,
  };
  try {
    if (window.__UEPA_EXPOSE__) window.__UEPA__ = api;
  } catch (e) {
    /* ignore */
  }

  main();
})();
