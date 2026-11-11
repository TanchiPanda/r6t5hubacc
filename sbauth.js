// ===== Supabase 认证模块（R6T5 Hub 账号中心）=====
// 登录走 Supabase Auth；业务数据（积分/会员）仍存 Cloudflare D1，user_id 用邮箱。
// 兼容原 msauth.js 的函数名（msLogin/msGetUser/msLogout/msHandleRedirect/msTakeReturnTo）。

// ---------- 节点判断：country=cn 走中国大陆服务器，否则走国际/CF 节点 ----------
function _detectChinaNode() {
    try {
        var p = new URLSearchParams(location.search || "");
        if (p.get("country") === "cn") {
            try { sessionStorage.setItem("wordGameCountry", "cn"); } catch (e) {}
            return true;
        }
        if (p.get("country") === "intl" || p.get("country") === "cf") {
            try { sessionStorage.removeItem("wordGameCountry"); } catch (e) {}
            return false;
        }
    } catch (e) {}
    // 从 return URL 解析 country=cn（Word_Funny_Game 跳回时会带上）
    try {
        var p2 = new URLSearchParams(location.search || "");
        var ret = p2.get("return") || "";
        if (ret && /[?&]country=cn/.test(ret)) {
            try { sessionStorage.setItem("wordGameCountry", "cn"); } catch (e) {}
            return true;
        }
    } catch (e) {}
    try {
        if (sessionStorage.getItem("wordGameCountry") === "cn") return true;
    } catch (e) {}
    return false;
}

var IS_CN_NODE = _detectChinaNode();

var CN_SB_URL  = "https://bxanbosouqnezggwdqhs.supabase.co";
var CN_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4YW5ib3NvdXFuZXpnZ3dkcWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNDg5NjAsImV4cCI6MjEwOTkyNDk2MH0.a29TONXcHs6lssvNw0KCAMVw6KkWsgysH5fiM3Pr0HM";

var INTL_SB_URL  = "https://fckqmlwkujixwztzqqni.supabase.co";
var INTL_SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZja3FtbHdrdWppeHd6dHpxcW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMjkzODksImV4cCI6MjEwNTkwNTM4OX0.W6FHJ-CgNNuCO9xEcrNuLj2y6-1D6Gyy72D0oGmA7Xw";

var SB_URL   = IS_CN_NODE ? CN_SB_URL : INTL_SB_URL;
var SB_ANON  = IS_CN_NODE ? CN_SB_ANON : INTL_SB_ANON;

var SB_USER_KEY    = "wordGameGitHubUser";
var SB_USERS_KEY   = "wordGameUsersArr";
var SB_ACTIVE_KEY  = "wordGameActiveEmail";
var _sb = null;
var _sbPromise = null;

function _injectSupabase() {
    if (_sbPromise) return _sbPromise;
    _sbPromise = new Promise(function (resolve, reject) {
        if (window.supabase && window.supabase.createClient) return resolve();
        var urls = [
            "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
            "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js"
        ];
        var i = 0;
        (function next() {
            if (i >= urls.length) return reject(new Error("Supabase 库加载失败，请检查网络"));
            var s = document.createElement("script");
            s.src = urls[i++];
            s.onload = function () {
                if (window.supabase && window.supabase.createClient) resolve();
                else next();
            };
            s.onerror = next;
            document.head.appendChild(s);
        })();
    });
    return _sbPromise;
}

async function sbInit() {
    if (_sb) return _sb;
    await _injectSupabase();
    _sb = window.supabase.createClient(SB_URL, SB_ANON, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            experimental: { passkey: !IS_CN_NODE }
        }
    });
    return _sb;
}

function _mapUser(sbUser) {
    if (!sbUser) return null;
    var email = sbUser.email || (sbUser.user_metadata && sbUser.user_metadata.email) || "";
    var name = (sbUser.user_metadata && (sbUser.user_metadata.name || sbUser.user_metadata.full_name)) || email;
    return {
        id: sbUser.id || email,
        name: name,
        email: email,
        login: email,
        avatar_url: (sbUser.user_metadata && sbUser.user_metadata.avatar_url) || ""
    };
}

function _readUsersArr() {
    try {
        var arr = JSON.parse(localStorage.getItem(SB_USERS_KEY) || "[]");
        if (Array.isArray(arr)) return arr;
    } catch (e) {}
    return [];
}
function _writeUsersArr(arr) {
    try { localStorage.setItem(SB_USERS_KEY, JSON.stringify(arr)); } catch (e) {}
}
function _upsertUser(u) {
    if (!u || !u.email) return u;
    var arr = _readUsersArr();
    var idx = -1;
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].user && arr[i].user.email === u.email) { idx = i; break; }
    }
    var rec = { user: u, node: IS_CN_NODE ? "cn" : "us", savedAt: Date.now() };
    if (idx >= 0) arr[idx] = rec;
    else arr.push(rec);
    _writeUsersArr(arr);
    try { localStorage.setItem(SB_ACTIVE_KEY, u.email); } catch (e) {}
    return u;
}

function _saveAuth(u) {
    if (!u) return u;
    try { localStorage.setItem(SB_USER_KEY, JSON.stringify(u)); } catch (e) {}
    _upsertUser(u);
    _writeHubCookie("ms_user", JSON.stringify(u), 7);
    return u;
}

function sbGetUser() {
    try {
        var u = JSON.parse(localStorage.getItem(SB_USER_KEY) || "null");
        if (u && (u.id || u.email)) return u;
    } catch (e) {}
    var c = _readHubCookie("ms_user");
    if (c) { try { return JSON.parse(c); } catch (e) {} }
    return null;
}

function sbListUsers(nodeFilter) {
    var arr = _readUsersArr();
    if (nodeFilter) return arr.filter(function (r) { return r.node === nodeFilter; });
    return arr;
}

function sbSetActive(email) {
    var arr = _readUsersArr();
    for (var i = 0; i < arr.length; i++) {
        if (arr[i].user && arr[i].user.email === email) {
            try {
                localStorage.setItem(SB_USER_KEY, JSON.stringify(arr[i].user));
                localStorage.setItem(SB_ACTIVE_KEY, email);
            } catch (e) {}
            return arr[i].user;
        }
    }
    return null;
}

function sbRemoveUser(email) {
    var arr = _readUsersArr().filter(function (r) {
        return !(r.user && r.user.email === email);
    });
    _writeUsersArr(arr);
    try {
        if (localStorage.getItem(SB_ACTIVE_KEY) === email) {
            localStorage.removeItem(SB_ACTIVE_KEY);
            localStorage.removeItem(SB_USER_KEY);
        }
    } catch (e) {}
}

async function sbRefreshUser() {
    var client = await sbInit();
    var { data } = await client.auth.getSession();
    if (data && data.session && data.session.user) {
        return _saveAuth(_mapUser(data.session.user));
    }
    return null;
}

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

function msLogin(options) {
    var opt = options || {};
    if (opt.returnTo) {
        try { localStorage.setItem("msReturnTo", opt.returnTo); } catch (e) {}
    }
    location.href = "/?country=" + (IS_CN_NODE ? "cn" : "intl");
}

function msTakeReturnTo(def) {
    try {
        var v = localStorage.getItem("msReturnTo");
        localStorage.removeItem("msReturnTo");
        if (v) return v;
    } catch (e) {}
    return def || "index.html";
}

async function msHandleRedirect(redirectUri) {
    var client = await sbInit();
    var params = new URLSearchParams(location.search);
    if (params.get("code") || location.hash.indexOf("access_token") >= 0) {
        var { data, error } = await client.auth.getSessionFromUrl({ storeSession: true });
        if (!error && data && data.session) {
            return _saveAuth(_mapUser(data.session.user));
        }
    }
    var u = await sbRefreshUser();
    return u;
}

async function msLogout(redirectUri, opt) {
    var back = (opt && opt.postLogoutRedirectUri) || (location.origin + "/index.html");
    try {
        var client = await sbInit();
        await client.auth.signOut();
    } catch (e) {}
    try { localStorage.removeItem(SB_USER_KEY); } catch (e) {}
    _clearHubCookie("ms_user");
    location.href = back;
}

var msGetUser = sbGetUser;
function msClearLocal() {
    try { localStorage.removeItem(SB_USER_KEY); } catch (e) {}
    _clearHubCookie("ms_user");
}
async function msGetToken() { return null; }
function msPeekToken() { return null; }
function msHasToken() { return false; }
async function graphFetch() { throw new Error("OneDrive 同步已停用"); }
async function msGetDriveQuota() { return { total: 0, used: 0, remaining: 0 }; }
