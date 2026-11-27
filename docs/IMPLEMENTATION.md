# 下一步建议实现说明

产品理念、交互体验与成功标准见[产品设计](../DESIGN.md)。

## 模块职责

| 部分 | 文件 | 职责 |
| --- | --- | --- |
| Host | `src/host/index.ts` → `index.js` | 为根 agent 注册 `suggest_next_actions` 与一段常驻提示；子代理不注册（按会话 header 的 `origin` 区分）；安装与判定失败写日志；`enabled: false` 时什么都不注册 |
| 规范化 | `src/lib/normalize.ts` | 参数 → `{ shown, context, suggestions[≤3] }`：折叠空白、截断上下文与指令、按指令去重、推荐至多一条且置顶；显式标签保持完整，超宽时在执行前交回模型缩短；危险标记来自模型字段或命令形状模式。结果作为 `tool/result.meta` 写入会话日志 |
| Client | `src/client/index.ts` → `client.js`（含 CSS） | 两个 Conversation Definition：`next-actions` 把本工具结果上的 meta（native 与 PTC `run_code` 两条通路）发布为该轮卡片；`next-actions-sent` 把用户在该轮发出的第一条 `user/message` 发布为 `sent` 文本。`conversation.chat.turnTail` 渲染卡片；`tool.call.toolview` 渲染过程行 |

## 状态派生与渲染机制

会话日志只追加，压缩不删除原 `tool/result`，所以客户端直接读 meta，不重算参数，
压缩产生的替换副本一律忽略，避免同一张卡片发布两次。
第 N 轮的卡片通过 `useChat` 的 `timeline.turnOrder` / `timeline.turns` 读第 N+1 轮的 `sent` 文本来判定“已使用”；
同一次查找也决定折叠：找到回应的卡片默认折叠，手动切换只存在组件状态里。

事件归到哪一轮由引擎决定。同一个 Definition 服务页面里所有会话的 assembler，
翻页加载旧历史（`prepend`）时还会对更早的事件重跑 `match`，所以 `match` 只看当前事件、不持有状态：
卡片按调用 id（PTC 按根调用 id）、消息按消息 id 建 Context，轮次在 `start` 里从引擎解析好的 `match.location` 读取。
引擎规定每轮的同一个 Location key 只能有一个 owner，因此同一轮里第一个产出卡片的调用拥有卡片，
第一条用户消息拥有 `sent`；后来者通过 `reader.previous` 看到前驱已占用就不再发布。

外部插件不能 require Harness Client 包，所以卡片样式按官方动作卡重写，类名用 `dshna-` 前缀；
刚结束的回合用 CSS `grid-template-rows` 展开卡片，避免回答被一帧顶起；折叠行与卡片各占一行常驻在同一个网格里，
收起与展开过渡行高，离开的一行在过渡结束后才退出可见性与焦点顺序，`prefers-reduced-motion` 下不做动画。
