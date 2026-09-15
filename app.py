from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import socket
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.model_config import (
    APP_DIR,
    OUTPUTS_DIR,
    STATIC_DIR,
    UPLOADS_DIR,
    default_base_url,
    load_settings,
    normalize_base_url,
    normalize_provider_base_url,
    read_model_catalog,
    save_settings,
)


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
IMAGE_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
OPENAI_SIZES = {
    "1024x1024": "1024x1024",
    "1024x1536": "1024x1536",
    "1536x1024": "1536x1024",
    "auto": "auto",
}


def ensure_dirs() -> None:
    OUTPUTS_DIR.mkdir(exist_ok=True)
    UPLOADS_DIR.mkdir(exist_ok=True)
    STATIC_DIR.mkdir(exist_ok=True)


ensure_dirs()
app = FastAPI(title="Orange White AI Image Studio")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")

tasks: dict[str, dict[str, Any]] = {}


def endpoint(base_url: str, path: str) -> str:
    return f"{normalize_base_url(base_url)}{path}"


def slugify(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value.strip())
    value = re.sub(r"\s+", "_", value)
    return value[:48] or "image_task"


def public_output_path(path: Path) -> str:
    return "/outputs/" + path.relative_to(OUTPUTS_DIR).as_posix()


def save_upload_bytes(data: bytes, content_type: str, prefix: str, index: int = 1) -> Path:
    ext = IMAGE_EXTENSIONS.get(content_type, ".png")
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    filename = f"{timestamp}_{slugify(prefix)}_{uuid.uuid4().hex[:8]}_{index:03d}{ext}"
    path = UPLOADS_DIR / filename
    path.write_bytes(data)
    return path


def hide_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 10:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def response_detail(response: httpx.Response) -> str:
    text = response.text.strip()
    if not text:
        return "接口返回了空内容。"
    try:
        return json.dumps(response.json(), ensure_ascii=False)[:1000]
    except ValueError:
        return text[:1000]


class ApiResponseError(Exception):
    def __init__(self, response: httpx.Response):
        self.response = response
        super().__init__(response_detail(response))


def friendly_error(exc: Exception | httpx.Response) -> str:
    if isinstance(exc, ApiResponseError):
        return friendly_error(exc.response)
    if isinstance(exc, httpx.Response):
        status = exc.status_code
        detail = response_detail(exc)
        if status in {401, 403}:
            return f"API Key 无效、权限不足，或服务拒绝访问。{detail}"
        if status == 404:
            return f"接口不存在。请检查 Base URL、模型名，以及服务是否支持该功能。{detail}"
        if status == 429:
            return f"请求太快、余额不足或额度受限。请降低并发后再试。{detail}"
        if status in {400, 422}:
            return f"请求参数、模型名、尺寸或图片格式不符合接口要求。{detail}"
        if status >= 500:
            return f"接口服务异常，可能是代理或上游服务故障。{detail}"
        return f"接口返回错误 {status}：{detail}"
    if isinstance(exc, httpx.ConnectError):
        return "Base URL 连接失败。请检查网址、网络或代理服务。"
    if isinstance(exc, httpx.TimeoutException):
        return "请求超时。请稍后再试，或降低并发。"
    return str(exc)


def size_for_provider(provider: str, requested_size: str) -> str:
    if provider in {"openai", "proxy", "custom"}:
        return OPENAI_SIZES.get(requested_size, nearest_openai_size(requested_size))
    return requested_size


def nearest_openai_size(size: str) -> str:
    match = re.fullmatch(r"(\d+)x(\d+)", size)
    if not match:
        return "1024x1024"
    width, height = int(match.group(1)), int(match.group(2))
    ratio = width / max(height, 1)
    if ratio > 1.2:
        return "1536x1024"
    if ratio < 0.84:
        return "1024x1536"
    return "1024x1024"


def size_to_gemini_ratio(size: str) -> str | None:
    mapping = {
        "512x512": "1:1",
        "768x768": "1:1",
        "1024x1024": "1:1",
        "1024x1536": "2:3",
        "1536x1024": "3:2",
        "1080x1920": "9:16",
        "1920x1080": "16:9",
        "1200x1600": "3:4",
        "1600x1200": "4:3",
    }
    if size in mapping:
        return mapping[size]
    match = re.fullmatch(r"(\d+)x(\d+)", size)
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    ratio = width / max(height, 1)
    choices = [(1, "1:1"), (2 / 3, "2:3"), (3 / 2, "3:2"), (9 / 16, "9:16"), (16 / 9, "16:9"), (3 / 4, "3:4"), (4 / 3, "4:3")]
    return min(choices, key=lambda item: abs(item[0] - ratio))[1]


def mime_from_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "image/png"


def append_log(path: Path, message: str) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {message}\n")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    return load_settings()


@app.get("/api/model-catalog")
async def get_model_catalog() -> dict[str, Any]:
    return {"sections": read_model_catalog()}


@app.get("/api/config")
async def get_config() -> dict[str, Any]:
    return load_settings()["generation"]


@app.post("/api/settings")
async def set_settings(payload: dict[str, Any]) -> dict[str, Any]:
    settings = load_settings()
    if isinstance(payload.get("active_preset"), str):
        settings["active_preset"] = payload["active_preset"].strip()
    if isinstance(payload.get("custom_presets"), dict):
        settings["custom_presets"] = payload["custom_presets"]
    if isinstance(payload.get("module_defaults"), dict):
        settings["module_defaults"] = payload["module_defaults"]
    if isinstance(payload.get("custom_models"), dict):
        settings["custom_models"] = payload["custom_models"]
    for section in ("chat", "generation", "reverse", "vision"):
        incoming = payload.get(section)
        if not isinstance(incoming, dict):
            continue
        provider = incoming.get("provider", settings[section]["provider"])
        settings[section].update(
            {
                "provider": provider,
                "base_url": normalize_provider_base_url(provider, incoming.get("base_url") or default_base_url(provider)),
                "api_key": incoming.get("api_key", settings[section].get("api_key", "")).strip(),
                "model": incoming.get("model", settings[section]["model"]).strip(),
                "source_platform": incoming.get("source_platform", settings[section].get("source_platform", "")).strip(),
            }
        )
        if isinstance(incoming.get("display_name"), str):
            settings[section]["display_name"] = incoming["display_name"].strip()
        if section == "generation":
            settings[section]["concurrency"] = max(1, min(8, int(incoming.get("concurrency", settings[section]["concurrency"]))))
    save_settings(settings)
    return {"ok": True}


@app.post("/api/test")
async def test_api(payload: dict[str, Any]) -> dict[str, Any]:
    provider = payload.get("provider", "proxy")
    base_url = normalize_provider_base_url(provider, payload.get("base_url") or default_base_url(provider))
    api_key = payload.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先填写 API Key。")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            if provider == "gemini":
                response = await client.get(endpoint(base_url, "/models"), headers={"x-goog-api-key": api_key})
            elif provider == "dashscope" and "compatible-mode" not in base_url:
                return {"ok": True, "message": "DashScope 图像生成配置格式正确。生图会在任务里验证余额和模型权限。"}
            else:
                response = await client.get(endpoint(base_url, "/models"), headers={"Authorization": f"Bearer {api_key}"})
        if response.is_success:
            return {"ok": True, "message": "连接成功。"}
        return {"ok": False, "message": friendly_error(response)}
    except Exception as exc:
        return {"ok": False, "message": friendly_error(exc)}


def parse_batch_prompts(raw_value: str) -> list[str]:
    if not raw_value:
        return []
    try:
        payload = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="批量提示词格式不正确。") from exc
    if not isinstance(payload, list):
        raise HTTPException(status_code=400, detail="批量提示词格式不正确。")
    prompts = [str(item).strip() for item in payload if str(item).strip()]
    if len(prompts) > 20:
        raise HTTPException(status_code=400, detail="一次最多批量生成 20 张。")
    return prompts


@app.post("/api/tasks")
async def create_task(
    provider: str = Form("proxy"),
    mode: str = Form("text"),
    base_url: str = Form(...),
    api_key: str = Form(...),
    model: str = Form("gpt-image-1"),
    prompt: str = Form(...),
    task_name: str = Form("商品图任务"),
    size: str = Form("1024x1024"),
    custom_width: int = Form(0),
    custom_height: int = Form(0),
    quality: str = Form("auto"),
    output_format: str = Form("png"),
    images_per_reference: int = Form(1),
    batch_prompts: str = Form(""),
    concurrency: int = Form(2),
    primary_index: int = Form(1),
    save_settings_flag: bool = Form(True),
    files: list[UploadFile] = File(default=[]),
) -> dict[str, str]:
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="请填写 API Key。")
    if not prompt.strip():
        raise HTTPException(status_code=400, detail="请填写提示词。")
    if mode not in {"text", "edit"}:
        raise HTTPException(status_code=400, detail="任务模式不正确。")
    batch_prompt_list = parse_batch_prompts(batch_prompts)

    ensure_dirs()
    task_id = uuid.uuid4().hex
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    task_prefix = f"{timestamp}_{slugify(task_name)}_{task_id[:8]}"
    task_dir = OUTPUTS_DIR
    refs_dir = UPLOADS_DIR

    reference_paths: list[Path] = []
    for index, upload in enumerate(files, start=1):
        if not upload.filename:
            continue
        if upload.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail=f"{upload.filename} 格式不支持，请使用 png、jpg 或 webp。")
        ref_path = refs_dir / f"{task_prefix}_ref_{index:03d}{IMAGE_EXTENSIONS[upload.content_type]}"
        with ref_path.open("wb") as f:
            shutil.copyfileobj(upload.file, f)
        reference_paths.append(ref_path)
    if mode == "edit" and not reference_paths:
        raise HTTPException(status_code=400, detail="图生图模式请至少上传一张参考图。")

    requested_size = f"{custom_width}x{custom_height}" if size == "custom" and custom_width > 0 and custom_height > 0 else size
    api_size = size_for_provider(provider, requested_size)
    clean_base_url = normalize_provider_base_url(provider, base_url or default_base_url(provider))
    clean_config = {
        "provider": provider,
        "base_url": clean_base_url,
        "model": model.strip() or "gpt-image-1",
        "api_key": api_key.strip(),
        "concurrency": max(1, min(8, concurrency)),
    }
    if save_settings_flag:
        settings = load_settings()
        settings["generation"].update(clean_config)
        save_settings(settings)

    total = len(batch_prompt_list) if batch_prompt_list else max(1, min(4, images_per_reference))
    task = {
        "id": task_id,
        "mode": mode,
        "status": "queued",
        "message": "等待开始",
        "created_at": timestamp,
        "task_dir": str(task_dir),
        "file_prefix": task_prefix,
        "log_path": str(OUTPUTS_DIR / f"{task_prefix}_run.log"),
        "output_url": "/outputs/",
        "total": total,
        "completed": 0,
        "failed": 0,
        "items": [],
        "results": [],
    }
    tasks[task_id] = task

    metadata = {
        "task_id": task_id,
        "created_at": timestamp,
        "provider": provider,
        "mode": mode,
        "base_url": clean_base_url,
        "model": clean_config["model"],
        "prompt": prompt,
        "batch_prompts": batch_prompt_list,
        "task_name": task_name,
        "requested_size": requested_size,
        "api_size": api_size,
        "quality": quality,
        "output_format": output_format,
        "count": total,
        "primary_index": primary_index,
        "api_key_preview": hide_key(api_key),
        "references": [p.name for p in reference_paths],
    }
    (OUTPUTS_DIR / f"{task_prefix}_metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    asyncio.create_task(
        run_task(
            provider=provider,
            mode=mode,
            task_id=task_id,
            task_dir=task_dir,
            reference_paths=reference_paths,
            base_url=clean_base_url,
            api_key=api_key.strip(),
            model=clean_config["model"],
            prompt=prompt,
            requested_size=requested_size,
            api_size=api_size,
            quality=quality,
            output_format=output_format,
            count=total,
            batch_prompts=batch_prompt_list,
            primary_index=max(1, min(primary_index, max(1, len(reference_paths)))),
        )
    )
    return {"task_id": task_id}


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str) -> dict[str, Any]:
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在。")
    return task


@app.post("/api/tasks/{task_id}/open-output")
async def open_task_output(task_id: str) -> dict[str, Any]:
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在。")
    task_dir = Path(task["task_dir"])
    if not task_dir.exists():
        raise HTTPException(status_code=404, detail="输出目录不存在。")
    if os.name == "nt":
        os.startfile(str(task_dir))  # type: ignore[attr-defined]
        return {"ok": True}
    raise HTTPException(status_code=400, detail="当前系统不支持自动打开文件夹。")


@app.post("/api/reverse")
async def reverse_prompt(
    provider: str = Form("openai"),
    base_url: str = Form(...),
    api_key: str = Form(...),
    model: str = Form("gpt-4.1-mini"),
    style: str = Form("general"),
    complexity: str = Form("balanced"),
    image: UploadFile = File(...),
) -> dict[str, Any]:
    if not api_key.strip():
        raise HTTPException(status_code=400, detail="请填写反推 API Key。")
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="请上传 png、jpg 或 webp 图片。")
    image_bytes = await image.read()
    save_upload_bytes(image_bytes, image.content_type or "image/png", "reverse")
    try:
        instruction = build_reverse_instruction(style, complexity)
        async with httpx.AsyncClient(timeout=120) as client:
            if provider == "gemini":
                text = await reverse_with_gemini(client, normalize_provider_base_url(provider, base_url), api_key.strip(), model, image_bytes, image.content_type, instruction)
            else:
                text = await reverse_with_openai(client, normalize_provider_base_url(provider, base_url), api_key.strip(), model, image_bytes, image.content_type, instruction)
        return {"ok": True, "text": text, **split_reverse_text(text)}
    except Exception as exc:
        return {"ok": False, "message": friendly_error(exc)}


@app.post("/api/product/analyze")
async def analyze_product(
    product_name: str = Form(""),
    requirements: str = Form(""),
    images: list[UploadFile] | None = File(None),
) -> dict[str, Any]:
    settings = load_settings()
    section = settings["vision"] if images else settings["chat"]
    api_key = section.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在系统设置里配置视觉理解或聊天 API Key。")

    image_payloads: list[dict[str, str]] = []
    for index, image in enumerate(images or [], start=1):
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="产品图只支持 PNG、JPG、WEBP。")
        image_bytes = await image.read()
        save_upload_bytes(image_bytes, image.content_type or "image/png", "product", index)
        image_payloads.append(
            {
                "mime_type": image.content_type or "image/png",
                "data": base64.b64encode(image_bytes).decode("ascii"),
            }
        )

    prompt = build_product_analysis_prompt(product_name, requirements, bool(image_payloads))
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            text = await call_multimodal_text_model(client, section, prompt, image_payloads)
        analysis = parse_json_object(text) or {"text": text}
        analysis.setdefault("raw_text", text)
        return {"ok": True, "analysis": analysis}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=friendly_error(exc))


@app.post("/api/chat")
async def chat_assistant(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    raw_images = payload.get("images") if isinstance(payload.get("images"), list) else []
    if not message and not raw_images:
        raise HTTPException(status_code=400, detail="请先输入文字或添加图片。")

    image_payloads = normalize_chat_images(raw_images)
    settings = load_settings()
    section_name = "vision" if image_payloads else "chat"
    section = settings[section_name]
    api_key = section.get("api_key", "").strip()
    if not api_key:
        label = "视觉理解" if image_payloads else "聊天"
        raise HTTPException(status_code=400, detail=f"请先在系统设置里配置{label} API Key。")

    prompt = build_chat_prompt(message, history, bool(image_payloads))
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            reply = await call_multimodal_text_model(client, section, prompt, image_payloads)
        return {"ok": True, "reply": reply.strip() or "模型没有返回内容。"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=friendly_error(exc))


@app.post("/api/product/copywriting")
async def product_copywriting(payload: dict[str, Any]) -> dict[str, Any]:
    settings = load_settings()
    section = settings["chat"]
    api_key = section.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在系统设置里配置聊天 API Key。")

    prompt = build_copywriting_prompt(
        str(payload.get("product_name", "")),
        str(payload.get("requirements", "")),
        payload.get("analysis"),
        payload.get("copy_settings"),
    )
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            text = await call_multimodal_text_model(client, section, prompt, [])
        copywriting = parse_json_object(text) or {"raw_text": text}
        copywriting.setdefault("raw_text", text)
        return {"ok": True, "copywriting": copywriting}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=friendly_error(exc))


@app.post("/api/product/image-plan")
async def product_image_plan(payload: dict[str, Any]) -> dict[str, Any]:
    settings = load_settings()
    section = settings["chat"]
    api_key = section.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在系统设置里配置聊天 API Key。")

    source_text = str(payload.get("source_text", "")).strip()
    if not source_text:
        raise HTTPException(status_code=400, detail="请先从产品文案发送内容到图片策划。")

    try:
        quantity = max(1, min(20, int(payload.get("quantity", 8))))
    except (TypeError, ValueError):
        quantity = 8

    prompt = build_image_plan_prompt(
        str(payload.get("product_name", "")),
        str(payload.get("platform", "amazon")),
        str(payload.get("style", "tech")),
        quantity,
        str(payload.get("plan_type", "main_sub")),
        str(payload.get("prompt_format", "")),
        str(payload.get("language", "en")),
        source_text,
    )
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            text = await call_multimodal_text_model(client, section, prompt, [])
        return {"ok": True, "plan": text.strip() or "模型没有返回内容。"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=friendly_error(exc))


@app.post("/api/product/translate-copywriting")
async def translate_copywriting(payload: dict[str, Any]) -> dict[str, Any]:
    settings = load_settings()
    section = settings["chat"]
    api_key = section.get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="请先在系统设置里配置聊天 API Key。")

    target_language = str(payload.get("target_language", "en")).strip() or "en"
    copywriting = payload.get("copywriting")
    if not isinstance(copywriting, dict):
        raise HTTPException(status_code=400, detail="没有可翻译的文案内容。")

    prompt = build_copywriting_translation_prompt(target_language, copywriting)
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            text = await call_multimodal_text_model(client, section, prompt, [])
        translated = parse_json_object(text) or {"raw_text": text}
        return {"ok": True, "copywriting": translated}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=friendly_error(exc))


async def run_task(
    provider: str,
    mode: str,
    task_id: str,
    task_dir: Path,
    reference_paths: list[Path],
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    requested_size: str,
    api_size: str,
    quality: str,
    output_format: str,
    count: int,
    batch_prompts: list[str],
    primary_index: int,
) -> None:
    task = tasks[task_id]
    task["status"] = "running"
    task["message"] = "正在生成"
    log_path = Path(task["log_path"])

    async with httpx.AsyncClient(timeout=240) as client:
        jobs = [
            process_one(
                client,
                task,
                log_path,
                copy_index,
                provider,
                mode,
                base_url,
                api_key,
                model,
                batch_prompts[copy_index - 1] if copy_index <= len(batch_prompts) else prompt,
                batch_prompts[copy_index - 1] if copy_index <= len(batch_prompts) else "",
                requested_size,
                api_size,
                quality,
                output_format,
                [reference_paths[primary_index - 1]] if mode == "edit" and batch_prompts and reference_paths else reference_paths,
                1 if mode == "edit" and batch_prompts and reference_paths else primary_index,
                bool(batch_prompts),
            )
            for copy_index in range(1, count + 1)
        ]
        await asyncio.gather(*jobs)

    if task["failed"] and task["completed"]:
        task["status"] = "partial"
        task["message"] = "部分完成，部分失败"
    elif task["failed"]:
        task["status"] = "failed"
        task["message"] = "全部失败"
    else:
        task["status"] = "done"
        task["message"] = "全部完成"


async def process_one(
    client: httpx.AsyncClient,
    task: dict[str, Any],
    log_path: Path,
    copy_index: int,
    provider: str,
    mode: str,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    prompt_label: str,
    requested_size: str,
    api_size: str,
    quality: str,
    output_format: str,
    reference_paths: list[Path],
    primary_index: int,
    is_batch_prompt: bool,
) -> None:
    item_id = f"{copy_index:02d}"
    if mode == "text":
        reference_name = "文生图"
    elif prompt_label:
        short_label = prompt_label if len(prompt_label) <= 60 else f"{prompt_label[:57]}..."
        reference_name = f"批量提示词 {copy_index}：{short_label}"
    else:
        reference_name = f"多图参考，主图 {primary_index}"
    item = {"id": item_id, "reference": reference_name, "status": "running", "message": "生成中"}
    task["items"].append(item)
    try:
        ordered_prompt = prompt
        if mode == "edit" and is_batch_prompt:
            ordered_prompt = (
                "本次是花括号批量任务中的一条独立生图提示词，只执行当前这一条提示词。"
                "不要引用、混合或延续其他花括号提示词的内容。"
                "只以当前上传的参考图作为产品外观参考，生成一张完整独立图片。"
                "禁止拼图、分屏、左右对比、前后对比、多画面排版、同一图里展示两个不同卖点或两个场景。"
                "不要把参考图原图和生成场景并排放在同一张图里。"
                "\n\n当前独立提示词：\n"
                f"{prompt}"
            )
        if mode == "edit" and provider not in {"dashscope", "gemini"}:
            ordered_prompt = (
                f"{ordered_prompt}\n\n参考图顺序说明：上传的图片按角标 1、2、3... 排列。"
                f"请重点修改第 {primary_index} 张主图，同时参考其他图片的内容、风格、材质或构图。"
            )
            if provider == "dashscope":
                result = await call_dashscope_image(client, base_url, api_key, model, ordered_prompt, reference_paths, requested_size, mode)
            elif provider == "gemini":
                result = await call_google_image(client, base_url, api_key, model, ordered_prompt, reference_paths, requested_size, mode)
        if provider == "dashscope":
            result = await call_dashscope_image(client, base_url, api_key, model, ordered_prompt, reference_paths, requested_size, mode)
        elif provider == "gemini":
            result = await call_google_image(client, base_url, api_key, model, ordered_prompt, reference_paths, requested_size, mode)
        elif mode == "text":
            result = await call_openai_image_generation(client, base_url, api_key, model, ordered_prompt, api_size, quality, output_format)
        else:
            result = await call_openai_image_edit(client, base_url, api_key, model, ordered_prompt, reference_paths, api_size, quality, output_format)

        out_ext = ".jpg" if output_format == "jpeg" else f".{output_format}"
        out_path = Path(task["task_dir"]) / f"{task['file_prefix']}_{item_id}{out_ext}"
        out_path.write_bytes(result)
        item.update({"status": "done", "message": "成功", "url": public_output_path(out_path)})
        task["results"].append({"url": public_output_path(out_path), "file": out_path.name, "reference": reference_name})
        task["completed"] += 1
        append_log(log_path, f"[OK] {item_id} {reference_name} -> {out_path.name}")
    except Exception as exc:
        message = friendly_error(exc)
        item.update({"status": "failed", "message": message})
        task["failed"] += 1
        append_log(log_path, f"[FAIL] {item_id} {reference_name}: {message}")
    finally:
        finished = task["completed"] + task["failed"]
        task["message"] = f"已处理 {finished}/{task['total']}"


async def call_openai_image_generation(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    size: str,
    quality: str,
    output_format: str,
) -> bytes:
    data: dict[str, Any] = {"model": model, "prompt": prompt, "size": size, "n": 1}
    if quality != "auto":
        data["quality"] = quality
    if output_format:
        data["output_format"] = output_format
    response = await client.post(endpoint(base_url, "/images/generations"), headers={"Authorization": f"Bearer {api_key}"}, json=data)
    return await parse_openai_image_response(client, response)


async def call_openai_image_edit(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_paths: list[Path],
    size: str,
    quality: str,
    output_format: str,
) -> bytes:
    data: dict[str, Any] = {"model": model, "prompt": prompt, "size": size, "n": "1"}
    if quality != "auto":
        data["quality"] = quality
    if output_format:
        data["output_format"] = output_format
    handles = [path.open("rb") for path in image_paths]
    try:
        files = [("image", (path.name, handle, mime_from_path(path))) for path, handle in zip(image_paths, handles)]
        response = await client.post(endpoint(base_url, "/images/edits"), headers={"Authorization": f"Bearer {api_key}"}, data=data, files=files)
    finally:
        for handle in handles:
            handle.close()
    return await parse_openai_image_response(client, response)


async def parse_openai_image_response(client: httpx.AsyncClient, response: httpx.Response) -> bytes:
    if not response.is_success:
        raise ApiResponseError(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"接口返回了非 JSON 内容：{response_detail(response)}") from exc
    first = payload.get("data", [{}])[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"])
    if first.get("url"):
        image_response = await client.get(first["url"])
        image_response.raise_for_status()
        return image_response.content
    raise RuntimeError(f"接口没有返回图片数据：{json.dumps(payload, ensure_ascii=False)[:500]}")


async def call_dashscope_image(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_paths: list[Path],
    size: str,
    mode: str,
) -> bytes:
    content: list[dict[str, Any]] = [{"text": prompt}]
    if mode == "edit":
        for index, path in enumerate(image_paths, start=1):
            content.append({"text": f"参考图 {index}"})
            content.append({"image": image_data_url(path)})
    if mode == "edit":
        content = [{"image": image_data_url(path)} for path in image_paths]
    else:
        content = []
    content.append({"text": prompt})
    parameters: dict[str, Any] = {"n": 1}
    resolution = dashscope_resolution(size)
    if resolution:
        parameters["size"] = resolution
    payload = {
        "model": model,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }
    response = await client.post(
        endpoint(base_url, "/services/aigc/multimodal-generation/generation"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "disable",
        },
        json=payload,
    )
    if not response.is_success:
        raise ApiResponseError(response)
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"DashScope 返回了非 JSON 内容：{response_detail(response)}") from exc
    image_url = extract_dashscope_image_url(data)
    if image_url:
        image_response = await client.get(image_url)
        image_response.raise_for_status()
        return image_response.content
    b64 = extract_dashscope_b64(data)
    if b64:
        return base64.b64decode(b64)
    raise RuntimeError(f"DashScope 没有返回图片：{json.dumps(data, ensure_ascii=False)[:800]}")


def image_data_url(path: Path) -> str:
    return f"data:{mime_from_path(path)};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def dashscope_resolution(size: str) -> str | None:
    if size == "auto":
        return None
    if re.fullmatch(r"\d+x\d+", size):
        return size.replace("x", "*")
    if re.fullmatch(r"\d+\*\d+", size):
        return size
    return "1024*1024"


def extract_dashscope_image_url(data: dict[str, Any]) -> str | None:
    output = data.get("output", {})
    for key in ("choices", "results", "images"):
        value = output.get(key)
        if isinstance(value, list):
            for item in value:
                if not isinstance(item, dict):
                    continue
                for url_key in ("url", "image_url", "image"):
                    url = item.get(url_key)
                    if isinstance(url, str) and url.startswith(("http://", "https://")):
                        return url
                message = item.get("message", {})
                for part in message.get("content", []) if isinstance(message, dict) else []:
                    if isinstance(part, dict):
                        url = part.get("image") or part.get("url")
                        if isinstance(url, str) and url.startswith(("http://", "https://")):
                            return url
    return None


def extract_dashscope_b64(data: dict[str, Any]) -> str | None:
    text = json.dumps(data)
    match = re.search(r"data:image/[^;]+;base64,([A-Za-z0-9+/=]+)", text)
    if match:
        return match.group(1)
    for key in ("b64_json", "base64", "image_base64"):
        match = re.search(rf'"{key}"\s*:\s*"([A-Za-z0-9+/=]+)"', text)
        if match:
            return match.group(1)
    return None


async def call_google_image(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_paths: list[Path],
    size: str,
    mode: str,
) -> bytes:
    if model.startswith("imagen-"):
        if mode == "edit" or image_paths:
            raise RuntimeError("Imagen 模型只支持文生图。需要参考图修改时请选择 Gemini 图像模型。")
        return await call_imagen_image(client, base_url, api_key, model, prompt, size)
    return await call_gemini_image(client, base_url, api_key, model, prompt, image_paths, size)


async def call_gemini_image(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    image_paths: list[Path],
    size: str,
) -> bytes:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for index, path in enumerate(image_paths, start=1):
        parts.append({"text": f"参考图 {index}"})
        parts.append({"inlineData": {"mimeType": mime_from_path(path), "data": base64.b64encode(path.read_bytes()).decode("ascii")}})
    generation_config: dict[str, Any] = {"responseModalities": ["IMAGE"]}
    ratio = size_to_gemini_ratio(size)
    if ratio:
        generation_config["imageConfig"] = {"aspectRatio": ratio}
    response = await client.post(
        endpoint(base_url, f"/models/{model}:generateContent"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={"contents": [{"parts": parts}], "generationConfig": generation_config},
    )
    if not response.is_success:
        raise ApiResponseError(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Gemini 返回了非 JSON 内容：{response_detail(response)}") from exc
    for candidate in payload.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError(f"Gemini 没有返回图片。可能是模型、地区、额度或安全策略限制：{json.dumps(payload, ensure_ascii=False)[:500]}")


async def call_imagen_image(client: httpx.AsyncClient, base_url: str, api_key: str, model: str, prompt: str, size: str) -> bytes:
    parameters: dict[str, Any] = {"sampleCount": 1}
    ratio = size_to_gemini_ratio(size)
    if ratio:
        parameters["aspectRatio"] = ratio
    response = await client.post(
        endpoint(base_url, f"/models/{model}:predict"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={"instances": [{"prompt": prompt}], "parameters": parameters},
    )
    if not response.is_success:
        raise ApiResponseError(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Imagen 返回了非 JSON 内容：{response_detail(response)}") from exc
    for prediction in payload.get("predictions", []):
        data = prediction.get("bytesBase64Encoded") or prediction.get("bytes_base64_encoded")
        if data:
            return base64.b64decode(data)
    raise RuntimeError(f"Imagen 没有返回图片：{json.dumps(payload, ensure_ascii=False)[:500]}")


def build_reverse_instruction(style: str, complexity: str) -> str:
    style_map = {
        "general": "通用写实风格，准确描述主体、场景、光线、构图和色彩。",
        "ecommerce": "电商商品图风格，重点描述产品主体、卖点、背景、材质、光线和商业质感。",
        "portrait": "人像写真风格，重点描述人物表情、姿态、服装、光线、镜头语言和氛围。",
        "poster": "海报广告风格，重点描述主题、视觉冲击力、版式留白、品牌感和传播氛围。",
        "cinematic": "电影感风格，重点描述镜头、景别、光影、色调、叙事氛围和质感。",
    }
    complexity_map = {
        "simple": "提示词保持简洁，每段 60 到 100 字。",
        "balanced": "提示词信息完整但不过度堆砌，每段 120 到 180 字。",
        "detailed": "提示词丰富，包含主体、环境、光线、色彩、构图、材质和风格细节。",
        "expert": "提示词专业细致，加入镜头语言、商业用途、视觉层级、质感和负面规避建议。",
    }
    return (
        "请分析这张图片，反推出适合 AI 生图的提示词。"
        f"固定风格要求：{style_map.get(style, style_map['general'])}"
        f"复杂度要求：{complexity_map.get(complexity, complexity_map['balanced'])}"
        "必须输出两段，并严格使用这两个标题：中文提示词：... 英文提示词：..."
    )


def build_product_analysis_prompt(product_name: str, requirements: str, has_images: bool) -> str:
    image_note = "请结合上传的多张产品图片判断真实外观、材质、功能和使用方式。" if has_images else "没有上传图片，请根据产品名称和要求进行分析。"
    return f"""
你是资深跨境电商产品经理和亚马逊 Listing 策划师。
产品名称：{product_name or "未填写"}
用户要求：{requirements or "无"}
{image_note}

请输出严格 JSON，不要输出 Markdown。字段必须包含：
selling_points: 5 到 8 条核心卖点数组；
target_audience: 目标人群数组；
use_scenarios: 使用场景数组；
positioning: 一段产品定位；
image_prompt_direction: 适合后续 AI 生图的视觉方向。
""".strip()


def build_chat_prompt(message: str, history: list[Any], has_images: bool) -> str:
    clean_history: list[str] = []
    for item in history[-20:]:
        if not isinstance(item, dict):
            continue
        role = "用户" if item.get("role") == "user" else "助手"
        content = str(item.get("content", "")).strip()
        if content:
            clean_history.append(f"{role}：{content}")
    history_text = "\n".join(clean_history) or "无"
    image_note = "用户本轮附带了图片，请结合图片内容回答。" if has_images else "用户本轮没有附带图片。"
    return f"""
你是这个本地 AI 图片与产品内容工作台里的聊天助手。
请用中文回答，语气清楚、直接、适合非程序员理解。
如果用户在讨论软件操作、产品文案、生图提示词或图片，请给出可执行建议。

最近对话：
{history_text}

本轮消息：
{message or "用户只发送了图片。"}

{image_note}
""".strip()


def normalize_chat_images(raw_images: list[Any]) -> list[dict[str, str]]:
    images: list[dict[str, str]] = []
    for item in raw_images[:6]:
        if not isinstance(item, dict):
            continue
        mime_type = str(item.get("mime_type") or item.get("type") or "image/png")
        if mime_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="聊天图片只支持 PNG、JPG、WEBP。")
        data = str(item.get("data", "")).strip()
        if "," in data and data.startswith("data:"):
            data = data.split(",", 1)[1]
        if not data:
            continue
        try:
            save_upload_bytes(base64.b64decode(data), mime_type, "chat", len(images) + 1)
        except ValueError:
            raise HTTPException(status_code=400, detail="聊天图片读取失败，请重新上传。")
        images.append({"mime_type": mime_type, "data": data})
    return images


def build_copywriting_prompt(product_name: str, requirements: str, analysis: Any, copy_settings: Any = None) -> str:
    preset = "standard"
    if isinstance(copy_settings, dict):
        preset = str(copy_settings.get("preset", "standard"))
    preset_map = {
        "standard": {
            "name": "标准",
            "style": "表达完整但不过度冗长，适合直接作为第一版亚马逊文案。",
        },
        "detailed": {
            "name": "详细",
            "style": "表达更丰富，补充更多场景、利益点和视觉细节，但不要重复堆砌。",
        },
        "concise": {
            "name": "精简",
            "style": "表达更短、更利落，便于后续人工快速修改。",
        },
    }
    preset_info = preset_map.get(preset, preset_map["standard"])
    return f"""
你是亚马逊美国站资深文案和视觉策划。
产品名称：{product_name or "未填写"}
用户要求：{requirements or "无"}
产品分析：{json.dumps(analysis or {}, ensure_ascii=False)}
文案模板：{preset_info["name"]}
模板要求：{preset_info["style"]}

请基于以上信息输出严格 JSON，不要输出 Markdown。字段必须包含：
keyword_combinations_en: 8 到 12 条英文关键词组合数组，偏亚马逊广告关键词、搜索词、卖点词组；
keyword_combinations_zh: 对应中文关键词组合数组；
bullets_en: 5 条英文五点描述数组；
bullets_zh: 对应中文五点描述数组；
image_copy_en: 10 条英文主图/副图画面文案数组，覆盖主图和副图构思；
image_copy_zh: 对应中文主图/副图画面文案数组；
aplus_copy_en: 13 条英文 A+ 页面模块文案数组；
aplus_copy_zh: 对应中文 A+ 页面模块文案数组。
要求：中英文必须一起生成；默认英文用于展示，但中文必须同时返回；文案适合亚马逊美国站，不夸大疗效，不写无法验证的认证，不使用绝对化违规词；五点描述必须符合亚马逊常见卖点表达，图片文案要能直接指导主图、副图和 A+ 视觉制作。
""".strip()


def build_image_plan_prompt(
    product_name: str,
    platform: str,
    style: str,
    quantity: int,
    plan_type: str,
    prompt_format: str,
    language: str,
    source_text: str,
) -> str:
    platform_label = {
        "amazon": "亚马逊",
        "walmart": "沃尔玛",
        "temu": "Temu",
        "ebay": "eBay",
        "etsy": "Etsy",
        "aliexpress": "速卖通",
        "tiktok_shop": "TikTok Shop",
        "shopee": "Shopee",
        "lazada": "Lazada",
        "shein": "SHEIN",
        "shopify": "独立站 / Shopify",
        "taobao": "淘宝",
        "tmall": "天猫",
        "jd": "京东",
        "pinduoduo": "拼多多",
        "douyin": "抖音电商",
        "kuaishou": "快手电商",
        "xiaohongshu": "小红书",
        "1688": "1688",
    }.get(platform, "亚马逊")
    style_label = {
        "tech": "科技",
        "home": "家居",
        "sport": "运动",
        "minimal_white": "极简白底",
        "premium": "高端质感",
        "lifestyle": "生活方式",
        "scenario": "场景化种草",
        "promo": "爆款促销",
        "black_friday": "黑五大促",
        "fresh": "清新自然",
        "luxury": "奢华精品",
        "guochao": "国潮新中式",
        "cute": "可爱潮玩",
        "industrial": "工业硬核",
    }.get(style, "科技")
    type_label = {
        "main_sub": "主副图",
        "aplus": "A+",
        "brand_story": "品牌故事",
        "sbh_ad": "SBH广告",
        "package": "包装设计",
    }.get(plan_type, "主副图")
    clean_format = prompt_format.strip() or "图片类型；画面主体；构图；背景/场景；光线；色彩；风格；卖点表达；模特/道具；禁止项。"
    output_language = "中文" if language == "zh" else "English"
    return f"""
你是资深电商图片策划和 AI 生图提示词专家。
请根据产品卖点、关键词组合、五点描述、主副图文案和 A+ 文案，生成一组可直接用于 AI 生图的详细提示词。

产品名称：{product_name or "未填写"}
目标平台：{platform_label}
视觉风格：{style_label}
策划类型：{type_label}
策划数量：{quantity} 条
输出语言：{output_language}
每条提示词必须遵循的格式：{clean_format}

来源内容：
{source_text}

输出要求：
1. 只输出图片策划提示词，不要解释，不要 Markdown 标题。
2. 每一条生图提示词必须用花括号包起来，例如：{{主图：...}}。
3. 每一条都必须明确标注图片类型，并且符合“策划类型”：{type_label}。
4. 每一条都要融合卖点、构图、色彩、风格、场景、产品展示方式；需要模特时明确模特类型、姿态和使用动作。
5. 严格生成 {quantity} 条；这是硬性数量要求，不要多生成，也不要少生成；每条提示词之间空一行，提升可读性。
6. 提示词要尽量精确详细，适合直接粘贴到文生图或图生图里批量生成。
7. 不要写无法证明的认证、医疗效果、夸大承诺或平台违规词。
""".strip()


def build_copywriting_translation_prompt(target_language: str, copywriting: dict[str, Any]) -> str:
    language_map = {
        "en": "English",
        "zh": "简体中文",
        "ja": "日本語",
        "de": "Deutsch",
        "fr": "Français",
        "es": "Español",
        "it": "Italiano",
        "nl": "Nederlands",
    }
    language = language_map.get(target_language, "English")
    def first_copy_value(*keys: str) -> Any:
        for key in keys:
            value = copywriting.get(key)
            if isinstance(value, list) and value:
                return value
            if isinstance(value, str) and value.strip():
                return value
        return []

    source = {
        "keyword_combinations": first_copy_value("keyword_combinations_en", "keyword_combinations_zh", "keyword_combinations", "keywords", "title_directions", "titles"),
        "bullets": first_copy_value("bullets_en", "bullets_zh", "bullets"),
        "image_copy": first_copy_value("image_copy_en", "image_copy_zh", "image_copy", "imageCopy"),
        "aplus_copy": first_copy_value("aplus_copy_en", "aplus_copy_zh", "aplus_copy", "aplusCopy"),
    }
    return f"""
你是专业跨境电商本地化翻译。
请把以下亚马逊文案翻译成：{language}。

原始文案 JSON：
{json.dumps(source, ensure_ascii=False)}

请输出严格 JSON，不要输出 Markdown。字段必须保持完全一致：
keyword_combinations
bullets
image_copy
aplus_copy

要求：只翻译文案内容，不新增字段，不解释；保留亚马逊电商语气，避免夸大疗效、绝对化词和无法验证认证。
""".strip()


def parse_json_object(text: str) -> dict[str, Any] | None:
    clean = text.strip()
    if clean.startswith("```"):
        clean = re.sub(r"^```(?:json)?\s*", "", clean)
        clean = re.sub(r"\s*```$", "", clean)
    try:
        data = json.loads(clean)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, re.S)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            return None


async def call_multimodal_text_model(client: httpx.AsyncClient, section: dict[str, Any], prompt: str, images: list[dict[str, str]]) -> str:
    provider = section.get("provider", "openai")
    base_url = normalize_provider_base_url(provider, section.get("base_url", ""))
    api_key = section.get("api_key", "").strip()
    model = section.get("model", "").strip()
    if provider == "gemini":
        return await call_gemini_text_model(client, base_url, api_key, model, prompt, images)
    return await call_openai_text_model(client, base_url, api_key, model, prompt, images)


async def call_openai_text_model(client: httpx.AsyncClient, base_url: str, api_key: str, model: str, prompt: str, images: list[dict[str, str]]) -> str:
    if images:
        content: str | list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        content.extend(
            {"type": "image_url", "image_url": {"url": f"data:{image['mime_type']};base64,{image['data']}"}}
            for image in images
        )
    else:
        content = prompt
    payload = {"model": model, "messages": [{"role": "user", "content": content}]}
    response = await client.post(endpoint(base_url, "/chat/completions"), headers={"Authorization": f"Bearer {api_key}"}, json=payload)
    if not response.is_success:
        raise ApiResponseError(response)
    data = response.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


async def call_gemini_text_model(client: httpx.AsyncClient, base_url: str, api_key: str, model: str, prompt: str, images: list[dict[str, str]]) -> str:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    parts.extend({"inlineData": {"mimeType": image["mime_type"], "data": image["data"]}} for image in images)
    response = await client.post(
        endpoint(base_url, f"/models/{model}:generateContent"),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json={"contents": [{"parts": parts}]},
    )
    if not response.is_success:
        raise ApiResponseError(response)
    data = response.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "\n".join(part.get("text", "") for part in parts if part.get("text"))


async def reverse_with_openai(client: httpx.AsyncClient, base_url: str, api_key: str, model: str, image_bytes: bytes, mime_type: str, instruction: str) -> str:
    image_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": instruction,
                    },
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
    }
    response = await client.post(endpoint(base_url, "/chat/completions"), headers={"Authorization": f"Bearer {api_key}"}, json=payload)
    if not response.is_success:
        raise ApiResponseError(response)
    data = response.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


async def reverse_with_gemini(client: httpx.AsyncClient, base_url: str, api_key: str, model: str, image_bytes: bytes, mime_type: str, instruction: str) -> str:
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": instruction},
                    {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}},
                ]
            }
        ]
    }
    response = await client.post(endpoint(base_url, f"/models/{model}:generateContent"), headers={"x-goog-api-key": api_key, "Content-Type": "application/json"}, json=payload)
    if not response.is_success:
        raise ApiResponseError(response)
    data = response.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    return "\n".join(part.get("text", "") for part in parts if part.get("text"))


def split_reverse_text(text: str) -> dict[str, str]:
    zh = ""
    en = ""
    zh_match = re.search(r"中文提示词[:：]\s*(.*?)(?:英文提示词[:：]|$)", text, re.S)
    en_match = re.search(r"英文提示词[:：]\s*(.*)$", text, re.S)
    if zh_match:
        zh = zh_match.group(1).strip()
    if en_match:
        en = en_match.group(1).strip()
    return {"zh_prompt": zh, "en_prompt": en}


def find_free_port(host: str = "127.0.0.1", start: int = 7860, attempts: int = 20) -> int:
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex((host, port)) != 0:
                return port
    raise RuntimeError(f"没有找到可用端口，请先关闭 {start}-{start + attempts - 1} 范围内的旧服务。")


if __name__ == "__main__":
    ensure_dirs()
    import uvicorn

    host = "127.0.0.1"
    port = find_free_port(host=host)
    url = f"http://{host}:{port}"
    print(f"\n橙白 AI 图片工坊已启动：{url}\n")
    webbrowser.open(url)
    uvicorn.run("app:app", host=host, port=port, reload=False)
