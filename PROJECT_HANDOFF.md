# GPT 图片批量生成 / AI 生图工作台项目交接文档

## 1. 项目概览

项目路径：

```text
D:\Young study\gpt-image-batch
```

这是一个本地运行的 AI 图片与产品内容工作台，技术栈为：

- 后端：Python FastAPI
- 前端：静态 HTML / CSS / JavaScript

项目目标是做成一个本地网页工具，支持图片生成、图片修改、提示词反推、结果画廊、多模型配置，以及后续扩展为左侧导航式的多模块工作台。

当前新增的重点模块是“产品分析与文案”：上传产品图后分析卖点，生成亚马逊文案，并能把文案发送到生图模块的提示词输入框。

## 2. 已完成功能

### 生图模块

已跑通的能力：

- 文生图
- 图生图 / 改图
- 多参考图上传
- 中文 / 英文提示词反推
- 结果画廊
- 亮色 / 暗色模式
- 模型配置中心

注意：生图模块已经跑通，后续修改时应尽量避免重写 `image.js`，优先做小范围补丁。

### 模块化结构

已完成的拆分：

- 生图逻辑：`static/modules/image.js`
- 生图样式：`static/modules/image.css`
- 共享状态：`static/shared/state.js`
- 事件总线：`static/shared/events.js`
- 请求封装：`static/shared/api.js`

模块之间通信应优先通过共享状态和事件总线完成，不要让一个模块直接调用另一个模块的内部函数。

### 产品分析模块

当前能力：

- 输入产品名称
- 输入自定义要求
- 多产品图点击上传
- 拖拽上传
- 粘贴上传
- 调用后端分析产品卖点
- 调用后端生成亚马逊文案
- 将文案发送到生图模块的文生图 / 图生图提示词框

### 聊天模块

当前只有入口占位，还没有完整聊天功能。

## 3. 后端接口

产品模块新增接口：

```text
POST /api/product/analyze
POST /api/product/copywriting
```

如果接口返回 404，常见原因是浏览器还连着旧服务端口，需要重启服务或打开新端口。

## 4. 运行方式

进入项目目录：

```powershell
cd "D:\Young study\gpt-image-batch"
```

启动服务：

```powershell
python app.py
```

`app.py` 会自动从 `7860` 开始寻找空闲端口。

常见访问地址：

```text
http://127.0.0.1:7860/
http://127.0.0.1:7861/
```

以终端实际输出的端口为准。

## 5. 关键文件说明

### 后端

`app.py`

- FastAPI 后端入口。
- 包含生图、图生图、提示词反推、模型配置、产品分析、产品文案等接口。
- 新增的产品分析与文案接口也在这里。

### 前端入口与页面结构

`static/index.html`

- 页面结构。
- 包含左侧导航。
- 包含 `image`、`product`、`chat` 三个模块容器。
- 包含设置弹窗。

`static/script.js`

- 前端入口。
- 引入各模块。
- 控制左侧导航切换模块。
- 更新 `appState.activeModule`。
- 触发 `module:change` 事件。

`static/styles.css`

- 全局样式。
- 控制 app 外壳、左侧导航、模块显示隐藏。
- 已引入 `image.css`、`product.css`、`chat.css`。

### 生图模块

`static/modules/image.js`

- 生图模块核心逻辑。
- 包含文生图、图生图、反推、设置、画廊等功能。
- 已监听 `image:setPrompt` 事件，用于接收其他模块传来的提示词。

`static/modules/image.css`

- 生图模块样式。
- 同时定义了很多全局变量、暗色主题、面板、按钮、输入框等基础样式。

### 产品模块

`static/modules/product.js`

- 产品分析与亚马逊文案模块逻辑。
- 负责上传图片、分析产品、生成文案、发送提示词到生图模块。

`static/modules/product.css`

- 产品模块样式。

### 聊天模块

`static/modules/chat.js`

- 聊天入口占位逻辑。

`static/modules/chat.css`

- 聊天入口占位样式。

### 共享模块

`static/shared/state.js`

- 共享状态。
- 当前包含 `activeModule`、`productUploads`、`productAnalysis`、`productCopywriting`、`chatDraft` 等。

`static/shared/events.js`

- EventTarget 事件总线。
- 模块之间通信应通过 `emit` / `on`。

`static/shared/api.js`

- 前端请求封装。
- 包含 `apiJson` / `apiForm`。
- 已调整为先读取 text，再尝试解析 JSON，避免空响应导致解析报错。

### 配置文件

`config.json`

- 本地 API 配置文件。
- 可能包含 API Key，不要上传、不要分享、不要写进回复或日志。

## 6. 最近一次改动摘要

最近一轮已完成的主要变化：

- 新增左侧导航栏。
- 新增产品分析模块。
- 新增聊天入口占位。
- 生图模块接入事件总线，支持从产品模块接收提示词。
- 后端新增产品分析与产品文案接口。
- 前端新增产品模块上传、分析、文案生成与发送提示词能力。

涉及文件：

- `app.py`
- `static/index.html`
- `static/styles.css`
- `static/script.js`
- `static/shared/state.js`
- `static/shared/api.js`
- `static/modules/image.js`
- `static/modules/product.js`
- `static/modules/product.css`
- `static/modules/chat.js`
- `static/modules/chat.css`

最近一次实际修改前的备份：

```text
D:\Young study\gpt-image-batch-backups\2026-05-03_095620
```

## 7. 基础检查命令

前端语法检查：

```powershell
node --check .\static\script.js
node --check .\static\modules\image.js
node --check .\static\modules\product.js
node --check .\static\modules\chat.js
```

后端语法检查：

```powershell
python -m compileall .\app.py
```

产品接口路由检查：

```powershell
@'
from app import app
print("\n".join(sorted(route.path for route in app.routes if route.path.startswith("/api/product"))))
'@ | python -
```

预期能看到：

```text
/api/product/analyze
/api/product/copywriting
```

## 8. 已知问题与注意事项

- 终端里部分中文可能显示乱码，这是控制台编码问题；网页中是否正常要以浏览器为准。
- 如果浏览器还停留在旧端口，例如 `7860`，而新接口返回 404，通常说明旧服务没有重启，需要重新运行 `python app.py` 或打开新端口。
- 当前产品分析接口会真实调用模型，可能消耗额度，不要随便用真实图片测试。
- `config.json` 可能包含 API Key，不能泄露。
- 项目目录不是 git 仓库，不能依赖 `git diff` / `git status`。
- 生图模块已跑通，后续应尽量保持稳定，不要重写核心逻辑。
- 模块之间数据流必须走 `static/shared/state.js` 和 `static/shared/events.js`。

## 9. 下一步建议

建议优先级：

1. 确认当前页面是否连接最新服务端口，确认 `/api/product/analyze` 不再 404。
2. 优化左侧导航 UI，让它和右侧内容更自然对齐。
3. 完善产品模块体验，包括分析结果布局、文案输出布局、发送到生图后的提示反馈。
4. 优化图片预览、移除、排序体验。
5. 为产品模块补充更清楚的错误提示，例如未配置 API Key、模型不支持图片、余额不足、限流等。
6. 聊天模块后续可以先规划，再逐步实现。

## 10. 协作规则与偏好

用户不是程序员，通常会用截图、圈选、体验感受和功能目标来描述需求。

默认协作方式：

- 如果用户说“先聊天”或“先规划”，不要写代码，只分析和规划。
- 如果用户问“这个在哪里”，先定位大概文件和类型，不要直接修改。
- 如果用户说“小修”，只做最小必要改动，不重构，不扩大范围。
- 如果用户说“保持其他不变”，必须优先保护现有功能。
- 每次真正修改文件前，先创建备份。
- 已有模块、样式、架构优先沿用，不重新发明一套。
- 多模块互通优先通过共享状态、事件总线或接口层解耦。
- 需求不清楚时，先根据代码和界面判断；仍有关键歧义时，只问一个最重要的问题。
- 修改后做基础验证，例如语法检查、页面刷新、关键功能不报错。
- 不要把 API Key、密码、隐私信息写进代码、日志或回复。

UI 偏好：

- 现代、科技感。
- 暗色模式可用。
- 橙色作为主强调色。
- 小步快跑，优先改善具体体验点。
- 已经跑通的功能不要轻易重写。

最终回复建议包含：

- 改了什么。
- 改了哪些关键文件。
- 备份位置。
- 验证结果。
