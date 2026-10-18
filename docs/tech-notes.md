# 白饭预言家 · 技术笔记

> 记录实现细节与容易踩的坑，给后续维护/发布用。版本：v0.5.0（2026-10-18）。

## 1. 架构

```
DSH 会话事件 ──> lib/state.js（纯函数折叠）──> lib/index.js（前缀路由 /turn.json）
                                                        │
                                      浏览器 assets/client.js（轮询 + DOM 叠加层）
                                                        │
                                      宿主挂件 .dshwv-root（鲸鱼立绘 + 余额气泡）
```

* **宿主半端**：订阅 `session/event`，把每会话折叠成 `{turn, running, actualTokens, usageEvents, toolCalls, ...}` 快照；`/dsh-whale-rice/turn.json` 输出最近 12 个会话。
* **浏览器半端**：找 `window.__dshWhaleRoot` / `.dshwv-root`，把 `.dshwr-layer` 塞进宿主根节点，随宿主一起缩放 / 拖动 / 镜像；轮询 turn.json 驱动吃饭与报账。
* **注入**：Web 端走 `webServer.tapIndex`；桌面端（Electron 静态 index.html）额外注册 `webserver/index-inject` 结构化注入行。
* 资源路由 `/dsh-whale-rice/*` 白名单只读，代码 no-store、图片 max-age=3600。

## 2. 米饭库存模型（v0.5.0 核心）

* 单位：`1 碗 = 1,000,000 token`（`config.tokensPerBowl`）。
* 每个对话（`sessionId`）一份：`localStorage['dshwr-tank:v1'] = { v:1, order:[sid...], sessions:{ sid: { allocated, consumed, fedAt, updatedAt, turns } } }`，保留最近 30 个对话。
* 剩余 = `max(0, allocated - consumed)`；超过 5 碗（`maxBowls`）继续记账但 UI 固定显示 5 碗。
* 显示：**主碗**显示「当前这一碗」的剩余比例；旁边最多 4 个**碗位**（`.dshwr-pip`）表示满碗库存；标签显示剩余碗数（如 `3 碗`）。
* 装饭：菜单档位 `feedBowls`（默认 1/2/5 碗）；没绑定对话时装的饭存进 `@pending`，第一轮对话开始时由 `adoptPending()` 倒进该对话的锅。
* 回合生命周期：`turn/start` → `startTurn()` 建立内存态 `rt.live = { sid, turn, seen, remain }`；轮询看到 `actualTokens` 增长 → `enqueueEat(delta)`；`turn/end` → `finishTurn()` 补演漏掉的口，再 `applyConsume()` 落盘 + 气泡报账。
* 防重复记账：只在「观察到 running → 结束」时落盘一次；插件启动时如果回合已经结束，不补记历史回合（避免误扣）。

## 3. 饭碗与米堆几何

* 饭碗 SVG `viewBox="0 0 120 112"`；碗口内沿椭圆 `cx=60 cy=41 rx=45 ry=11`；玻璃碗用渐变 + 高光，米面用 `dshwrRiceGrad`。
* `HEAP_KEYS = [{fill:0,y0:99,amp:0},{0.5,70,8},{0.95,41,11},{1.15,41,30}]`：fill 越大米面越高，超过 0.98 时切到 `dshwrHeapClip` 允许冒尖。
* `riceBasePath()` 画一整块米面曲线，`riceGrainsHtml()` 在表面撒程序生成的米粒椭圆当纹理（不是散开的一颗颗生米）。
* 主碗 fill = `bowlFillFor(remain)`：当前碗的剩余比例（0~1）；`setRice()` 用 480ms 缓动，但**吃饭队列播放时改成按口离散设置**，避免「连续滑落」和嘴不同步。

## 4. 嘴部叠加层

* `.dshwr-mouthwrap` 绝对定位，JS `layoutMouth()` 用 `.dshwv-img` 的布局盒（offsetLeft/Top/Width/Height，不受 transform 影响）算出嘴中心；嘴盒尺寸 = 嘴本身大小，再用 CSS `translate(-50%,-50%)` 居中，所以嘴中心严格等于 `(mx,my)`。
* 嘴位来自 `config.mouth`（默认 `0.555 / 0.735 / size 0.08`），按宿主默认立绘 `DSniang1.png` 的双眼与下巴位置标定；**不做运行时校准**。换皮肤时改 config 的 `mouth`（相对立绘宽高的 0~1 + 嘴宽比例）。
* 嘴形是 SVG：咧嘴笑 + 一颗小虎牙（`dshwrMouthIn` 柔粉渐变 + `#2e3358` 细描边 + 上唇阴影）；张嘴 / 咬合用 class 切换，在 `dshwr-mouth-open` / `dshwr-mouth-chomp` / `dshwr-mouth-soft` 三态之间走。
* 立绘嚼动用临时类 `.dshwr-chewing`（加在宿主 `img` 上，2 次 0.34s 缩放动画）。

## 5. 吃饭动画：串行咀嚼队列

旧实现的问题（v0.4.x）：每口独立 `setTimeout` 链，第 i 口的合嘴定时器正好落在第 i+1 口的张嘴中段 → 嘴闪一下 / 卡住；口数与饭量脱钩；短回合轮询看不到增量 → 完全不演。

v0.5.0 的做法：

* **单队列**：`enqueueEat(tokens)` 把 delta 拆成 n 口，逐口压入 `rt.eatQueue`；`pumpEat()` 保证同一时刻只有一口在播，播完才取下一口。
* **每口时序**：张嘴 → 0.18s 后饭团飞 → 0.3s 碰碗声 → 0.64s 咬合（嘴 + 立绘 + 音效 + 米粒）→ 1.18s 收尾合嘴；关闭「吃饭动作」时退化为米粒特效。
* **离散扣饭**：每口预计算 `remain` 目标值，咬合那一刻 `setRice()` + 碗位 + 标签同步下降。
* **回合结束补演**：`finishTurn()` 把 `seen` 与最终 `actualTokens` 的差值压入快放队列（约 0.62s/口，最多 4 口），播完才 `applyConsume()` + 报账气泡；所以 5 秒短回合也一定看得到吃。
* **轮询自适应**：running 时 `pollRunningMs`（500ms）、空闲 `pollIdleMs`（1600ms）；`document.hidden` 时暂停，恢复后靠补演追平。
* 口数：`bites = clamp(ceil(tokens / biteTokens), 1, 6)`，`biteTokens` 默认 1800。

## 6. 讨饭状态机

* 触发：`updateBegging()` 在有饭量 / 正在吃饭 / 回合进行中时停掉；否则（`settings.begging` 开启且剩余 ≤ 0）先等 `begDelayMs`（9s），之后每 `begIntervalMs`（7s）来一次 `begPulse()`。
* 每次 `begPulse()`：气泡显示 `begShowMs`（3.4s）并自动消失；同时给宿主 `img` 临时加 `.dshwr-beg-img`（上浮 + 歪头 1.7s）、层上加 `.dshwr-beg`（碗发光 1.5s）、嘴张开「啊——」0.9s。
* 文案：`pickBegLine()` 随机取 `lines.beg`，且与上一次的 `rt.lastBeg` 不同（池子只有 1 条时除外）。
* 加饭 / 重新有饭后立即 `stopBegging()`，清掉所有定时器和临时类。

## 7. 宿主数据口径

* `usageTokens()` = `inputTokens + outputTokens`；`COUNT_CACHE_READ = false`（同宿主鲸鱼挂件的每轮口径）。
* `assistant/message` 累加 `actualTokens`；`turn/start` 清零；`turn/end` 落 `settled`。
* 快照只保留最近 12 个会话（每会话只有当前轮），**历史累计必须客户端自己记账**（宿主不做跨轮历史）。
* 浏览器轮询 `/dsh-whale-rice/turn.json`；路由只读、无鉴权（本机 web server 上）。

## 8. 测试与 demo

* `npm test`：21 条（宿主事件折叠、usage 口径、资产路由白名单、注入契约、package / config / lines 契约、旧文案禁用）。
* `npm run demo`：本地模拟宿主 DOM（`demo/index.html`）+ mock turn.json（`demo/server.mjs` 的 `/mock/set`）；页面左侧按钮可装饭 / 模拟每轮消耗 / 空碗讨饭 / 清空。
* 真机 / 无头验证过的点：饭碗挂载、嘴中心坐标、主碗+碗位数量、每轮报账、短回合补演、空碗讨饭、pending 预装饭、菜单 3 档、饭账面板、无 console 报错。
* demo 预览的鲸鱼立绘优先读本机宿主插件里的 `DSniang1.png`（可用 `DSH_WHALE_ART` 覆盖）；不打包进 npm。

## 9. 已知限制

* 默认 100 万 token 一碗：普通一轮只占 0.5%，视觉变化小；`tokensPerBowl` 可调。
* 嘴位只适配宿主默认立绘；换肤需要改 config。
* 多会话跟随「最近有事件的会话」，不做多会话聚合显示。
* 宿主 DOM 结构变化可能导致错位；找不到锚点时静默隐藏。
* 无 CI；发布前靠 `npm test` + demo / 真机手动冒烟。
