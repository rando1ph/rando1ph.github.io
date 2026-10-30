/** The standalone START data model. No DOM or network access is required. */
export const STORAGE_KEY = "randolf-start-v1";
// The shared UTF-8 limit also applies to import files in the UI. Compact JSON at
// the schema's maximum 50 × 100 records fits within this limit.
export const MAX_CONFIG_BYTES = 16 * 1024 * 1024;

export const ENGINES = Object.freeze([
  Object.freeze({
    id: "google",
    label: "Google",
    short: "G",
    url: "https://www.google.com/search?q={query}",
  }),
  Object.freeze({
    id: "bing",
    label: "Bing",
    short: "B",
    url: "https://www.bing.com/search?q={query}",
  }),
  Object.freeze({
    id: "duckduckgo",
    label: "DuckDuckGo",
    short: "D",
    url: "https://duckduckgo.com/?q={query}",
  }),
  Object.freeze({
    id: "baidu",
    label: "百度",
    short: "百",
    url: "https://www.baidu.com/s?wd={query}",
  }),
]);

const CATEGORY_ICONS = new Set(["grid", "code", "book", "layers"]);
const THEMES = new Set(["system", "light", "dark"]);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ICON_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const UNSAFE_SEARCH_SCHEME = /^(?:javascript|data|file|vbscript|blob|about):/i;

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createDefaults() {
  return {
    version: 1,
    settings: {
      theme: "system",
      engine: "google",
      newTab: true,
      clock24: true,
      showSeconds: false,
    },
    categories: [
      {
        id: "daily",
        name: "Daily",
        icon: "grid",
        links: [
          {
            id: "chatgpt",
            title: "ChatGPT",
            url: "https://chatgpt.com/",
            description: "AI assistant",
            color: "#70BDAA",
            icon: "chatgpt",
          },
          {
            id: "gmail",
            title: "Gmail",
            url: "https://mail.google.com/",
            description: "Email",
            color: "#EA685D",
            icon: "gmail",
          },
          {
            id: "notion",
            title: "Notion",
            url: "https://www.notion.so/",
            description: "Notes & docs",
            color: "#DFE4F1",
            icon: "notion",
          },
          {
            id: "drive",
            title: "Google Drive",
            url: "https://drive.google.com/",
            description: "Files & storage",
            color: "#79BCA5",
            icon: "drive",
          },
        ],
      },
      {
        id: "development",
        name: "Development",
        icon: "code",
        links: [
          {
            id: "github",
            title: "GitHub",
            url: "https://github.com/",
            description: "Code & projects",
            color: "#DFE4F1",
            icon: "github",
          },
          {
            id: "mdn",
            title: "MDN",
            url: "https://developer.mozilla.org/",
            description: "Web docs",
            color: "#BFCBF8",
            icon: "mdn",
          },
          {
            id: "stackoverflow",
            title: "Stack Overflow",
            url: "https://stackoverflow.com/",
            description: "Development Q&A",
            color: "#EC985D",
            icon: "stackoverflow",
          },
          {
            id: "vercel",
            title: "Vercel",
            url: "https://vercel.com/",
            description: "Deploy & host",
            color: "#DFE4F1",
            icon: "vercel",
          },
        ],
      },
      {
        id: "reading",
        name: "Reading",
        icon: "book",
        links: [
          {
            id: "wikipedia",
            title: "Wikipedia",
            url: "https://www.wikipedia.org/",
            description: "The free encyclopedia",
            color: "#DFE4F1",
            icon: "wikipedia",
          },
          {
            id: "youtube",
            title: "YouTube",
            url: "https://www.youtube.com/",
            description: "Videos & discoveries",
            color: "#F25C67",
            icon: "youtube",
          },
          {
            id: "medium",
            title: "Medium",
            url: "https://medium.com/",
            description: "Stories & ideas",
            color: "#C6D6CB",
            icon: "medium",
          },
          {
            id: "substack",
            title: "Substack",
            url: "https://substack.com/",
            description: "Independent writing",
            color: "#EC985D",
            icon: "substack",
          },
        ],
      },
      {
        id: "tools",
        name: "Tools",
        icon: "layers",
        links: [
          {
            id: "randolf",
            title: "randolf.dev",
            url: "https://randolf.dev/",
            description: "A personal corner",
            color: "#AEB8F5",
            icon: "randolf",
          },
          {
            id: "figma",
            title: "Figma",
            url: "https://www.figma.com/",
            description: "Design & prototypes",
            color: "#C29FF1",
            icon: "figma",
          },
          {
            id: "linear",
            title: "Linear",
            url: "https://linear.app/",
            description: "Project management",
            color: "#9F96FA",
            icon: "linear",
          },
          {
            id: "slack",
            title: "Slack",
            url: "https://slack.com/",
            description: "Team communication",
            color: "#6EC9BE",
            icon: "slack",
          },
        ],
      },
    ],
  };
}

/** Accept only navigation-safe HTTP(S) URLs, completing a bare host with HTTPS. */
export function normalizeUrl(input) {
  if (typeof input !== "string" || !input.trim())
    throw new Error("请输入网址。");
  const value = input.trim();
  if (value.length > 2048) throw new Error("网址不能超过 2048 个字符。");
  if (CONTROL_CHARACTERS.test(value) || value.includes("\\"))
    throw new Error("网址含有无效字符。");

  const explicit = /^https?:\/\//i.test(value);
  const hostWithPort = /^[^\s/?#:@]+:\d+(?:[/?#]|$)/.test(value);
  if (!explicit && /^[a-z][a-z\d+.-]*:/i.test(value) && !hostWithPort) {
    throw new Error("仅支持 http:// 或 https:// 网址。");
  }

  let url;
  try {
    url = new URL(explicit ? value : `https://${value}`);
  } catch {
    throw new Error("请输入有效的网址，例如 example.com。");
  }

  if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
    throw new Error("仅支持 HTTP 或 HTTPS 网址。");
  if (
    url.username ||
    url.password ||
    (explicit ? value.replace(/^https?:\/\//i, "") : value)
      .split(/[/?#]/, 1)[0]
      .includes("@")
  ) {
    throw new Error("网址不能包含用户名或密码。");
  }
  if (!isValidHostname(url.hostname, explicit))
    throw new Error("请输入有效的域名或 IP 地址。");
  if (url.href.length > 2048)
    throw new Error("规范化后的网址不能超过 2048 个字符。");
  return url.href;
}

function isValidHostname(hostname, explicit) {
  if (hostname === "localhost") return true;
  // A URL parser validates bracketed IPv6 addresses for us.
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  const host = hostname.replace(/\.$/, "");
  if (!host || host.length > 253) return false;
  const labels = host.split(".");
  if (!explicit && labels.length < 2) return false;
  return labels.every((label) =>
    /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label),
  );
}

/** Resolve ordinary text to the chosen search engine; hosts and HTTP(S) URLs go directly. */
export function resolveSearch(input, engineId = "google") {
  if (typeof input !== "string" || !input.trim())
    throw new Error("请输入搜索内容或网址。");
  const value = input.trim();
  if (CONTROL_CHARACTERS.test(value)) throw new Error("输入中含有无效字符。");
  if (
    UNSAFE_SEARCH_SCHEME.test(value) ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(value)
  ) {
    return { url: normalizeUrl(value), kind: "url" };
  }
  if (/^https?:/i.test(value)) return { url: normalizeUrl(value), kind: "url" };

  const host = value.split(/[/?#]/, 1)[0];
  const looksLikeHost =
    !/\s/.test(host) &&
    (/^localhost(?::\d+)?$/i.test(host) ||
      /^\[[a-f\d:]+\](?::\d+)?$/i.test(host) ||
      /^[^:@]+(?:\.[^:@]+)+(?::\d+)?$/.test(host));
  if (looksLikeHost) return { url: normalizeUrl(value), kind: "url" };

  const engine = ENGINES.find((item) => item.id === engineId) || ENGINES[0];
  return {
    url: engine.url.replace("{query}", encodeURIComponent(value)),
    kind: "search",
  };
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} 必须是对象。`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`${path} 必须是普通对象。`);
  return value;
}

function text(value, max, path, { empty = false } = {}) {
  if (typeof value !== "string") throw new Error(`${path} 必须是文本。`);
  const normalized = value.trim();
  if (
    (!empty && !normalized) ||
    value.length > max ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error(
      `${path}${empty ? `不能超过 ${max} 个字符` : `须为 1–${max} 个字符`}，且不能包含控制字符。`,
    );
  }
  return normalized;
}

function boolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值。`);
  return value;
}

/** Validate everything first and return a new, whitelisted object for atomic imports. */
export function validateConfig(value) {
  const root = object(value, "配置");
  if (root.version !== 1)
    throw new Error("不支持此配置版本，当前仅支持 version 1。");
  const settings = object(root.settings, "设置");
  if (!THEMES.has(settings.theme))
    throw new Error("主题必须为 system、light 或 dark。");
  if (!ENGINES.some((engine) => engine.id === settings.engine))
    throw new Error("搜索引擎无效。");
  if (!Array.isArray(root.categories) || root.categories.length > 50)
    throw new Error("分类必须是数组，且不能超过 50 个。");

  const ids = new Set();
  const id = (candidate, path) => {
    if (typeof candidate !== "string" || !ID_PATTERN.test(candidate))
      throw new Error(`${path} ID 无效。`);
    if (ids.has(candidate)) throw new Error(`配置含有重复 ID：${candidate}。`);
    ids.add(candidate);
    return candidate;
  };

  const cleanSettings = {
    theme: settings.theme,
    engine: settings.engine,
    newTab: boolean(settings.newTab, "新标签页设置"),
    clock24: boolean(settings.clock24, "24 小时制设置"),
    showSeconds: boolean(settings.showSeconds, "秒钟显示设置"),
  };
  const categories = root.categories.map((candidate, categoryIndex) => {
    const path = `第 ${categoryIndex + 1} 个分类`;
    const category = object(candidate, path);
    const categoryId = id(category.id, path);
    const name = text(category.name, 60, `${path}名称`);
    if (!CATEGORY_ICONS.has(category.icon))
      throw new Error(`${path}图标无效。`);
    if (!Array.isArray(category.links) || category.links.length > 100)
      throw new Error(`${path}链接必须是数组，且不能超过 100 个。`);
    const links = category.links.map((candidateLink, linkIndex) => {
      const linkPath = `${path}的第 ${linkIndex + 1} 个链接`;
      const link = object(candidateLink, linkPath);
      const linkId = id(link.id, linkPath);
      const title = text(link.title, 80, `${linkPath}标题`);
      const description = text(link.description, 120, `${linkPath}描述`, {
        empty: true,
      });
      const url = normalizeUrl(text(link.url, 2048, `${linkPath}网址`));
      if (typeof link.color !== "string" || !/^#[a-f\d]{6}$/i.test(link.color))
        throw new Error(`${linkPath}颜色必须是六位十六进制色值。`);
      if (typeof link.icon !== "string" || !ICON_PATTERN.test(link.icon))
        throw new Error(`${linkPath}图标无效。`);
      return {
        id: linkId,
        title,
        url,
        description,
        color: link.color.toUpperCase(),
        icon: link.icon,
      };
    });
    return { id: categoryId, name, icon: category.icon, links };
  });
  return { version: 1, settings: cleanSettings, categories };
}

export function loadConfig(storage) {
  let serialized;
  try {
    serialized = storage.getItem(STORAGE_KEY);
  } catch {
    return {
      config: createDefaults(),
      error: "浏览器无法读取本地存储。当前更改可能无法在关闭页面后保留。",
    };
  }
  if (serialized === null) return { config: createDefaults(), error: null };
  try {
    assertConfigSize(serialized);
    return { config: validateConfig(JSON.parse(serialized)), error: null };
  } catch (error) {
    return {
      config: createDefaults(),
      error: `本地配置无法读取，已载入默认设置，原数据仍保留。${error.message}`,
    };
  }
}

export function saveConfig(storage, config) {
  try {
    const serialized = exportConfig(config);
    storage.setItem(STORAGE_KEY, serialized);
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: `保存失败，当前更改仅保留在本次会话。${error.message || "请检查浏览器存储空间。"}`,
    };
  }
}

export function exportConfig(config) {
  const serialized = JSON.stringify(validateConfig(config));
  assertConfigSize(serialized);
  return serialized;
}

function assertConfigSize(serialized) {
  if (typeof serialized !== "string") throw new Error("配置内容无效。");
  if (
    serialized.length > MAX_CONFIG_BYTES ||
    new TextEncoder().encode(serialized).byteLength > MAX_CONFIG_BYTES
  ) {
    throw new Error("配置文件不能超过 16 MB。");
  }
}
