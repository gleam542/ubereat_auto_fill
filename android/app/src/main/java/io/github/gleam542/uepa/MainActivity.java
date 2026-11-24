package io.github.gleam542.uepa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

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

    private final ExecutorService io = Executors.newCachedThreadPool();
    private WebView web;
    private SharedPreferences prefs;
    private String userAgent;
    private volatile String currentHost = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("uepa", MODE_PRIVATE);

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        userAgent = browserLikeUserAgent(settings.getUserAgentString());
        settings.setUserAgentString(userAgent);

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

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(Menu.NONE, MENU_HOME, 0, "Uber Eats 首頁");
        menu.add(Menu.NONE, MENU_SOURCE, 1, "打開優惠文章（手動擷取）");
        menu.add(Menu.NONE, MENU_RELOAD, 2, "重新整理");
        menu.add(Menu.NONE, MENU_UPDATE, 3, "檢查腳本更新");
        menu.add(Menu.NONE, MENU_ABOUT, 4, "版本資訊");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
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
                return false; // 一律留在 App 內，不跳去 Uber Eats App
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
        // 同一頁只注入一次（onPageFinished 可能觸發多次）
        String js = "(function(){if(window.__uepaLoaded)return;window.__uepaLoaded=true;\n"
                + shim + "\n" + script + "\n})();";
        web.evaluateJavascript(js, null);
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
                    deliver(id, f.status, f.body);
                } catch (IOException e) {
                    deliver(id, 0, "");
                }
            });
        }
    }

    private void deliver(int id, int status, String body) {
        String js = "window.__uepaHttpCallback&&window.__uepaHttpCallback(" + id + "," + status + ","
                + JSONObject.quote(body) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
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
