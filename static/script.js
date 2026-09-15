import "./modules/settings.js?v=20260505-virtual-edit-tasks";
import "./modules/image.js?v=20260505-virtual-edit-tasks";
import "./modules/product.js?v=20260505-virtual-edit-tasks";
import "./modules/chat.js?v=20260505-virtual-edit-tasks";
import { appState } from "./shared/state.js";
import { emit } from "./shared/events.js";

document.querySelectorAll("[data-module]").forEach((button) => {
  button.addEventListener("click", () => {
    const moduleName = button.dataset.module;
    appState.activeModule = moduleName;
    document.querySelectorAll("[data-module]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-module-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.modulePanel === moduleName));
    emit("module:change", { moduleName });
  });
});
