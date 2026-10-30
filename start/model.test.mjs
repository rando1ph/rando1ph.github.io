import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY,
  MAX_CONFIG_BYTES,
  ENGINES,
  uid,
  createDefaults,
  normalizeUrl,
  resolveSearch,
  validateConfig,
  loadConfig,
  saveConfig,
  exportConfig,
} from "./model.mjs";

function memoryStorage(initial = null) {
  let value = initial;
  let writes = 0;
  return {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      return value;
    },
    setItem(key, next) {
      assert.equal(key, STORAGE_KEY);
      value = next;
      writes += 1;
    },
    get value() {
      return value;
    },
    get writes() {
      return writes;
    },
  };
}

test("defaults are complete, independently mutable, and pass the import schema", () => {
  const first = createDefaults();
  assert.equal(first.categories.length, 4);
  assert.equal(
    first.categories.flatMap((category) => category.links).length,
    16,
  );
  assert.deepEqual(validateConfig(first), first);
  first.categories[0].links[0].title = "Changed";
  assert.equal(createDefaults().categories[0].links[0].title, "ChatGPT");
  assert.equal(new Set(Array.from({ length: 100 }, uid)).size, 100);
});

test("URL normalization supports bare domains, international domains, localhost and IPs", () => {
  for (const [input, expected] of [
    [
      " Example.COM/path?q=hello world ",
      "https://example.com/path?q=hello%20world",
    ],
    ["https://EXAMPLE.com:443/a#b", "https://example.com/a#b"],
    ["http://localhost:3000/start", "http://localhost:3000/start"],
    ["localhost:8080", "https://localhost:8080/"],
    ["example.com:8443/path", "https://example.com:8443/path"],
    ["192.168.1.20:8080", "https://192.168.1.20:8080/"],
    [
      "例子.中国/起始页",
      "https://xn--fsqu00a.xn--fiqs8s/%E8%B5%B7%E5%A7%8B%E9%A1%B5",
    ],
    ["[::1]:4000", "https://[::1]:4000/"],
  ])
    assert.equal(normalizeUrl(input), expected);
});

test("unsafe protocols, credentials, malformed URLs and control characters are rejected", () => {
  for (const input of [
    "",
    "   ",
    null,
    123,
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/test",
    "ftp://example.com",
    "https://user:secret@example.com",
    "https://@example.com",
    "user@example.com",
    "https://",
    "hello world",
    "example..com",
    "http://.",
    "https://exa\nmple.com",
    "https://example.com\\@evil.com",
    "localhost:99999",
    "a".repeat(2049),
  ])
    assert.throws(() => normalizeUrl(input), Error, String(input));
});

test("search routing recognizes navigation and encodes text for every engine", () => {
  for (const input of [
    "example.com",
    "github.com/user/repo",
    "localhost:5173",
    "example.com:8443/path",
    "127.0.0.1:8080/a",
    "例子.中国",
    "https://example.com/a?x=1",
  ]) {
    assert.deepEqual(resolveSearch(input, "baidu"), {
      url: normalizeUrl(input),
      kind: "url",
    });
  }
  for (const engine of ENGINES) {
    const query = "你好 & a/b? #测试";
    assert.deepEqual(resolveSearch(query, engine.id), {
      url: engine.url.replace("{query}", encodeURIComponent(query)),
      kind: "search",
    });
  }
  assert.equal(
    resolveSearch("site:github.com keyboard", "google").kind,
    "search",
  );
  assert.equal(
    resolveSearch("1 + 1", "missing").url,
    "https://www.google.com/search?q=1%20%2B%201",
  );
  assert.equal(resolveSearch("hello.world next steps").kind, "search");
  assert.throws(() => resolveSearch("  "));
  assert.throws(() => resolveSearch("javascript:alert(1)"));
  assert.throws(() => resolveSearch("file:///etc/passwd"));
  assert.throws(() => resolveSearch("http:example.com"));
});

test("configuration validation returns a clean clone and ignores unknown properties safely", () => {
  const original = createDefaults();
  const raw = JSON.parse(
    JSON.stringify(original).replace(
      '"version":1',
      '"version":1,"__proto__":{"polluted":true},"surprise":true',
    ),
  );
  raw.settings.extra = "ignored";
  raw.categories[0].extra = "ignored";
  raw.categories[0].links[0].extra = "ignored";
  raw.categories[0].links[0].url = "chatgpt.com";
  const clean = validateConfig(raw);
  assert.deepEqual(clean, original);
  assert.equal(Object.hasOwn(clean, "__proto__"), false);
  assert.equal({}.polluted, undefined);
  clean.categories[0].links[0].title = "Changed";
  assert.equal(raw.categories[0].links[0].title, "ChatGPT");
});

test("invalid import records reject the complete import without mutating its input", () => {
  const mutations = [
    (config) => {
      config.version = 2;
    },
    (config) => {
      config.settings.theme = "sunset";
    },
    (config) => {
      config.settings.engine = "unknown";
    },
    (config) => {
      config.settings.newTab = "true";
    },
    (config) => {
      delete config.settings.clock24;
    },
    (config) => {
      config.categories[0].name = "x".repeat(61);
    },
    (config) => {
      config.categories[0].icon = "script";
    },
    (config) => {
      config.categories[1].id = config.categories[0].id;
    },
    (config) => {
      config.categories[0].links[0].id = config.categories[0].id;
    },
    (config) => {
      config.categories[3].links[3].id = config.categories[0].links[0].id;
    },
    (config) => {
      config.categories[0].links[0].title = "";
    },
    (config) => {
      config.categories[0].links[0].description = "x".repeat(121);
    },
    (config) => {
      config.categories[0].links[0].url = "javascript:alert(1)";
    },
    (config) => {
      config.categories[0].links[0].color = "red";
    },
    (config) => {
      config.categories[0].links[0].icon = "<svg>";
    },
    (config) => {
      config.categories[0].links = {};
    },
    (config) => {
      config.categories[0].links = Array.from(
        { length: 101 },
        () => config.categories[0].links[0],
      );
    },
    (config) => {
      config.categories = Array.from(
        { length: 51 },
        () => config.categories[0],
      );
    },
  ];
  for (const mutate of mutations) {
    const input = createDefaults();
    mutate(input);
    const before = JSON.stringify(input);
    assert.throws(() => validateConfig(input));
    assert.equal(JSON.stringify(input), before);
  }
  assert.throws(() => validateConfig(null));
  assert.throws(() => validateConfig([]));
  assert.throws(() => validateConfig(Object.create(createDefaults())));
});

test("empty data and supported upper bounds remain valid", () => {
  const empty = createDefaults();
  empty.categories = [];
  assert.deepEqual(validateConfig(empty).categories, []);
  const maximum = createDefaults();
  const template = maximum.categories[0].links[0];
  maximum.categories = Array.from({ length: 50 }, (_, category) => ({
    id: `cat-${category}`,
    name: "x".repeat(60),
    icon: "grid",
    links: Array.from({ length: 100 }, (_, link) => ({
      ...template,
      id: `link-${category}-${link}`,
      title: "t".repeat(80),
      description: "d".repeat(120),
    })),
  }));
  assert.equal(validateConfig(maximum).categories[49].links.length, 100);
});

test("storage round-trip and exported configuration preserve the personal data", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadConfig(storage), {
    config: createDefaults(),
    error: null,
  });
  const config = createDefaults();
  config.settings.theme = "light";
  config.categories[0].links.pop();
  assert.deepEqual(saveConfig(storage, config), { ok: true, error: null });
  assert.equal(storage.writes, 1);
  assert.deepEqual(loadConfig(storage), { config, error: null });
  assert.deepEqual(JSON.parse(exportConfig(config)), config);
});

test("large supported collections survive save, reload, and export/import unchanged", () => {
  const config = createDefaults();
  const template = config.categories[0].links[0];
  config.categories = Array.from({ length: 50 }, (_, category) => ({
    id: `cat-${category}`,
    name: "中文分类",
    icon: "grid",
    links: Array.from({ length: 100 }, (_, link) => ({
      ...template,
      id: `link-${category}-${link}`,
      title: "中文标题",
      description: "中文描述",
      url: `https://example.com/${"a".repeat(420)}`,
    })),
  }));
  const storage = memoryStorage();
  assert.equal(saveConfig(storage, config).ok, true);
  assert.ok(Buffer.byteLength(storage.value, "utf8") > 2 * 1024 * 1024);
  const loaded = loadConfig(storage);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.config, config);
  const exported = exportConfig(config);
  assert.equal(exported, storage.value);
  assert.deepEqual(validateConfig(JSON.parse(exported)), config);
});

test("maximum schema-sized data with Chinese text fits the common UTF-8 limit", () => {
  const config = createDefaults();
  const template = config.categories[0].links[0];
  config.categories = Array.from({ length: 50 }, (_, category) => ({
    id: `cat-${category}`.padEnd(80, "c"),
    name: "中".repeat(60),
    icon: "grid",
    links: Array.from({ length: 100 }, (_, link) => ({
      ...template,
      id: `link-${category}-${link}`.padEnd(80, "l"),
      title: "中".repeat(80),
      description: "文".repeat(120),
      url: `https://example.com/${"a".repeat(2048 - "https://example.com/".length)}`,
      icon: "i".repeat(40),
    })),
  }));
  const exported = exportConfig(config);
  assert.ok(Buffer.byteLength(exported, "utf8") > 10 * 1024 * 1024);
  assert.ok(Buffer.byteLength(exported, "utf8") <= MAX_CONFIG_BYTES);
  const storage = memoryStorage();
  assert.equal(saveConfig(storage, config).ok, true);
  assert.equal(storage.value, exported);
  const loaded = loadConfig(storage);
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.config, config);
  assert.deepEqual(validateConfig(JSON.parse(exported)), config);
});

test("oversized stored input is measured in UTF-8 bytes and remains recoverable", () => {
  const source = JSON.stringify({
    ...createDefaults(),
    padding: "中".repeat(Math.ceil(MAX_CONFIG_BYTES / 3)),
  });
  assert.ok(source.length < MAX_CONFIG_BYTES);
  assert.ok(Buffer.byteLength(source, "utf8") > MAX_CONFIG_BYTES);
  const storage = memoryStorage(source);
  const loaded = loadConfig(storage);
  assert.deepEqual(loaded.config, createDefaults());
  assert.match(loaded.error, /16 MB/);
  assert.equal(storage.value, source);
  assert.equal(storage.writes, 0);
});

test("corrupt storage falls back without overwriting the recoverable original", () => {
  for (const source of [
    "{broken",
    '{"version":1}',
    "x".repeat(MAX_CONFIG_BYTES + 1),
  ]) {
    const storage = memoryStorage(source);
    const result = loadConfig(storage);
    assert.deepEqual(result.config, createDefaults());
    assert.match(result.error, /原数据仍保留/);
    assert.equal(storage.value, source);
    assert.equal(storage.writes, 0);
  }
});

test("blocked or full storage returns actionable errors instead of throwing", () => {
  const blocked = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
  assert.deepEqual(loadConfig(blocked).config, createDefaults());
  assert.equal(typeof loadConfig(blocked).error, "string");
  assert.equal(loadConfig(undefined).error.includes("本地存储"), true);
  assert.deepEqual(saveConfig(blocked, createDefaults()).ok, false);
  assert.match(saveConfig(blocked, createDefaults()).error, /保存失败/);
  assert.equal(saveConfig(undefined, createDefaults()).ok, false);
  const storage = memoryStorage("original");
  assert.equal(saveConfig(storage, {}).ok, false);
  assert.equal(storage.value, "original");
  assert.equal(storage.writes, 0);
});
