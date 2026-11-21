// CF Pages Function：userinfo 代理（服务端转发，规避 CORS）
// 前端 GET /api/cb-userinfo  带 Authorization: Bearer <access_token>
export async function onRequest(context) {
  const { request, env } = context;
  const base = env.CB_BASE_URL || "https://netdisk.r6t5.dpdns.org";
  const auth = request.headers.get("Authorization") || "";

  const resp = await fetch(base + "/api/v4/session/oauth/userinfo", {
    headers: { Authorization: auth }
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
