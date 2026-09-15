from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = APP_DIR / "static"
OUTPUTS_DIR = APP_DIR / "outputs"
UPLOADS_DIR = APP_DIR / "uploads"
CONFIG_PATH = APP_DIR / "config.json"
MODEL_CATALOG_PATH = APP_DIR / "API config .csv"

DEFAULT_SETTINGS: dict[str, Any] = {
    "active_preset": "dashscope",
    "module_defaults": {},
    "custom_models": {
        "chat": [],
        "generation": [],
        "vision": [],
        "reverse": [],
    },
    "chat": {
        "provider": "dashscope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "",
        "model": "qwen-plus",
    },
    "generation": {
        "provider": "dashscope",
        "base_url": "https://dashscope.aliyuncs.com/api/v1",
        "api_key": "",
        "model": "wan2.7-image",
        "concurrency": 2,
    },
    "reverse": {
        "provider": "dashscope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "",
        "model": "qwen-vl-plus",
    },
    "vision": {
        "provider": "dashscope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "",
        "model": "qwen-vl-plus",
    },
    "custom_presets": {},
}


def deep_merge(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(base))
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_settings() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_SETTINGS))
    if "generation" not in saved:
        saved = {"generation": saved}
    return deep_merge(DEFAULT_SETTINGS, saved)


def save_settings(settings: dict[str, Any]) -> None:
    CONFIG_PATH.write_text(
        json.dumps(deep_merge(DEFAULT_SETTINGS, settings), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def normalize_base_url(base_url: str) -> str:
    clean = base_url.strip().rstrip("/")
    if clean.endswith("/chat/completions"):
        clean = clean[: -len("/chat/completions")]
    return clean


def normalize_provider_base_url(provider: str, base_url: str) -> str:
    clean = normalize_base_url(base_url)
    if provider in {"proxy", "openai", "modelscope"} and clean and not clean.endswith("/v1"):
        clean = f"{clean}/v1"
    return clean


def default_base_url(provider: str) -> str:
    if provider == "openai":
        return "https://api.openai.com/v1"
    if provider == "gemini":
        return "https://generativelanguage.googleapis.com/v1beta"
    if provider == "dashscope":
        return "https://dashscope.aliyuncs.com/api/v1"
    if provider == "modelscope":
        return "https://api-inference.modelscope.cn/v1"
    return "https://z.apiyihe.org/v1"


def provider_from_source(source: str) -> str:
    text = source.strip().lower()
    if "dashscope" in text or "百炼" in source or "阿里云" in source:
        return "dashscope"
    if "openai" in text and "官方" in source:
        return "openai"
    if "gemini" in text or "google" in text:
        return "gemini"
    if "modelscope" in text or "魔塔" in source or "魔搭" in source:
        return "modelscope"
    return "custom"


def catalog_base_url(provider: str, base_url: str) -> str:
    clean = normalize_base_url(base_url.strip())
    if provider == "gemini" and "/openai" in clean:
        return "https://generativelanguage.googleapis.com/v1beta"
    return normalize_provider_base_url(provider, clean or default_base_url(provider))


def catalog_section(category: str) -> str | None:
    clean = category.strip()
    if clean == "聊天":
        return "chat"
    if clean in {"生图", "生图/编辑"}:
        return "generation"
    if clean == "视觉识别":
        return "vision"
    return None


def read_model_catalog() -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {"chat": [], "generation": [], "vision": []}
    if not MODEL_CATALOG_PATH.exists():
        return grouped
    with MODEL_CATALOG_PATH.open("r", encoding="gbk", newline="") as handle:
        for row in csv.DictReader(handle):
            section = catalog_section(row.get("模块分类", ""))
            model = row.get("模型调用ID", "").strip()
            display_name = row.get("模型显示名称", "").strip()
            if not section or not model or not display_name:
                continue
            source = row.get("接口来源平台", "").strip()
            provider = provider_from_source(source)
            grouped[section].append(
                {
                    "section": section,
                    "display_name": display_name,
                    "model": model,
                    "source_platform": source,
                    "base_url": catalog_base_url(provider, row.get("BaseURL", "")),
                    "provider": provider,
                    "cost_level": row.get("费用等级", "").strip(),
                    "priority": row.get("使用优先级", "").strip(),
                    "is_default": any(str(value).strip() == "默认" for value in row.values()),
                    "is_custom": False,
                }
            )
    return grouped
