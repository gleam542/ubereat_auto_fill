package io.github.gleam542.uepa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 用內建瀏覽器（WebView）打開 Uber Eats 網頁版，並注入與 Tampermonkey 版相同的 userscript。
 * userscript 需要的 GM_getValue / GM_setValue / GM_xmlhttpRequest 由 {@link Bridge} 提供。
 */
public class MainActivity extends Activity {

    static final String HOME_URL = "https://www.ubereats.com/tw";
    static final String SOURCE_URL =
            "https://www.callingtaiwan.com.tw/ubereats%E5%84%AA%E6%83%A0-%E6%9C%80%E6%96%B0%E9%A4%90%E5%BB%B3%E5%A4%96%E9%80%81%E9%A6%96%E8%B3%BC%E5%84%AA%E6%83%A0%E5%BA%8F%E8%99%9F-%E6%8A%98%E6%89%A3%E7%A2%BC-%E6%8E%A8%E8%96%A6%E7%A2%BC/";
    static final String SCRIPT_UPDATE_URL =
            "https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js";

    private static final String BUNDLED_SCRIPT = "ubereats-promo-autofill.user.js";
    private static final String SHIM_SCRIPT = "gm-shim.js";
    private static final String CACHED_SCRIPT = "userscript-latest.js";
    private static final int MAX_BYTES = 5 * 1024 * 1024;
    private static final Pattern VERSION = Pattern.compile("@version\\s+(\\S+)");

    private static final int MENU_HOME = 1;
    private static final int MENU_SOURCE = 2;
    private static final int MENU_RELOAD = 3;
    private static final int MENU_UPDATE = 4;
    private static final int MENU_ABOUT = 5;
    private static final int MENU_DESKTOP = 6;
    private static final int MENU_PANEL = 7;

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout container;
    private WebView web;
    private WebView activeFetcher;
    private SharedPreferences prefs;
    private String defaultUserAgent;
    private String userAgent;
    private volatile String currentHost = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("uepa", MODE_PRIVATE);

        container = new FrameLayout(this);
        web = new WebView(this);
        container.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        container.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                @SuppressWarnings("deprecation")
                int left = insets.getSystemWindowInsetLeft();
                @SuppressWarnings("deprecation")
                int top = insets.getSystemWindowInsetTop();
                @SuppressWarnings("deprecation")
                int right = insets.getSystemWindowInsetRight();
                @SuppressWarnings("deprecation")
                int bottom = insets.getSystemWindowInsetBottom();
                v.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        setContentView(container);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true); // 可以雙指縮放
        settings.setDisplayZoomControls(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        defaultUserAgent = settings.getUserAgentString();
        applyUserAgent();

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "UepaBridge");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient());

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(HOME_URL);
        }
        checkForScriptUpdate(false);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        destroyFetcher();
        io.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * 預設用「電腦版網站」的身分開 Uber Eats：手機版網頁會把 Android 導到 Google Play 要你裝官方 App。
     * 版面仍會依螢幕寬度自動調整；可以從選單切回手機版。
     */
    private boolean desktopMode() {
        return prefs.getBoolean("desktop_mode", true);
    }

    private void applyUserAgent() {
        userAgent = desktopMode() ? desktopUserAgent(defaultUserAgent) : browserLikeUserAgent(defaultUserAgent);
        web.getSettings().setUserAgentString(userAgent);
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(Menu.NONE, MENU_PANEL, 0, "優惠碼面板")
                .setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        menu.add(Menu.NONE, MENU_HOME, 1, "Uber Eats 首頁");
        menu.add(Menu.NONE, MENU_SOURCE, 2, "打開優惠文章（手動擷取）");
        menu.add(Menu.NONE, MENU_RELOAD, 3, "重新整理");
        menu.add(Menu.NONE, MENU_UPDATE, 4, "檢查腳本更新");
        menu.add(Menu.NONE, MENU_DESKTOP, 5, "使用電腦版網站").setCheckable(true);
        menu.add(Menu.NONE, MENU_ABOUT, 6, "版本資訊");
        return true;
    }

    @Override
    public boolean onPrepareOptionsMenu(Menu menu) {
        MenuItem desktop = menu.findItem(MENU_DESKTOP);
        if (desktop != null) desktop.setChecked(desktopMode());
        return super.onPrepareOptionsMenu(menu);
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case MENU_PANEL:
                if (isScriptHost(currentHost)) {
                    showPanel();
                } else {
                    toast("請先回到 Uber Eats 首頁再開啟優惠碼面板");
                }
                return true;
            case MENU_HOME:
                web.loadUrl(HOME_URL);
                return true;
            case MENU_SOURCE:
                web.loadUrl(SOURCE_URL);
                return true;
            case MENU_RELOAD:
                web.reload();
                return true;
            case MENU_UPDATE:
                checkForScriptUpdate(true);
                return true;
            case MENU_DESKTOP:
                prefs.edit().putBoolean("desktop_mode", !desktopMode()).apply();
                applyUserAgent();
                toast(desktopMode() ? "已切換為電腦版網站" : "已切換為手機版網站");
                web.loadUrl(HOME_URL);
                return true;
            case MENU_ABOUT:
                toast("App " + appVersion() + "｜腳本 " + versionOf(currentScript()));
                return true;
            default:
                return super.onOptionsItemSelected(item);
        }
    }

    /* ------------------------------------------------------------------ */
    /* 注入 userscript                                                      */
    /* ------------------------------------------------------------------ */

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if (scheme.equals("http") || scheme.equals("https")) {
                if (isAppStoreHost(hostOf(uri.toString()))) {
                    toast("已擋下跳到應用程式商店的連結");
                    return true;
                }
                return false; // 一律留在 App 內，不跳去 Uber Eats App
            }
            if (scheme.equals("market")) {
                toast("已擋下跳到應用程式商店的連結");
                return true;
            }
            if (scheme.equals("tel") || scheme.equals("mailto")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // 沒有可以處理的 App
                }
            }
            return true; // intent://、ubereats:// 等等直接忽略
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            currentHost = hostOf(url);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            currentHost = hostOf(url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            currentHost = hostOf(url);
            if (isScriptHost(currentHost)) {
                inject();
            }
        }
    }

    private void inject() {
        String shim = readAsset(SHIM_SCRIPT);
        String script = currentScript();
        if (shim == null || script == null) {
            toast("找不到內建腳本");
            return;
        }
        // 以實際 DOM 是否已掛載為準：若 SPA 重繪或驗證轉址清掉面板，仍可自動補注入
        String js = "(function(){if(document.getElementById('uepa-host'))return;"
                + "try{\n" + shim + "\n" + script
                + "\n}catch(e){if(window.UepaBridge&&UepaBridge.onError)UepaBridge.onError(String(e));}"
                + "})();";
        web.evaluateJavascript(js, null);
    }

    private void showPanel() {
        inject();
        web.evaluateJavascript(
                "(function(){if(window.__uepaShowPanel)window.__uepaShowPanel();})();",
                null);
    }

    /** 內建腳本與下載到的新版腳本，取版本較新的那一個。 */
    private String currentScript() {
        String bundled = readAsset(BUNDLED_SCRIPT);
        File cached = new File(getFilesDir(), CACHED_SCRIPT);
        if (cached.exists()) {
            String downloaded = readFile(cached);
            if (downloaded != null && compareVersions(versionOf(downloaded), versionOf(bundled)) > 0) {
                return downloaded;
            }
        }
        return bundled;
    }

    private void checkForScriptUpdate(boolean userRequested) {
        io.execute(() -> {
            String message;
            try {
                Fetched f = httpGet(SCRIPT_UPDATE_URL);
                if (f.status != 200 || !f.body.contains("// ==UserScript==")) {
                    message = "無法檢查更新（HTTP " + f.status + "）。repo 需要是公開的才能自動更新。";
                } else {
                    String latest = versionOf(f.body);
                    String current = versionOf(currentScript());
                    if (compareVersions(latest, current) > 0) {
                        writeFile(new File(getFilesDir(), CACHED_SCRIPT), f.body);
                        runOnUiThread(() -> toast("腳本已更新到 " + latest + "，重新整理頁面後生效"));
                        return;
                    }
                    message = "已經是最新版（" + current + "）";
                }
            } catch (IOException e) {
                message = "無法檢查更新：" + e.getMessage();
            }
            if (userRequested) {
                String m = message;
                runOnUiThread(() -> toast(m));
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* 給 userscript 用的 GM_* 橋接                                         */
    /* ------------------------------------------------------------------ */

    private final class Bridge {
        @JavascriptInterface
        public String getValue(String key) {
            if (!isScriptHost(currentHost)) return null;
            return prefs.getString("gm:" + key, null);
        }

        @JavascriptInterface
        public void setValue(String key, String value) {
            if (!isScriptHost(currentHost)) return;
            prefs.edit().putString("gm:" + key, value).apply();
        }

        @JavascriptInterface
        public void onError(String message) {
            if (!isScriptHost(currentHost)) return;
            runOnUiThread(() -> toast("腳本錯誤：" + message));
        }

        /** 只允許抓優惠文章的網站（對應 userscript 的 @connect）。 */
        @JavascriptInterface
        public void httpGet(String url, int id) {
            if (!isScriptHost(currentHost) || !isSourceUrl(url)) {
                deliver(id, 0, "");
                return;
            }
            io.execute(() -> {
                try {
                    Fetched f = MainActivity.this.httpGet(url);
                    if (looksLikeCloudflareChallenge(f.status, f.body)) {
                        fetchViaWebView(url, id);
                    } else {
                        deliver(id, f.status, f.body);
                    }
                } catch (IOException e) {
                    fetchViaWebView(url, id);
                }
            });
        }
    }

    private void deliver(int id, int status, String body) {
        String js = "window.__uepaHttpCallback&&window.__uepaHttpCallback(" + id + "," + status + ","
                + JSONObject.quote(body) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    private void destroyFetcher() {
        if (activeFetcher != null) {
            if (container != null) container.removeView(activeFetcher);
            activeFetcher.stopLoading();
            activeFetcher.destroy();
            activeFetcher = null;
        }
    }

    /**
     * 當來源網站有 Cloudflare 瀏覽器驗證時，改用隱藏 WebView 載入頁面並等待驗證完成後取出 HTML。
     * 同時共用 CookieManager，驗證通過後下一次抓取就能直接沿用 cf_clearance cookie。
     */
    private void fetchViaWebView(String url, int id) {
        mainHandler.post(() -> {
            if (isFinishing() || isDestroyed()) {
                deliver(id, 0, "");
                return;
            }
            destroyFetcher();
            final AtomicBoolean done = new AtomicBoolean(false);
            final WebView fetcher = new WebView(this);
            activeFetcher = fetcher;
            fetcher.setVisibility(View.INVISIBLE);

            WebSettings s = fetcher.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setUserAgentString(userAgent);

            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setAcceptThirdPartyCookies(fetcher, true);

            // 放在主 WebView 後方，不攔截觸控事件，但保留在視窗樹內讓 JS 與計時器正常運作
            container.addView(fetcher, 0, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

            final Runnable finishTimeout = () -> {
                if (done.compareAndSet(false, true)) {
                    destroyFetcher();
                    deliver(id, 403, "");
                }
            };
            mainHandler.postDelayed(finishTimeout, 20000);

            final Runnable[] pollRef = new Runnable[1];
            pollRef[0] = () -> {
                if (done.get() || activeFetcher != fetcher) return;
                String checkJs = "(function(){"
                        + "var t=(document.title||'');"
                        + "var h=document.documentElement?document.documentElement.outerHTML:'';"
                        + "var b=/just a moment|attention required|checking your browser|請稍候/i.test(t)"
                        + "||h.indexOf('challenges.cloudflare.com')!==-1"
                        + "||h.indexOf('__cf_chl_')!==-1"
                        + "||h.indexOf('cf-browser-verification')!==-1;"
                        + "return JSON.stringify({ready:document.readyState==='complete',blocked:b,html:b?'':h});"
                        + "})();";
                fetcher.evaluateJavascript(checkJs, raw -> {
                    if (done.get() || activeFetcher != fetcher) return;
                    try {
                        if (raw != null && !raw.equals("null")) {
                            // evaluateJavascript 回傳的是 JSON 字串再包一層引號，需要解兩次
                            String unwrapped = new JSONObject("{\"v\":" + raw + "}").getString("v");
                            JSONObject obj = new JSONObject(unwrapped);
                            boolean blocked = obj.optBoolean("blocked", true);
                            String html = obj.optString("html", "");
                            if (!blocked && html.length() > 500) {
                                if (done.compareAndSet(false, true)) {
                                    mainHandler.removeCallbacks(finishTimeout);
                                    CookieManager.getInstance().flush();
                                    destroyFetcher();
                                    deliver(id, 200, html);
                                }
                                return;
                            }
                        }
                    } catch (JSONException ignored) {
                        // 頁面尚未就緒，繼續輪詢
                    }
                    mainHandler.postDelayed(pollRef[0], 1200);
                });
            };

            fetcher.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String loadedUrl) {
                    if (!done.get() && activeFetcher == fetcher) {
                        mainHandler.removeCallbacks(pollRef[0]);
                        mainHandler.postDelayed(pollRef[0], 800);
                    }
                }
            });
            fetcher.loadUrl(url);
        });
    }

    static boolean looksLikeCloudflareChallenge(int status, String body) {
        if (status == 403 || status == 503) return true;
        if (body == null) return false;
        return body.contains("challenges.cloudflare.com")
                || body.contains("__cf_chl_")
                || body.contains("cf-browser-verification")
                || body.contains("<title>Just a moment...</title>");
    }

    /* ------------------------------------------------------------------ */
    /* 小工具                                                               */
    /* ------------------------------------------------------------------ */

    static final class Fetched {
        final int status;
        final String body;

        Fetched(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private Fetched httpGet(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Accept-Language", "zh-TW,zh;q=0.9,en;q=0.8");
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) {
                c.setRequestProperty("Cookie", cookie);
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = in == null ? "" : readAll(in);
            return new Fetched(status, body);
        } finally {
            c.disconnect();
        }
    }

    static String browserLikeUserAgent(String ua) {
        // 拿掉 WebView 標記，避免網站把 App 當成「內嵌瀏覽器」而要求改用官方 App
        return ua.replace("; wv)", ")").replaceAll("Version/\\d+(\\.\\d+)* ", "");
    }

    /** 偽裝成電腦版 Chrome（沿用 WebView 的 Chrome 版本號） */
    static String desktopUserAgent(String ua) {
        Matcher m = Pattern.compile("Chrome/([\\d.]+)").matcher(ua);
        String chrome = m.find() ? m.group(1) : "131.0.0.0";
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                + chrome + " Safari/537.36";
    }

    static boolean isAppStoreHost(String host) {
        return host.equals("play.google.com") || host.equals("market.android.com")
                || host.equals("apps.apple.com") || host.equals("itunes.apple.com");
    }

    static String hostOf(String url) {
        if (url == null) return "";
        String host = Uri.parse(url).getHost();
        return host == null ? "" : host.toLowerCase();
    }

    static boolean isScriptHost(String host) {
        return host.equals("ubereats.com") || host.endsWith(".ubereats.com")
                || host.equals("callingtaiwan.com.tw") || host.endsWith(".callingtaiwan.com.tw");
    }

    static boolean isSourceUrl(String url) {
        Uri uri = Uri.parse(url);
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        return "https".equals(uri.getScheme())
                && (host.equals("www.callingtaiwan.com.tw") || host.equals("callingtaiwan.com.tw"));
    }

    static String versionOf(String script) {
        if (script == null) return "0";
        Matcher m = VERSION.matcher(script);
        return m.find() ? m.group(1) : "0";
    }

    static int compareVersions(String a, String b) {
        String[] pa = a.split("\\.");
        String[] pb = b.split("\\.");
        for (int i = 0; i < Math.max(pa.length, pb.length); i++) {
            int x = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int y = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (x != y) return Integer.compare(x, y);
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D.*$", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            return readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    private static String readFile(File f) {
        try (InputStream in = new FileInputStream(f)) {
            return readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    private static void writeFile(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
        if (!tmp.renameTo(f)) throw new IOException("無法寫入 " + f.getName());
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > MAX_BYTES) throw new IOException("檔案太大");
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private String appVersion() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
