import {
  STORAGE_KEY,
  MAX_CONFIG_BYTES,
  ENGINES,
  uid,
  normalizeUrl,
  resolveSearch,
  validateConfig,
  loadConfig,
  saveConfig,
  exportConfig,
} from "./model.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13.1A8.5 8.5 0 0 1 10.9 3.5 8.5 8.5 0 1 0 20.5 13.1Z"/>',
  settings:
    '<path d="m9.5 3-.8 2.2-2 .9-2.2-.4L2 10l1.5 1.7v2L2 15.5l2.5 4.3 2.2-.4 2 .9L9.5 22h5l.8-1.7 2-.9 2.2.4 2.5-4.3-1.5-1.8v-2L22 10l-2.5-4.3-2.2.4-2-.9L14.5 3Z" transform="translate(1 0) scale(.92)"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external: '<path d="M6 18 18 6M6 6h12v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20"/>',
  book: '<path d="M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15"/>',
  layers:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
};
const svg = (name, cls = "") =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" class="${cls}">${paths[name] || paths.grid}</svg>`;
const brandSvg = {
  gmail:
    '<svg viewBox="0 0 32 32" aria-hidden="true" stroke="none"><path fill="#7DA9E8" d="M3 8h5v19H3z"/><path fill="#75B691" d="M24 8h5v19h-5z"/><path fill="#E5B569" d="m24 8 5-3v11l-5 4z"/><path fill="#D97C7C" d="M3 5 16 15 29 5v7L16 22 3 12z"/></svg>',
  drive:
    '<svg viewBox="0 0 32 32" aria-hidden="true" stroke="none"><path fill="#77B99D" d="M11 3h10L10 23H0z"/><path fill="#E7C77A" d="m21 3 11 20H22L11 3z"/><path fill="#84A8E1" d="M0 23h32l-5 8H5z"/></svg>',
  youtube:
    '<svg viewBox="0 0 32 32" aria-hidden="true" stroke="none"><rect x="1" y="6" width="30" height="21" rx="6" fill="#E56470"/><path d="m13 11 9 5.5-9 5.5z" fill="#fff"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" aria-hidden="true" stroke="none" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.6 9.6 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>',
  figma:
    '<svg viewBox="0 0 24 32" aria-hidden="true" stroke="none"><path fill="#DE8783" d="M6 0h6v11H6A5.5 5.5 0 0 1 6 0"/><path fill="#E9AE93" d="M12 0h6a5.5 5.5 0 0 1 0 11h-6"/><path fill="#BA9CDC" d="M6 11h6v10H6a5 5 0 0 1 0-10"/><circle fill="#83B7D9" cx="17" cy="16" r="5"/><path fill="#83BBA0" d="M6 21h6v5.5A5.5 5.5 0 1 1 6 21"/></svg>',
  slack:
    '<svg viewBox="0 0 24 24" aria-hidden="true" stroke-width="4"><path stroke="#7EC8D1" d="M9 3v6M3 9h1"/><path stroke="#89BCA2" d="M15 3h1m-1 6h6"/><path stroke="#D7ACCC" d="M3 15h6m0 6v-1"/><path stroke="#DBB47C" d="M15 15v6m6-6h-1"/></svg>',
  stackoverflow:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke="currentColor" d="M5 16v5h15v-5M8 17h9M8 13l9 2M9 9l9 4m-7-8 8 6m-4-9 6 8" stroke-width="1.8"/></svg>',
  randolf:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 15c4-12 7-12 10-3s7 4 10-2" stroke="currentColor" stroke-width="2"/></svg>',
  chatgpt:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5"><path id="petal" d="M14 4c7-5 15 5 8 10l-8 5-7-4V7l7-4 7 4v8l-7 4"/><path d="M4 14C-1 7 9-1 14 6l5 8-4 7H7l-4-7 4-7h8l4 7" transform="rotate(30 14 14)"/><path d="M14 24c-7 5-15-5-8-10l8-5 7 4v8l-7 4-7-4v-8l7-4"/></g></svg>',
  linear:
    '<svg viewBox="0 0 28 28" aria-hidden="true" stroke="none" fill="currentColor"><path d="M4 6a12 12 0 0 1 18 16ZM2 10l16 16a12 12 0 0 1-3 0L2 13ZM2 17l9 9a12 12 0 0 1-9-9Z"/></svg>',
};
function brand(link) {
  const classes = {
    notion: "brand-notion",
    mdn: "brand-mdn",
    wikipedia: "brand-wikipedia",
    vercel: "brand-vercel",
    github: "brand-github",
  };
  const letters = {
    notion: "N",
    mdn: "M",
    wikipedia: "W",
    vercel: "▲",
    medium: "●◖",
    substack: "▤",
  };
  const drawing = Object.hasOwn(brandSvg, link.icon) ? brandSvg[link.icon] : "";
  const letter = Object.hasOwn(letters, link.icon) ? letters[link.icon] : "";
  const className = Object.hasOwn(classes, link.icon)
    ? classes[link.icon]
    : drawing || letter
      ? ""
      : "brand-tile";
  return `<span class="brand-icon ${className}" style="--brand:${esc(link.color)}" aria-hidden="true">${drawing || esc(letter || link.title.slice(0, 1).toUpperCase())}</span>`;
}
let storage;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
const loaded = loadConfig(storage);
let config = loaded.config;
let editing = false;
let toastTimer;
let clockTimer;
let pendingExternal = false;
function readStorageSnapshot() {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
}
let storedSnapshot = readStorageSnapshot();
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const settingsDialog = $("#settings-dialog");
const editorDialog = $("#editor-dialog");
const confirmDialog = $("#confirm-dialog");
const toastElement = $("#toast");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$("#modifier-key").textContent = isMac ? "⌘" : "Ctrl";
$("#settings-open").innerHTML = svg("settings");
$("#search-submit").innerHTML = svg("arrow");
$$(".dialog-close").forEach((button) => {
  button.innerHTML = svg("close");
  button.addEventListener("click", () => button.closest("dialog").close());
});
$("#add-category").innerHTML = `${svg("plus")}添加分类`;

function toast(message, persistent = false) {
  clearTimeout(toastTimer);
  const dialogs = $$("dialog[open]");
  (dialogs.at(-1) || document.body).append(toastElement);
  toastElement.textContent = message;
  toastElement.hidden = false;
  if (!persistent)
    toastTimer = setTimeout(() => {
      toastElement.hidden = true;
    }, 4000);
}
function canMutateConfig() {
  const latest = readStorageSnapshot();
  if (!pendingExternal && (latest === undefined || latest === storedSnapshot))
    return true;
  pendingExternal = true;
  if (document.querySelector("dialog[open]")) {
    const message =
      "另一标签页已更新配置。请先关闭所有弹窗以同步，再重新编辑；当前表单尚未保存。";
    if (editorDialog.open && $("#editor-error")) editorError(message);
    toast(message, true);
  } else {
    reloadFromStorage();
    toast("已读取另一标签页的配置，请重试刚才的操作。");
  }
  return false;
}
function persist() {
  const result = saveConfig(storage, config);
  const footer = $(".footer-local");
  footer.classList.toggle("storage-warning", !result.ok);
  if (!result.ok) {
    footer.textContent = "暂未保存 · 请导出备份";
    toast("浏览器未能保存配置。当前改动仍可使用，请在设置中导出备份。", true);
  } else {
    storedSnapshot = readStorageSnapshot();
    footer.innerHTML = '<span class="tiny-dot"></span>只存于此刻的浏览器';
  }
  return result.ok;
}
function applyTheme() {
  const theme =
    config.settings.theme === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : config.settings.theme;
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').content =
    theme === "dark" ? "#0b1426" : "#e9eef2";
  $("#theme-toggle").innerHTML = svg(theme === "dark" ? "moon" : "sun");
  $("#theme-toggle").setAttribute(
    "aria-label",
    `切换到${theme === "dark" ? "日间" : "夜间"}主题`,
  );
  $$("[data-theme-choice]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      button.dataset.themeChoice === config.settings.theme,
    ),
  );
}
function updateClock() {
  const now = new Date();
  const hour = config.settings.clock24
    ? now.getHours()
    : now.getHours() % 12 || 12;
  $("#clock").innerHTML =
    `<span>${String(hour).padStart(2, "0")}</span><span class="clock-colon">:</span><span>${String(now.getMinutes()).padStart(2, "0")}</span>${config.settings.showSeconds ? `<span class="clock-seconds">${String(now.getSeconds()).padStart(2, "0")}</span>` : ""}`;
  $("#clock").dateTime = now.toISOString();
  $(".clock").setAttribute(
    "aria-label",
    `当前时间 ${now.toLocaleTimeString("zh-CN", { hour12: !config.settings.clock24 })}`,
  );
  $(".clock").classList.toggle("has-seconds", config.settings.showSeconds);
  $("#period").hidden = config.settings.clock24;
  $("#period").textContent = now.getHours() < 12 ? "AM" : "PM";
  $("#date").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  $("#date").dateTime =
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  $("#weekday").textContent = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
  }).format(now);
  clearTimeout(clockTimer);
  if (!document.hidden)
    clockTimer = setTimeout(
      updateClock,
      config.settings.showSeconds
        ? 1000 - now.getMilliseconds()
        : 60000 - now.getSeconds() * 1000 - now.getMilliseconds(),
    );
}
function syncPreferences() {
  $("#search-engine").value = config.settings.engine;
  $("#setting-engine").value = config.settings.engine;
  $("#engine-mark").textContent = ENGINES.find(
    (engine) => engine.id === config.settings.engine,
  ).short;
  $("#setting-newtab").checked = config.settings.newTab;
  $("#setting-clock24").checked = config.settings.clock24;
  $("#setting-seconds").checked = config.settings.showSeconds;
  applyTheme();
  updateClock();
  $("#search").dispatchEvent(new Event("input"));
}
function smallButton(action, label, icon, disabled = false) {
  return `<button type="button" class="small-button" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${disabled ? "disabled" : ""}>${svg(icon)}</button>`;
}
function renderCategories(focusAction) {
  $(".destinations").classList.toggle("is-editing", editing);
  $("#edit-toggle").innerHTML =
    `${svg(editing ? "check" : "edit")}${editing ? "完成整理" : "整理"}`;
  $("#edit-toggle").setAttribute("aria-pressed", String(editing));
  $("#add-category").hidden = !editing;
  $("#categories").innerHTML = config.categories
    .map(
      (
        category,
        categoryIndex,
      ) => `<section class="category" data-category="${esc(category.id)}" aria-label="${esc(category.name)}">
    <div class="category-heading">${svg(category.icon)}<h2>${esc(category.name)}</h2><span class="category-count">${String(category.links.length).padStart(2, "0")}</span><div class="category-actions">
    ${editing ? smallButton("category-up", `上移分类 ${category.name}`, "up", categoryIndex === 0) + smallButton("category-down", `下移分类 ${category.name}`, "down", categoryIndex === config.categories.length - 1) + smallButton("edit-category", `编辑分类 ${category.name}`, "edit") : ""}
    <button class="small-button category-add" type="button" data-action="add-link" aria-label="添加链接到 ${esc(category.name)}" title="添加快捷链接">${svg("plus")}</button></div></div>
    <div class="link-grid">${category.links.map((link, index) => `<div class="link-card" data-link="${esc(link.id)}"><a class="shortcut" href="${esc(link.url)}" ${config.settings.newTab ? 'target="_blank" rel="noopener noreferrer"' : ""} title="${esc(link.title)} · ${esc(link.url)}">${brand(link)}<span class="link-copy"><span class="link-title">${esc(link.title)}</span><span class="link-description">${esc(link.description || new URL(link.url).hostname)}</span></span>${svg("external", "link-arrow")}</a>${editing ? `<div class="link-controls">${smallButton("edit-link", `编辑链接 ${link.title}`, "edit")}${smallButton("link-left", `前移链接 ${link.title}`, "left", index === 0)}${smallButton("link-right", `后移链接 ${link.title}`, "right", index === category.links.length - 1)}</div>` : ""}</div>`).join("") || `<button class="empty-category" data-action="add-link" type="button">${svg("plus")}添加第一个快捷链接</button>`}</div></section>`,
    )
    .join("");
  if (!config.categories.length)
    $("#categories").innerHTML =
      '<button class="empty-category" data-action="new-category" type="button">添加你的第一个分类，让常用网址在这里安家。</button>';
  if (focusAction) {
    const elements = $$("[data-action]", $("#categories"));
    elements
      .find(
        (el) =>
          el.dataset.action === focusAction.action &&
          el.closest("[data-category]")?.dataset.category ===
            focusAction.category &&
          (!focusAction.link ||
            el.closest("[data-link]")?.dataset.link === focusAction.link),
      )
      ?.focus();
  }
}
function toggleEditing(value = !editing) {
  editing = value;
  renderCategories();
}
function setPreference(key, value) {
  if (!canMutateConfig()) {
    syncPreferences();
    return;
  }
  config.settings[key] = value;
  syncPreferences();
  if (key === "newTab") renderCategories();
  persist();
}
function openSettings(help = false) {
  syncPreferences();
  settingsDialog.showModal();
  if (help) $("#shortcuts-section").scrollIntoView({ block: "center" });
  else settingsDialog.scrollTop = 0;
}
function closeOnBackdrop(event) {
  if (event.target !== event.currentTarget) return;
  const box = event.currentTarget.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    event.currentTarget.close();
}
$$("dialog").forEach((dialog) => {
  dialog.addEventListener("click", closeOnBackdrop);
  dialog.addEventListener("close", () => {
    if (toastElement.closest("dialog") === dialog) {
      const remaining = $$("dialog[open]");
      (remaining.at(-1) || document.body).append(toastElement);
    }
    if (pendingExternal && !document.querySelector("dialog[open]"))
      reloadFromStorage();
  });
});
function showConfirm({
  title,
  message,
  label = "确认",
  destructive = false,
  onConfirm,
}) {
  confirmDialog.innerHTML = `<div class="modal-heading"><h2 id="confirm-title">${esc(title)}</h2><button class="icon-button" data-close type="button" aria-label="关闭确认">${svg("close")}</button></div><div class="confirm-body"><p>${esc(message)}</p><div class="form-actions"><button class="secondary-button" data-close type="button">取消</button><button class="primary-button ${destructive ? "destructive" : ""}" id="confirm-accept" type="button">${esc(label)}</button></div></div>`;
  $$("[data-close]", confirmDialog).forEach(
    (button) => (button.onclick = () => confirmDialog.close()),
  );
  $("#confirm-accept").onclick = () => {
    if (!canMutateConfig()) return;
    confirmDialog.close();
    onConfirm();
  };
  confirmDialog.showModal();
  $(".secondary-button", confirmDialog).focus();
}
function openCategory(category = null) {
  if (!category && config.categories.length >= 50)
    return toast("最多可以添加 50 个分类。");
  editorDialog.innerHTML = `<div class="modal-heading"><div><p class="eyebrow">A PLACE FOR EVERYTHING</p><h2 id="editor-title">${category ? "编辑分类" : "添加分类"}</h2></div><button class="icon-button" data-close type="button" aria-label="关闭编辑">${svg("close")}</button></div><form class="editor-form" id="category-form"><label class="field">分类名称<input name="name" required maxlength="60" placeholder="例如：灵感收集" value="${esc(category?.name || "")}"></label><label class="field">分类图标<select name="icon">${[
    ["grid", "日常 · 方格"],
    ["code", "开发 · 代码"],
    ["book", "阅读 · 书本"],
    ["layers", "工具 · 应用"],
  ]
    .map(
      ([id, label]) =>
        `<option value="${id}" ${category?.icon === id ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></label><p class="error-message" id="editor-error" role="alert" hidden></p><div class="form-actions">${category ? '<button class="danger-button" id="delete-category" type="button">删除分类</button>' : ""}<button class="secondary-button" type="button" data-close>取消</button><button class="primary-button" type="submit">${category ? "保存修改" : "添加分类"}</button></div></form>`;
  bindEditorClose();
  $("#category-form").onsubmit = (event) => {
    event.preventDefault();
    if (!canMutateConfig()) return;
    const data = new FormData(event.currentTarget),
      name = data.get("name").trim();
    if (!name) return editorError("请输入分类名称。");
    if (category) Object.assign(category, { name, icon: data.get("icon") });
    else
      config.categories.push({
        id: uid(),
        name,
        icon: data.get("icon"),
        links: [],
      });
    persist();
    renderCategories();
    editorDialog.close();
    toast(category ? "分类已更新。" : "新分类已添加。");
  };
  if (category)
    $("#delete-category").onclick = () =>
      showConfirm({
        title: "删除这个分类？",
        message: `“${category.name}”及其中的 ${category.links.length} 个快捷链接将一并删除。`,
        label: "删除分类",
        destructive: true,
        onConfirm: () => {
          config.categories = config.categories.filter(
            (item) => item.id !== category.id,
          );
          persist();
          renderCategories();
          editorDialog.close();
          toast("分类已删除。");
        },
      });
  editorDialog.showModal();
}
function bindEditorClose() {
  $$("[data-close]", editorDialog).forEach(
    (button) => (button.onclick = () => editorDialog.close()),
  );
}
function editorError(message) {
  $("#editor-error").textContent = message;
  $("#editor-error").hidden = false;
}
function openLink(category, link = null) {
  if (!link && category.links.length >= 100)
    return toast("每个分类最多可以添加 100 个链接。");
  editorDialog.innerHTML = `<div class="modal-heading"><div><p class="eyebrow">KEEP THE GOOD THINGS CLOSE</p><h2 id="editor-title">${link ? "编辑快捷链接" : "添加快捷链接"}</h2></div><button class="icon-button" data-close type="button" aria-label="关闭编辑">${svg("close")}</button></div><form class="editor-form" id="link-form"><label class="field">名称<input name="title" required maxlength="80" placeholder="例如：我的灵感库" value="${esc(link?.title || "")}"></label><label class="field">网址<input name="url" type="text" inputmode="url" required maxlength="2048" spellcheck="false" placeholder="example.com" value="${esc(link?.url || "")}"></label><label class="field">描述 <span class="field-optional">可选</span><input name="description" maxlength="120" placeholder="一句简短的说明" value="${esc(link?.description || "")}"></label><div class="field-row"><label class="field">所属分类<select name="category">${config.categories.map((item) => `<option value="${esc(item.id)}" ${item.id === category.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label class="field">图标颜色<input name="color" type="color" value="${esc(link?.color || "#819BC9")}"></label></div><p class="field-hint">已知网站使用本地图标，其他网站以名称首字显示。</p><p class="error-message" id="editor-error" role="alert" hidden></p><div class="form-actions">${link ? '<button class="danger-button" id="delete-link" type="button">删除链接</button>' : ""}<button class="secondary-button" type="button" data-close>取消</button><button class="primary-button" type="submit">${link ? "保存修改" : "添加链接"}</button></div></form>`;
  bindEditorClose();
  $("#link-form").onsubmit = (event) => {
    event.preventDefault();
    if (!canMutateConfig()) return;
    try {
      const data = new FormData(event.currentTarget),
        title = data.get("title").trim();
      if (!title) throw Error("请输入链接名称。");
      const url = normalizeUrl(data.get("url"));
      const destination = config.categories.find(
        (item) => item.id === data.get("category"),
      );
      if (
        (!link || destination !== category) &&
        destination.links.length >= 100
      )
        throw Error("目标分类已达到 100 个链接的上限。");
      const known = detectBrand(url);
      const value = {
        id: link?.id || uid(),
        title,
        url,
        description: data.get("description").trim(),
        color: data.get("color"),
        icon: known || "custom",
      };
      if (link && destination === category)
        category.links[
          category.links.findIndex((item) => item.id === link.id)
        ] = value;
      else {
        if (link)
          category.links = category.links.filter((item) => item.id !== link.id);
        destination.links.push(value);
      }
      persist();
      renderCategories();
      editorDialog.close();
      toast(link ? "快捷链接已更新。" : "新的去处，已收藏。");
    } catch (error) {
      editorError(error.message);
    }
  };
  if (link)
    $("#delete-link").onclick = () =>
      showConfirm({
        title: "删除这个链接？",
        message: `“${link.title}”将从“${category.name}”中移除。`,
        label: "删除链接",
        destructive: true,
        onConfirm: () => {
          category.links = category.links.filter((item) => item.id !== link.id);
          persist();
          renderCategories();
          editorDialog.close();
          toast("快捷链接已删除。");
        },
      });
  editorDialog.showModal();
}
function detectBrand(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const brands = {
    "chatgpt.com": "chatgpt",
    "mail.google.com": "gmail",
    "notion.so": "notion",
    "notion.com": "notion",
    "drive.google.com": "drive",
    "github.com": "github",
    "developer.mozilla.org": "mdn",
    "stackoverflow.com": "stackoverflow",
    "vercel.com": "vercel",
    "wikipedia.org": "wikipedia",
    "youtube.com": "youtube",
    "medium.com": "medium",
    "substack.com": "substack",
    "randolf.dev": "randolf",
    "figma.com": "figma",
    "linear.app": "linear",
    "slack.com": "slack",
  };
  return Object.entries(brands).find(
    ([domain]) => host === domain || host.endsWith(`.${domain}`),
  )?.[1];
}
$("#categories").onclick = (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "new-category") return openCategory();
  const category = config.categories.find(
    (item) => item.id === button.closest("[data-category]")?.dataset.category,
  );
  if (!category) return;
  const link = category.links.find(
    (item) => item.id === button.closest("[data-link]")?.dataset.link,
  );
  if (action === "add-link") return openLink(category);
  if (action === "edit-category") return openCategory(category);
  if (action === "edit-link") return openLink(category, link);
  const list = action.startsWith("category-")
    ? config.categories
    : category.links;
  const index = list.indexOf(action.startsWith("category-") ? category : link);
  const offset = ["category-up", "link-left"].includes(action) ? -1 : 1;
  if (index < 0 || index + offset < 0 || index + offset >= list.length) return;
  if (!canMutateConfig()) return;
  [list[index], list[index + offset]] = [list[index + offset], list[index]];
  persist();
  renderCategories({
    action: action.startsWith("category-") ? "edit-category" : "edit-link",
    category: category.id,
    link: link?.id,
  });
};
$("#edit-toggle").onclick = () => toggleEditing();
$("#add-category").onclick = () => openCategory();
$("#settings-open").onclick = () => openSettings();
$("#help-open").onclick = () => openSettings(true);
$("#theme-toggle").onclick = () =>
  setPreference(
    "theme",
    document.documentElement.dataset.theme === "dark" ? "light" : "dark",
  );
$$("[data-theme-choice]").forEach(
  (button) =>
    (button.onclick = () => setPreference("theme", button.dataset.themeChoice)),
);
$("#setting-newtab").onchange = (event) =>
  setPreference("newTab", event.target.checked);
$("#setting-clock24").onchange = (event) =>
  setPreference("clock24", event.target.checked);
$("#setting-seconds").onchange = (event) =>
  setPreference("showSeconds", event.target.checked);
$("#setting-engine").onchange = $("#search-engine").onchange = (event) =>
  setPreference("engine", event.target.value);
systemTheme.addEventListener("change", applyTheme);
document.addEventListener("visibilitychange", updateClock);
$("#search-form").onsubmit = (event) => {
  event.preventDefault();
  if (!$("#search").value.trim()) {
    $("#search").focus();
    return;
  }
  try {
    const result = resolveSearch($("#search").value, config.settings.engine);
    if (config.settings.newTab) {
      window.open(result.url, "_blank", "noopener,noreferrer");
      $("#search").select();
    } else window.location.assign(result.url);
  } catch (error) {
    toast(error.message);
    $("#search").focus();
  }
};
$("#search").oninput = () => {
  const value = $("#search").value.trim();
  let text = "让好奇心，带你去远一点的地方。";
  if (value) {
    try {
      const result = resolveSearch(value, config.settings.engine);
      text =
        result.kind === "url"
          ? `直接前往 ${new URL(result.url).hostname}`
          : `使用 ${ENGINES.find((item) => item.id === config.settings.engine).label} 搜索`;
    } catch {
      text = "请输入搜索内容或 http / https 网址。";
    }
  }
  $("#search-caption").textContent = text;
};
$("#export-config").onclick = () => {
  const blob = new Blob([exportConfig(config)], { type: "application/json" });
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `START-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("配置已导出，请妥善保存备份。");
};
$("#import-config").onclick = () => $("#import-file").click();
$("#import-file").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_CONFIG_BYTES) throw Error("配置文件不能超过 16 MB。");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw Error("无法读取配置，请选择 START 导出的 JSON 文件。");
    }
    const imported = validateConfig(parsed);
    const count = imported.categories.reduce(
      (sum, category) => sum + category.links.length,
      0,
    );
    showConfirm({
      title: "导入这份配置？",
      message: `已验证 ${imported.categories.length} 个分类、${count} 个链接。导入将替换当前导航和设置；建议先导出当前配置作为备份。`,
      label: "导入并替换",
      onConfirm: () => {
        config = imported;
        syncPreferences();
        renderCategories();
        persist();
        toast("配置已导入，欢迎回来。");
      },
    });
  } catch (error) {
    toast(`导入失败：${error.message}`, true);
  }
};
document.addEventListener("keydown", (event) => {
  const typing = event.target.closest(
    'input,textarea,select,[contenteditable="true"]',
  );
  const modal = document.querySelector("dialog[open]");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    if (!modal) {
      event.preventDefault();
      $("#search").focus();
      $("#search").select();
    }
    return;
  }
  if (event.key === "Escape" && !modal) {
    if (editing) {
      toggleEditing(false);
      $("#edit-toggle").focus();
    } else if (event.target === $("#search")) {
      $("#search").value = "";
      $("#search").dispatchEvent(new Event("input"));
      $("#search").blur();
    }
    return;
  }
  if (typing || modal || event.ctrlKey || event.metaKey) return;
  if (event.key === "/" && !event.altKey) {
    event.preventDefault();
    $("#search").focus();
  }
  if (event.key === "?" && !event.altKey) {
    event.preventDefault();
    openSettings(true);
  }
  if (event.altKey && event.key.toLowerCase() === "e") {
    event.preventDefault();
    toggleEditing();
    $("#edit-toggle").focus();
  }
});
function reloadFromStorage() {
  const next = loadConfig(storage);
  if (!next.error) {
    config = next.config;
    storedSnapshot = readStorageSnapshot();
    pendingExternal = false;
    syncPreferences();
    renderCategories();
    toast("已同步另一标签页的配置。");
  } else toast(next.error, true);
}
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  if (readStorageSnapshot() === storedSnapshot) return;
  if (document.querySelector("dialog[open]")) {
    pendingExternal = true;
    toast("另一标签页更新了配置，将在关闭弹窗后同步。");
  } else reloadFromStorage();
});
syncPreferences();
renderCategories();
if (loaded.error) {
  $(".footer-local").textContent = "配置读取异常 · 请检查备份";
  $(".footer-local").classList.add("storage-warning");
  toast(`配置读取异常，已临时使用默认导航。${loaded.error}`, true);
}
