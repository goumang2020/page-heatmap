# page-heatmap

> **WIP：架构重写进行中。** 以下文档描述旧版 API，尚未完全适配当前源码；新版本的构建和测试尚未完成，请勿用于生产环境。

将已有的页面元素统计数据叠加为 Canvas 热力图。适配器根据 CSS 选择器在目标页面查找元素，以元素中心作为热力点，并在页面布局变化时更新位置。底层绘制和增量更新由 [`heatmap`](./heatmap) 子模块（animate-heatmap）提供。

本项目**不负责采集、存储或聚合事件**；调用方需要提供每个元素的数值。仓库中的 Vue 示例使用 2017 年的静态模拟数据，不代表实时统计服务。

## 获取与构建

需要 Git 和 Node.js/npm。源码使用 Babel 6、Webpack 2 和 Vue 2 等旧工具链；仓库未声明 Node 版本或提供锁文件，在现代 Node/npm 下的兼容性尚未验证。

```bash
git clone --recurse-submodules https://github.com/goumang2020/page-heatmap.git
cd page-heatmap
# 如果此前没有递归克隆：
git submodule update --init
# 避免 preinstall 脚本将子模块更新到远端分支的最新提交
npm install --ignore-scripts --no-package-lock
npm run build
```

子模块地址使用 GitHub SSH（见 `.gitmodules`），需要相应的 GitHub SSH 访问配置。`npm run build` 根据 `build/webpack.config.js` 将源码打包到 `dist/index.js`。构建和示例依赖安装是否成功取决于当前环境；若需要稳定复现，应先固定工具链及依赖版本。

**当前仓库中提交的 `dist/index.js` 与源码不同步**，且在 Node 中 `require('./dist/index.js')` 返回空对象。因此不要直接假设仓库现有 dist 或 npm 包入口可用；下例针对支持 Babel/ES 模块的项目从源码导入。完成构建后也应在目标环境验证导出和运行行为。

## 最小示例

**源码级示例：已静态核对，尚未运行验证。**

在目标页面的 DOM 已创建后执行。以下使用同一页面的 `window`；也可传入可同源访问的 iframe 的 `contentWindow`。调用方的构建工具需要处理项目中的 ES 模块、对象展开和 class fields 等语法，并能解析 `heatmap/src`。

```html
<button id="buy">购买</button>
<a id="details" href="#details">查看详情</a>
```

```js
import Adapter from './src'; // 路径相对于本仓库；在自己的项目中按实际位置调整

const adapter = new Adapter({
  $win: window,
  initData: [
    { selector: '#buy', value: 120 },
    { selector: '#details', value: 40 }
  ]
});
adapter.start();

// 数据变化时替换整组数据：
adapter.reset([
  { selector: '#buy', value: 150 },
  { selector: '#details', value: 50 }
]);

// 显示或隐藏覆盖层：
adapter.hide();
adapter.show();
```

`initData` 和传给 `reset` 的数据必须是数组；`start()` 不传参时使用初始化的数据。为避免归一化出现无效值，建议提供非空数组、有效的有限数值，并确保 `value` 的中位数大于 0。数据中的选择器必须对目标文档有效；找不到的元素不会得到有效坐标。

## 数据和定位

每条输入至少包含：

| 字段 | 含义 |
| --- | --- |
| `selector` | 目标文档中的 CSS 选择器，使用 `querySelector`，只匹配第一个元素。 |
| `value` | 用于表示热度的数值，例如调用方预先聚合的 PV 或 UV。 |

初始化、`start(data)` 和 `reset(data)` 会根据整组 `value` 的中位数计算 `_value = value × 0.5 / median`。这不是百分比或概率；空数组、中位数为 0、缺失或非数值可能产生 `NaN`/`Infinity`，源码没有对此做校验。归一化会浅拷贝每条数据；默认预处理在内部数据上写入并缓存 `$el`，并计算 `cx`、`cy`、`w`、`h`、`visible` 和源码拼写的 `slient` 等字段。DOM 元素被替换后，可通过 `reset` 提供不含旧 `$el` 的数据对象以重新查询。

默认定位使用元素中心的 `getBoundingClientRect()` 和 `elementFromPoint()` 判断可见性，并结合 `body.scrollTop/scrollLeft` 计算页面坐标。它依赖当前布局、遮挡状态和滚动容器；响应式布局、嵌套滚动、跨域 iframe 等场景需要在目标浏览器中验证。

## API

| API | 行为 |
| --- | --- |
| `new Adapter(config)` / `adapter.init(config)` | `config` 包含 `$win`、必需的 `initData`，以及可选的 `option`、`customProcessor`、`dataLengthFixed`。只有提供 `$win` 才初始化。 |
| `adapter.start(data?)` | 启动更新循环；传入数组时先归一化并替换数据。 |
| `adapter.reset(data)` | 归一化并替换数据；不会单独启动尚未启动的循环。 |
| `adapter.hide()` / `adapter.show()` | 隐藏或显示覆盖层；隐藏不会停止更新循环。 |
| `adapter.hover(enter, over, off, throttle = 200)` | 按元素矩形检测鼠标；`enter(x, y, index, parsedData)` 在进入新元素时调用，`over(x, y)` 在其内移动时节流调用，`off()` 在未命中时调用。 |
| `adapter.append(element)` | 将元素添加到热力图覆盖容器。 |
| `adapter.destroy()` | 移除覆盖容器。当前实现**不会**停止动画或移除事件监听，不能作为完整资源清理。 |
| `Adapter.field` | 暴露字段名映射：`X: 'cx'`、`Y: 'cy'`、`W: 'w'`、`H: 'h'`、`VS: 'visible'`、`SL: 'slient'`、`PARSED_VAL: '_value'`、`RAW_VAL: 'value'`。 |

`option` 会传给底层绘制器。适配器默认值为 `type: 'heatmap'`、`hoverable: false`、`minAlpha: 0.2`、`valueScale: 1`、`opacity: 1`、`bgAlpha: 100`；底层还支持 `blurSize` 和 `gradientColors`，具体实现见 [`heatmap/src/constants.js`](https://github.com/goumang2010/animate-heatmap/blob/4aa7e38b11172f5a9b8379e65a6b1f831d1bcaf2/src/constants.js)。`dataLengthFixed: true` 使用数组下标作为点的标识，适用于长度和顺序保持稳定的数据。

`customProcessor(data)` 可替换默认定位过程，接收已归一化的数据数组，返回包含 `cx`、`cy`、`_value`、`visible`、`slient` 的对象数组；需要 `hover` 命中时还需提供 `w`、`h`。调用方负责坐标和可见性计算。

## Vue 示例

```bash
npm run eg:vue
```

示例启动本地 Express/Webpack 开发服务（端口 `7777`），通过 `express-forward-html` 代理页面到 iframe，并将 [`examples/mock/heatdata.json`](./examples/mock/heatdata.json) 中的 PV/UV 映射成 `value`。示例面向历史页面和旧依赖，代理目标、网络、浏览器安全限制以及依赖缺失都可能影响运行；它不是已验证的生产部署方案。

**仅对受信页面使用此示例。** 示例将用户输入的 HTTP(S) 地址交给本地代理，并在 iframe 中同时启用 `allow-scripts` 和 `allow-same-origin`；不能依赖它作为生产环境的安全隔离。若改用于实际服务，应限制并校验代理目标、使用独立 origin 承载受代理页面，并评估代理及 iframe 的安全策略。

## 已知限制

- 初始化后通过 `requestAnimationFrame` 以默认约 20 次/秒反复检查位置；点数多或页面复杂时应测量 CPU 和绘制开销。
- `destroy()` 不停止循环或解绑事件；`bindEvent` 未保存事件目标，`unbindEvent` 的函数分支也存在问题。重复初始化和销毁可能留下监听器或循环，使用前应评估生命周期风险。
- 覆盖层固定使用 `id="heatdiv"`、绝对定位和页面 body 尺寸；多实例、动态页面、不同滚动模型和高分屏需要额外验证。
- 底层增量更新在一次键查找中使用 `key || position`，键为 `0` 时会回退到坐标；计算重绘区域时 `filter(Boolean)` 会忽略值为 `0` 的坐标，边缘点和固定下标模式需要额外验证。
- 项目没有根目录测试脚本；示例构建配置引用了部分未直接声明的 loader。不要将示例或提交的 dist 当作已验证的发布产物。

## 未来改进建议

以下是后续可评估的方向，当前版本尚未实现：

- 保留 Canvas 绘制，先补齐动画停止、事件解绑和重复初始化的生命周期管理，并修复 `unbindEvent`。
- 明确页面坐标和滚动容器模型，覆盖动态 DOM、布局变化、不同设备像素比等场景；增加对应的浏览器测试。
- 校验数据与归一化边界，提供稳定的元素标识；按实际性能测量结果评估事件驱动更新或降低轮询频率。
- 整理依赖、子模块和构建产物，固定工具链并验证包导出。若有更换绘制器的需求，可评估轻量 Canvas 库 [simpleheat](https://github.com/mourner/simpleheat)；它只解决绘制部分，DOM 定位和生命周期仍需适配，不能直接视为兼容替代。

## 许可

[MIT](./LICENSE)。子模块的许可见 [`heatmap/LICENSE`](https://github.com/goumang2010/animate-heatmap/blob/4aa7e38b11172f5a9b8379e65a6b1f831d1bcaf2/LICENSE)。
