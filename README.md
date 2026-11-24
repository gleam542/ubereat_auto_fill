# Uber Eats 優惠碼自動填入

一個 Tampermonkey 使用者腳本（userscript）。它做三件事：

1. 從 [callingtaiwan 的 Uber Eats 優惠文章](https://www.callingtaiwan.com.tw/ubereats%E5%84%AA%E6%83%A0-%E6%9C%80%E6%96%B0%E9%A4%90%E5%BB%B3%E5%A4%96%E9%80%81%E9%A6%96%E8%B3%BC%E5%84%AA%E6%83%A0%E5%BA%8F%E8%99%9F-%E6%8A%98%E6%89%A3%E7%A2%BC-%E6%8E%A8%E8%96%A6%E7%A2%BC/)抓出所有優惠碼、折扣碼、序號和推薦碼。
2. 在 ubereats.com 逐一打開「新增優惠碼」視窗，輸入每組碼並按下套用。
3. 讀出 Uber Eats 對每組碼的回應，並標成 ✅ 成功、⚠️ 已擁有、❌ 失敗或 ❓ 無法判斷。

腳本每次都即時抓文章，所以文章更新後，按一次「抓取」就能拿到最新的碼。

## 安裝

1. 在電腦版瀏覽器（Chrome、Edge 或 Firefox）安裝 [Tampermonkey](https://www.tampermonkey.net/)。
   - 新版 Chrome 要先打開擴充功能的「允許使用者指令碼」開關：在 `chrome://extensions` 找到 Tampermonkey，點「詳細資料」，再打開「允許使用者指令碼」。
2. 點這個網址：**[安裝腳本](https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js)**。Tampermonkey 會跳出安裝畫面，按「安裝」。
   - 這個網址要等 repo 設成**公開**才能用。repo 還是私人的時候，請改用複製貼上：打開 Tampermonkey 的「建立新腳本」，把 [`ubereats-promo-autofill.user.js`](./ubereats-promo-autofill.user.js) 的全部內容貼上，然後存檔。

## 自動更新

腳本裡已經設定好 `@updateURL` 和 `@downloadURL`，它們指向本 repo 預設分支上的最新版本。

- Tampermonkey 預設每天檢查一次更新，發現 `@version` 變大就會自動更新。
- 想立刻更新：在 Tampermonkey 控制台勾選這個腳本，按「檢查更新」。
- 要求：
  - repo 必須是**公開**的，Tampermonkey 才讀得到更新網址。
  - 要裝 1.2.0 以後的版本。1.2.0 以前的版本沒有更新網址，請用上面的安裝網址重新安裝一次（會直接覆蓋舊版，存好的優惠碼清單不會不見）。

## 使用方式

1. 打開 <https://www.ubereats.com/tw> 並登入。右下角會出現「Uber Eats 優惠碼自動填入」面板。
2. 按 **① 抓取優惠碼**。第一次使用時，Tampermonkey 會詢問是否允許連到 `callingtaiwan.com.tw`，請選「永遠允許」。
3. 檢查清單：
   - 文章寫明已過期的碼會加上刪除線，預設不勾選。
   - 標示「可能不是優惠碼」的項目是用寬鬆規則抓到的，預設不勾選，請自己確認。
   - 每組碼下方的灰字是文章原文，可以拿來判斷條件，例如限新用戶、限特定卡別。
4. 加一樣東西到購物車並進入結帳頁，或從左上選單打開「優惠」。
5. 按 **② 開始填入**。腳本會依序：
   - 打開「新增優惠碼」視窗。如果它自己打不開，面板會請你手動打開，偵測到輸入框後會自動繼續。
   - 輸入優惠碼，按下套用。
   - 讀取回應訊息，記錄結果，再換下一組。
6. 結果會記住，重新整理頁面也還在：
   - 已成功或已擁有的碼，下次會自動略過。
   - 失敗的碼會自動取消勾選，下次不會再試；想重試可以手動勾回去。

### 抓不到文章時

如果來源網站擋下自動下載（例如 Cloudflare 驗證），可以直接在瀏覽器打開那篇文章，按右下角的 **擷取本頁優惠碼**，再回到 Uber Eats 分頁按「② 開始填入」。

也可以在 **手動新增 / 設定** 貼上優惠碼（一行一個），或貼一整段文章讓它自己找。

### 找不到輸入框或套用按鈕時

Uber Eats 改版後，自動偵測可能會失效。這時打開 **手動新增 / 設定**：

1. 按「指定輸入框」，再點一下頁面上的優惠碼輸入框。
2. 按「指定套用按鈕」，再點一下「套用」按鈕。

腳本會記住你指定的位置。

## 電腦版（Windows / Mac）

不想裝 Tampermonkey 的話，可以直接用電腦版程式。程式裡有一個內建瀏覽器，會打開 Uber Eats 網頁版並自動載入同一支腳本，用法跟上面一樣。

### 下載

先登入 GitHub（repo 是私人的），再到 [Releases 的 desktop-latest](https://github.com/gleam542/ubereat_auto_fill/releases/tag/desktop-latest) 下載對應的檔案：

| 電腦 | 檔案 |
| --- | --- |
| Windows | `ubereat_auto_fill-windows.exe` |
| Mac（Apple 晶片 M1～M4） | `ubereat_auto_fill-mac-arm64.dmg` |
| Mac（Intel） | `ubereat_auto_fill-mac-x64.dmg` |

不知道 Mac 是哪一種的話：點左上角蘋果選單 →「關於這台 Mac」，「晶片」寫 Apple M 開頭的是 Apple 晶片，「處理器」寫 Intel 的是 Intel。

### 第一次打開

程式沒有向微軟或蘋果購買開發者簽章，所以第一次打開時系統會擋一下。

**Windows**

1. 直接雙擊 `ubereat_auto_fill-windows.exe`，不用安裝。
2. 如果出現「Windows 已保護您的電腦」，點「其他資訊」→「仍要執行」。
3. 每次打開都要先解壓縮，會等幾秒鐘，這是正常的。

**Mac**

1. 打開 `.dmg`，把「UberEat 優惠碼」拖到「應用程式」資料夾。
2. 到「應用程式」資料夾打開它。系統會說無法確認是否含有惡意軟體，先按「完成」或「取消」。
3. 打開「系統設定」→「隱私權與安全性」，往下捲，在「UberEat 優惠碼」旁邊按「仍要打開」，再輸入電腦密碼。
4. 如果系統說「已損毀，無法打開」，打開「終端機」，貼上以下指令並按 Enter，再重新打開程式：

   ```bash
   xattr -cr "/Applications/UberEat 優惠碼.app"
   ```

### 使用

1. 打開後會直接進入 Uber Eats 網頁版，登入你的帳號。
2. 按右下角面板的「① 抓取優惠碼」，再按「② 開始填入」。
3. 視窗上方選單：
   - 「頁面」：回 Uber Eats 首頁、打開優惠文章（手動擷取）、上一頁、重新整理、放大縮小。
   - 「說明」：檢查腳本更新、版本資訊。

登入狀態和優惠碼清單會保存在電腦上，下次打開還在。

### 更新

- **腳本**：程式每次打開都會檢查 GitHub 上有沒有更新版本的腳本，有就自動下載，重新整理頁面後生效。這需要 repo 是公開的。
- **程式本身**：重新下載就好，登入狀態和清單不會不見。
- **自動打包的時機**：只有 `desktop/` 或 `shared/` 的程式碼有變動時，GitHub Actions 才會重新打包。私人 repo 的 macOS 打包會用掉比較多 Actions 免費額度，所以只改腳本時不會重新打包。需要的話，可以到 Actions 頁面的「Desktop apps」手動按「Run workflow」。

## Android App（APK）

Android 手機最簡單的用法是直接裝 App，不需要 Firefox 或 Tampermonkey。

App 裡面有一個內建瀏覽器，會打開 Uber Eats 網頁版，並自動載入同一支腳本，所以畫面和用法都跟電腦版一樣。

### 下載與安裝

1. **登入 GitHub**：用手機瀏覽器登入 GitHub。repo 是私人的，沒登入就下載不到。
2. **下載 APK**：打開 [Releases 的 apk-latest](https://github.com/gleam542/ubereat_auto_fill/releases/tag/apk-latest)，下載 `ubereat_auto_fill.apk`（[直接下載連結](https://github.com/gleam542/ubereat_auto_fill/releases/download/apk-latest/ubereat_auto_fill.apk)）。
3. **安裝**：打開下載好的檔案。
   - 手機若詢問是否「允許安裝不明應用程式」，請允許瀏覽器安裝。
   - 若 Play 安全防護跳出警告，點「更多詳細資料」→「仍要安裝」。這是因為 App 不是從 Play 商店下載的。

APK 由 GitHub Actions 自動產生：每次推送腳本或 `android/` 底下的程式碼，都會重新打包並更新 Release。

### 使用

1. **打開 App 並登入**：打開桌面上的「UberEat 優惠碼」，會直接進入 Uber Eats 網頁版，登入你的帳號。
   - 建議用手機號碼或 Email 登入。
   - 「用 Google 登入」在 App 內建瀏覽器裡可能會被 Google 擋下。
2. **開始填入**：用法跟電腦版一樣，按「① 抓取優惠碼」，再按「② 開始填入」。
   - App 會自己下載文章，不會跳出允許連線的詢問。
3. **右上角選單**：
   - **Uber Eats 首頁**
   - **打開優惠文章（手動擷取）**：文章抓不到時用。打開文章後按「擷取本頁優惠碼」，再回 Uber Eats 首頁。
   - **重新整理**
   - **檢查腳本更新**
   - **版本資訊**

### 更新

- **腳本**：App 每次啟動都會檢查 GitHub 上有沒有更新版本的腳本。有的話會自動下載，重新整理頁面後生效。這需要 repo 是公開的。
- **App 本身**：重新下載 APK 安裝。
  - 如果安裝時出現「與現有套件衝突」，代表兩次打包用的簽章不同。請先解除安裝舊版再安裝；登入狀態和優惠碼清單會被清掉。
  - 想避免這個問題，請看下面的「（進階）固定簽章」。

### （進階）固定簽章

沒設定的話，每次打包都用臨時的 debug 金鑰，所以新版 APK 不能直接覆蓋舊版。

在電腦上產生一把金鑰，並把它存成 GitHub Secrets，之後每次打包都會用同一把，就能直接覆蓋更新：

```bash
keytool -genkeypair -v -keystore release.keystore -alias uepa -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore > release.keystore.b64
```

到 repo 的「Settings」→「Secrets and variables」→「Actions」新增以下四個 Secret：

| Secret 名稱 | 內容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `release.keystore.b64` 的內容 |
| `ANDROID_KEYSTORE_PASSWORD` | 金鑰庫密碼 |
| `ANDROID_KEY_ALIAS` | `uepa` |
| `ANDROID_KEY_PASSWORD` | 金鑰密碼 |

`release.keystore` 請自己保管好，不要提交到 repo。

## 在 Android 手機上使用（Firefox + Tampermonkey）

不想裝 App 的話，也可以用瀏覽器。Android 版 Chrome 不能裝擴充功能，請改用 **Firefox**。手機版 Firefox 可以裝 Tampermonkey；找不到的話，Violentmonkey 也可以。

1. **安裝 Firefox**：從 Play 商店安裝。
2. **安裝 Tampermonkey**：在 Firefox 點右上「⋮」→「附加元件」→「探索更多 Firefox 附加元件」，搜尋 Tampermonkey 並新增。
3. **安裝這個腳本**：
   - **repo 公開時**：在手機 Firefox 打開 [安裝網址](https://raw.githubusercontent.com/gleam542/ubereat_auto_fill/HEAD/ubereats-promo-autofill.user.js)，按「安裝」。之後會自動更新，不用再管它。
   - **repo 還是私人時**：要用複製貼上。
     1. 在手機版 Firefox 登入 GitHub，打開本 repo 的 `ubereats-promo-autofill.user.js`，按「Raw」。如果 Tampermonkey 跳出安裝畫面，按「安裝」就完成了。
     2. 如果沒跳出來，長按文字並全選、複製。
     3. 點「⋮」→「附加元件」→ Tampermonkey →「控制台（Dashboard）」→「+」新增腳本。
     4. 刪掉預設內容，貼上剛剛複製的程式碼，存檔。
4. **打開 Uber Eats 網頁**：在網址列直接輸入 `ubereats.com/tw`。
   - 腳本只在瀏覽器裡有效。手機有裝 Uber Eats App 的話，點連結可能會直接跳進 App。
   - 如果會跳進 App，到 Firefox「設定」把「在應用程式中開啟連結（Open links in apps）」關掉。
5. **登入並開始使用**：步驟跟電腦版一樣，按「① 抓取優惠碼」，再按「② 開始填入」。
   - 面板固定在畫面下方，最多佔半個螢幕。按「–」可以縮小。
   - 需要你自己點頁面時（例如打開「新增優惠碼」），面板會自動縮小，等你點完再繼續。
6. 優惠碼是加到帳號上，之後通常可以直接在 Uber Eats App 結帳時使用。

如果手機版網頁一直找不到優惠碼欄位，可以：

- 在 Firefox 選單勾選「電腦版網站」再試一次。
- 用「指定輸入框 / 指定套用按鈕」手動指定。

## 注意事項

- **這個腳本還沒在真實網站上跑過。** 開發環境連不到 callingtaiwan.com.tw 和 ubereats.com，所以文章的解析規則和 Uber Eats 的欄位偵測都是通用規則，只用模擬頁面測過。第一次使用時請看著它跑，有問題可以用上面的「指定」功能修正。
- 一筆訂單只能用一組優惠碼。很多碼只限新用戶、特定店家或特定付款方式，失敗是正常的。
- 預設每組間隔 3 秒。偵測到「嘗試次數過多」會自動停止，連續 3 組無法判斷結果也會停止。請不要把間隔調得太短，以免帳號被暫時限制。
- 優惠碼是加到你的 Uber 帳號上，通常在 App 的「優惠」頁也看得到。

## 開發 / 測試

測試用 Playwright 在 Chromium 載入腳本，對以下兩個檔案跑完整流程：

- 假文章：`test/fixtures/callingtaiwan-sample.html`
- 模擬結帳頁：`test/fixtures/mock-ubereats.html`，會模仿 React 受控輸入框和各種錯誤訊息。

兩個檔案裡的優惠碼都是虛構的。

另外也會測 Android App 用的 `shared/gm-shim.js`（Android App 與電腦版共用）：用假的 `UepaBridge` 模擬 App 端，確認 GM_* 橋接能正常抓取和填入。

Android App 的原始碼在 `android/`：

- App 本身：一個 WebView Activity 加上 GM_* 橋接。
- 內建腳本：打包時從 repo 根目錄複製進 APK。
- 版本號：直接用腳本的 `@version`。

電腦版的原始碼在 `desktop/`：

- 程式本身：Electron。
- 內建腳本：`npm run assets` 會把腳本和 `shared/gm-shim.js` 複製進去。

測試會真的啟動 Electron 跑一遍完整流程，Linux 上沒有螢幕時要用 `xvfb-run`：

```bash
cd desktop && npm install && cd ..
xvfb-run -a npm test
```

本機執行電腦版：

```bash
cd desktop && npm install && npm start
```

Android App 要在本機打包，需要 Android SDK，然後執行：

```bash
cd android
gradle assembleRelease
```

```bash
npm install
npx playwright install chromium
npm test
```

修改腳本後，記得同時把 `@version` 和 `package.json` 的 `version` 調大。版本號沒變，Tampermonkey 不會更新，測試也會提醒你。
