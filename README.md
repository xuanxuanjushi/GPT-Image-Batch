<h1 align="center">GPT 图片批量生成工具</h1>
<p align="center"><b>GPT Image Batch Generator</b></p>
<p align="center">Windows / macOS / Linux · Python + Flask 风格本地网页界面 · 支持 OpenAI 及兼容代理</p>

> 一个本地运行的网页小工具：填写 OpenAI 或第三方兼容代理的 API Key 和 Base URL，上传多张参考图，批量调用图片接口生成结果。
>
> A small local web app that calls image-generation APIs in batches. Point it at OpenAI or any compatible proxy, load several reference images, and it generates the results in one run.

> 关键词：批量生图、GPT 画图、参考图、API 代理、本地网页 / Keywords: batch image generation, gpt-image, reference images, OpenAI API, local web app

[简体中文](#安全提醒) | [English](#english)

## 下载

免安装便携版在 [Releases](https://github.com/xuanxuanjushi/GPT-Image-Batch/releases/latest) 页面：

| 文件 | 说明 |
| --- | --- |
| GPT-Image-Batch-portable-v1.0.0.zip | 解压整个文件夹后双击「启动并打开浏览器.bat」，第一次使用需要在页面里填写自己的 API Key |

## 安全提醒

不要把 API Key 发给别人，也不要提交到 Git。软件会把 Key 保存到本机的 `config.json`，这个文件已经加入 `.gitignore`。

如果你曾经在聊天、截图、网盘或公开页面里发过 Key，请立刻让卖家或平台重置。

## 安装和启动

第一次使用：

```powershell
cd "D:\Young study\gpt-image-batch"
python -m pip install -r requirements.txt
python app.py
```

之后也可以双击 `start.bat` 启动。

启动后打开：

```text
http://127.0.0.1:7860
```

## 使用方法

1. 在 API 设置里填写 API Key。
2. Base URL 默认是 `https://z.apiyihe.org/v1`，官方 OpenAI 可改成 `https://api.openai.com/v1`。
3. 模型默认是 `gpt-image-1`，如果代理商要求别的模型名，可以手动修改。
4. 输入提示词，选择多张参考图。
5. 点击开始批量生成。
6. 结果会保存到 `outputs/时间_任务名/`。

## 说明

- 默认并发数是 2。
- 每张参考图独立处理，单张失败不会影响其他图片。
- 测试接口按钮只做低成本连通性测试，不会生成图片。

## 项目结构

```
app.py                后端入口与接口
backend/              模型与接口配置
static/               网页界面
outputs/              生成结果（不上传仓库）
uploads/              上传的参考图（不上传仓库）
config.json           本机 API 配置（已被 .gitignore 排除，请勿上传）
start.bat             启动脚本
```

---

## English

**GPT Image Batch Generator** is a local web app for batch image generation through OpenAI or any OpenAI-compatible proxy.

### Highlights

- Configure API Key, Base URL and model in the web UI; the key is stored only in your local `config.json`
- Upload several reference images and run one batch generation job
- Default concurrency is 2; each reference image is handled independently, so one failure does not stop the rest
- A low-cost "test API" button checks connectivity without spending image credits
- Results are saved to `outputs/<time>_<task>/`

### Run

```powershell
python -m pip install -r requirements.txt
python app.py
```

Then open `http://127.0.0.1:7860`. You can also double-click `start.bat`.

### Security

Never commit or share your API key. It lives in `config.json`, which is excluded by `.gitignore`. If a key was ever pasted into a chat, screenshot or public page, rotate it immediately with your provider.
