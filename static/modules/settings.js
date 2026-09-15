const settingsModal = document.querySelector("#settingsModal");
const openSettings = document.querySelector("#openSettings");
const saveSettingsBtn = document.querySelector("#saveSettingsBtn");
const testActiveApi = document.querySelector("#testActiveApi");
const setDefaultSettings = document.querySelector("#setDefaultSettings");
const saveCustomModel = document.querySelector("#saveCustomModel");
const settingsStatus = document.querySelector("#settingsStatus");
const tabs = document.querySelectorAll("#settingsModal .tab");
const panes = document.querySelectorAll("#settingsModal .settings-pane");

let activeSettingsTab = "chat";
let settings = null;
let modelCatalog = { chat: [], generation: [], vision: [] };

const settingsSections = ["chat", "generation", "reverse", "vision"];
const visibleSettingsSections = ["chat", "generation", "vision"];
const sectionLabels = {
  chat: "聊天",
  generation: "生图",
  vision: "视觉识别",
  reverse: "反推",
};

const providerDefaults = {
  chat: {
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    proxy: "https://z.apiyihe.org/v1",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    modelscope: "https://api-inference.modelscope.cn/v1",
    custom: "https://z.apiyihe.org/v1",
  },
  generation: {
    dashscope: "https://dashscope.aliyuncs.com/api/v1",
    proxy: "https://z.apiyihe.org/v1",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    modelscope: "https://api-inference.modelscope.cn/v1",
    custom: "https://z.apiyihe.org/v1",
  },
  reverse: {
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    proxy: "https://z.apiyihe.org/v1",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    modelscope: "https://api-inference.modelscope.cn/v1",
    custom: "https://z.apiyihe.org/v1",
  },
  vision: {
    dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    proxy: "https://z.apiyihe.org/v1",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
    modelscope: "https://api-inference.modelscope.cn/v1",
    custom: "https://z.apiyihe.org/v1",
  },
};

export async function loadSettings() {
  const [settingsResponse, catalogResponse] = await Promise.all([
    fetch("/api/settings"),
    fetch("/api/model-catalog"),
  ]);
  settings = normalizeSettings(await settingsResponse.json());
  if (catalogResponse.ok) {
    const catalog = await catalogResponse.json();
    modelCatalog = catalog.sections || { chat: [], generation: [], vision: [] };
  }
  renderSettings();
  return settings;
}

export function collectSettings() {
  const next = normalizeSettings(settings || {});
  for (const section of visibleSettingsSections) {
    const container = document.querySelector(`[data-section="${section}"]`);
    if (container?.querySelector('[data-field="model"]')) {
      next[section] = readSectionConfig(section);
    }
  }
  return next;
}

function normalizeSettings(data) {
  const next = { ...(data || {}) };
  next.active_preset = next.active_preset || "";
  next.custom_presets = next.custom_presets || {};
  next.module_defaults = next.module_defaults || {};
  next.custom_models = next.custom_models || {};
  for (const section of settingsSections) {
    const sectionDefault = providerDefaults[section]?.proxy || providerDefaults.chat.proxy;
    next[section] = {
      provider: "custom",
      source_platform: "自定义 / OpenAI 兼容",
      base_url: sectionDefault,
      api_key: "",
      model: "",
      ...(next[section] || {}),
    };
    if (!next[section].source_platform) {
      next[section].source_platform = providerLabel(next[section].provider);
    }
    next[section].base_url = normalizeCatalogBaseUrl(next[section].provider, next[section].base_url);
    if (section === "generation") next[section].concurrency = Number(next[section].concurrency || 1);
    next.custom_models[section] = Array.isArray(next.custom_models[section]) ? next.custom_models[section] : [];
  }
  return next;
}

function renderSettings() {
  settings = normalizeSettings(settings);
  for (const section of visibleSettingsSections) {
    const container = document.querySelector(`[data-section="${section}"]`);
    if (!container) continue;
    const current = settings[section];
    const selected = findModelForSection(section, current);
    const models = sectionModels(section).map((item) => normalizeCatalogItem(section, item));
    const selectedKey = selected
      ? `${selected.is_custom ? "custom" : "catalog"}:${selected.provider}:${selected.model}`
      : "__custom__";
    const modelOptions = models.map((item) => {
      const key = `${item.is_custom ? "custom" : "catalog"}:${item.provider}:${item.model}`;
      const suffix = item.is_custom ? "（自定义）" : item.is_default ? "（默认推荐）" : "";
      return `<option value="${escapeHtml(key)}">${escapeHtml(item.display_name + suffix)}</option>`;
    }).join("");

    container.innerHTML = `
      <label>模型名
        <select data-field="model_choice" data-section-name="${section}">
          ${modelOptions}
          <option value="__custom__">自定义模型...</option>
        </select>
      </label>
      <label class="custom-model-name hidden">自定义显示名称
        <input data-field="display_name" data-section-name="${section}" placeholder="例如：我的新模型" />
      </label>
      <label>模型调用 ID
        <input data-field="model" data-section-name="${section}" placeholder="例如：gpt-4.1-mini" />
      </label>
      <label>接口来源
        <input data-field="source_platform" data-section-name="${section}" placeholder="例如：OpenAI 官方 / 自定义代理" />
      </label>
      <label>Base URL
        <input data-field="base_url" data-section-name="${section}" />
      </label>
      <label>API Key
        <input data-field="api_key" data-section-name="${section}" type="password" autocomplete="off" />
      </label>
      <input type="hidden" data-field="provider" data-section-name="${section}" />
      ${section === "generation" ? `<label>并发数量<input data-field="concurrency" data-section-name="${section}" type="number" min="1" max="8" /></label>` : ""}
    `;

    const item = selected || normalizeCatalogItem(section, current);
    container.querySelector('[data-field="model_choice"]').value = selected ? selectedKey : "__custom__";
    applyModelToSection(section, item, { keepApiKey: true });
    container.querySelector('[data-field="api_key"]').value = current.api_key || "";
    if (section === "generation") container.querySelector('[data-field="concurrency"]').value = current.concurrency || 1;
    const isCustomChoice = !selected || current.display_name;
    container.querySelector(".custom-model-name").classList.toggle("hidden", !isCustomChoice);
    container.querySelector('[data-field="display_name"]').value = current.display_name || selected?.display_name || "";
  }
}

function sectionModels(section) {
  const builtIn = (modelCatalog[section] || []).map((item) => ({ ...item, is_custom: false }));
  const custom = (settings?.custom_models?.[section] || []).map((item) => ({ ...item, is_custom: true }));
  return [...builtIn, ...custom];
}

function normalizeCatalogItem(section, item = {}) {
  const sourcePlatform = item.source_platform || providerLabel(item.provider);
  const provider = item.provider || providerFromSourceLabel(sourcePlatform);
  return {
    section,
    display_name: item.display_name || item.model || "自定义模型",
    model: item.model || "",
    source_platform: sourcePlatform,
    base_url: normalizeCatalogBaseUrl(provider, item.base_url || providerDefaults[section]?.[provider]),
    provider,
    is_default: Boolean(item.is_default),
    is_custom: Boolean(item.is_custom),
  };
}

function defaultModelForSection(section) {
  const models = sectionModels(section).map((item) => normalizeCatalogItem(section, item));
  const moduleDefault = settings?.module_defaults?.[section];
  return models.find((item) => item.model === moduleDefault)
    || models.find((item) => item.is_default)
    || models[0]
    || null;
}

function findModelForSection(section, config = {}) {
  const models = sectionModels(section).map((item) => normalizeCatalogItem(section, item));
  const matched = models.find((item) => item.model === config.model && item.provider === config.provider)
    || models.find((item) => item.model === config.model);
  if (matched || config.model) return matched || null;
  return defaultModelForSection(section);
}

function applyModelToSection(section, item, { keepApiKey = true } = {}) {
  const container = document.querySelector(`[data-section="${section}"]`);
  if (!container || !item) return;
  const provider = item.provider || providerFromSourceLabel(item.source_platform || "");
  container.querySelector('[data-field="model"]').value = item.model || "";
  container.querySelector('[data-field="source_platform"]').value = item.source_platform || providerLabel(provider);
  container.querySelector('[data-field="base_url"]').value = normalizeCatalogBaseUrl(provider, item.base_url);
  container.querySelector('[data-field="provider"]').value = provider;
  if (!keepApiKey) container.querySelector('[data-field="api_key"]').value = "";
}

function readSectionConfig(section) {
  const container = document.querySelector(`[data-section="${section}"]`);
  const sourcePlatform = container.querySelector('[data-field="source_platform"]').value.trim();
  const provider = providerFromSourceLabel(sourcePlatform) || container.querySelector('[data-field="provider"]').value || "custom";
  const config = {
    provider,
    source_platform: sourcePlatform || providerLabel(provider),
    base_url: normalizeCatalogBaseUrl(provider, container.querySelector('[data-field="base_url"]').value),
    api_key: container.querySelector('[data-field="api_key"]').value.trim(),
    model: container.querySelector('[data-field="model"]').value.trim(),
  };
  const displayName = container.querySelector('[data-field="display_name"]')?.value.trim();
  if (displayName) config.display_name = displayName;
  if (section === "generation") {
    config.concurrency = Number(container.querySelector('[data-field="concurrency"]').value || 1);
  }
  return config;
}

async function saveSettingsPatch(payload) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.detail || data.message || "保存失败");
  }
  settings = normalizeSettings({ ...settings, ...payload });
  return data;
}

function selectCurrentModel(section) {
  const container = document.querySelector(`[data-section="${section}"]`);
  const choice = container.querySelector('[data-field="model_choice"]').value;
  if (choice === "__custom__") return null;
  const models = sectionModels(section).map((item) => normalizeCatalogItem(section, item));
  return models.find((item) => `${item.is_custom ? "custom" : "catalog"}:${item.provider}:${item.model}` === choice) || null;
}

function providerLabel(provider) {
  const labels = {
    dashscope: "阿里云百炼 DashScope",
    openai: "OpenAI 官方",
    gemini: "Google Gemini 官方",
    modelscope: "魔塔 ModelScope",
    proxy: "第三方 OpenAI 代理",
    custom: "自定义 / OpenAI 兼容",
  };
  return labels[provider] || labels.custom;
}

function providerFromSourceLabel(source = "") {
  const text = source.trim().toLowerCase();
  if (text.includes("dashscope") || source.includes("百炼") || source.includes("阿里云")) return "dashscope";
  if (text.includes("openai") && source.includes("官方")) return "openai";
  if (text.includes("gemini") || text.includes("google")) return "gemini";
  if (text.includes("modelscope") || source.includes("魔塔") || source.includes("魔搭")) return "modelscope";
  if (!text) return "";
  return "custom";
}

function normalizeCatalogBaseUrl(provider, baseUrl) {
  const clean = (baseUrl || "").trim().replace(/\/+$/, "");
  if (provider === "gemini" && clean.includes("/openai")) {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  return clean || providerDefaults.chat[provider] || providerDefaults.chat.custom;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeSettingsTab = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    panes.forEach((pane) => pane.classList.toggle("active", pane.dataset.pane === activeSettingsTab));
  });
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!target.dataset || !target.dataset.sectionName) return;
  if (!visibleSettingsSections.includes(target.dataset.sectionName)) return;
  const section = target.dataset.sectionName;
  const field = target.dataset.field;
  const container = document.querySelector(`[data-section="${section}"]`);

  if (field === "model_choice") {
    const selected = selectCurrentModel(section);
    const customName = container.querySelector(".custom-model-name");
    customName.classList.toggle("hidden", Boolean(selected));
    if (selected) {
      applyModelToSection(section, selected, { keepApiKey: true });
      container.querySelector('[data-field="display_name"]').value = selected.display_name || "";
    } else {
      container.querySelector('[data-field="display_name"]').value = "";
    }
  }

  if (field === "source_platform") {
    const provider = providerFromSourceLabel(target.value);
    container.querySelector('[data-field="provider"]').value = provider;
    const base = container.querySelector('[data-field="base_url"]');
    if (!base.value.trim()) base.value = providerDefaults[section]?.[provider] || providerDefaults[section]?.custom || "";
  }
});

openSettings?.addEventListener("click", async () => {
  settingsStatus.textContent = "正在读取模型清单...";
  settingsStatus.className = "status-line";
  await loadSettings();
  settingsModal.showModal();
  settingsStatus.textContent = "";
});

saveSettingsBtn?.addEventListener("click", async () => {
  const section = activeSettingsTab;
  settingsStatus.textContent = "正在保存当前模块...";
  settingsStatus.className = "status-line";
  try {
    const payload = { [section]: readSectionConfig(section) };
    await saveSettingsPatch(payload);
    settingsStatus.textContent = `${sectionLabels[section]}配置已保存。`;
    settingsStatus.className = "status-line ok";
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "status-line bad";
  }
});

setDefaultSettings?.addEventListener("click", async () => {
  const section = activeSettingsTab;
  const current = readSectionConfig(section);
  if (!current.model) {
    settingsStatus.textContent = "请先填写模型调用 ID。";
    settingsStatus.className = "status-line bad";
    return;
  }
  const moduleDefaults = { ...(settings?.module_defaults || {}), [section]: current.model };
  try {
    await saveSettingsPatch({ [section]: current, module_defaults: moduleDefaults });
    settingsStatus.textContent = `已把当前模型设为${sectionLabels[section]}默认。`;
    settingsStatus.className = "status-line ok";
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "status-line bad";
  }
});

saveCustomModel?.addEventListener("click", async () => {
  const section = activeSettingsTab;
  const current = readSectionConfig(section);
  const container = document.querySelector(`[data-section="${section}"]`);
  const selected = selectCurrentModel(section);
  const displayName = container.querySelector('[data-field="display_name"]').value.trim()
    || selected?.display_name
    || current.model;

  if (!displayName || !current.model || !current.base_url) {
    settingsStatus.textContent = "请先填写模型名、模型调用 ID 和 Base URL。";
    settingsStatus.className = "status-line bad";
    return;
  }

  const customModels = { ...(settings?.custom_models || {}) };
  const list = [...(customModels[section] || [])];
  const item = {
    display_name: displayName,
    model: current.model,
    source_platform: current.source_platform,
    base_url: current.base_url,
    provider: current.provider,
  };
  const index = list.findIndex((model) => model.model === item.model && model.provider === item.provider);
  if (index >= 0) list[index] = item;
  else list.push(item);
  customModels[section] = list;

  try {
    await saveSettingsPatch({ [section]: current, custom_models: customModels });
    settingsStatus.textContent = `已保存为${sectionLabels[section]}自定义模型。`;
    settingsStatus.className = "status-line ok";
    renderSettings();
  } catch (error) {
    settingsStatus.textContent = error.message;
    settingsStatus.className = "status-line bad";
  }
});

testActiveApi?.addEventListener("click", async () => {
  const payload = readSectionConfig(activeSettingsTab);
  settingsStatus.textContent = "正在测试...";
  settingsStatus.className = "status-line";
  const response = await fetch("/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  settingsStatus.textContent = data.message || data.detail || "测试完成";
  settingsStatus.className = `status-line ${data.ok ? "ok" : "bad"}`;
});

loadSettings();
