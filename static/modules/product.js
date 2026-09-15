import { appState } from "../shared/state.js";
import { emit } from "../shared/events.js";
import { apiForm, apiJson } from "../shared/api.js";

const productName = document.querySelector("#productName");
const productRequirements = document.querySelector("#productRequirements");
const productImages = document.querySelector("#productImages");
const productDrop = document.querySelector("#productDrop");
const productThumbs = document.querySelector("#productThumbs");
const productEmpty = document.querySelector("#productEmpty");
const analyzeProductBtn = document.querySelector("#analyzeProductBtn");
const generateCopyBtn = document.querySelector("#generateCopyBtn");
const productStatus = document.querySelector("#productStatus");
const analysisOutput = document.querySelector("#analysisOutput");
const copywritingOutput = document.querySelector("#copywritingOutput");
const sendImagePlanBtn = document.querySelector("#sendImagePlanBtn");
const copySettingsBtn = document.querySelector("#copySettingsBtn");
const copySettingsModal = document.querySelector("#copySettingsModal");
const copyPresetButtons = document.querySelectorAll("[data-copy-preset]");
const saveCopySettings = document.querySelector("#saveCopySettings");
const copySettingsStatus = document.querySelector("#copySettingsStatus");

const copyPresets = {
  standard: "标准：关键词组合、5 条五点描述、10 张主副图文案、13 张 A+ 文案。",
  detailed: "详细：同样结构，关键词和画面细节更丰富。",
  concise: "精简：同样结构，表达更短，方便快速改稿。",
};

if (!Array.isArray(appState.copywritingDrafts)) appState.copywritingDrafts = [];

let uploads = [];
let previewUrls = [];
let pasteReady = false;
let copyPreset = appState.productCopyPreset || "standard";
let draftCopyPreset = copyPreset;
let originalCopywriting = null;
let displayedCopywriting = null;
let copyLanguage = "en";
let translationLanguage = "en";
let translatedCopywritingByLanguage = {};

const copyLanguages = [
  { value: "en", label: "英语" },
  { value: "zh", label: "中文" },
  { value: "ja", label: "日语" },
  { value: "de", label: "德语" },
  { value: "fr", label: "法语" },
  { value: "es", label: "西班牙语" },
  { value: "it", label: "意大利语" },
  { value: "nl", label: "荷兰语" },
];

const copyLanguageSuffix = {
  en: "En",
  zh: "Zh",
  ja: "Ja",
  de: "De",
  fr: "Fr",
  es: "Es",
  it: "It",
  nl: "Nl",
};

function copyLanguageLabel(value) {
  return copyLanguages.find((item) => item.value === value)?.label || "英语";
}

function setStatus(message, type = "") {
  if (!productStatus) return;
  productStatus.textContent = message;
  productStatus.className = `status-line ${type}`;
}

function imageFiles(files) {
  return Array.from(files || []).filter((file) => file.type.startsWith("image/"));
}

function clipboardImages(clipboardData) {
  if (!clipboardData) return [];
  const files = imageFiles(clipboardData.files);
  if (files.length) return files;
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const ext = file.type.split("/").pop() || "png";
      return file.name ? file : new File([file], `product_clipboard_${Date.now()}_${index}.${ext}`, { type: file.type });
    })
    .filter(Boolean);
}

function addUploads(files) {
  const incoming = imageFiles(files);
  if (!incoming.length) return;
  uploads = [...uploads, ...incoming];
  appState.productUploads = uploads;
  renderUploads();
}

function syncInputFiles() {
  const dataTransfer = new DataTransfer();
  uploads.forEach((file) => dataTransfer.items.add(file));
  productImages.files = dataTransfer.files;
}

function cleanupPreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
}

function renderUploads() {
  syncInputFiles();
  productDrop.classList.toggle("has-files", uploads.length > 0);
  productEmpty.classList.toggle("hidden", uploads.length > 0);
  cleanupPreviewUrls();
  productThumbs.innerHTML = uploads
    .map((file, index) => {
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      return `<article class="product-thumb">
        <span class="order-badge">${index + 1}</span>
        <img src="${url}" alt="产品图 ${index + 1}" />
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatSize(file.size)}</small>
        <button type="button" data-remove-product="${index}">移除</button>
      </article>`;
    })
    .join("") + `<button class="product-add-card" type="button" data-add-product>+</button>`;

  productThumbs.querySelector("[data-add-product]")?.addEventListener("click", (event) => {
    event.preventDefault();
    productImages.click();
  });
  productThumbs.querySelectorAll("[data-remove-product]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      uploads.splice(Number(button.dataset.removeProduct), 1);
      appState.productUploads = uploads;
      renderUploads();
    });
  });
}

function buildProductForm() {
  const body = new FormData();
  body.set("product_name", productName.value.trim());
  body.set("requirements", productRequirements.value.trim());
  uploads.forEach((file) => body.append("images", file));
  return body;
}

function textBlock(title, body) {
  const content = Array.isArray(body) ? body.filter(Boolean).map((item) => `<li>${escapeHtml(item)}</li>`).join("") : escapeHtml(body || "暂无内容");
  const wrapped = Array.isArray(body) ? `<ul>${content}</ul>` : `<p>${content}</p>`;
  return `<section class="copy-block"><h3>${escapeHtml(title)}</h3>${wrapped}</section>`;
}

function copySection(copy, keys) {
  for (const key of keys) {
    const value = copy?.[key];
    if (Array.isArray(value) ? value.length : value) return value;
  }
  return "";
}

function localizedSection(copy, baseKeys) {
  const suffix = copyLanguageSuffix[copyLanguage] || "En";
  const localizedKeys = baseKeys.flatMap((key) => [`${key}_${copyLanguage}`, `${key}${suffix}`]);
  return copySection(copy, [...localizedKeys, ...baseKeys]);
}

function promptFromCopy(copy) {
  return [
    "关键词组合：",
    formatPlain(localizedSection(copy, ["keyword_combinations", "keywords", "title_directions", "titles"])),
    "五点描述：",
    formatPlain(localizedSection(copy, ["bullets"])),
    "主图/副图文案：",
    formatPlain(localizedSection(copy, ["image_copy", "imageCopy"])),
    "A+ 文案：",
    formatPlain(localizedSection(copy, ["aplus_copy", "aplusCopy"])),
  ].filter(Boolean).join("\n");
}

function buildImagePlanSource(copy) {
  const analysis = appState.productAnalysis || {};
  return [
    `产品名称：${productName.value.trim() || "未填写"}`,
    `当前语言：${copyLanguageLabel(copyLanguage)}`,
    "产品卖点：",
    formatPlain(analysis.selling_points || analysis.sellingPoints || analysis.text),
    "目标人群：",
    formatPlain(analysis.target_audience || analysis.targetAudience),
    "使用场景：",
    formatPlain(analysis.use_scenarios || analysis.useScenarios),
    "产品文案：",
    promptFromCopy(copy),
  ].filter(Boolean).join("\n");
}

function formatPlain(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => `- ${item}`).join("\n");
  return String(value || "").trim();
}

function renderAnalysis(analysis) {
  if (!analysis) {
    analysisOutput.textContent = "还没有分析结果。";
    return;
  }
  analysisOutput.innerHTML = [
    textBlock("核心卖点", analysis.selling_points || analysis.sellingPoints || analysis.text),
    textBlock("目标人群", analysis.target_audience || analysis.targetAudience),
    textBlock("使用场景", analysis.use_scenarios || analysis.useScenarios),
  ].join("");
}

function renderCopywriting(copy) {
  if (!copy) {
    copywritingOutput.innerHTML = `<div class="copy-placeholder">还没有文案。先分析产品，再生成亚马逊文案。</div>`;
    return;
  }
  displayedCopywriting = copy;
  const languageOptions = copyLanguages
    .map((language) => `<option value="${language.value}" ${translationLanguage === language.value ? "selected" : ""}>${language.label}</option>`)
    .join("");
  copywritingOutput.innerHTML = `
    <div class="copy-toolbar">
      <select class="copy-translate-select" data-translate-language aria-label="翻译语言">
        ${languageOptions}
      </select>
      <button class="ghost" type="button" data-translate-copy>点击翻译</button>
      <div class="copy-language-switch" role="group" aria-label="文案语言">
        <button class="ghost ${copyLanguage === "en" ? "active" : ""}" type="button" data-copy-language="en">英文</button>
        <button class="ghost ${copyLanguage === "zh" ? "active" : ""}" type="button" data-copy-language="zh">中文</button>
      </div>
    </div>
    <div class="copy-grid-inner">
      ${textBlock("关键词组合", localizedSection(copy, ["keyword_combinations", "keywords", "title_directions", "titles", "raw_text"]))}
      ${textBlock("五点描述", localizedSection(copy, ["bullets"]))}
      ${textBlock("主图/副图文案", localizedSection(copy, ["image_copy", "imageCopy"]))}
      ${textBlock("A+ 文案", localizedSection(copy, ["aplus_copy", "aplusCopy"]))}
    </div>`;
  copywritingOutput.querySelector("[data-translate-language]")?.addEventListener("change", (event) => {
    translationLanguage = event.target.value || "en";
    if (translationLanguage === "en" || translationLanguage === "zh") {
      copyLanguage = translationLanguage;
      renderCopywriting(originalCopywriting || displayedCopywriting);
      return;
    }
    if (translatedCopywritingByLanguage[translationLanguage]) {
      copyLanguage = translationLanguage;
      renderCopywriting(translatedCopywritingByLanguage[translationLanguage]);
    }
  });
  copywritingOutput.querySelector("[data-translate-copy]")?.addEventListener("click", async (event) => {
    const sourceCopy = originalCopywriting || displayedCopywriting;
    if (!sourceCopy) {
      setStatus("请先生成文案，再进行翻译。", "bad");
      return;
    }
    if (translationLanguage === "en" || translationLanguage === "zh") {
      copyLanguage = translationLanguage;
      renderCopywriting(sourceCopy);
      setStatus(`已切换为${copyLanguageLabel(translationLanguage)}文案。`, "ok");
      return;
    }
    if (translatedCopywritingByLanguage[translationLanguage]) {
      copyLanguage = translationLanguage;
      renderCopywriting(translatedCopywritingByLanguage[translationLanguage]);
      setStatus(`已显示之前翻译过的${copyLanguageLabel(translationLanguage)}文案。`, "ok");
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    setStatus(`正在翻译为${copyLanguageLabel(translationLanguage)}...`);
    try {
      const data = await apiJson("/api/product/translate-copywriting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_language: translationLanguage,
          copywriting: sourceCopy,
        }),
      });
      copyLanguage = translationLanguage;
      translatedCopywritingByLanguage[translationLanguage] = data.copywriting;
      renderCopywriting(data.copywriting);
      setStatus(`已翻译为${copyLanguageLabel(translationLanguage)}。`, "ok");
    } catch (error) {
      setStatus(error.message, "bad");
    } finally {
      button.disabled = false;
    }
  });
  copywritingOutput.querySelectorAll("[data-copy-language]").forEach((button) => {
    button.addEventListener("click", () => {
      copyLanguage = button.dataset.copyLanguage || "en";
      translationLanguage = copyLanguage;
      renderCopywriting(originalCopywriting || displayedCopywriting);
      setStatus(`已切换为${copyLanguageLabel(copyLanguage)}文案。`, "ok");
    });
  });
}

function renderCopyPresetButtons() {
  copyPresetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.copyPreset === draftCopyPreset);
  });
}

function setCopySettingsStatus(message, type = "") {
  if (!copySettingsStatus) return;
  copySettingsStatus.textContent = message;
  copySettingsStatus.className = `status-line ${type}`;
}

productImages?.addEventListener("change", () => addUploads(productImages.files));

productDrop?.addEventListener("dragover", (event) => {
  event.preventDefault();
  productDrop.classList.add("dragover");
});
productDrop?.addEventListener("dragleave", () => productDrop.classList.remove("dragover"));
productDrop?.addEventListener("drop", (event) => {
  event.preventDefault();
  productDrop.classList.remove("dragover");
  addUploads(event.dataTransfer.files);
});
productDrop?.addEventListener("mouseenter", () => {
  pasteReady = true;
  productDrop.classList.add("paste-ready");
});
productDrop?.addEventListener("mouseleave", () => {
  pasteReady = false;
  productDrop.classList.remove("paste-ready");
});

document.addEventListener("paste", (event) => {
  const inProduct = appState.activeModule === "product";
  const targetingProduct = pasteReady || productDrop?.contains(document.activeElement);
  if (!inProduct || !targetingProduct) return;
  const files = clipboardImages(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  addUploads(files);
  setStatus(`已从剪贴板添加 ${files.length} 张产品图。`, "ok");
});

analyzeProductBtn?.addEventListener("click", async () => {
  analyzeProductBtn.disabled = true;
  setStatus("正在分析产品卖点...");
  try {
    const data = await apiForm("/api/product/analyze", buildProductForm());
    appState.productAnalysis = data.analysis;
    renderAnalysis(data.analysis);
    emit("product:analysisUpdated", { analysis: data.analysis });
    setStatus("产品分析完成。", "ok");
  } catch (error) {
    setStatus(error.message, "bad");
  } finally {
    analyzeProductBtn.disabled = false;
  }
});

generateCopyBtn?.addEventListener("click", async () => {
  generateCopyBtn.disabled = true;
  setStatus(`正在生成亚马逊文案（${copyPresets[copyPreset] || "标准模板"}）...`);
  try {
    const data = await apiJson("/api/product/copywriting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_name: productName.value.trim(),
        requirements: productRequirements.value.trim(),
        analysis: appState.productAnalysis,
        copy_settings: {
          preset: copyPreset,
        },
      }),
    });
    appState.productCopywriting = data.copywriting;
    originalCopywriting = data.copywriting;
    translatedCopywritingByLanguage = {};
    appState.copywritingDrafts = [data.copywriting, ...appState.copywritingDrafts].slice(0, 20);
    renderCopywriting(data.copywriting);
    emit("product:copywritingUpdated", { copywriting: data.copywriting });
    setStatus("文案生成完成。", "ok");
  } catch (error) {
    setStatus(error.message, "bad");
  } finally {
    generateCopyBtn.disabled = false;
  }
});

sendImagePlanBtn?.addEventListener("click", () => {
  const sourceCopy = displayedCopywriting || originalCopywriting || appState.productCopywriting;
  if (!sourceCopy) {
    setStatus("请先生成文案，再发送到图片策划。", "bad");
    return;
  }
  const sourceText = buildImagePlanSource(sourceCopy);
  emit("product:imagePlanRequested", {
    product_name: productName.value.trim(),
    language: copyLanguage === "zh" ? "zh" : "en",
    source_text: sourceText,
  });
  document.querySelector('[data-module="chat"]')?.click();
  setStatus("已发送到图片策划。", "ok");
});

copySettingsBtn?.addEventListener("click", () => {
  draftCopyPreset = copyPreset;
  renderCopyPresetButtons();
  setCopySettingsStatus(copyPresets[copyPreset] || "");
  copySettingsModal.showModal();
});

copyPresetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    draftCopyPreset = button.dataset.copyPreset || "standard";
    renderCopyPresetButtons();
    setCopySettingsStatus(copyPresets[draftCopyPreset] || "", "ok");
  });
});

saveCopySettings?.addEventListener("click", () => {
  copyPreset = draftCopyPreset;
  appState.productCopyPreset = copyPreset;
  setStatus(`文案设置已保存：${copyPresets[copyPreset] || "标准模板"}`, "ok");
  copySettingsModal.close();
});

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

renderCopyPresetButtons();
