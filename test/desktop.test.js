// 電腦版（Electron）測試。
// - lib.js 的單元測試：不需要 Electron。
// - 端對端測試：需要先在 desktop/ 執行 npm install；Linux 沒有螢幕時請用 xvfb-run 執行。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DESKTOP = path.join(ROOT, 'desktop');
const lib = require(path.join(DESKTOP, 'lib.js'));
const SCRIPT = fs.readFileSync(path.join(ROOT, 'ubereats-promo-autofill.user.js'), 'utf8');
const ARTICLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'callingtaiwan-sample.html'), 'utf8');
const MOCK_UE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mock-ubereats.html'), 'utf8');

describe('desktop/lib.js', () => {
  test('只在 Uber Eats 與優惠文章網站注入；只允許抓優惠文章', () => {
    assert.ok(lib.isScriptHost('www.ubereats.com'));
    assert.ok(lib.isScriptHost('ubereats.com'));
    assert.ok(lib.isScriptHost('www.callingtaiwan.com.tw'));
    assert.ok(!lib.isScriptHost('auth.uber.com'));
    assert.ok(!lib.isScriptHost('evilubereats.com'));
    assert.ok(lib.isSourceUrl(lib.SOURCE_URL));
    assert.ok(!lib.isSourceUrl('http://www.callingtaiwan.com.tw/'));
    assert.ok(!lib.isSourceUrl('https://example.com/'));
    assert.ok(!lib.isSourceUrl('not a url'));
  });

  test('版本比較', () => {
    assert.equal(lib.versionOf(SCRIPT), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
    assert.equal(lib.compareVersions('1.10.0', '1.9.9'), 1);
    assert.equal(lib.compareVersions('1.3.0', '1.3'), 0);
    assert.equal(lib.compareVersions('1.2.9', '1.3.0'), -1);
  });

  test('User-Agent 拿掉 Electron 與 App 名稱', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ubereat_auto_fill/1.3.0 Chrome/140.0.0.0 Electron/45.2.3 Safari/537.36';
    assert.equal(
      lib.browserLikeUserAgent(ua),
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    );
  });

});

const electronBinary = (() => {
  try {
    const p = require(path.join(DESKTOP, 'node_modules', 'electron'));
    return fs.existsSync(p) ? p : null;
  } catch (e) {
    return null;
  }
})();
const skipReason = !electronBinary
  ? '先在 desktop/ 執行 npm install'
  : process.platform === 'linux' && !process.env.DISPLAY
    ? '沒有螢幕：請用 xvfb-run 執行'
    : false;

describe('電腦版 App（Electron）', { skip: skipReason }, () => {
  const { _electron: electron } = require('playwright');

  async function launch(userData) {
    const app = await electron.launch({
      executablePath: electronBinary,
      args: [DESKTOP, '--no-sandbox'],
      env: { ...process.env, UEPA_START_URL: 'about:blank', UEPA_USER_DATA: userData },
    });
    // 攔截 App 內的所有 https 請求：Uber Eats → 模擬結帳頁、優惠文章 → 假文章
    await app.evaluate(
      ({ session }, { mock, article }) => {
        session.fromPartition('persist:ubereats').protocol.handle('https', (req) => {
          const host = new URL(req.url).hostname;
          const html = { headers: { 'content-type': 'text/html; charset=utf-8' } };
          if (host === 'www.ubereats.com') return new Response(mock, html);
          if (host === 'www.callingtaiwan.com.tw') return new Response(article, html);
          return new Response('<p>other site</p>', html);
        });
      },
      { mock: MOCK_UE, article: ARTICLE }
    );
    const win = await app.firstWindow();
    return { app, win };
  }

  const readStore = (userData) => JSON.parse(fs.readFileSync(path.join(userData, 'uepa-store.json'), 'utf8'));

  test('注入腳本、經由主程序抓文章、填入、重開後結果還在', async () => {
    execFileSync(process.execPath, [path.join(DESKTOP, 'scripts', 'copy-assets.js')]);
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uepa-desktop-'));

    let { app, win } = await launch(userData);
    try {
      await win.goto('https://www.ubereats.com/tw/checkout');
      const panel = win.locator('#uepa-host');
      await panel.locator('.panel').waitFor();
      assert.doesNotMatch(await win.evaluate(() => navigator.userAgent), /Electron/);

      await panel.locator('details summary').click();
      await panel.locator('input.delay').fill('0');
      await panel.locator('input.delay').dispatchEvent('change');

      // ① 抓取：GM_xmlhttpRequest → preload → 主程序 session.fetch → 回呼
      await panel.locator('[data-act=fetch]').click();
      await panel.getByText('抓到 9 組優惠碼').waitFor();
      assert.equal(JSON.parse(readStore(userData).codes).length, 9);

      // 只勾兩組，避免測試結果跟今天日期有關
      await panel.locator('[data-act=none]').click();
      await panel.locator('label.item', { hasText: 'GOODCODE1' }).locator('input[type=checkbox]').check();
      await panel.locator('label.item', { hasText: 'OLDCODE' }).locator('input[type=checkbox]').check();
      await panel.locator('[data-act=run]').click();
      await panel.getByText('本次成功 1 組').waitFor({ timeout: 60000 });
      assert.deepEqual(await win.evaluate(() => window.__submitted), ['GOODCODE1', 'OLDCODE']);

      // 其他網站拿不到橋接資料
      await win.goto('https://example.com/');
      assert.equal(await win.evaluate(() => window.UepaBridge.getValue('codes')), null);
    } finally {
      await app.close();
    }

    const status = Object.fromEntries(JSON.parse(readStore(userData).codes).map((c) => [c.code, c.status]));
    assert.equal(status.GOODCODE1, 'success');
    assert.equal(status.OLDCODE, 'fail');

    // 重開 App：清單與結果還在
    ({ app, win } = await launch(userData));
    try {
      await win.goto('https://www.ubereats.com/tw/checkout');
      await win.locator('#uepa-host').getByText('已載入上次的優惠碼清單').waitFor();
      await win.locator('#uepa-host').getByText('成功 1・').waitFor();
    } finally {
      await app.close();
    }
  });
});
