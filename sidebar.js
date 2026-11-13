// ===== R6T5 Hub 全局侧边栏 =====
// 引入方式：在页面 </body> 前加 <script src="sidebar.js?v=20261113"></script>
// 自动注入汉堡按钮 + 抽屉菜单（参考单词闯关 dict/sidebar.js 的实现）

(function () {
  const current = location.pathname.split("/").pop() || "index.html";

  const items = [
    { icon: "🏠", label: "首页", href: "index.html", match: ["index.html", ""] },
    { icon: "📊", label: "额度状态", href: "egree.html", match: ["egree.html"] },
    { icon: "⚡", label: "单词闯关", href: "https://wordgm.r6t5.dpdns.org", match: [] },
    { icon: "💰", label: "积分钱包", href: "https://wallet.r6t5.dpdns.org", match: [] },
    { icon: "📕", label: "错题本", href: "https://wrobook.r6t5.dpdns.org", match: [] },
    { icon: "📝", label: "TanchiNotes", href: "https://tcnotes.r6t5.cloud-ip.cc", match: [] },
    { icon: "📖", label: "登录帮助", href: "https://my.feishu.cn/wiki/U9Azw3ougiAYb4k99GkcyGxon6g", match: [] },
  ];

  const style = document.createElement("style");
  style.textContent = `
    .hub-sb-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9998;display:none}
    .hub-sb-overlay.show{display:block}
    .hub-sb{position:fixed;top:0;left:0;width:230px;height:100vh;background:linear-gradient(180deg,#161b33,#1a1a2e);z-index:9999;transform:translateX(-100%);transition:transform .25s ease;display:flex;flex-direction:column;padding:16px 0;box-shadow:4px 0 20px rgba(0,0,0,.4);border-right:1px solid rgba(255,215,0,.15)}
    .hub-sb.show{transform:translateX(0)}
    .hub-sb-title{color:#ffd700;font-size:17px;font-weight:bold;text-align:center;padding:6px 0 18px;letter-spacing:2px}
    .hub-sb-item{display:flex;align-items:center;gap:12px;padding:13px 20px;color:#c8c8e8;text-decoration:none;font-size:15px;border-left:3px solid transparent;transition:.15s}
    .hub-sb-item:hover{background:rgba(255,255,255,.06);color:#fff}
    .hub-sb-item.active{background:rgba(255,215,0,.1);color:#ffd700;border-left-color:#ffd700}
    .hub-sb-icon{width:22px;text-align:center;font-size:17px;flex-shrink:0}
    .hub-sb-footer{margin-top:auto;padding:14px 16px;border-top:1px solid rgba(255,255,255,.1);font-size:12px;color:#8888bb;line-height:1.6}
    .hub-sb-toggle{position:fixed;top:14px;left:14px;z-index:9997;width:40px;height:40px;border-radius:10px;background:rgba(22,27,51,.9);border:1px solid rgba(255,215,0,.4);color:#ffd700;cursor:pointer;font-size:19px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
    .hub-sb-toggle:active{transform:scale(.96)}
    @media (max-width:520px){ .hub-sb{width:210px} }
  `;
  document.head.appendChild(style);

  const toggle = document.createElement("button");
  toggle.className = "hub-sb-toggle";
  toggle.type = "button";
  toggle.innerHTML = "☰";
  toggle.setAttribute("aria-label", "菜单");
  document.body.appendChild(toggle);

  const overlay = document.createElement("div");
  overlay.className = "hub-sb-overlay";
  document.body.appendChild(overlay);

  const ext = (href) => href.startsWith("http") ? ' target="_blank" rel="noopener"' : "";
  const isActive = (it) => it.match.indexOf(current) >= 0;

  const sb = document.createElement("div");
  sb.className = "hub-sb";
  sb.innerHTML =
    '<div class="hub-sb-title">⚡ R6T5 Hub</div>' +
    items.map((it) =>
      `<a class="hub-sb-item${isActive(it) ? " active" : ""}" href="${it.href}"${ext(it.href)}>` +
      `<span class="hub-sb-icon">${it.icon}</span><span>${it.label}</span></a>`
    ).join("") +
    '<div class="hub-sb-footer">一个账号，通行全部应用</div>';
  document.body.appendChild(sb);

  function open() { sb.classList.add("show"); overlay.classList.add("show"); }
  function close() { sb.classList.remove("show"); overlay.classList.remove("show"); }
  toggle.onclick = open;
  overlay.onclick = close;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // 避免汉堡按钮遮挡页面内容
  const pad = document.createElement("style");
  pad.textContent = "@media (min-width:0px){ body{ padding-left:0 !important } }";
  document.head.appendChild(pad);
})();
