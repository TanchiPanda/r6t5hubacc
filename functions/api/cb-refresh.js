// CF Pages Function：refresh_token 静默续期（服务端转发）
// 前端 POST /api/cb-refresh  body: { refresh_token }
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const base = env.CB_BASE_URL || "https://netdisk.r6t5.dpdns.org";

  const resp = await fetch(base + "/api/v4/session/token/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: body.refresh_token || "" })
  });
  const data = await resp.text();
  return new Response(data, {
    status: resp.status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
