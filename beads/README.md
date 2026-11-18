# 拼豆图纸生成器

这是 randolf.dev 独立维护的拼豆图纸生成器，保留并改造了
[Bead Grid Studio / 豆格工坊](https://github.com/zwhy149/bead-grid-studio) 的核心算法、
界面和许可证声明。应用版本 1.3.0，访问路径为 `/beads/`。
访问路径为 `/beads/`，适用于当前仓库直接发布的 GitHub Pages 静态站点。

## 结构与维护

- `src/`：应用界面、转换逻辑、色板和本地化源码。
- `packages/core/`：图像量化、颜色和图纸模型等核心模块。
- `public/`：图标、法律页面、Service Worker 与其他静态资源。
- `scripts/build.mjs`：标准 Vite 构建并生成可下载的单文件离线版。
- `index.html`、`assets/`、`offline.html` 等：构建生成的静态发布产物，请勿手工修改。
- `tests/`：核心单元测试、图片夹具和真实 `/beads/` 子路径的桌面及手机端浏览器回归测试。

保留上游图片转换算法、221 色色板、智能推荐、裁剪、画笔/橡皮/取色、撤销重做、
旋转镜像、坐标与色号、底板拼接、用料统计、逐色制作进度、草稿恢复、
PNG 图纸、JSON 工程、CSV 清单、宣传图、浏览器分页打印与完整单文件离线版。
本项目后续按自身需求维护，不以同步或跟随原项目更新为目标。

## 构建与验证

要求 Node.js >= 22.12 和 Python 3（测试静态服务器）。从仓库根目录运行：

```sh
npm --prefix beads ci
cd beads
npx playwright install chromium
npm run check
npm run build
npm test
```

`npm test` 在 4180 端口启动整个仓库的静态服务器，覆盖桌面与手机。
测试包含核心单元测试、图片转换、编辑与撤销重做、工程往返、
PNG/CSV 导出、材料总数、制作进度恢复、离线运行、站点导航及响应式布局。

构建后直接提交发布产物，无需服务器、在线构建服务或运行时 CDN。
本地预览可在仓库根目录运行 `python3 -m http.server 8000` 后访问
`http://localhost:8000/beads/`。

## 本地处理与离线

图片通过浏览器文件接口读取，转换、编辑、统计、导出均在本地运行。
无上传接口、遥测或第三方运行时资源；页面 CSP 的 `connect-src data: blob:`
阻止页面发起 HTTP 数据提交。内置示例图片嵌入应用，亦可离线转换。
草稿使用 `randolf:beads:draft:v2`，不包含原图。

Service Worker 仅控制 `/beads/`，仅清理 `randolf-beads-` 前缀缓存；
缓存版本由构建内容确定，保留其他网站工具的缓存。
“下载离线版”下载本站中文适配后的单文件 HTML，包含完整应用和版权声明。

## 许可

应用代码采用 Apache-2.0，原文见 [LICENSE.txt](./LICENSE.txt)。
色板数据、第三方依赖与原作者版权声明见 [NOTICE.txt](./NOTICE.txt)。
上游品牌与色板厂商商标不因代码许可自动授予使用权；本站按独立项目维护。
