// ===== R6T5 Hub 认证模块（Cloudreve OAuth 2.0 授权码 + PKCE）=====
// 登录走 netdisk.r6t5.dpdns.org（Cloudreve）OAuth；业务数据仍存 Cloudflare D1，user_id 用邮箱。
// 兼容原 msauth.js / sbauth.js 的函数名（msLogin/msGetUser/msLogout/msHandleRedirect/msTakeReturnTo、
// sbGetUser/sbGetAccessToken/sbRefreshUser），各页面只需保持 <script src="sbauth.js"> 引用。
//
// 流程：
//   1. msLogin() 生成 PKCE，跳转 Cloudreve /session/authorize；
//   2. /callback 页用 code 换 access_token/refresh_token，调 userinfo 取身份；
//   3. 本地会话：access_token 短期有效，过期用 refresh_token 静默续期；
//   4. msLogout() 只清本地（Cloudreve 无 end_session 端点）。

// ---------- Cloudreve OAuth 配置（管理面板 → OAuth 应用） ----------
var CB_BASE = "https://netdisk.r6t5.dpdns.org";
var CB_CLIENT_ID = "efdf62d2-e83b-41fd-8bce-7ac453c4fa1e";
var CB_CLIENT_SECRET = "HhHF5qraMcYrCb6vDGpvLMbmPlAPCCO0";
var CB_REDIRECT_URI = "https://myacc.r6t5.dpdns.org/callback";
var CB_SCOPE = "openid email profile offline_access UserInfo.Write UserSecurityInfo.Write Files.Write Shares.Write Workflow.Write Finance.Write DavAccount.Write";

var CB_AUTHORIZE = CB_BASE + "/session/authorize";
var CB_TOKEN = CB_BASE + "/api/v4/session/oauth/token";
var CB_REFRESH = CB_BASE + "/api/v4/session/token/refresh";
var CB_USERINFO = CB_BASE + "/api/v4/session/oauth/userinfo";

// ---------- 本地存储键 ----------
var CB_USER_KEY = "wordGameGitHubUser";   // 与旧缓存键保持一致，便于其它站读取 ms_user
var CB_AT_KEY = "r6t5CbAccessToken";
var CB_RT_KEY = "r6t5CbRefreshToken";
var CB_EXP_KEY = "r6t5CbAccessExp";

// ---------- PKCE 工具 ----------
function _cbRandomVerifier() {
    var charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    var arr = new Uint8Array(64);
    if (crypto.getRandomValues) crypto.getRandomValues(arr);
    return Array.prototype.map.call(arr, function (v) { return charset[v % charset.length]; }).join("");
}

function _cbS256Challenge(verifier) {
    return new Promise(function (resolve, reject) {
        try {
            var data = new TextEncoder().encode(verifier);
            crypto.subtle.digest("SHA-256", data).then(function (hash) {
                var bytes = new Uint8Array(hash);
                var b64 = btoa(String.fromCharCode.apply(null, bytes));
                resolve(b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
            }).catch(reject);
        } catch (e) { reject(e); }
    });
}

// ---------- 跨子域 cookie（与原 msauth/sbauth 保持一致，供其它站读取登录态） ----------
function _hubCookieDomain() {
    var h = location.hostname;
    var i = h.indexOf(".");
    return i >= 0 ? "." + h.slice(i + 1) : h;
}
function _writeHubCookie(name, value, days) {
    try {
        var d = new Date();
        d.setTime(d.getTime() + (days || 7) * 864e5);
        document.cookie = name + "=" + encodeURIComponent(value) +
            ";expires=" + d.toUTCString() + ";path=/;domain=" + _hubCookieDomain() + ";SameSite=Lax;Secure";
    } catch (e) {}
}
function _readHubCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
}
function _clearHubCookie(name) {
    try {
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + _hubCookieDomain() + ";Secure";
    } catch (e) {}
}

// ---------- 用户对象映射（兼容旧字段） ----------
function _cbMapUser(info) {
    if (!info) return null;
    var email = info.email || info.preferred_username || "";
    var name = info.name || info.nickname || info.preferred_username || email;
    return {
        id: info.sub || email,
        name: name,
        email: email,
        login: email,
        avatar_url: info.picture || info.avatar_url || ""
    };
}

function _cbSaveUser(u) {
    if (!u) return u;
    try { localStorage.setItem(CB_USER_KEY, JSON.stringify(u)); } catch (e) {}
    _writeHubCookie("ms_user", JSON.stringify(u), 7);
    return u;
}

function _cbSaveTokens(accessToken, refreshToken, expiresIn) {
    try {
        localStorage.setItem(CB_AT_KEY, accessToken || "");
        if (refreshToken) localStorage.setItem(CB_RT_KEY, refreshToken);
        // 提前 60 秒判定过期，避免边界时刻用旧 token 调接口
        var exp = Date.now() + (Number(expiresIn) || 3600) * 1000 - 60000;
        localStorage.setItem(CB_EXP_KEY, String(exp));
    } catch (e) {}
}

// ---------- 本地读取 ----------
function cbGetAccessToken() {
    try { return localStorage.getItem(CB_AT_KEY) || ""; } catch (e) { return ""; }
}
function cbGetRefreshToken() {
    try { return localStorage.getItem(CB_RT_KEY) || ""; } catch (e) { return ""; }
}
function cbAccessExpired() {
    var exp = parseInt(localStorage.getItem(CB_EXP_KEY) || "0", 10);
    return !exp || Date.now() >= exp;
}

/** 同步读取当前本地用户（不发起网络请求）。 */
function sbGetUser() {
    try {
        var u = JSON.parse(localStorage.getItem(CB_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    var c = _readHubCookie("ms_user");
    if (c) { try { return JSON.parse(c); } catch (e) {} }
    return null;
}
var msGetUser = sbGetUser;

// ---------- 换 token / 刷新 ----------
async function _cbExchangeCode(code, codeVerifier) {
    var body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CB_CLIENT_ID,
        client_secret: CB_CLIENT_SECRET,
        code: code,
        redirect_uri: CB_REDIRECT_URI,
        code_verifier: codeVerifier || ""
    });
    var r = await fetch(CB_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok || !d.access_token) {
        throw new Error((d && d.msg) || (d && d.error_description) || ("换 token 失败 HTTP " + r.status));
    }
    _cbSaveTokens(d.access_token, d.refresh_token, d.expires_in);
    return d;
}

async function _cbRefresh() {
    var rt = cbGetRefreshToken();
    if (!rt) return null;
    var r = await fetch(CB_REFRESH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt })
    });
    var d = await r.json().catch(function () { return {}; });
    var data = d.data || d;
    if (!r.ok || !data.access_token) throw new Error("刷新令牌失败");
    _cbSaveTokens(data.access_token, data.refresh_token || rt, data.access_exp ? null : 3600);
    return data.access_token;
}

/** 取当前可用 access_token；过期先用 refresh_token 静默续期，失败返回 null。 */
async function sbGetAccessToken() {
    if (!cbAccessExpired()) return cbGetAccessToken();
    try {
        var at = await _cbRefresh();
        if (at) return at;
    } catch (e) {}
    return null;
}
async function msGetToken() { return await sbGetAccessToken(); }
function msPeekToken() {
    if (!cbAccessExpired()) return cbGetAccessToken();
    return null;
}
function msHasToken() { return !!cbGetRefreshToken() || !!cbGetAccessToken(); }

// ---------- 拉取最新用户资料 ----------
async function sbRefreshUser() {
    var at = await sbGetAccessToken();
    if (!at) return null;
    var r = await fetch(CB_USERINFO, { headers: { Authorization: "Bearer " + at } });
    if (!r.ok) return sbGetUser();
    var info = await r.json().catch(function () { return null; });
    var u = _cbMapUser(info);
    if (u) _cbSaveUser(u);
    return u || sbGetUser();
}

// ---------- 登录跳转 ----------
function msLogin(options) {
    var opt = options || {};
    if (opt.returnTo) {
        try { localStorage.setItem("msReturnTo", opt.returnTo); } catch (e) {}
    }
    var verifier = _cbRandomVerifier();
    _cbS256Challenge(verifier).then(function (challenge) {
        try {
            sessionStorage.setItem("r6t5CbCodeVerifier", verifier);
            sessionStorage.setItem("r6t5CbState", _cbRandomVerifier());
        } catch (e) {}
        var state = sessionStorage.getItem("r6t5CbState") || "";
        var params = new URLSearchParams({
            response_type: "code",
            client_id: CB_CLIENT_ID,
            redirect_uri: CB_REDIRECT_URI,
            scope: CB_SCOPE,
            state: state,
            code_challenge: challenge,
            code_challenge_method: "S256"
        });
        location.href = CB_AUTHORIZE + "?" + params.toString();
    });
}

// 读取并清除返回页
function msTakeReturnTo(def) {
    try {
        var v = localStorage.getItem("msReturnTo");
        localStorage.removeItem("msReturnTo");
        if (v) return v;
    } catch (e) {}
    return def || "index.html";
}

/** 非回调页恢复会话：本地有有效（或可刷新）的会话则返回用户，否则 null。 */
async function msHandleRedirect() {
    var u = sbGetUser();
    if (!u) return null;
    try {
        var at = await sbGetAccessToken();
        if (at) {
            var fresh = await sbRefreshUser();
            return fresh || u;
        }
    } catch (e) {}
    return null;
}
async function msResolveAuth(force) { return await msHandleRedirect(); }
function sbResolveAuth() { return sbGetUser(); }

// ---------- 退出 ----------
async function msLogout(redirectUri, opt) {
    var back = (opt && opt.postLogoutRedirectUri) || (location.origin + "/index.html");
    msClearLocal();
    location.href = back;
}

function msClearLocal() {
    try {
        localStorage.removeItem(CB_USER_KEY);
        localStorage.removeItem(CB_AT_KEY);
        localStorage.removeItem(CB_RT_KEY);
        localStorage.removeItem(CB_EXP_KEY);
    } catch (e) {}
    _clearHubCookie("ms_user");
}

// ---------- 旧能力占位（OneDrive/Graph 已停用） ----------
async function graphFetch() { throw new Error("OneDrive 同步已停用"); }
async function msGetDriveQuota() { return { total: 0, used: 0, remaining: 0 }; }
