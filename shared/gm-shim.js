// App（Android WebView、電腦版 Electron）共用：把 userscript 需要的 GM_* 函式接到 App 端提供的 UepaBridge。
(function () {
  if (typeof UepaBridge === 'undefined') return;
  var pending = {};
  var seq = 0;
  window.GM_getValue = function (key) {
    var v = UepaBridge.getValue(String(key));
    return v === null || v === undefined ? undefined : v;
  };
  window.GM_setValue = function (key, value) {
    UepaBridge.setValue(String(key), String(value));
  };
  window.__uepaHttpCallback = function (id, status, text) {
    var req = pending[id];
    delete pending[id];
    if (!req) return;
    if (status > 0) {
      if (req.onload) req.onload({ status: status, responseText: text });
    } else if (req.onerror) {
      req.onerror();
    }
  };
  window.GM_xmlhttpRequest = function (opts) {
    var id = ++seq;
    pending[id] = opts;
    UepaBridge.httpGet(String(opts.url), id);
  };
})();
