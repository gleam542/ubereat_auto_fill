package io.github.gleam542.uepa;

import android.accessibilityservice.AccessibilityService;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 透過 Android 無障礙服務直接操作官方 Uber Eats App（com.ubercab.eats），
 * 自動導航到優惠碼輸入頁、逐一貼上優惠碼、按下套用並讀取結果回寫至共用清單。
 */
public class UberEatsAccessibilityService extends AccessibilityService {

    public static final String TARGET_PACKAGE = "com.ubercab.eats";
    private static final String PREFS_NAME = "uepa";
    private static final String KEY_CODES = "gm:codes";
    private static final String KEY_SETTINGS = "gm:settings";

    private static volatile UberEatsAccessibilityService instance;
    private static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());

    private enum Phase {
        IDLE,
        NAVIGATE,
        CLICK_APPLY,
        WAIT_RESULT,
        COOLDOWN
    }

    private Phase phase = Phase.IDLE;
    private JSONArray allCodes = new JSONArray();
    private final List<Integer> queueIndices = new ArrayList<>();
    private int queuePos = 0;
    private int okCount = 0;
    private int failCount = 0;
    private int unknownStreak = 0;
    private long delayMs = 3000;

    private long phaseStartedAt = 0;
    private long lastInTargetAt = 0;
    private long lastNavClickAt = 0;
    private boolean showedManualHint = false;
    private final Set<String> beforeTexts = new HashSet<>();

    private static final Pattern RE_RATE_LIMIT = Pattern.compile(
            "嘗試次數過多|次數過多|太頻繁|請稍後再試|too many|try again later|rate limit",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern RE_ALREADY = Pattern.compile(
            "已擁有|已兌換|已使用|已經使用|已領取|重複|已經套用|already (?:applied|redeemed|used|claimed|added)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern RE_SUCCESS = Pattern.compile(
            "已套用|已新增|新增成功|已加入|套用成功|兌換成功|優惠已新增|promo(?:tion)? (?:applied|added)|successfully (?:applied|added)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern RE_FAIL = Pattern.compile(
            "無效|過期|不符合|無法使用|無法套用|找不到|錯誤|不適用|僅限|不符資格|已達上限|已額滿|無此優惠|序號有誤|代碼無效|invalid|expired|not eligible|unable to apply|cannot be applied|couldn't apply|not valid|oops|sorry",
            Pattern.CASE_INSENSITIVE);

    private static final List<String> NAV_INPUT_LABELS = Arrays.asList(
            "輸入優惠序號", "新增優惠碼", "新增優惠", "輸入優惠碼", "新增促銷代碼",
            "enter promo code", "add promo code", "add promo");
    private static final List<String> NAV_PROMO_LABELS = Arrays.asList(
            "優惠方案", "優惠", "促銷", "promotions", "promos");
    private static final List<String> NAV_ACCOUNT_LABELS = Arrays.asList(
            "帳戶", "帳號", "account");
    private static final List<String> APPLY_BUTTON_LABELS = Arrays.asList(
            "新增優惠", "套用", "新增", "使用", "兌換", "確定", "apply", "add promo", "add");
    private static final List<String> DISMISS_BUTTON_LABELS = Arrays.asList(
            "確定", "知道了", "好", "關閉", "了解", "ok", "got it", "dismiss", "close");

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            try {
                step();
            } catch (Exception e) {
                toast("自動化錯誤：" + e.getMessage());
                stopInternal(null);
                return;
            }
            if (running) {
                handler.postDelayed(this, 600);
            }
        }
    };

    public static boolean isServiceConnected() {
        return instance != null;
    }

    public static boolean isRunning() {
        return running;
    }

    public static int countPendingCodes(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean skipDone = readSkipDone(prefs);
        JSONArray arr = readCodes(prefs);
        int count = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject obj = arr.optJSONObject(i);
            if (obj == null || !obj.optBoolean("checked", false)) continue;
            String st = obj.optString("status", "pending");
            if (skipDone && ("success".equals(st) || "already".equals(st))) continue;
            String code = obj.optString("code", "").trim();
            if (!code.isEmpty()) count++;
        }
        return count;
    }

    public static boolean startRun(Context ctx) {
        UberEatsAccessibilityService svc = instance;
        if (svc == null) return false;
        return svc.beginRun();
    }

    public static void stopRun() {
        UberEatsAccessibilityService svc = instance;
        if (svc != null) {
            svc.stopInternal("已停止官方 App 自動填入");
        } else {
            running = false;
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 主迴圈由 ticker 定時檢查目前畫面狀態，避免遺漏動畫後的 DOM 變化
    }

    @Override
    public void onInterrupt() {
        stopInternal(null);
    }

    @Override
    public void onDestroy() {
        stopInternal(null);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private boolean beginRun() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        allCodes = readCodes(prefs);
        boolean skipDone = readSkipDone(prefs);
        delayMs = readDelayMs(prefs);

        queueIndices.clear();
        for (int i = 0; i < allCodes.length(); i++) {
            JSONObject obj = allCodes.optJSONObject(i);
            if (obj == null || !obj.optBoolean("checked", false)) continue;
            String st = obj.optString("status", "pending");
            if (skipDone && ("success".equals(st) || "already".equals(st))) continue;
            if (!obj.optString("code", "").trim().isEmpty()) {
                queueIndices.add(i);
            }
        }
        if (queueIndices.isEmpty()) {
            toast("沒有待填入的優惠碼，請先抓取或勾選優惠碼");
            return false;
        }

        queuePos = 0;
        okCount = 0;
        failCount = 0;
        unknownStreak = 0;
        showedManualHint = false;
        lastInTargetAt = System.currentTimeMillis();
        lastNavClickAt = 0;
        phase = Phase.NAVIGATE;
        phaseStartedAt = System.currentTimeMillis();
        running = true;

        handler.removeCallbacks(ticker);
        handler.postDelayed(ticker, 1000);
        toast("開始在 Uber Eats App 自動填入 " + queueIndices.size() + " 組優惠碼（離開 Uber Eats 即自動停止）");
        return true;
    }

    private void stopInternal(String message) {
        running = false;
        phase = Phase.IDLE;
        handler.removeCallbacks(ticker);
        if (message != null && !message.isEmpty()) {
            toast(message);
        }
    }

    private void step() {
        long now = System.currentTimeMillis();
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        CharSequence pkg = root.getPackageName();
        if (pkg == null || !TARGET_PACKAGE.equals(pkg.toString())) {
            // 剛啟動時給 App 一點時間切換過去；若超過 12 秒不在 Uber Eats 畫面則自動停止
            if (now - lastInTargetAt > 12000) {
                stopInternal("已離開 Uber Eats，停止自動填入");
            }
            return;
        }
        lastInTargetAt = now;

        if (queuePos >= queueIndices.size()) {
            stopInternal("全部填完！成功 " + okCount + " 組" + (failCount > 0 ? "，失敗 " + failCount + " 組" : ""));
            return;
        }

        JSONObject item = allCodes.optJSONObject(queueIndices.get(queuePos));
        if (item == null) {
            queuePos++;
            return;
        }
        String code = item.optString("code", "").trim();

        switch (phase) {
            case NAVIGATE: {
                AccessibilityNodeInfo edit = findPromoEditText(root);
                if (edit != null) {
                    beforeTexts.clear();
                    collectTexts(root, beforeTexts);
                    if (fillEditText(edit, code)) {
                        toast("(" + (queuePos + 1) + "/" + queueIndices.size() + ") 填入 " + code);
                        phase = Phase.CLICK_APPLY;
                        phaseStartedAt = now;
                    }
                    return;
                }
                // 嘗試自動導航到優惠碼輸入頁（每 1.8 秒最多點一次，避免狂點）
                if (now - lastNavClickAt > 1800) {
                    if (clickByLabels(root, NAV_INPUT_LABELS)
                            || clickByLabels(root, NAV_PROMO_LABELS)
                            || clickByLabels(root, NAV_ACCOUNT_LABELS)) {
                        lastNavClickAt = now;
                        return;
                    }
                }
                if (!showedManualHint && now - phaseStartedAt > 8000) {
                    showedManualHint = true;
                    toast("請手動打開「帳戶 → 優惠方案 → 輸入優惠序號」，偵測到輸入框會自動開始");
                }
                break;
            }
            case CLICK_APPLY: {
                if (now - phaseStartedAt < 450) return;
                if (clickByLabels(root, APPLY_BUTTON_LABELS)) {
                    phase = Phase.WAIT_RESULT;
                    phaseStartedAt = now;
                } else if (now - phaseStartedAt > 4000) {
                    recordAndAdvance(item, "unknown", "找不到套用按鈕", root, now);
                }
                break;
            }
            case WAIT_RESULT: {
                if (now - phaseStartedAt < 1200) return;
                Set<String> afterTexts = new HashSet<>();
                collectTexts(root, afterTexts);

                String matchedStatus = null;
                String matchedMsg = "";
                for (String t : afterTexts) {
                    if (beforeTexts.contains(t)) continue;
                    String st = classifyText(t);
                    if (st != null) {
                        matchedStatus = st;
                        matchedMsg = t;
                        break;
                    }
                }
                // 若新增文字裡找不到，檢查整個畫面（有些錯誤訊息原本就佔位或重複出現）
                if (matchedStatus == null && now - phaseStartedAt > 2600) {
                    for (String t : afterTexts) {
                        String st = classifyText(t);
                        if (st != null) {
                            matchedStatus = st;
                            matchedMsg = t;
                            break;
                        }
                    }
                }
                if (matchedStatus != null) {
                    recordAndAdvance(item, matchedStatus, matchedMsg, root, now);
                } else if (now - phaseStartedAt > 4800) {
                    recordAndAdvance(item, "unknown", "未偵測到明確回應", root, now);
                }
                break;
            }
            case COOLDOWN: {
                if (now - phaseStartedAt >= Math.max(1200, delayMs)) {
                    phase = Phase.NAVIGATE;
                    phaseStartedAt = now;
                }
                break;
            }
            default:
                break;
        }
    }

    private void recordAndAdvance(JSONObject item, String status, String message,
                                  AccessibilityNodeInfo root, long now) {
        try {
            item.put("status", status);
            item.put("message", message == null ? "" : message);
            item.put("time", now);
            if ("fail".equals(status)) {
                item.put("checked", false);
                failCount++;
            } else if ("success".equals(status)) {
                okCount++;
            }
        } catch (JSONException ignored) {
            // ignore
        }
        saveCodes(allCodes);

        // 若畫面跳出提示對話框，嘗試關閉以繼續下一組
        clickByLabels(root, DISMISS_BUTTON_LABELS);

        if ("rate_limited".equals(status)) {
            stopInternal("Uber Eats 提示嘗試次數過多，已自動停止");
            return;
        }

        unknownStreak = "unknown".equals(status) ? unknownStreak + 1 : 0;
        if (unknownStreak >= 3) {
            stopInternal("連續 3 組無法判斷結果，已停止（請確認是否在優惠碼輸入畫面）");
            return;
        }

        queuePos++;
        if (queuePos >= queueIndices.size()) {
            stopInternal("全部填完！成功 " + okCount + " 組" + (failCount > 0 ? "，失敗 " + failCount + " 組" : ""));
        } else {
            phase = Phase.COOLDOWN;
            phaseStartedAt = now;
        }
    }

    private String classifyText(String text) {
        if (text == null || text.length() < 2 || text.length() > 160) return null;
        if (RE_RATE_LIMIT.matcher(text).find()) return "rate_limited";
        if (RE_ALREADY.matcher(text).find()) return "already";
        if (RE_SUCCESS.matcher(text).find()) return "success";
        if (RE_FAIL.matcher(text).find()) return "fail";
        return null;
    }

    private boolean fillEditText(AccessibilityNodeInfo edit, String code) {
        edit.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        edit.performAction(AccessibilityNodeInfo.ACTION_FOCUS);

        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, code);
        if (edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            return true;
        }

        // 部分自訂輸入框不支援 ACTION_SET_TEXT，改用剪貼簿貼上
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("promo", code));
            Bundle selectAll = new Bundle();
            selectAll.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0);
            selectAll.putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, 100);
            edit.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, selectAll);
            return edit.performAction(AccessibilityNodeInfo.ACTION_PASTE);
        }
        return false;
    }

    private AccessibilityNodeInfo findPromoEditText(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> edits = new ArrayList<>();
        collectEditTexts(root, edits);
        if (edits.isEmpty()) return null;
        for (AccessibilityNodeInfo e : edits) {
            String hint = nodeLabel(e).toLowerCase(Locale.ROOT);
            if (hint.contains("優惠") || hint.contains("序號") || hint.contains("折扣")
                    || hint.contains("promo") || hint.contains("code")) {
                return e;
            }
        }
        // 若頁面上只有一個可見輸入框且畫面本身有優惠相關字樣，就使用它
        if (edits.size() == 1) {
            Set<String> texts = new HashSet<>();
            collectTexts(root, texts);
            for (String t : texts) {
                String lower = t.toLowerCase(Locale.ROOT);
                if (lower.contains("優惠") || lower.contains("序號") || lower.contains("promo")) {
                    return edits.get(0);
                }
            }
        }
        return null;
    }

    private void collectEditTexts(AccessibilityNodeInfo node, List<AccessibilityNodeInfo> out) {
        if (node == null || !node.isVisibleToUser()) return;
        CharSequence cls = node.getClassName();
        if (cls != null && cls.toString().contains("EditText") && node.isEditable()) {
            out.add(node);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collectEditTexts(node.getChild(i), out);
        }
    }

    private boolean clickByLabels(AccessibilityNodeInfo root, List<String> labels) {
        AccessibilityNodeInfo match = findNodeByLabels(root, labels);
        if (match == null) return false;
        return clickSelfOrParent(match);
    }

    private AccessibilityNodeInfo findNodeByLabels(AccessibilityNodeInfo node, List<String> labels) {
        if (node == null || !node.isVisibleToUser()) return null;
        String label = nodeLabel(node).trim().toLowerCase(Locale.ROOT);
        if (!label.isEmpty()) {
            for (String want : labels) {
                String w = want.toLowerCase(Locale.ROOT);
                if (label.equals(w) || (label.length() <= w.length() + 6 && label.contains(w))) {
                    // 避免點到輸入框本身
                    CharSequence cls = node.getClassName();
                    if (cls == null || !cls.toString().contains("EditText")) {
                        return node;
                    }
                }
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = findNodeByLabels(node.getChild(i), labels);
            if (found != null) return found;
        }
        return null;
    }

    private boolean clickSelfOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo cur = node;
        for (int depth = 0; depth < 6 && cur != null; depth++) {
            if (cur.isClickable() && cur.isEnabled()) {
                return cur.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            cur = cur.getParent();
        }
        return false;
    }

    private void collectTexts(AccessibilityNodeInfo node, Set<String> out) {
        if (node == null || !node.isVisibleToUser()) return;
        CharSequence t = node.getText();
        if (t != null) {
            String s = t.toString().trim();
            if (!s.isEmpty()) out.add(s);
        }
        CharSequence d = node.getContentDescription();
        if (d != null) {
            String s = d.toString().trim();
            if (!s.isEmpty()) out.add(s);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collectTexts(node.getChild(i), out);
        }
    }

    private String nodeLabel(AccessibilityNodeInfo node) {
        StringBuilder sb = new StringBuilder();
        if (node.getText() != null) sb.append(node.getText()).append(' ');
        if (node.getContentDescription() != null) sb.append(node.getContentDescription()).append(' ');
        if (node.getHintText() != null) sb.append(node.getHintText());
        return sb.toString().trim();
    }

    private void saveCodes(JSONArray arr) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(KEY_CODES, arr.toString()).apply();
    }

    private static JSONArray readCodes(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_CODES, null);
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static boolean readSkipDone(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_SETTINGS, null);
        if (raw == null) return true;
        try {
            return new JSONObject(raw).optBoolean("skipDone", true);
        } catch (JSONException e) {
            return true;
        }
    }

    private static long readDelayMs(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_SETTINGS, null);
        if (raw == null) return 3000;
        try {
            double sec = new JSONObject(raw).optDouble("delaySec", 3.0);
            return Math.max(1000L, (long) (sec * 1000.0));
        } catch (JSONException e) {
            return 3000;
        }
    }

    private void toast(String msg) {
        handler.post(() -> Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_LONG).show());
    }
}
