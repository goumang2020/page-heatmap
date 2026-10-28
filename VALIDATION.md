# 验证记录（云端 Linux）

**状态：实现与静态/模拟测试已验证；真实浏览器功能与性能基准尚未执行成功。不能宣称已完成浏览器验收或性能提升。**

本地代码从公开分支 `rewrite/typescript-heatmap` 的提交
`d642e6a760a12f746eedfb114491edde5b9cf186` 接续。原始 WIP 保留在本地基线分支与归档；本次修复没有推送、建 PR、合并、发布 npm 或部署。

## 环境

- Linux x64；Node.js 24.22.1，npm 11.9.0。
- 系统 Chromium 155.0.8059.79 已安装，但未能在该执行沙箱内启动。
- 精确锁定 simpleheat 1.0.0、TypeScript 5.9.3、Vite 8.3.5、Vitest 5.0.5、Playwright Core 1.64.1。
- 依赖安装使用 `npm ci --ignore-scripts` / `npm install --ignore-scripts`，开发服务只监听 loopback。

## 通过的检查

| 检查 | 结果 |
| --- | --- |
| ESLint | 通过，包含库、demo、测试及基准脚本（不检查原样历史源码缓存） |
| TypeScript strict + noUncheckedIndexedAccess | 通过，包含库、demo、单测及构建配置 |
| 数据单测 | 39 项通过：非法输入/选择器/重复 ID/稀疏数组/量程等 |
| 生命周期与几何模拟单测 | 40 项通过：合帧/空闲/暂停恢复/清理/跨 realm/异常回滚/裁剪规则等 |
| Canvas 适配器模拟单测 | 27 项通过：DPR/尺寸/选项/空集清理/销毁等 |
| 合计 | **106 项通过**；DOM/Canvas 模拟不是浏览器像素或布局验证 |
| 干净库构建 | ES module 与 `.d.ts` 生成成功 |
| 消费方类型检查 | `NodeNext`、`Node16`、`bundler`，`skipLibCheck=false` 全通过 |
| Node ESM / SSR 导入 | 无 `window` 环境下导入已构建包成功（不创建实例） |
| 独立本地 demo 构建 | 通过，无任意 URL 代理 |
| npm 打包清单 | 仅公开声明的 `dist`、README、LICENSE、package.json；无缓存/测试数据/凭据 |
| `npm audit` | 当前锁文件报告 **0 个已知漏洞**，不是安全保证 |
| `git diff --check` | 通过 |
| 独立干净目录复验 | 仅复制源码与锁文件，`npm ci --ignore-scripts` 后上述非浏览器检查再次全部通过 |
| 公平基准准备 | 公开旧源与新源均成功打包，记录源码/锁文件/产物哈希 |

## 浏览器阻塞与未验证范围

`tests/browser.mjs` 有 10 组真实浏览器场景，涵盖：滚动及嵌套滚动、动态替换、数据替换原子性、合帧与空闲、暂停/销毁清理、多实例、hover/遮挡、同源 iframe、DPR 与真实 Canvas 像素、fixed/absolute containing-block 逃逸，以及 root/body overflow 传播。

脚本语法与 lint/typecheck 通过，但执行器禁止 Chromium 需要的 UNIX socket，启动返回 `socket() failed: Operation not permitted`。正常外层执行审批路径也因运行器只读目录问题失败；没有改安全设置或绕过限制。

官方云端浏览器确实存在，CDP 控制正常。独立复验在同一次执行会话启动 Vite（127.0.0.1:4181）并确认 `curl` 返回 HTTP 200，保持服务运行后，官方浏览器访问相同地址仍返回 `ERR_CONNECTION_REFUSED`；另一次独立执行中的 `curl` 也返回 HTTP 000。因此只可确认服务在它自己的执行边界内可达，不能推断未知物理拓扑或泛称没有云端浏览器。

已读取的官方 API 未暴露跨执行边界的 host/端口映射；正常自包含 `data:` 测试页导航被明确策略拒绝（只允许 HTTP/S），该路线已停止。没有猜测内网地址、端口转发、外网部署、调整安全设置或切回用户 Mac。当前仍缺少一条受支持、已授权的本地代码到官方云端浏览器加载路径；这不是功能测试通过。

因此 `npm run check` **不应报告全绿**；最后的 `test:browser` 仍需要一个已授权且可启动本机浏览器的执行器。尤其是 CSS 几何边界、真实像素和浏览器资源释放仍需执行该阶段确认。

## 性能基准

未取得原 Mac 测试包，不引用其中的样本或数值。新实验仅使用公开旧提交 `1f8f68b` 与 animate-heatmap `4aa7e38`，在同主机、同视口、同数据、同浏览器条件下运行对照。详细方法和可复现命令见 [benchmarks/README.md](./benchmarks/README.md)。

两份 IIFE bundle 已构建；由于同一 Chromium 启动限制，没有生成性能结果。**没有 p50/p95、FPS、CPU 改善或加速倍数可供报告。** DPR 2 对旧版本不是相同 backing 像素量，不能将其误当等工作量速度对照。

## 完成浏览器验收的命令

```sh
npm ci --ignore-scripts
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run check
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run benchmark
node benchmarks/summarize.mjs > benchmarks/results/summary.md
```

先保留原始 JSON 和环境/源码哈希，再解释结果；失败或未执行场景必须继续标注，不能用模拟单测替代真实浏览器测试。
