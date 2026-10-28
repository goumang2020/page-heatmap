# page-heatmap

框架无关的 TypeScript 页面热力图展示层：把**调用方已聚合的元素数值**映射到 DOM，在独立 Canvas 覆盖层中绘制。默认使用 [simpleheat](https://github.com/mourner/simpleheat)，渲染器可替换。

**2.0 是不兼容重写**，不再提供旧 `Adapter`、Vue 2 示例、子模块或任意 URL 代理。没有事件采集、存储、上报、后端、Worker 或 GPU 管线。

## 本地运行

开发环境使用 Node.js 22.13+（已验证 Node 24）和 npm。仓库包含精确版本的锁文件。

```sh
npm ci --ignore-scripts
npm run dev            # 仅监听 127.0.0.1，打开控制台显示的地址
npm run build          # dist/index.js + 类型声明
npm run build:demo     # 独立的可信本地示例 -> demo-dist/
```

示例仅使用本地静态 DOM 和模拟数据，不抓取或代理第三方页面。当前分支并未发布到 npm；使用仓库构建或本地打包产物，不要假设 npm 上已有 2.0。

## 最小示例

在目标页面 `document.body` 创建后运行：

```ts
import { PageHeatmap } from 'page-heatmap';

const heatmap = new PageHeatmap({
  data: [
    { id: 'buy', selector: '#buy', value: 120 },
    { id: 'details', selector: '#details', value: 40 },
  ],
  max: 200, // 可选：跨批次比较时固定量程
});

heatmap.setData([
  { id: 'buy', selector: '#buy', value: 150 },
  { id: 'details', selector: '#details', value: 50 },
]);

heatmap.pause();   // 冻结画面并解绑观察器和监听器
heatmap.start();   // 恢复，按当前 DOM 和数据更新
heatmap.destroy(); // 卸载时必须调用；可重复调用
```

在本仓库内直接运行源码示例时，将导入路径改为 `./src/index`。React/Vue/Svelte 等框架只需在挂载后创建实例、数据变化时 `setData()`、卸载时 `destroy()`，不需要专用适配器。

## 数据与量程

```ts
interface HeatDatum {
  readonly id: string;
  readonly selector: string;
  readonly value: number;
}
```

- `id` 必须是非空且唯一的字符串；`"0"` 有效，不以数组下标或坐标代替身份。
- `selector` 是有效 CSS 选择器；每条数据只使用目标文档的第一个匹配项。未找到的项保留在数据中，但暂不绘制。
- `value` 必须是有限的非负数；负数、`NaN`、无穷大、非法选择器、重复 ID、稀疏数组均会抛出 `TypeError`。
- 数据会复制，调用方不必允许内部修改。`setData()` 先校验整批输入，失败时保留上一批有效数据。
- 零值不产生热力点；空数组清空画面。
- 有 `max` 时量程固定为该正有限值；否则每次 `setData()` 从**完整数据集**取最大值，全零/空数据使用 1。滚动、遮挡和 DOM 变化不会重新计算量程。
- `normalized = min(1, value / max)`。叠加热斑不是概率密度或精确数值图，重叠点可能饱和。

## API

### `new PageHeatmap(options?)`

构造后自动请求首帧，无需再次 `start()`。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `window` | 当前 `window` | 目标同源窗口，可为同源 iframe 的 `contentWindow`。使用该窗口的观察器和坐标。 |
| `data` | `[]` | 初始元素数据。 |
| `max` | 数据最大值 | 正有限的固定量程；跨时间或页面对比时建议显式设置。 |
| `visibility` | `'viewport'` | `'viewport'` 为几何可见；`'unoccluded'` 另做中心点 `elementFromPoint()` 检查。 |
| `renderer` | `canvas => new CanvasRenderer(canvas)` | 为每个实例创建独立渲染器的工厂。 |
| `onHover` | 无 | `(point, event) => void`，未命中或离开页面时 `point` 为 `null`。 |

### 实例方法

| 方法 | 行为 |
| --- | --- |
| `setData(data)` | 原子替换数据、重算自动量程并合并到下一帧。暂停时仅保存数据。销毁后调用会抛错。 |
| `refresh()` | 重新查询选择器并检查几何位置；相同结果不重复绘制。 |
| `pause()` / `stop()` | 取消待执行帧、断开观察器和监听器，保留最后画面。 |
| `start()` | 恢复观察并刷新；重复调用不会叠加循环。 |
| `destroy()` | 取消帧、移除监听器、断开观察器、销毁渲染器并移除覆盖层。幂等；其他控制方法在销毁后不重新启动。 |

`onHover` 检查当前已渲染点的裁剪矩形，重叠时最后一条数据优先；它不是 DOM z-index 命中检测，也不会拦截页面鼠标事件。回调抛出的错误由调用方处理。

## 坐标、可见性与调度

- `HeatPoint.x/y/rect` 使用目标**布局视口内的 CSS 像素**，来自 `getBoundingClientRect()`，不会再次加页面滚动量。
- 热点位于元素矩形与视口、overflow 裁剪祖先的交集中心；部分进入视口的元素因此使用可见部分中心，而非完整元素中心。
- 默认过滤零尺寸、`display:none`、不可见/透明元素和透明祖先。`unoccluded` 仅是单个中心点的遮挡启发式，不是逐像素检测；`pointer-events:none` 的内容、复杂裁剪等有局限。
- Canvas CSS 尺寸等于视口尺寸，backing store 为 `round(CSS size × DPR)`。点位和半径由渲染器转换为 backing 像素。
- scroll（含嵌套滚动）、resize、DPR、DOM mutation、目标及祖先 resize、资源/字体加载，以及过渡/动画结束会触发检查；同一时段事件合并到一个 `requestAnimationFrame`。
- 没有永久轮询或空闲动画循环。相同点集与视口不重复绘制。暂停时不继续观察 DOM。
- 实例的覆盖层无固定 ID，互不监听彼此的绘制 mutation。覆盖层 `pointer-events:none`、`aria-hidden=true`；不会修改业务 DOM。

## 定制绘制

默认 Canvas 绘制器允许调整 CSS 像素半径、模糊和最低非零不透明度：

```ts
import { PageHeatmap, CanvasRenderer } from 'page-heatmap';

const heatmap = new PageHeatmap({
  data: [],
  renderer: canvas => new CanvasRenderer(canvas, {
    radius: 24,     // 默认 28，必须 > 0
    blur: 20,       // 默认 30，必须 >= 0
    minOpacity: 0, // 默认 0，范围 [0, 1]
  }),
});
```

替换整个绘制器时实现以下契约：

```ts
interface Renderer {
  resize(viewport: { width: number; height: number; dpr: number }): void;
  draw(points: readonly HeatPoint[]): void;
  destroy(): void;
}
```

`resize()` 在首帧及视口/DPR 改变时调用，先于 `draw()`。渲染器负责 Canvas 的 CSS/backing 尺寸、DPR 换算和清空；`draw([])` 必须移除旧画面。不得修改传入点集；`destroy()` 必须释放自己的资源。工厂应为每次调用返回独立实例。

## 明确的边界

- 需要现代浏览器中的 Canvas 2D、`MutationObserver`、`ResizeObserver`、`requestAnimationFrame` 和 `matchMedia`；不提供 IE/旧浏览器 polyfill。模块可在 SSR 中导入，创建实例仍需要浏览器窗口。
- 只查询普通 document DOM；不穿透 Shadow DOM，也不能访问跨源 iframe。多个选择器命中同一元素时仍是多个数据点。
- 连续 CSS transform 动画、脚本直接修改 stylesheet/CSSOM、未改变已观察尺寸的布局移动或自定义状态，可能没有可观察事件：由调用方在动画帧或变化后调用 `refresh()`。不声称追踪每一种浏览器布局变化。
- 普通轴向 overflow 裁剪受支持；旋转/clip-path/mask、root element transform、浏览器 top layer 和复杂移动端 pinch-zoom 不保证像素精确覆盖。body transform 不会移动覆盖层。
- 页面的强制全局样式仍可能影响可视结果。覆盖层不是安全隔离容器。
- simpleheat 绘制成本与视口 backing 像素面积相关，DPR 2 大约有 DPR 1 的四倍像素；大型视口/高 DPR 仍可能昂贵。事件驱动消除了空闲轮询，不等于每次绘制必然更快。

## 检查与基准

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:package # 对构建产物验证 NodeNext / Node16 / bundler 类型与 SSR 导入
npm run build:demo
# 自动寻找本机 Chromium；也可指定真实浏览器路径：
CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
npm run check
```

单测分别验证数据、模拟 DOM 的调度/生命周期和 Canvas 适配器；**模拟测试不能代替真实浏览器布局与像素验证**。完整浏览器脚本覆盖滚动、节点替换、遮挡、iframe、DPR、像素及多实例清理。

本次实际通过项和执行环境限制见 [VALIDATION.md](./VALIDATION.md)。同机对照实验与复现方式见 [benchmarks/README.md](./benchmarks/README.md)；未执行的浏览器测试或基准不计为通过，不使用旧 Mac 数值宣称 Linux 加速。

## 许可

本项目 [MIT](./LICENSE)。默认依赖 simpleheat 为 [BSD-2-Clause](https://github.com/mourner/simpleheat/blob/main/LICENSE)。历史基准引用的旧实现仍遵循各自许可。
