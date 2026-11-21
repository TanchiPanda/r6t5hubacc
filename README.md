# r6t5hubacc
R6T5 Hub 账号管理中心：统一登录入口与应用导航

## 认证方式

登录走 Cloudreve OAuth 2.0 授权码 + PKCE（`netdisk.r6t5.dpdns.org`）。
换 token / 刷新 / userinfo 经 `functions/api/` 下的 Pages Function 同源代理，
避免 Cloudreve 后端未配置 CORS 导致浏览器直连被拦；`client_secret` 不下发前端。

### CF Pages 环境变量（生产）

在 Pages 项目 Settings → Environment variables 配置：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `CB_CLIENT_ID` | `efdf62d2-e83b-41fd-8bce-7ac453c4fa1e` | OAuth 应用 Client ID |
| `CB_CLIENT_SECRET` | 管理面板 OAuth 应用里的客户端密钥 | 仅服务端可见，勿提交仓库 |
| `CB_BASE_URL` | `https://netdisk.r6t5.dpdns.org` | 可选，缺省即此值 |

回调地址已在 Cloudreve 后台登记为 `https://myacc.r6t5.dpdns.org/callback`，对应 `callback/index.html`。

### 流程

1. 首页点「使用 R6T5 账号登录」→ 跳 Cloudreve 授权页（PKCE）；
2. 回调 `/callback` → `/api/cb-token` 换 access/refresh token → `/api/cb-userinfo` 取身份；
3. access 过期由 `/api/cb-refresh` 静默续期；退出仅清本地。
