import { appState } from "../shared/state.js";
import { apiJson } from "../shared/api.js";
import { emit, on } from "../shared/events.js";

const chatMessages = document.querySelector("#chatMessages");
const chatDraft = document.querySelector("#chatDraft");
const chatImages = document.querySelector("#chatImages");
const chatComposer = document.querySelector(".chat-composer");
const chatAttachments = document.querySelector("#chatAttachments");
const clearChat = document.querySelector("#clearChat");
const sendChat = document.querySelector("#sendChat");
const chatStatus = document.querySelector("#chatStatus");
const plannerPlatform = document.querySelector("#plannerPlatform");
const plannerStyle = document.querySelector("#plannerStyle");
const plannerQuantity = document.querySelector("#plannerQuantity");
const plannerType = document.querySelector("#plannerType");
const startPlannerBtn = document.querySelector("#startPlannerBtn");
const openPlannerFormat = document.querySelector("#openPlannerFormat");
const plannerFormatModal = document.querySelector("#plannerFormatModal");
const plannerFormatInput = document.querySelector("#plannerFormatInput");
const resetPlannerFormat = document.querySelector("#resetPlannerFormat");
const savePlannerFormat = document.querySelector("#savePlannerFormat");
const plannerFormatStatus = document.querySelector("#plannerFormatStatus");
const plannerSource = document.querySelector("#plannerSource");
const plannerOutput = document.querySelector("#plannerOutput");
const sendPlanToText = document.querySelector("#sendPlanToText");
const sendPlanToEdit = document.querySelector("#sendPlanToEdit");
const plannerStatus = document.querySelector("#plannerStatus");

if (!Array.isArray(appState.chatMessages)) appState.chatMessages = [];

let attachments = [];
let attachmentUrls = [];
let plannerProductName = "";
let plannerLanguage = "en";

const PLANNER_FORMAT_STORAGE_KEY = "imagePlannerPromptFormat";
const DEFAULT_PLANNER_FORMAT =
  "图片类型：主图/副图/A+；画面主体：产品和核心卖点；构图：主体位置、视角、镜头距离；背景/场景：使用环境或纯色背景；光线：棚拍光/自然光/氛围光；色彩：主色、辅助色、对比关系；风格：平台和品类匹配；模特/道具：人物类型、姿态、动作、道具；禁止：文字、水印、变形、低清、夸张违规表达。";

const platformLabels = {
  amazon: "亚马逊",
  walmart: "沃尔玛",
  temu: "Temu",
  ebay: "eBay",
  etsy: "Etsy",
  aliexpress: "速卖通",
  tiktok_shop: "TikTok Shop",
  shopee: "Shopee",
  lazada: "Lazada",
  shein: "SHEIN",
  shopify: "独立站 / Shopify",
  taobao: "淘宝",
  tmall: "天猫",
  jd: "京东",
  pinduoduo: "拼多多",
  douyin: "抖音电商",
  kuaishou: "快手电商",
  xiaohongshu: "小红书",
  1688: "1688",
};

const styleLabels = {
  tech: "科技",
  home: "家居",
  sport: "运动",
  minimal_white: "极简白底",
  premium: "高端质感",
  lifestyle: "生活方式",
  scenario: "场景化种草",
  promo: "爆款促销",
  black_friday: "黑五大促",
  fresh: "清新自然",
  luxury: "奢华精品",
  guochao: "国潮新中式",
  cute: "可爱潮玩",
  industrial: "工业硬核",
};

const plannerTypeLabels = {
  main_sub: "主副图",
  aplus: "A+",
  brand_story: "品牌故事",
  sbh_ad: "SBH广告",
  package: "包装设计",
};

function setStatus(message, type = "") {
  if (!chatStatus) return;
  chatStatus.textContent = message;
  chatStatus.className = `status-line ${type}`;
}

function setPlannerStatus(message, type = "") {
  if (!plannerStatus) return;
  plannerStatus.textContent = message;
  plannerStatus.className = `status-line ${type}`;
}

function setPlannerFormatStatus(message, type = "") {
  if (!plannerFormatStatus) return;
  plannerFormatStatus.textContent = message;
  plannerFormatStatus.className = `status-line ${type}`;
}

function getPlannerFormat() {
  try {
    return localStorage.getItem(PLANNER_FORMAT_STORAGE_KEY) || DEFAULT_PLANNER_FORMAT;
  } catch {
    return DEFAULT_PLANNER_FORMAT;
  }
}

function savePlannerFormatValue(value) {
  try {
    localStorage.setItem(PLANNER_FORMAT_STORAGE_KEY, value || DEFAULT_PLANNER_FORMAT);
  } catch {
    // 本地存储不可用时，不影响本次生成。
  }
}

function syncPlannerFormatInput() {
  if (plannerFormatInput) plannerFormatInput.value = getPlannerFormat();
}

function normalizePlannerOutput(text) {
  return String(text || "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/}\s*{/g, "}\n\n{")
    .replace(/\n{3,}/g, "\n\n");
}

function fitPlannerOutputToQuantity(text, quantity) {
  const normalized = normalizePlannerOutput(text);
  const target = Math.max(1, Math.min(12, Number(quantity) || 8));
  const braceItems = normalized.match(/\{[\s\S]*?\}/g);
  if (braceItems?.length) {
    return braceItems.slice(0, target).map((item) => item.trim()).join("\n\n");
  }
  const chunks = normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  return chunks.length > target ? chunks.slice(0, target).join("\n\n") : normalized;
}

function autoResizePlannerOutput() {
  if (!plannerOutput) return;
  plannerOutput.style.height = "auto";
  plannerOutput.style.height = `${Math.max(280, plannerOutput.scrollHeight)}px`;
}

function imageFiles(files) {
  return Array.from(files || []).filter((file) => file.type.startsWith("image/"));
}

function clipboardImageFiles(clipboardData) {
  if (!clipboardData) return [];
  const files = imageFiles(clipboardData.files);
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

function addAttachments(files) {
  const incoming = imageFiles(files);
  if (!incoming.length) return;
  attachments = [...attachments, ...incoming].slice(0, 6);
  renderAttachments();
  syncPlannerButtons();
  setStatus(`已添加 ${incoming.length} 张图片。`, "ok");
}

function cleanupAttachmentUrls() {
  attachmentUrls.forEach((url) => URL.revokeObjectURL(url));
  attachmentUrls = [];
}

function renderAttachments() {
  if (!chatAttachments) return;
  cleanupAttachmentUrls();
  chatAttachments.classList.toggle("hidden", attachments.length === 0);
  chatAttachments.innerHTML = attachments
    .map((file, index) => {
      const url = URL.createObjectURL(file);
      attachmentUrls.push(url);
      return `<article class="chat-thumb">
        <img src="${url}" alt="聊天图片 ${index + 1}" />
        <button type="button" data-remove-chat-image="${index}" aria-label="移除图片">×</button>
      </article>`;
    })
    .join("");
  chatAttachments.querySelectorAll("[data-remove-chat-image]").forEach((button) => {
    button.addEventListener("click", () => {
      attachments.splice(Number(button.dataset.removeChatImage), 1);
      renderAttachments();
      syncPlannerButtons();
    });
  });
}

function renderMessages() {
  if (!chatMessages) return;
  if (!Array.isArray(appState.chatMessages)) appState.chatMessages = [];
  if (!appState.chatMessages.length) {
    chatMessages.innerHTML = `<div class="chat-empty">还没有消息。可以输入文字，也可以上传或粘贴图片一起发送。</div>`;
    return;
  }
  chatMessages.innerHTML = appState.chatMessages
    .map((message) => {
      const images = (message.images || [])
        .map((image) => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || "聊天图片")}" />`)
        .join("");
      return `<article class="chat-message ${message.role}">
        <div class="chat-bubble">
          ${images ? `<div class="chat-message-images">${images}</div>` : ""}
          <p>${escapeHtml(message.content || "（空消息）")}</p>
        </div>
      </article>`;
    })
    .join("");
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function recentHistory() {
  return appState.chatMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-20)
    .map((message) => ({ role: message.role, content: message.content || "" }));
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve({
        name: file.name,
        mime_type: file.type || "image/png",
        data: dataUrl.split(",")[1] || "",
      });
    };
    reader.onerror = () => reject(new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });
}

function snapshotImages() {
  return attachments.map((file) => ({
    name: file.name,
    url: URL.createObjectURL(file),
  }));
}

function resetComposer() {
  if (chatDraft) chatDraft.value = "";
  appState.chatDraft = "";
  attachments = [];
  renderAttachments();
  syncPlannerButtons();
}

function clearConversation() {
  resetComposer();
  appState.chatMessages = [];
  renderMessages();
}

function hasPlannerSource() {
  return Boolean(plannerSource?.value.trim() || chatDraft?.value.trim() || attachments.length);
}

function hasPlannerOutput() {
  return Boolean(plannerOutput?.value.trim());
}

function syncPlannerButtons() {
  if (startPlannerBtn) startPlannerBtn.disabled = !hasPlannerSource();
  const disabled = !hasPlannerOutput();
  if (sendPlanToText) sendPlanToText.disabled = disabled;
  if (sendPlanToEdit) sendPlanToEdit.disabled = disabled;
}

function buildPlannerFallbackPrompt({ product_name, platform, style, quantity, plan_type, prompt_format, language, source_text, has_images = false }) {
  const outputLanguage = language === "zh" ? "中文" : "English";
  const count = Math.max(1, Math.min(20, Number(quantity) || 8));
  const sourceBlock = source_text || (has_images ? "用户已上传产品图片，请先识别图片中的产品外观、结构、材质、颜色和适用场景，再进行图片策划。" : "");
  return `
你是资深电商图片策划和 AI 生图提示词专家。
请根据以下产品卖点、关键词、五点描述、主副图文案或 A+ 文案，生成可直接用于文生图或图生图的详细生图提示词。
如果用户上传了产品图片，请把图片作为主要产品参考；如果同时有文字和图片，请同时结合文字需求和图片里的产品特征。

产品名称：${product_name || "未填写"}
目标平台：${platformLabels[platform] || "亚马逊"}
视觉风格：${styleLabels[style] || "科技"}
策划类型：${plannerTypeLabels[plan_type] || "主副图"}
策划数量：${count} 条
输出语言：${outputLanguage}
每条提示词格式：${prompt_format || DEFAULT_PLANNER_FORMAT}

来源内容：
${sourceBlock}

要求：
1. 只输出图片策划提示词，不要解释，不要 Markdown 标题。
2. 每一条提示词都必须用 {} 包起来。
3. 每一条都必须明确标注对应图片类型，并符合“策划类型”。
4. 内容要融合卖点、构图、色彩、风格、场景、模特或产品展示要求。
5. 严格生成 ${count} 条；这是硬性数量要求，不要多生成，也不要少生成，每条之间空一行。
`.trim();
}

async function requestChatImagePlan(payload) {
  const data = await apiJson("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: buildPlannerFallbackPrompt(payload),
      history: [],
      images: payload.images || [],
    }),
  });
  return data.reply || "";
}

async function requestImagePlan(payload) {
  if (payload.images?.length) {
    return requestChatImagePlan(payload);
  }
  try {
    const data = await apiJson("/api/product/image-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return data.plan || "";
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("Not Found") && !message.includes("接口不存在")) {
      throw error;
    }
    return requestChatImagePlan(payload);
  }
}

function sendPlannerResult(mode) {
  const prompt = plannerOutput?.value.trim() || "";
  if (!prompt) {
    setPlannerStatus("请先生成或填写图片策划内容。", "bad");
    return;
  }
  emit("image:setPrompt", { prompt, mode });
  setPlannerStatus(mode === "edit" ? "已发送到图生图。" : "已发送到文生图。", "ok");
}

on("product:imagePlanRequested", ({ product_name = "", language = "en", source_text = "" } = {}) => {
  resetComposer();
  plannerProductName = product_name;
  plannerLanguage = language === "zh" ? "zh" : "en";
  if (plannerSource) plannerSource.value = source_text;
  if (plannerOutput) plannerOutput.value = "";
  autoResizePlannerOutput();
  syncPlannerButtons();
  setPlannerStatus("已接收产品文案，选择平台和风格后可以开始策划。", "ok");
});

chatDraft?.addEventListener("input", () => {
  appState.chatDraft = chatDraft.value;
  syncPlannerButtons();
});

plannerOutput?.addEventListener("input", () => {
  autoResizePlannerOutput();
  syncPlannerButtons();
});

openPlannerFormat?.addEventListener("click", () => {
  syncPlannerFormatInput();
  setPlannerFormatStatus("");
  plannerFormatModal?.showModal();
});

resetPlannerFormat?.addEventListener("click", () => {
  if (plannerFormatInput) plannerFormatInput.value = DEFAULT_PLANNER_FORMAT;
  savePlannerFormatValue(DEFAULT_PLANNER_FORMAT);
  setPlannerFormatStatus("已恢复默认格式。", "ok");
});

savePlannerFormat?.addEventListener("click", () => {
  const value = plannerFormatInput?.value.trim() || DEFAULT_PLANNER_FORMAT;
  savePlannerFormatValue(value);
  setPlannerFormatStatus("已保存提示词格式。", "ok");
  plannerFormatModal?.close();
});

startPlannerBtn?.addEventListener("click", async () => {
  const sourceText = chatDraft?.value.trim() || plannerSource?.value.trim() || "";
  if (!sourceText && !attachments.length) {
    setPlannerStatus("请先从产品文案发送内容，或在上方聊天输入框输入文字/添加产品图片。", "bad");
    return;
  }
  const outputLanguage = chatDraft?.value.trim() ? (/\p{Script=Han}/u.test(sourceText) ? "zh" : "en") : (plannerSource?.value.trim() ? plannerLanguage : "zh");
  startPlannerBtn.disabled = true;
  setPlannerStatus(attachments.length ? "正在结合产品图片生成图片策划..." : "正在生成图片策划...");
  try {
    const imagePayloads = await Promise.all(attachments.map(fileToPayload));
    const payload = {
      product_name: plannerProductName,
      platform: plannerPlatform?.value || "amazon",
      style: plannerStyle?.value || "tech",
      quantity: Number(plannerQuantity?.value || 8),
      plan_type: plannerType?.value || "main_sub",
      prompt_format: getPlannerFormat(),
      language: outputLanguage,
      source_text: sourceText,
      has_images: Boolean(imagePayloads.length),
      images: imagePayloads,
    };
    const plan = fitPlannerOutputToQuantity(await requestImagePlan(payload), payload.quantity);
    if (plannerOutput) plannerOutput.value = plan;
    autoResizePlannerOutput();
    setPlannerStatus(
      `已生成${platformLabels[plannerPlatform?.value] || "平台"} · ${styleLabels[plannerStyle?.value] || "风格"} · ${plannerTypeLabels[plannerType?.value] || "主副图"}图片策划。`,
      "ok",
    );
  } catch (error) {
    setPlannerStatus(error.message, "bad");
  } finally {
    syncPlannerButtons();
  }
});

sendPlanToText?.addEventListener("click", () => sendPlannerResult("text"));
sendPlanToEdit?.addEventListener("click", () => sendPlannerResult("edit"));

chatImages?.addEventListener("change", () => {
  addAttachments(chatImages.files);
  chatImages.value = "";
});

chatComposer?.addEventListener("dragover", (event) => {
  event.preventDefault();
});

chatComposer?.addEventListener("drop", (event) => {
  event.preventDefault();
  addAttachments(event.dataTransfer?.files);
});

document.addEventListener("paste", (event) => {
  if (appState.activeModule !== "chat") return;
  const files = clipboardImageFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  addAttachments(files);
});

clearChat?.addEventListener("click", () => {
  clearConversation();
  setStatus("已清空聊天内容。", "ok");
});

sendChat?.addEventListener("click", async () => {
  const message = chatDraft?.value.trim() || "";
  if (!message && !attachments.length) {
    setStatus("请先输入文字或添加图片。", "bad");
    return;
  }
  sendChat.disabled = true;
  setStatus(attachments.length ? "正在调用视觉理解模型..." : "正在调用聊天模型...");
  const history = recentHistory();
  const localImages = snapshotImages();
  appState.chatMessages.push({ role: "user", content: message, images: localImages });
  renderMessages();
  try {
    const imagePayloads = await Promise.all(attachments.map(fileToPayload));
    const data = await apiJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history,
        images: imagePayloads,
      }),
    });
    appState.chatMessages.push({ role: "assistant", content: data.reply || "没有返回内容。" });
    appState.chatMessages = appState.chatMessages.slice(-60);
    renderMessages();
    resetComposer();
    setStatus("回复完成。", "ok");
  } catch (error) {
    appState.chatMessages.push({ role: "assistant", content: `发送失败：${error.message}` });
    renderMessages();
    setStatus(error.message, "bad");
  } finally {
    sendChat.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderAttachments();
renderMessages();
syncPlannerButtons();
