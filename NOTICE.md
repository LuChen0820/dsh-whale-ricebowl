# NOTICE

`dsh-whale-ricebowl`（白饭预言家）是一个**非官方**的第三方 DSH 插件。

## 与上游的关系

* 宿主插件「DSH 小鲸鱼记账挂件」`dsh-whale-widget` 由 @MeteorNOX 开发，MIT 许可。
  本项目与上游作者**无隶属关系**，也不是 DeepSeek 官方产品。
* 本项目**不包含**上游的任何代码、美术素材、音频或台词。运行时只通过公开 DOM 锚点
  （`window.__dshWhaleRoot`、`.dshwv-root`、`.dshwv-img`）定位，以及读取 DSH 会话事件做状态折叠。
* 本项目不含任何角色图片或音频文件；吃饭音效由浏览器 WebAudio 现场合成（舀饭 / 碰碗 / 咀嚼）。
本地 `demo/` 预览在没有宿主角色图时使用自绘占位图（`demo/placeholder.svg`）。
  文档截图里的鲸鱼立绘来自宿主插件 `dsh-whale-widget`（DSniang1.png），仅用于演示本插件挂载效果；
  `demo/.local/` 下的宿主角色图与截图用图不会进入 npm 包或仓库提交。

## 工程思路致谢

事件折叠 + 前缀路由 + `tapIndex` 注入 + 桌面端 `webserver/index-inject` 结构化注入行这套做法，
参考了 `dsh-whale-widget` 与 `dsh-whale-food-expack`（Mynaniao，MIT）的公开实现，特此致谢。
本插件的玩法（装饭 → 每轮吃 → 报账 → 讨饭）与代码、台词均为独立实现。

## 商标与免责

DeepSeek、DeepSeek Harness 等名称与商标归其权利人所有。本项目按 MIT 许可按原样提供，
不附带任何担保；因使用本插件造成的任何直接或间接损失，作者不承担责任。
