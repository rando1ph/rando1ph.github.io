# Phase 3 — Visual Expansion / 验收报告

实现与检查日期：2026-10-02～2026-10-03。等待用户人工验收。
本轮只写入 Signal Stack；未检查 Git status，未执行 reset / restore /
stash / clean / branch switch / commit / push，也未修改其它游戏或 games/index.html。

## 1. 修改 / 新增文件

修改：

- `index.html`：本地 import map。
- `main.js`：在既有 RAF 中采样真实帧间隔，供视觉降级使用。
- `renderer.js`：模块族同步、逐层能量、部署轨道、微弱导引 / underglow、
  Composer resize / disposal / fallback、只读诊断。
- `signal-stack.css`：轻微 combo scale 与弱化 Best。
- `render/bookkeeping.js`：保留池化 / ID / culling，仅在 entry 中增加只读 floor。
- `render/modules.js`：六种共享几何，池内独立 signal 材质。
- `render/environment.js`：完整高度环境。
- `render/effects.js`：340ms Perfect、24 点复用粒子、失败微火花。
- `render/hud.js`：DOM combo pulse。
- `render/scene.js`：关闭 canvas MSAA，避免与 HDR 后处理叠加。
- `render-browser-checks.py`：新增 `--no-bloom` 参数，原测试断言全部保留。
- `README.md`、`vendor/three/README.md`、`vendor/three/SHA256SUMS`。

新增：

- `render/visual-state.js`：确定性样式、高度插值、视差、传播、质量纯逻辑。
- `render/postprocessing.js`：r186 Composer / Bloom / Output 包装。
- `visual-tests.mjs`：11 项纯逻辑 / 几何 / vendor 测试。
- `visual-browser-checks.py`：实际 WebGL 高度 / Perfect / 视口 / 120 层检查。
- `quality-browser-checks.py`：实际 WebGL 四种降级路径。
- `vendor/three/addons/` 下 10 个官方文件。
- 本报告；`qa/` 中截图、并排对比 HTML / PNG 和测量 JSON（本地 QA 产物）。

用开始工作时记录的 SHA-256 复核：`engine.js`、`input.js`、`storage.js`、
`tests.mjs`、`render-tests.mjs`、`render/coordinates.js`、`render/lighting.js`
逐字节保持不变。所有碰撞、Perfect 判定、combo、score、difficulty、
MAX_MISSES、restart 和 storage 仍由已验收代码负责。

## 2. Three.js addon 精确来源

固定 **r186 / WebGLRenderer**。所有文件来自官方 GitHub tag：

`https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/`

完整递归依赖闭包：

- `postprocessing/EffectComposer.js`
- `postprocessing/RenderPass.js`
- `postprocessing/UnrealBloomPass.js`
- `postprocessing/OutputPass.js`
- `postprocessing/Pass.js`
- `postprocessing/ShaderPass.js`
- `postprocessing/MaskPass.js`
- `shaders/CopyShader.js`
- `shaders/LuminosityHighPassShader.js`
- `shaders/OutputShader.js`

依赖依据下载后的 r186 实际 import 核实。保留上游原文件与 MIT 许可；
core 未改动。可用 `sha256sum -c vendor/three/SHA256SUMS` 核验。

[官方 EffectComposer 源码](https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/postprocessing/EffectComposer.js)
与 [UnrealBloomPass 源码](https://raw.githubusercontent.com/mrdoob/three.js/r186/examples/jsm/postprocessing/UnrealBloomPass.js)。

index.html 的 import map 将 `three` 与 `three/addons/` 解析到本地。
既有相对 core imports 保留，以兼容原 Node 测试；浏览器解析为同一模块 URL。
无 CDN、运行期外部素材、build step、WebGPU 或版本混用。

## 3. 新 module archetypes

| 型号 | 识别点 |
| --- | --- |
| RELAY | 保留 Mk.I service panel、grille、中央 signal spine |
| COOLING | 更大的六槽横向散热 grille，少量指示灯 |
| STRUCTURE | 开放框架、后置底板、双 X brace、signal nodes |
| POWER | 重型护板、bus connectors、中央纵向能量条 |
| ARRAY | 电子机架、内嵌小型 dish、受控天线 |
| CORE | 罕见强能量腔、连接条、最强常态 emissive |

每种模块五个共享材质几何批次。全部继续使用 engine 的 100×44 默认
footprint，随 engine 实际 width / height 缩放。没有任何新 hitbox。

## 4. Module assignment

按目标成功楼层进行纯函数分配：0～5 层以 Relay / Cooling / Structure
为主；6 层开始循环 Power、Relay、Array、Cooling、Structure 等。
13、30、47……每隔 17 层出现 Core。失败不推进序列。

active 的目标楼层等于当前成功高度 + 1；落地后为对应 tower index。
因此 active → landed、相机移动、对象池复用、跳过 LANDED 渲染帧都不换型。
重启恢复相同的初始序列。无逐帧随机数。

## 5. Environment architecture

单一 `environment.js` 管理 stars、moon、far city、near skyline、mountains、
horizon haze、clouds、beams 和原 launch foundation。资源创建一次；
每帧只更新位置、透明度、背景颜色和 visibility。

层次均在主体后方，只有已验收 lighting rig 影响 tower。背景不增加实时灯。
环境不读取输入，不消费 engine events，也不反向写入游戏对象。

## 6. Altitude progression

| 连续插值锚点 | 视觉阶段 | city / cloud / stars |
| --- | --- | --- |
| 0 | CITY | 1 / .12 / .32 |
| 8 | SKYLINE | .78 / .35 / .43 |
| 18 | CLOUDS | .32 / .85 / .58 |
| 30 | UPPER ATMOSPHERE | .06 / .46 / .80 |
| 46 | NEAR SPACE | 0 / .15 / 1 |

楼层输入先缓动，再 smoothstep 插值。前几层已开始变化，8～18 层云层
逐步增强。没有切场景或 threshold 跳变。

相机上升视差系数：near .62、clouds .38、far .25、mountains .11、
moon .018、stars .004。主体相机架构完全不变。

## 7. City

52 栋远城 + 14 栋近景建筑；楼体 / roof antennas 共四个 InstancedMesh。
共享 64×256 程序化窗灯图，窗灯是假光。实例高度、宽度、深度和亮度有稳定差异。
建筑底部向视口下方延伸，避免悬空。远城通过颜色、haze 和更慢视差建立尺度。

## 8. Clouds

一个 512×256 CanvasTexture：四尺度确定性噪声密度，柔软边缘，灰蓝色明暗。
12 张共享纹理的 cards，以位置、深度、尺寸和缓慢漂移分层。
低 detail 配置可降到 6 张。所有云均在 collision plane 后方，不能盖住模块。
穿云时城市下沉，云层密度增加；高处云层退到塔下。

## 9. Moon / planet

偏左的大型单 card；512×512 CanvasTexture 用径向明暗、细小 crater value
variation 和暗侧渐变生成。无下载月球纹理，视差近乎静止；会被云和 haze
部分遮住，作为远景尺度参照。

## 10. Bloom 参数与调色

`strength: .17 / radius: .12 / threshold: 1.65`。
流程为 RenderPass → UnrealBloomPass → OutputPass。保持 ACES exposure 1.15、
sRGB 输出；在 HDR 中提取能量后只做一次最终 tone mapping。

首轮截图中较大的 spread 已收紧。高 threshold 排除 chassis、城市、云和
大部分金属；强度主要集中于 active、Power/Core 和 Perfect。
背景 beam 还带有廉价 additive soft profile。HUD 是 DOM，不进入 Bloom。

Bloom ON / OFF 使用相同场景、相同 engine timestamp 截图。OFF 时模块、
碰撞边缘和全部环境仍清楚。配置默认 ON；设置 `bloom: false` 即可关闭。

## 11. Perfect propagation

读取 feedback 时间戳作为视觉 event key，维护至多一个 renderer timeline。
顶层快速增亮；45ms 起连接环展开，约 295ms 前淡出。
80ms 后依可见层的垂直距离逐层增强 signal emissive，340ms 前结束。
截图 120ms 与 220ms 显示亮度重心从上部移向下部。

最多 24 sparks，共享一个 Points buffer。普通 landing 不触发。
DOM 显示 PERFECT! / +bonus；combo 只做 1.045× 的小幅 scale。
reduced motion 下 180ms 内完成、ring 近静态、关闭 sparks 和 combo scaling，
保留环境与 Bloom。失败保持原 3D rotation，最多 6 枚短火花并衰减 signal。

## 12. Performance / lifecycle

- DPR 上限仍为 1.5；关闭 canvas AA 和 target MSAA，避免叠加。
- Composer 使用整数 physical buffer，测试 fractional DPR 后尺寸精确。
- 一个 RAF；场景只渲染一次，Bloom 另做屏幕后处理 passes。
- 原模块池上限 32；实测当前竖屏通常 11 个实例。
- 六套几何共用；signal 材质数量随池上限有界，不随成功层数增长。
- 城市实例化、窗灯烘焙；12 clouds、4 beams、350 stars，不添加实时灯。
- 2 秒 warm-up + 2 秒采样；平均帧间隔 >36ms 时自动释放并禁用 Bloom，
  同时降到 6 张云卡、关闭 sparks；不删除其它环境层。
- 缺少 HDR framebuffer 支持或 compositor 发生异常时，转直接渲染。
- 重启复用 Composer/targets；pause / resize 重置性能采样。
- 正确释放 r186 官方 dispose 遗漏的高通材质，以及 Composer timer。

真实 WebGL 降级检查覆盖配置关闭、HDR 扩展不可用、模拟 compositor
异常和持续慢帧，四种均通过。均保持 engine 数据不变，返回直接渲染，无 WebGL error。

软件 GPU 实测：ANGLE / Vulkan SwiftShader，390×844、DPR 1.5。
6.5 秒启动与降级混合样本约 **4.44 FPS**，约 **5 秒**时自动关闭 Bloom。
该样本包含 shader warm-up 与切换，不代表稳定态，也不是手机硬件成绩。
物理手机 GPU 的帧率与观感仍需用户验收；这里不声称已达到手机 60 FPS。

## 13. Long-run

Phase 3 以真实 engine API 模拟 120 次成功，每层绘制 active、landing 和
settled 状态，强制 Bloom ON；不降低 gameplay difficulty。

| 样本层数 | allocated modules | scene objects | GPU geometries | textures | Composer targets |
| --- | --- | --- | --- | --- | --- |
| 30 | 11 | 111 | 44 | 21 | 13 |
| 60 | 11 | 111 | 44 | 21 | 13 |
| 90 | 11 | 111 | 44 | 21 | 13 |
| 120 | 11 | 111 | 44 | 21 | 13 |

稳定状态约 82～92 draw calls（含后处理），约 8.5k～10.2k triangles。
所有样本中临时 Perfect timeline / sparks / ring 已清零，云没有重复生成。
resize / restart 前后两只 Composer target UUID 不变。

关闭 Bloom 后 textures 21 → 8，13 个 target 全部释放；最终 teardown 后
geometries 0、scene objects 0。`textures: 1` 明确对应 r186 core 的共享
`DFG_LUT`，不是应用纹理；应用的 7 张 CanvasTexture 已全部释放。

原 Phase 2 的 **1,000 层**检查也通过（`--no-bloom`）：20 / 100 / 500 / 1000
层都保持 11 个模块、111 个 scene objects、41 个 geometries、8 张 textures。
该旧 harness 在 settled 状态采样，因此尚未上传 ring / spark 等几何；数量
与新 harness 的差异来自测试覆盖的可见资源，非泄漏。resize / restart 正常，
最终 geometries 0、scene objects 0，pageErrors 为空。

其 Bloom OFF、完整 12 云卡的 7 秒软件 GPU 样本约 **9.79 FPS**，CPU submit
median 1.3ms / p95 3.5ms。低端 profile 的针对性检查在同为 390×844、DPR 1.5、
11 个可见模块下运行；先完成排队的预热绘制，跳过起始 warm-up，再采样 53
个真实帧间隔，得到约 **14.01 FPS**，median 66.7ms / p95 116.6ms，72 draw
calls、6 张云卡、无粒子。两次样本场景 / 启动过程并非完全相同，不能把差值
视为严格的性能提升比例。软件 GPU 仍不足以证明真实手机的流畅度。
复查：`qa/phase3-thousand-results.json`。

## 14. Automated tests

Node：**42 / 42**。

- 原 Phase 1：20 / 20，测试文件未改。
- 原 Phase 2：11 / 11，测试文件未改。
- Phase 3：11 / 11，覆盖 deterministic mapping、active/landed identity、
  六族几何边界、band / interpolation、parallax、propagation、cleanup / reset、
  quality state 和 vendor 校验 / recursive import closure。

实际 WebGL：Phase 3 高度 / Perfect / 长跑 / resize / restart / reduced-motion /
Bloom ON/OFF / cleanup 检查通过，pageErrors 为空。降级路径独立检查通过。
浏览器运行请求全部来自 localhost 或 data URI。

原 browser-checks 分视口运行：360、390、430、1280 全部通过；reduced-motion、
blocked-storage、corrupt-storage 三种模式全部通过。原 lifecycle-only 测试通过：
WebGL context loss → fallback → restore → input，以及 WebGL 2 完全不可用的
可读 fallback。所有运行的 pageErrors 均为空。

复查 JSON：`qa/phase3-gameplay-results.json`、`qa/phase3-lifecycle-results.json`。

## 15. Viewport tests

实际截图逐一检查：**360×800、390×844、430×932、1280×900 desktop**。
无水平 overflow；HUD 仍占原位置，title / score / combo 没有挤压 gameplay。
canvas DPR 不超过 1.5；Composer 宽高与整数绘图缓冲一致。
高空、低空、Cloud Layer、长塔、普通 landing、Perfect 多时刻、双侧失败、
restart、reduced motion 和 Bloom OFF 均保存了截图。

可复查：

- [并排视觉比较](../qa/phase3-comparison.html)
- [并排截图](../qa/phase3-comparison.png)
- [Phase 3 完整测量](../qa/phase3-results.json)
- [降级路径测量](../qa/phase3-quality-results.json)
- `qa/phase3-{360,390,430,1280}-normal.png`
- `qa/phase3-390-altitude-{0,6,12,20,32,50}.png`
- `qa/phase3-perfect-{40,120,220,320,450}ms.png`
- `qa/phase3-bloom-on.png` / `phase3-bloom-off.png`

## 16. 与 visual baseline 最大的三个差距

1. **塔体比例与表面精度。** 已验收的 100×44 gameplay footprint 仍然偏扁，
   不具有概念图细长模块的纪念碑比例；几何也缺少精细 bevel、磨损和材质层次。
   本阶段没有为追求概念图而更改碰撞或相机。
2. **城市与地形的复杂度。** 当前 66 栋实例建筑、简单山脉和 haze 已建立尺度，
   但还没有概念图的河流、城市道路光带、复杂地形和建筑群变化。
3. **大气的体积感。** 云与月球是低成本 cards，已有视差和高度变化，仍缺少
   概念图的体积云自遮挡、月球边缘散射和更细腻的多尺度光照。

已对照的共同目标包括 dark sci-fi material hierarchy、局部 neon energy、
城市尺度、atmospheric depth、height journey、模块区别、Perfect 和干净 HUD。
并非 pixel-match；基准图中的宣传标语没有加入游戏。

## 17. 下一阶段建议

先由用户验收本轮手机观感和 gameplay readability，尤其是 clouds / Core
亮度与 Perfect 时序。随后优先做真机性能 profiling、低端降级参数调整、
更细腻的面板 / bevel 和城市地平线细节；保持已验收规则边界。
音效、成就、皮肤、排行榜、后端、账户和最终上线工作均未在本轮加入。

本轮不 commit、不 push。验收交付后停止开发。
