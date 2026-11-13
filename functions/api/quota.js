// CF Pages Function：额度查询代理
// 浏览器只访问同源 /api/quota，由 Cloudflare 边缘再向《单词闯关》取数，
// 避免跨子域 fetch 被网络/浏览器拦截（手机上常见 "Load failed"）

const UPSTREAM = "https://wordgm.r6t5.dpdns.org/api/vision";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(context) {
  const { request } = context;
  const auth = request.headers.get("Authorization") || "";
  if (!auth) {
    return new Response(JSON.stringify({ ok: false, error: "缺少登录凭证" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  let body = "{}";
  try {
    body = await request.text();
  } catch (e) {}

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "额度服务暂时连不上，请稍后再试" }),
      { status: 504, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } }
    );
  } finally {
    clearTimeout(timer);
  }
}
