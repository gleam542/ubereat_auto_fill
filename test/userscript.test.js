// 用 Playwright 在 Chromium 裡載入 userscript，對假文章與模擬結帳頁做測試。
// 執行：npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'ubereats-promo-autofill.user.js'), 'utf8');
const ARTICLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'callingtaiwan-sample.html'), 'utf8');
const MOCK_UE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-ubereats.html'), 'utf8');

const ARTICLE_URL = 'https://www.callingtaiwan.com.tw/ubereats-test-article/';
const CHECKOUT_URL = 'https://www.ubereats.com/tw/checkout';
const FIXED_NOW = Date.parse('2026-11-24T12:00:00+08:00');

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
});

/** 開一個頁面：攔截所有請求回傳測試用 HTML，並提供 GM_* 的替身。 */
async function openWithScript(url, html) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    if (route.request().url() === url) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.exposeFunction('__testFetch', (u) =>
    u.startsWith('https://www.callingtaiwan.com.tw/') ? { status: 200, text: ARTICLE } : { status: 404, text: '' }
  );
  await page.addInitScript((now) => {
    window.__UEPA_EXPOSE__ = true;
    Date.now = () => now;
    const mem = {};
    window.GM_getValue = (k) => mem[k];
    window.GM_setValue = (k, v) => {
      mem[k] = v;
    };
    window.GM_xmlhttpRequest = (opts) => {
      window.__testFetch(opts.url).then(
        (r) => opts.onload({ status: r.status, responseText: r.text }),
        () => opts.onerror && opts.onerror()
      );
    };
  }, FIXED_NOW);
  await page.goto(url);
  await page.addScriptTag({ content: SCRIPT });
  return { page, context };
}

async function setNoDelay(panel) {
  await panel.locator('details summary').click();
  await panel.locator('input.delay').fill('0');
  await panel.locator('input.delay').dispatchEvent('change');
}

const pick = (codes) => Object.fromEntries(codes.map((c) => [c.code, c]));

test('isPlausibleCode 過濾一般文字', async () => {
  const { page, context } = await openWithScript(ARTICLE_URL, ARTICLE);
  const result = await page.evaluate(() => {
    const good = ['TSIB', 'GOODCODE1', 'eats-abc123x', '多吃八折', '美食挺台的', 'NEWUSER100'];
    const bad = ['Uber', 'UberEats', 'code', 'here', '2026', '$100', 'NT199', '點此領取', '新用戶', 'https://x.com', 'a', 'ONE'];
    const f = window.__UEPA__.isPlausibleCode;
    return { good: good.filter((s) => !f(s)), bad: bad.filter((s) => f(s)) };
  });
  assert.deepEqual(result, { good: [], bad: [] });
  await context.close();
});

test('從文章擷取所有優惠碼（含過期判斷、排除留言/頁首/頁尾）', async () => {
  const { page, context } = await openWithScript(ARTICLE_URL, ARTICLE);
  const codes = await page.evaluate((now) => window.__UEPA__.extractCodes(document, { now }), FIXED_NOW);
  const byCode = pick(codes);

  assert.deepEqual(
    codes.map((c) => c.code),
    ['GOODCODE1', 'GOOD2026', '多吃八折', 'eats-abc123x', 'USEDCODE', 'OLDCODE', 'TABLECODE7', 'CLIPCODE88', '美食挺台']
  );
  assert.equal(byCode.GOODCODE1.expiry, '2026-12-31');
  assert.equal(byCode.GOODCODE1.checked, true);
  assert.equal(byCode.GOOD2026.expiry, '2027-01-31');
  assert.equal(byCode['多吃八折'].expired, true);
  assert.equal(byCode['多吃八折'].checked, false);
  assert.equal(byCode.OLDCODE.expiry, '2026-12-31');
  assert.equal(byCode['美食挺台'].confidence, 'low');
  assert.equal(byCode['美食挺台'].checked, false);
  await context.close();
});

test('extractCodes 也能吃 HTML 字串（抓取遠端文章時的路徑）', async () => {
  const { page, context } = await openWithScript(ARTICLE_URL, ARTICLE);
  const codes = await page.evaluate(
    ({ html, now }) => window.__UEPA__.extractCodes(html, { now }).map((c) => c.code),
    { html: ARTICLE, now: FIXED_NOW }
  );
  assert.equal(codes.length, 9);
  assert.ok(!codes.includes('COMMENTSPAM1'));
  assert.ok(!codes.includes('FOOTJUNK1'));
  assert.ok(!codes.includes('NAVJUNK1'));
  await context.close();
});

test('文章頁的「擷取本頁優惠碼」會把碼存起來', async () => {
  const { page, context } = await openWithScript(ARTICLE_URL, ARTICLE);
  await page.locator('#uepa-host').getByText('擷取本頁優惠碼').click();
  await page.locator('#uepa-host').getByText('擷取到 9 組').waitFor();
  const stored = await page.evaluate(() => window.__UEPA__.store.get('codes', []).map((c) => c.code));
  assert.equal(stored.length, 9);
  await context.close();
});

test('在結帳頁：抓取 → 自動打開視窗 → 逐一填入 → 判斷結果', async () => {
  const { page, context } = await openWithScript(CHECKOUT_URL, MOCK_UE);
  const panel = page.locator('#uepa-host');
  await setNoDelay(panel);

  await panel.locator('[data-act=fetch]').click();
  await panel.getByText('抓到 9 組優惠碼').waitFor();

  await panel.locator('[data-act=run]').click();
  await page.waitForFunction(() => window.__UEPA__.state.lastRun !== null, null, { timeout: 60000 });

  const codes = await page.evaluate(() => window.__UEPA__.state.codes);
  const status = Object.fromEntries(codes.map((c) => [c.code, c.status]));
  assert.deepEqual(status, {
    GOODCODE1: 'success',
    GOOD2026: 'success',
    多吃八折: 'pending', // 已過期 → 預設不勾選
    'eats-abc123x': 'fail',
    USEDCODE: 'already',
    OLDCODE: 'fail',
    TABLECODE7: 'fail',
    CLIPCODE88: 'fail',
    美食挺台: 'pending', // 低信心 → 預設不勾選
  });
  assert.match(pick(codes).OLDCODE.message, /過期/);

  const page_ = await page.evaluate(() => ({
    submitted: window.__submitted,
    applied: Array.from(document.querySelectorAll('#applied li')).map((li) => li.textContent),
    search: document.getElementById('search').value,
    note: document.getElementById('note').value,
    zip: document.getElementById('zip').value,
  }));
  assert.deepEqual(page_.submitted, ['GOODCODE1', 'GOOD2026', 'eats-abc123x', 'USEDCODE', 'OLDCODE', 'TABLECODE7', 'CLIPCODE88']);
  assert.deepEqual(page_.applied, ['GOODCODE1', 'GOOD2026']);
  assert.equal(page_.search, '');
  assert.equal(page_.note, '');
  assert.equal(page_.zip, '');

  // 再跑一次：已成功/已擁有的會被略過
  await panel.locator('[data-act=run]').click();
  await page.waitForFunction(() => window.__UEPA__.state.lastRun !== null && !window.__UEPA__.state.running, null, {
    timeout: 60000,
  });
  const resubmitted = await page.evaluate(() => window.__submitted.slice(7));
  assert.ok(!resubmitted.includes('GOODCODE1'));
  assert.ok(!resubmitted.includes('USEDCODE'));
  await context.close();
});

test('遇到「嘗試次數過多」會自動停止', async () => {
  const { page, context } = await openWithScript(CHECKOUT_URL, MOCK_UE);
  const panel = page.locator('#uepa-host');
  await setNoDelay(panel);
  await panel.locator('textarea.manual').fill('BADONE\nRATELIMIT\nGOODCODE1');
  await panel.locator('[data-act=add]').click();
  await panel.getByText('已加入 3 組').waitFor();

  await panel.locator('[data-act=run]').click();
  await page.waitForFunction(() => window.__UEPA__.state.lastRun !== null, null, { timeout: 60000 });

  const status = await page.evaluate(() => Object.fromEntries(window.__UEPA__.state.codes.map((c) => [c.code, c.status])));
  assert.deepEqual(status, { BADONE: 'fail', RATELIMIT: 'rate_limited', GOODCODE1: 'pending' });
  assert.deepEqual(await page.evaluate(() => window.__submitted), ['BADONE', 'RATELIMIT']);
  await panel.getByText('嘗試次數過多').first().waitFor();
  await context.close();
});
