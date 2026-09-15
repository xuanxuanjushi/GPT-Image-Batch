# 架构维护说明

这份说明用于约束后续新增功能，目标是让项目保持“统一外壳 + 小模块 + 通信规则”的结构。

## 1. 当前分层

```text
static/index.html          页面结构和模块容器
static/script.js           主入口，负责左侧导航和模块切换
static/styles.css          样式总入口，只负责 import 和外壳布局
static/shared/theme.css    颜色、字体、暗色模式、基础排版
static/shared/components.css 通用按钮、输入框、面板、状态、提示词输出等组件
static/shared/state.js     公共状态
static/shared/events.js    事件总线
static/shared/api.js       前端接口请求封装
static/modules/*           各功能模块自己的逻辑和样式
```

## 2. 新增模块规则

新增功能时，优先按下面方式创建：

```text
static/modules/newModule.js
static/modules/newModule.css
```

然后在：

```text
static/index.html
static/script.js
static/styles.css
static/shared/state.js
```

里接入模块容器、导航按钮、入口 import、公共状态。

不要把新功能塞进已经跑通的 `image.js`，除非它确实属于生图模块内部能力。

## 3. 样式规则

公共样式放在：

```text
static/shared/theme.css
static/shared/components.css
```

模块自己的特殊样式放在：

```text
static/modules/模块名.css
```

新增模块时优先复用这些类：

```text
.panel
.hero
.primary
.ghost
.mini-tool
.status-line
.ok
.bad
.hidden
.prompt-output
```

颜色尽量只使用变量：

```text
--bg
--panel
--ink
--muted
--line
--soft
--orange
--orange-dark
--orange-light
--danger
--success
--shadow
```

如果某个样式会被两个以上模块复用，就应该放进 `shared`，不要留在单个模块 CSS 里。

## 4. 通信规则

模块之间不要直接调用彼此内部函数。

推荐流程：

```text
模块 A 更新 appState
模块 A emit("domain:eventName", payload)
模块 B on("domain:eventName", handler)
模块 B 自己刷新界面
```

已经使用的事件：

```text
module:change
image:setPrompt
product:analysisUpdated
product:copywritingUpdated
```

事件命名建议：

```text
模块名:动作
```

例如：

```text
chat:draftUpdated
gallery:imageSelected
product:copywritingUpdated
```

## 5. 状态规则

公共状态放在：

```text
static/shared/state.js
```

适合放公共状态的数据：

- 当前激活模块
- 需要跨模块使用的提示词
- 产品分析结果
- 生成后的图片列表
- 聊天草稿

只在模块内部使用的数据，留在模块自己的 JS 里。

## 6. 修改原则

- 小修只改最小范围。
- 已跑通的生图模块不要重写。
- 涉及 API Key 的内容不要写进代码、日志或回复。
- 产品分析和生图接口会消耗额度，验证时不要随便跑真实模型请求。
- 修改前先备份。
- 修改后至少做语法检查。
