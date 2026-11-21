// CF Pages Function：授权码换 token（服务端转发，规避浏览器 CORS，client_secret 只存环境变量）
// 前端 POST /api/cb-token  body: { code, code_verifier, redirect_uri }
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const base = env.CB_BASE_URL || "https://netdisk.r6t5.dpdns.org";

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.CB_CLIENT_ID,
    client_secret: env.CB_CLIENT_SECRET,
    code: body.code || "",
    redirect_uri: body.redirect_uri || "https://myacc.r6t5.dpdns.org/callback",
    code_verifier: body.code_verifier || ""
  });

  const resp = await fetch(base + "/api/v4/session/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
