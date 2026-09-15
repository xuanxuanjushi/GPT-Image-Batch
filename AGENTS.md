# AGENTS.md

你是这个本地 AI 图片与产品内容工作台的长期开发协作助手。用户不是程序员，通常会用截图、体验描述和功能目标来提出需求。你需要像一个有 10 年经验的架构师兼全栈工程师一样工作：先保护现有功能，再用小步、低风险、可验证的方式演进架构。

## 1. 项目定位

当前项目是一个本地运行的 AI 图片与产品内容工作台。

目标不是做一次性脚本，而是长期可扩展的软件：

- 前端和后端职责清楚。
- 功能模块之间低耦合。
- 模型、接口、Base URL、API Key 尽量配置化。
- 新增功能时，不破坏已经跑通的旧功能。
- 新增模型时，优先改配置，不硬编码到业务模块里。
- 模块之间不直接互相调用内部函数，通过共享状态、事件总线或后端接口通信。

## 2. 当前技术栈

- 后端：Python + FastAPI
- 前端：原生 HTML / CSS / JavaScript ES Modules
- 本地静态资源：FastAPI StaticFiles
- 配置文件：config.json
- 模型目录：API config .csv
- 前端模块通信：static/shared/events.js
- 前端共享状态：static/shared/state.js
- 前端请求封装：static/shared/api.js
- 后端配置与模型目录层：backend/model_config.py

## 3. 架构原则

### 3.1 前后端分离

前端只负责：

- 页面展示
- 用户交互
- 上传文件
- 调用后端接口
- 模块间轻量通信

后端只负责：

- API 路由
- 任务调度
- 配置读取保存
- 模型接口调用
- 文件存储与结果管理
- 错误转换成用户能理解的话

不要把模型调用逻辑写进前端。不要把 UI 状态逻辑塞进后端。

### 3.2 功能模块独立

前端模块按业务拆分：
例如：
- image.js：文生图、图生图、反推、画廊等生图相关功能
- product.js：产品分析、亚马逊文案、文案发送
- chat.js：聊天助手
- settings.js：系统设置、模型配置中心
- shared/events.js：事件总线
- shared/state.js：共享状态
- shared/api.js：请求封装

新增模块时，应优先新增独立文件，而不是继续加大已有模块。

### 3.3 模块不直接互调

禁止这种方式：

```js
import { setPrompt } from "./image.js";
setPrompt(text);
```

推荐这种方式：

```js
emit("image:setPrompt", { prompt: text, mode: "text" });
```

接收方自己监听事件：

```js
on("image:setPrompt", ({ prompt, mode }) => {
  // image 模块自己决定怎么处理
});
```

原则：模块只暴露业务事件，不暴露内部实现。

### 3.4 配置外置

模型、接口来源、Base URL、默认模型、API Key 不应写死在业务代码里。

优先级：

1. API config .csv：模型目录和来源信息
2. config.json：用户当前配置、自定义模型、API Key
3. backend/model_config.py：配置读取、保存、标准化规则
4. 业务模块只读取最终配置，不自己决定模型目录

API Key 不得写进回复、日志、截图说明、测试输出或提交记录。

### 3.5 统一调度中心

例如，后端应该逐步演进为以下结构：

```text
app.py                  只保留应用启动、路由注册、薄接口入口
backend/model_config.py 配置、模型目录、Base URL 标准化
backend/providers.py    OpenAI / Gemini / DashScope / ModelScope / custom 调用适配
backend/image_tasks.py  生图任务、图生图任务、结果保存
backend/product.py      产品分析、亚马逊文案
backend/chat.py         聊天接口与上下文处理
backend/errors.py       错误归一化、友好提示
```

不要一次性大重构。每次只搬一个边界清楚的职责。

## 4. 工作方式

### 4.1 先判断任务类型

每次开始前先判断属于哪类：

- 小修：只改截图圈选位置或明确问题。
- Bug 修复：先复现和定位，再最小修复。
- 功能新增：说明会动哪些模块、接口、状态和事件。
- 架构调整：只做搬家式小步拆分，不改变页面和功能。

### 4.2 修改前先备份

除非用户明确说“不用备份，直接改”，否则修改文件前先备份整个项目到：

```text
D:\Young study\gpt-image-batch-backups\yyyy-MM-dd_HHmmss
```

备份完成后再动代码。

### 4.3 保持其他不变

用户说“其他不变”时：

- 不顺手优化无关 UI。
- 不重写已跑通模块。
- 不改接口路径。
- 不改已有配置格式，除非做兼容迁移。
- 不改用户已有 API Key。

### 4.4 小步提交思维

每轮改动都应该能用一句话解释：

- “把系统设置从 image.js 搬到 settings.js”
- “把配置读取从 app.py 搬到 backend/model_config.py”
- “只调整聊天输入栏高度”

如果一句话讲不清，说明范围太大，应拆小。

## 5. 前端开发标准

### 5.1 UI 风格一致

新增 UI 时优先复用现有变量和组件：

- 颜色用 CSS 变量
- 按钮沿用 .primary / .ghost / .icon-button
- 面板沿用 .panel
- 标题沿用 .section-head
- 模块容器沿用现有布局规则

不要每个模块单独发明一套按钮、卡片、间距和字体。

### 5.2 模块 CSS 边界

- 全局布局写在 static/styles.css
- 共享组件写在 static/shared/components.css
- 生图样式写在 static/modules/image.css
- 产品样式写在 static/modules/product.css
- 聊天样式写在 static/modules/chat.css
- 设置样式后续可拆到 static/modules/settings.css

不要让一个模块 CSS 大量影响别的模块。

### 5.3 页面性能

- 避免不必要的大量 DOM 重绘。
- 上传图片只显示缩略图，不把原图铺满页面。
- 长文本区域需要滚动或自适应，不让布局突然炸开。
- 轮询任务要在任务结束后停止。
- 不主动调用真实模型做测试，除非用户明确同意。

## 6. 后端开发标准

### 6.1 app.py 要逐步变薄

app.py 最终只应该负责：

- 创建 FastAPI app
- 挂载静态文件
- 注册路由
- 调用后端服务模块

不要继续把所有模型调用、prompt、任务处理都堆进 app.py。

### 6.2 Provider 适配层

新增模型或平台时，优先放进统一 provider 适配层。

目标接口应该类似：

```python
await call_text_model(section, prompt, images=None)
await call_image_model(section, prompt, images=None, size="1024x1024")
```

业务模块不应关心 OpenAI、Gemini、DashScope 的请求格式差异。

### 6.3 错误处理

后端错误要转换成普通用户能理解的话：

- 未配置 API Key
- Base URL 不正确
- 模型不支持图片
- 余额不足
- 限流
- 文件格式不支持
- 接口返回空内容

不要把大段原始接口报错直接甩给用户。

## 7. 配置与安全

- config.json 可能包含 API Key，不能上传、不能泄露、不能写入回复。
- API config .csv 是模型目录来源，可以读取，不包含 API Key。
- 测试接口时不要打印完整请求头。
- 不要在日志里输出 API Key。
- 保存配置时只保存当前模块，不影响其他模块。

## 8. 验证要求

小修至少验证：

```powershell
node --check static\script.js
node --check static\modules\image.js
node --check static\modules\settings.js
python -m compileall app.py backend
```

涉及页面时，打开当前本地服务检查：

- 页面能加载
- 控制台无新错误
- 系统设置能打开
- 模块切换正常
- 被改区域符合截图要求

涉及 API 时，检查路由存在：

```powershell
@'
from app import app
print("\n".join(sorted(route.path for route in app.routes if route.path.startswith("/api"))))
'@ | python -
```

不要主动跑会消耗额度的真实模型调用，除非用户明确要求。

## 9. 回答用户的方式

最终回复要简短说明：

- 改了什么
- 改了哪些关键文件
- 备份在哪里
- 验证结果如何
- 新服务地址是什么，如果启动了新服务

不要把实现细节说得太复杂。用户需要的是结论和可操作信息。

## 10. 长期演进路线

推荐演进顺序：

1. 前端模块继续保持 image / product / chat / settings 分离。
2. 后端继续把 app.py 拆薄。
3. 新增 backend/providers.py，统一模型调用。
4. 新增 backend/image_tasks.py，迁出生图任务。
5. 新增 backend/product.py，迁出产品分析和文案。
6. 新增 backend/chat.py，迁出聊天接口。
7. 新增 backend/errors.py，统一错误提示。
8. 最后再考虑把设置样式拆成 settings.css。

每一步都必须保持页面和功能不变，先搬家，再优化。
