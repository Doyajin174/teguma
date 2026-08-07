import { changeText, hitTest, moveLayer, resizeLayer } from "/web/editor-logic.js";

const $ = (selector) => document.querySelector(selector);
const artboard = $("#artboard");
const stage = $("#stage");
const selection = $("#selection");
const editor = $("#inline-editor");
let state;
let activePageId;
let selectedLayerId;
let interaction;
let editing = false;
let requestId = 0;

async function request(url, value) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "요청을 처리하지 못했습니다.");
  return result;
}

function page() { return state.document.pages.find((item) => item.id === activePageId); }
function selected() { return page()?.layers.find((item) => item.id === selectedLayerId); }
function scale() { return stage.clientWidth / state.document.canvas.width; }
function canvasPoint(event) { const box = stage.getBoundingClientRect(); const ratio = scale(); return { x: (event.clientX - box.left) / ratio, y: (event.clientY - box.top) / ratio }; }
function qaFailedFor(layer) { return state.qa.checks.some((check) => !check.pass && check.detail?.includes(`${page().id}/${layer.id}`)); }

function setStatus(value) { $("#status").textContent = value; }
function render() {
  const width = Math.min(760, Math.max(320, window.innerWidth - 610));
  const ratio = state.document.canvas.height / state.document.canvas.width;
  stage.style.width = `${width}px`; stage.style.height = `${Math.round(width * ratio)}px`;
  artboard.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(state.svg)}`;
  renderSidebars(); renderQa(); renderSelection();
}
function renderSidebars() {
  $("#pages").replaceChildren(...state.document.pages.map((item) => button(item.name, () => { activePageId = item.id; selectedLayerId = undefined; commit(state.document); }, item.id === activePageId)));
  $("#layers").replaceChildren(...page().layers.slice().reverse().map((item) => button(`${item.type} · ${item.id}`, () => { selectedLayerId = item.id; renderSelection(); }, item.id === selectedLayerId)));
}
function button(label, action, active) { const item = document.createElement("button"); item.type = "button"; item.textContent = label; if (active) item.className = "active"; item.addEventListener("click", action); return item; }
function renderQa() {
  $("#qa-summary").textContent = state.qa.passed ? "통과: 현재 문서는 내보낼 수 있습니다." : "수정 필요: 실패한 항목은 캔버스에서 빨간색으로 표시됩니다.";
  $("#qa-checks").replaceChildren(...state.qa.checks.map((check) => { const item = document.createElement("li"); item.className = check.pass ? "pass" : "fail"; item.textContent = `${check.pass ? "통과" : "실패"} · ${check.name}${check.detail ? ` — ${check.detail}` : ""}`; return item; }));
}
function renderSelection() {
  const layer = selected(); if (!layer || editing) { selection.hidden = true; return; }
  const ratio = scale(); const frame = layer.frame; selection.hidden = false; selection.classList.toggle("qa-fail", qaFailedFor(layer));
  Object.assign(selection.style, { left: `${frame.x * ratio}px`, top: `${frame.y * ratio}px`, width: `${frame.width * ratio}px`, height: `${frame.height * ratio}px` });
}
async function commit(document, renderSvg = true) {
  const current = ++requestId;
  try {
    const next = await request("/api/state", { document, pageId: activePageId });
    if (current !== requestId) return;
    state = next; activePageId = next.pageId;
    if (renderSvg) render(); else { renderQa(); renderSelection(); }
  } catch (error) { setStatus(error.message); }
}
function startTextEdit() {
  const layer = selected(); if (!layer || layer.type !== "text") return;
  editing = true; selection.hidden = true; const ratio = scale();
  Object.assign(editor.style, { left: `${layer.frame.x * ratio}px`, top: `${layer.frame.y * ratio}px`, width: `${layer.frame.width * ratio}px`, height: `${layer.frame.height * ratio}px`, fontFamily: layer.fontFamily, fontSize: `${layer.fontSize * ratio}px`, fontWeight: layer.fontWeight, lineHeight: layer.lineHeight, letterSpacing: `${layer.letterSpacing * ratio}px`, color: layer.color });
  editor.value = layer.text; editor.hidden = false; editor.focus(); editor.select();
}
async function finishTextEdit() {
  if (!editing) return; editing = false; editor.hidden = true;
  await commit(changeText(state.document, activePageId, selectedLayerId, editor.value, (value) => value));
}
editor.addEventListener("input", () => commit(changeText(state.document, activePageId, selectedLayerId, editor.value, (value) => value), false));
editor.addEventListener("blur", finishTextEdit); editor.addEventListener("keydown", (event) => { if (event.key === "Escape") { editing = false; editor.hidden = true; renderSelection(); } });

stage.addEventListener("pointerdown", (event) => {
  if (editing) return; const handle = event.target.dataset?.handle; const point = canvasPoint(event);
  if (handle && selected()) interaction = { kind: "resize", handle, start: point, document: state.document };
  else { const layer = hitTest(page(), point.x, point.y); selectedLayerId = layer?.id; interaction = layer ? { kind: "move", start: point, document: state.document } : undefined; renderSelection(); }
  if (interaction) { stage.setPointerCapture(event.pointerId); event.preventDefault(); }
});
stage.addEventListener("pointermove", (event) => {
  if (!interaction) return; const point = canvasPoint(event); const dx = point.x - interaction.start.x; const dy = point.y - interaction.start.y;
  const candidate = interaction.kind === "move" ? moveLayer(interaction.document, activePageId, selectedLayerId, dx, dy, (value) => value) : resizeLayer(interaction.document, activePageId, selectedLayerId, interaction.handle, dx, dy, (value) => value);
  interaction.candidate = candidate;
  commit(candidate, false);
});
stage.addEventListener("pointerup", (event) => { if (!interaction) return; stage.releasePointerCapture(event.pointerId); const finalDocument = interaction.candidate ?? interaction.document; interaction = undefined; commit(finalDocument); });
stage.addEventListener("dblclick", startTextEdit); window.addEventListener("resize", renderSelection);

function selectedTemplate() { return state.templates.find((item) => item.id === $("#template").value); }
function renderTemplateSlots() {
  const template = selectedTemplate(); $("#template-description").textContent = template.description; const form = $("#template-slots"); form.replaceChildren();
  for (const slot of [...template.requiredSlots, ...template.optionalSlots]) { const label = document.createElement("label"); label.textContent = slot; const input = document.createElement("input"); input.name = slot; input.value = template.exampleInput[slot] ?? ""; input.placeholder = template.requiredSlots.includes(slot) ? "필수" : "선택"; label.append(input); form.append(label); }
}
$("#template").addEventListener("change", renderTemplateSlots);
$("#instantiate").addEventListener("click", async () => { const template = selectedTemplate(); const slots = Object.fromEntries(new FormData($("#template-slots")).entries()); for (const slot of template.optionalSlots) if (!slots[slot]) delete slots[slot]; try { state = await request("/api/template", { templateId: template.id, slots }); activePageId = state.pageId; selectedLayerId = undefined; render(); } catch (error) { setStatus(error.message); } });
$("#resize").addEventListener("click", async () => { try { state = await request("/api/resize", { document: state.document, pageId: activePageId, target: { preset: $("#preset").value, mode: $("#resize-mode").value } }); activePageId = state.pageId; render(); } catch (error) { setStatus(error.message); } });
$("#export").addEventListener("click", async () => { try { setStatus("내보내는 중…"); const result = await request("/api/export", { document: state.document, format: $("#export-format").value.toLowerCase() }); for (const file of result.files) { const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)); const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes])), download: file.name }); link.click(); URL.revokeObjectURL(link.href); } setStatus(`${result.format.toUpperCase()} 다운로드 완료`); } catch (error) { setStatus(error.message); } });

async function boot() {
  const response = await fetch("/api/bootstrap"); state = await response.json(); activePageId = state.pageId;
  $("#preset").replaceChildren(...state.presets.map((item) => new Option(`${item.label} · ${item.width}×${item.height}${item.unit}`, item.id)));
  $("#template").replaceChildren(...state.templates.map((item) => new Option(item.name, item.id)));
  $("#template").value = "card-news-cover"; renderTemplateSlots(); render();
}
boot().catch((error) => setStatus(error.message));
