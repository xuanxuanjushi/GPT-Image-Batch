import { on } from "../shared/events.js";
import { loadSettings, collectSettings } from "./settings.js?v=20260504-settings-split";

const form = document.querySelector("#taskForm");
const modeInput = document.querySelector("#mode");
const modeButtons = document.querySelectorAll(".mode");
const promptInput = document.querySelector("#prompt");
const textPromptPlaceholder = "例如：生成现代电商主图，产品清晰，柔和棚拍光，干净背景，高级质感；需要一次生成多张时，可写成 {多场景使用图提示词}{产品细节特写提示词}{结构爆炸图提示词}";
const editPromptPlaceholder = "例如: 将图2模特手里的产品替换为图1，保持产品特征不变，若一次想生成多张，可写成{生成图1的侧面特写图}{生成一个 将图1和图2还有图3在客厅的场景}{根据图2的产品做一个黑五海报}，注意，提示词要尽量精确详细";
const sizeSelect = document.querySelector("#size");
const customSize = document.querySelector("#customSize");
const uploadBlock = document.querySelector("#uploadBlock");
const primaryIndex = document.querySelector("#primaryIndex");
const filesInput = document.querySelector("#files");
const fileList = document.querySelector("#fileList");
const dropZone = document.querySelector("#dropZone");
const startBtn = document.querySelector("#startBtn");
const defaultStartBtnText = startBtn.textContent;
const imagesPerReference = document.querySelector("#imagesPerReference");
const normalQuantityMax = Number(imagesPerReference?.max || 4);
const batchPromptLimit = 20;
let manualImagesPerReference = imagesPerReference?.value || "1";
const taskStatus = document.querySelector("#taskStatus");
const taskItems = document.querySelector("#taskItems");
const progressFill = document.querySelector("#progressFill");
const results = document.querySelector("#results");
const openOutput = document.querySelector("#openOutput");
const reverseImage = document.querySelector("#reverseImage");
const reverseDrop = document.querySelector(".reverse-drop");
const reverseEmpty = document.querySelector("#reverseEmpty");
const reversePreview = document.querySelector("#reversePreview");
const reverseBtn = document.querySelector("#reverseBtn");
const reverseStatus = document.querySelector("#reverseStatus");
const zhPrompt = document.querySelector("#zhPrompt");
const enPrompt = document.querySelector("#enPrompt");
const useZhPrompt = document.querySelector("#useZhPrompt");
const useEnPrompt = document.querySelector("#useEnPrompt");
const reverseSettingsBtn = document.querySelector("#reverseSettingsBtn");
const reverseSettingsModal = document.querySelector("#reverseSettingsModal");
const reverseStyle = document.querySelector("#reverseStyle");
const reverseComplexity = document.querySelector("#reverseComplexity");
const saveReverseSettings = document.querySelector("#saveReverseSettings");
const imagePreviewModal = document.querySelector("#imagePreviewModal");
const imagePreview = document.querySelector("#imagePreview");
const closeImagePreview = document.querySelector("#closeImagePreview");
const themeToggle = document.querySelector("#themeToggle");

let polling = {};
let currentTaskId = null;
let selectedFiles = [];
let reverseOptions = { style: "general", complexity: "balanced" };
let currentTheme = localStorage.getItem("uiTheme") || "light";
const galleryTasks = {};
let lastGalleryCount = 0;
let dropZoneReadyForPaste = false;
let reverseDropReadyForPaste = false;
modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setImageMode(button.dataset.mode);
  });
});

function setImageMode(mode) {
  modeInput.value = mode === "edit" ? "edit" : "text";
  modeButtons.forEach((item) => item.classList.toggle("active", item.dataset.mode === modeInput.value));
  updateModeUi();
  updateBatchPromptUi();
}

function updateModeUi() {
  const isEdit = modeInput.value === "edit";
  uploadBlock.classList.toggle("hidden", !isEdit);
  promptInput.placeholder = isEdit ? editPromptPlaceholder : textPromptPlaceholder;
}

function resizePromptInput() {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.max(118, promptInput.scrollHeight)}px`;
}

function queuePromptResize() {
  resizePromptInput();
  requestAnimationFrame(resizePromptInput);
  setTimeout(resizePromptInput, 0);
  setTimeout(resizePromptInput, 80);
}

promptInput.addEventListener("input", () => {
  queuePromptResize();
  updateBatchPromptUi();
});

imagesPerReference?.addEventListener("input", () => {
  if (!getActiveBatchPrompts().length) {
    manualImagesPerReference = imagesPerReference.value || "1";
  }
  updateBatchPromptUi();
});

on("image:setPrompt", ({ prompt = "", mode = "text" } = {}) => {
  setImageMode(mode);
  if (prompt) {
    promptInput.value = prompt;
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  document.querySelector('[data-module="image"]')?.click();
  queuePromptResize();
  promptInput.focus({ preventScroll: false });
});

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = currentTheme;
  if (themeToggle) {
    themeToggle.textContent = currentTheme === "dark" ? "亮色模式" : "暗色模式";
  }
  localStorage.setItem("uiTheme", currentTheme);
}

themeToggle?.addEventListener("click", () => {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
});

sizeSelect.addEventListener("change", () => {
  customSize.classList.toggle("hidden", sizeSelect.value !== "custom");
});

filesInput.addEventListener("change", () => {
  appendImageFiles(filesInput.files);
});

dropZone.tabIndex = 0;
dropZone.addEventListener("mouseenter", () => {
  dropZoneReadyForPaste = true;
  dropZone.classList.add("paste-ready");
  dropZone.focus({ preventScroll: true });
});
dropZone.addEventListener("mouseleave", () => {
  dropZoneReadyForPaste = false;
  dropZone.classList.remove("paste-ready");
});
dropZone.addEventListener("focusin", () => {
  dropZoneReadyForPaste = true;
  dropZone.classList.add("paste-ready");
});
dropZone.addEventListener("focusout", () => {
  dropZoneReadyForPaste = false;
  dropZone.classList.remove("paste-ready");
});
dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  appendImageFiles(event.dataTransfer.files);
});

document.addEventListener("paste", (event) => {
  const isEditMode = modeInput.value === "edit" && !uploadBlock.classList.contains("hidden");
  const isTargetingDropZone = dropZoneReadyForPaste || dropZone.contains(document.activeElement);
  if (!isEditMode || !isTargetingDropZone) return;
  const pastedFiles = getClipboardImageFiles(event.clipboardData);
  if (!pastedFiles.length) return;
  event.preventDefault();
  appendImageFiles(pastedFiles);
  taskStatus.textContent = `已从剪贴板添加 ${pastedFiles.length} 张参考图。`;
});

reverseDrop.tabIndex = 0;
reverseDrop.addEventListener("mouseenter", () => {
  reverseDropReadyForPaste = true;
});
reverseDrop.addEventListener("mouseleave", () => {
  reverseDropReadyForPaste = false;
});
reverseDrop.addEventListener("focusin", () => {
  reverseDropReadyForPaste = true;
});
reverseDrop.addEventListener("focusout", () => {
  reverseDropReadyForPaste = false;
});
reverseDrop.addEventListener("dragover", (event) => {
  event.preventDefault();
});
reverseDrop.addEventListener("drop", (event) => {
  event.preventDefault();
  setReverseImageFile(event.dataTransfer.files?.[0]);
});

document.addEventListener("paste", (event) => {
  const isTargetingReverseDrop = reverseDropReadyForPaste || reverseDrop.contains(document.activeElement);
  if (!isTargetingReverseDrop) return;
  const pastedFiles = getClipboardImageFiles(event.clipboardData);
  if (!pastedFiles.length) return;
  event.preventDefault();
  setReverseImageFile(pastedFiles[0]);
});

function appendImageFiles(files) {
  const images = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  selectedFiles = [...selectedFiles, ...images];
  syncFiles();
}

function getClipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = Array.from(clipboardData.files || []).filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(clipboardData.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const ext = file.type.split("/").pop() || "png";
      return file.name ? file : new File([file], `clipboard_${Date.now()}_${index}.${ext}`, { type: file.type });
    })
    .filter(Boolean);
}

function syncFiles() {
  const dataTransfer = new DataTransfer();
  selectedFiles.forEach((file) => dataTransfer.items.add(file));
  filesInput.files = dataTransfer.files;
  primaryIndex.max = Math.max(1, selectedFiles.length);
  renderFileList();
}

function setReverseImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  reverseImage.files = dataTransfer.files;
  renderReverseImagePreview(file);
}

function renderReverseImagePreview(file) {
  const url = URL.createObjectURL(file);
  reverseEmpty.classList.add("hidden");
  reversePreview.classList.remove("hidden");
  reversePreview.innerHTML = `<img src="${url}" alt="反推图片预览" />
    <div class="reverse-preview-meta">
      <span>${escapeHtml(file.name)} · ${formatSize(file.size)}</span>
      <button class="reverse-remove" type="button" data-clear-reverse-image>移除</button>
    </div>`;
  reversePreview.querySelector("[data-clear-reverse-image]")?.addEventListener("click", clearReverseImage);
  reverseStatus.textContent = "图片已选择，可以开始反推。";
  reverseStatus.className = "status-line ok";
}

function clearReverseImage(event) {
  event?.preventDefault();
  event?.stopPropagation();
  reverseImage.value = "";
  reversePreview.innerHTML = "";
  reversePreview.classList.add("hidden");
  reverseEmpty.classList.remove("hidden");
  reverseStatus.textContent = "";
  reverseStatus.className = "status-line";
}

function renderFileList() {
  dropZone.classList.toggle("has-files", selectedFiles.length > 0);
  fileList.innerHTML = selectedFiles
    .map((file, index) => {
      const url = URL.createObjectURL(file);
      return `<article class="thumb">
        <span class="order-badge">${index + 1}</span>
        <img src="${url}" alt="参考图 ${index + 1}" data-preview="${url}" />
        <div>${escapeHtml(file.name)}<br />${formatSize(file.size)}
          <button class="use-edit" type="button" data-remove="${index}">移除</button>
        </div>
      </article>`;
    })
    .join("") + `<button class="upload-add-card" type="button" data-add-file>+</button>`;
  fileList.querySelectorAll("[data-preview]").forEach((image) => {
    image.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(image.dataset.preview);
    });
  });
  fileList.querySelector("[data-add-file]")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    filesInput.click();
  });
  fileList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedFiles.splice(Number(button.dataset.remove), 1);
      syncFiles();
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadSettings();
  const batchPrompts = getActiveBatchPrompts();
  if (batchPrompts.length > batchPromptLimit) {
    taskStatus.textContent = `一次最多批量生成 ${batchPromptLimit} 张，请减少花括号数量。`;
    return;
  }
  if (modeInput.value === "edit" && !selectedFiles.length) {
    taskStatus.textContent = "图生图模式请先添加参考图。";
    return;
  }

  startBtn.disabled = true;
  taskStatus.textContent = "正在创建任务...";
  progressFill.style.width = "0%";
  taskItems.innerHTML = "";
  openOutput.classList.add("hidden");

  const gen = collectSettings().generation;
  if (modeInput.value === "edit" && batchPrompts.length > 1) {
    await createVirtualEditTasks(batchPrompts, gen);
    return;
  }

  const body = new FormData(form);
  body.set("provider", gen.provider);
  body.set("base_url", gen.base_url);
  body.set("api_key", gen.api_key);
  body.set("model", gen.model);
  body.set("concurrency", gen.concurrency || 1);
  body.set("save_settings_flag", "true");
  if (batchPrompts.length) {
    body.set("images_per_reference", batchPrompts.length);
    body.set("batch_prompts", JSON.stringify(batchPrompts));
  }

  try {
    const response = await fetch("/api/tasks", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "创建任务失败");
    currentTaskId = data.task_id;
    createGalleryPlaceholders(data.task_id, getExpectedResultCount());
    pollTask(data.task_id);
    startBtn.disabled = false;
  } catch (error) {
    taskStatus.textContent = error.message;
    startBtn.disabled = false;
  }
});

function buildTaskFormData(gen, promptValue = promptInput.value, files = selectedFiles) {
  const body = new FormData(form);
  body.set("provider", gen.provider);
  body.set("base_url", gen.base_url);
  body.set("api_key", gen.api_key);
  body.set("model", gen.model);
  body.set("concurrency", gen.concurrency || 1);
  body.set("save_settings_flag", "true");
  body.set("prompt", promptValue);
  body.delete("batch_prompts");
  body.set("images_per_reference", "1");
  body.delete("files");
  files.forEach((file) => body.append("files", file));
  return body;
}

async function createVirtualEditTasks(batchPrompts, gen) {
  const primaryFile = selectedFiles[Math.max(0, Math.min(selectedFiles.length - 1, Number(primaryIndex.value || 1) - 1))];
  if (!primaryFile) {
    taskStatus.textContent = "图生图模式请先添加参考图。";
    startBtn.disabled = false;
    return;
  }
  taskStatus.textContent = `正在创建 ${batchPrompts.length} 个独立图生图任务...`;
  try {
    const createdTasks = [];
    for (const [index, prompt] of batchPrompts.entries()) {
      const body = buildTaskFormData(gen, prompt, [primaryFile]);
      body.set("task_name", `商品图任务_${String(index + 1).padStart(2, "0")}`);
      const response = await fetch("/api/tasks", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `第 ${index + 1} 个任务创建失败`);
      createdTasks.push(data.task_id);
      createGalleryPlaceholders(data.task_id, 1);
      pollTask(data.task_id);
    }
    currentTaskId = createdTasks[createdTasks.length - 1] || currentTaskId;
    taskStatus.textContent = `已创建 ${createdTasks.length} 个独立图生图任务，每个任务只参考图 1。`;
    startBtn.disabled = false;
  } catch (error) {
    taskStatus.textContent = error.message;
    startBtn.disabled = false;
  }
}

openOutput.addEventListener("click", async () => {
  if (!currentTaskId) return;
  await fetch(`/api/tasks/${currentTaskId}/open-output`, { method: "POST" });
});

function pollTask(taskId) {
  if (polling[taskId]) clearInterval(polling[taskId]);
  polling[taskId] = setInterval(async () => {
    const response = await fetch(`/api/tasks/${taskId}`);
    const task = await response.json();
    renderTask(task);
    if (["done", "partial", "failed"].includes(task.status)) {
      clearInterval(polling[taskId]);
      delete polling[taskId];
      startBtn.disabled = false;
    }
  }, 1000);
}

function renderTask(task) {
  const total = task.total || 0;
  const finished = (task.completed || 0) + (task.failed || 0);
  const percent = total ? Math.round((finished / total) * 100) : 0;
  progressFill.style.width = `${percent}%`;
  taskStatus.textContent = `${task.message}，成功 ${task.completed || 0}，失败 ${task.failed || 0}`;
  if (task.output_url) openOutput.classList.remove("hidden");

  taskItems.innerHTML = (task.items || [])
    .map((item) => {
      const cls = item.status === "done" ? "ok" : item.status === "failed" ? "bad" : "";
      return `<div class="task-item"><span>${escapeHtml(item.reference)} / ${escapeHtml(item.id)}</span><strong class="${cls}">${escapeHtml(item.message)}</strong></div>`;
    })
    .join("");

  updateGalleryTask(task);
  renderResults(getGalleryItems());
}

function getExpectedResultCount() {
  const batchPrompts = getActiveBatchPrompts();
  if (batchPrompts.length) return batchPrompts.length;
  return Math.max(1, Math.min(normalQuantityMax, Number(imagesPerReference.value || 1)));
}

function getActiveBatchPrompts() {
  return extractBracePrompts(promptInput.value);
}

function extractBracePrompts(text) {
  const prompts = [];
  const pattern = /[{\uff5b]([^{}\uff5b\uff5d]+)[}\uff5d]/g;
  let match;
  while ((match = pattern.exec(text || "")) !== null) {
    const prompt = match[1].trim();
    if (prompt) prompts.push(prompt);
  }
  return prompts;
}

function updateBatchPromptUi() {
  const batchPrompts = getActiveBatchPrompts();
  if (batchPrompts.length) {
    imagesPerReference.max = String(Math.max(normalQuantityMax, batchPrompts.length));
    imagesPerReference.value = String(batchPrompts.length);
  } else {
    imagesPerReference.max = String(normalQuantityMax);
    imagesPerReference.value = manualImagesPerReference;
  }
  startBtn.textContent = batchPrompts.length > 1 ? `批量生成${batchPrompts.length}张` : defaultStartBtnText;
}

function createGalleryPlaceholders(taskId, count) {
  galleryTasks[taskId] = Array.from({ length: count }, (_, index) => ({
    id: `${taskId}-${index}`,
    taskId,
    status: "loading",
    file: `第 ${index + 1} 张`,
    reference: modeInput.value === "edit" ? "图生图 / 改图" : "文生图",
  }));
  renderResults(getGalleryItems());
}

function updateGalleryTask(task) {
  const taskId = task.id || currentTaskId;
  if (!taskId) return;
  const existing = galleryTasks[taskId] || [];
  const doneItems = (task.results || []).map((result, index) => ({
    ...result,
    id: `${taskId}-done-${index}`,
    taskId,
    status: "done",
  }));
  const count = Math.max(existing.length, doneItems.length, task.total || 0, 1);
  galleryTasks[taskId] = Array.from({ length: count }, (_, index) => {
    if (doneItems[index]) return doneItems[index];
    const old = existing[index];
    if (["done", "partial", "failed"].includes(task.status)) {
      const failedItem = (task.items || []).find((item) => item.status === "failed");
      return {
        ...(old || {}),
        id: old?.id || `${taskId}-failed-${index}`,
        taskId,
        status: "failed",
        file: old?.file || `第 ${index + 1} 张`,
        reference: old?.reference || (modeInput.value === "edit" ? "图生图 / 改图" : "文生图"),
        message: failedItem?.message || "生成失败",
      };
    }
    return (
      old || {
        id: `${taskId}-${index}`,
        taskId,
        status: "loading",
        file: `第 ${index + 1} 张`,
        reference: modeInput.value === "edit" ? "图生图 / 改图" : "文生图",
      }
    );
  });
}

function getGalleryItems() {
  return Object.keys(galleryTasks)
    .reverse()
    .flatMap((taskId) => galleryTasks[taskId]);
}

function renderResults(items) {
  if (!items.length) {
    results.innerHTML = "";
    lastGalleryCount = 0;
    return;
  }
  const previousTrack = results.querySelector(".result-track");
  const previousScrollLeft = previousTrack ? previousTrack.scrollLeft : 0;
  const shouldShowNewest = items.length > lastGalleryCount;
  results.innerHTML = `
    <button class="carousel-arrow prev" type="button" data-result-prev aria-label="上一张">‹</button>
    <div class="result-track">
      ${items
        .map(
          (result, index) =>
            result.status === "done"
              ? `<article class="result-card">
                  <span class="order-badge">${index + 1}</span>
                  <a href="${result.url}" target="_blank" rel="noreferrer"><img src="${result.url}" alt="生成结果" loading="lazy" data-result-image /></a>
                  <div class="result-meta"><strong data-result-size>读取像素中...</strong></div>
                  <div class="result-actions"><button class="use-edit" type="button" data-use="${result.url}">发送到图生图继续修改</button></div>
                </article>`
              : `<article class="result-card ${result.status === "failed" ? "failed-card" : "loading-card"}">
                  <span class="order-badge">${index + 1}</span>
                  <div class="result-placeholder">
                    <strong>${result.status === "failed" ? "生成失败" : "生成中..."}</strong>
                    <small>${escapeHtml(result.message || result.file || "")}</small>
                  </div>
                  <div>${escapeHtml(result.reference || "")}</div>
                </article>`,
        )
        .join("")}
    </div>
    <button class="carousel-arrow next" type="button" data-result-next aria-label="下一张">›</button>
  `;
  const track = results.querySelector(".result-track");
  const scrollByCard = () => Math.max(180, Math.round(track.clientWidth / 5));
  requestAnimationFrame(() => {
    track.scrollLeft = shouldShowNewest ? 0 : previousScrollLeft;
  });
  lastGalleryCount = items.length;
  results.querySelector("[data-result-prev]")?.addEventListener("click", () => {
    track.scrollBy({ left: -scrollByCard(), behavior: "smooth" });
  });
  results.querySelector("[data-result-next]")?.addEventListener("click", () => {
    track.scrollBy({ left: scrollByCard(), behavior: "smooth" });
  });
  track.addEventListener(
    "wheel",
    (event) => {
      const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      event.preventDefault();
      track.scrollBy({ left: delta, behavior: "smooth" });
    },
    { passive: false },
  );
  bindResultActions();
  bindResultImageSizes();
}

function bindResultActions() {
  results.querySelectorAll("[data-use]").forEach((button) => {
    button.addEventListener("click", async () => {
      await addResultAsReference(button.dataset.use);
      document.querySelector('[data-mode="edit"]').click();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function bindResultImageSizes() {
  results.querySelectorAll("[data-result-image]").forEach((image) => {
    const sizeLabel = image.closest(".result-card")?.querySelector("[data-result-size]");
    if (!sizeLabel) return;
    const updateSize = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      sizeLabel.textContent = `${image.naturalWidth} × ${image.naturalHeight} px`;
    };
    if (image.complete) updateSize();
    image.addEventListener("load", updateSize, { once: true });
  });
}

async function addResultAsReference(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  const name = url.split("/").pop() || "generated.png";
  selectedFiles.push(new File([blob], name, { type: blob.type || "image/png" }));
  syncFiles();
}

reverseBtn.addEventListener("click", async () => {
  if (!reverseImage.files.length) {
    reverseStatus.textContent = "请先选择一张图片。";
    return;
  }
  await loadSettings();
  const reverse = collectSettings().reverse;
  const body = new FormData();
  body.set("provider", reverse.provider);
  body.set("base_url", reverse.base_url);
  body.set("api_key", reverse.api_key);
  body.set("model", reverse.model);
  body.set("style", reverseOptions.style);
  body.set("complexity", reverseOptions.complexity);
  body.set("image", reverseImage.files[0]);

  reverseBtn.disabled = true;
  reverseStatus.textContent = "正在反推...";
  try {
    const response = await fetch("/api/reverse", { method: "POST", body });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || data.detail || "反推失败");
    zhPrompt.textContent = data.zh_prompt || data.text || "";
    enPrompt.textContent = data.en_prompt || "";
    reverseStatus.textContent = "反推完成";
    reverseStatus.className = "status-line ok";
  } catch (error) {
    reverseStatus.textContent = error.message;
    reverseStatus.className = "status-line bad";
  } finally {
    reverseBtn.disabled = false;
  }
});

useZhPrompt.addEventListener("click", () => {
  promptInput.value = zhPrompt.textContent || promptInput.value;
  promptInput.dispatchEvent(new Event("input", { bubbles: true }));
});

useEnPrompt.addEventListener("click", () => {
  promptInput.value = enPrompt.textContent || promptInput.value;
  promptInput.dispatchEvent(new Event("input", { bubbles: true }));
});

reverseSettingsBtn.addEventListener("click", () => {
  reverseStyle.value = reverseOptions.style;
  reverseComplexity.value = reverseOptions.complexity;
  reverseSettingsModal.showModal();
});

saveReverseSettings.addEventListener("click", () => {
  reverseOptions = {
    style: reverseStyle.value,
    complexity: reverseComplexity.value,
  };
  reverseStatus.textContent = "反推设置已保存。";
  reverseStatus.className = "status-line ok";
  reverseSettingsModal.close();
});

function openImagePreview(url) {
  imagePreview.src = url;
  imagePreviewModal.showModal();
}

closeImagePreview.addEventListener("click", () => {
  imagePreviewModal.close();
});

imagePreviewModal.addEventListener("click", (event) => {
  if (event.target === imagePreviewModal) imagePreviewModal.close();
});

reverseImage.addEventListener("change", () => {
  const file = reverseImage.files[0];
  if (!file) return;
  renderReverseImagePreview(file);
});

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

applyTheme(currentTheme);
updateModeUi();
updateBatchPromptUi();
queuePromptResize();
