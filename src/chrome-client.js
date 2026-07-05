const origin = document.body.dataset.origin;
const views = Object.fromEntries([...document.querySelectorAll("[data-view]")].map((node) => [node.dataset.view, node]));
const statusNode = document.querySelector("[data-role='status']");
let token = "";
let selectedEventId = null;

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}

async function refresh() {
  if (!origin) return;
  if (!token) await loadToken();
  statusNode.textContent = "loading";
  const response = await fetch(`/api/session?origin=${encodeURIComponent(origin)}`);
  const body = await response.json();
  render(body.session);
  statusNode.textContent = "live";
}

async function loadToken() {
  const response = await fetch("/api/token");
  const body = await response.json();
  token = body.token ?? "";
}

function render(session) {
  renderNotifications(session.timeline.filter((event) => event.notification?.status === "open"));
  renderTimeline(session.timeline);
  renderQueue(session.queue);
}

function renderNotifications(events) {
  views.notifications.innerHTML = events.length ? "" : `<p class="empty">No open notifications</p>`;
  for (const event of events) {
    const node = card(event);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `<button data-action="approve">Approve</button><button data-action="dismiss">Dismiss</button>`;
    actions.querySelector("[data-action='approve']").addEventListener("click", () => showApprovalEditor(node, event));
    actions.querySelector("[data-action='dismiss']").addEventListener("click", () => dismiss(event));
    node.append(actions);
    views.notifications.append(node);
  }
}

function renderTimeline(events) {
  views.timeline.innerHTML = events.length ? "" : `<p class="empty">No interactions yet</p>`;
  for (const event of events.toReversed()) {
    const node = card(event);
    node.tabIndex = 0;
    node.addEventListener("click", () => selectEvent(node, event));
    node.addEventListener("keydown", (keyboardEvent) => {
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") selectEvent(node, event);
    });
    if (event.id === selectedEventId) appendCommentComposer(node, event);
    views.timeline.append(node);
  }
}

function renderQueue(queue) {
  views.queue.innerHTML = queue.length ? "" : `<p class="empty">No queued comments</p>`;
  for (const item of queue.toReversed()) {
    const node = document.createElement("article");
    node.className = `queue-item ${item.sent ? "sent" : ""}`;
    node.innerHTML = `<p>${escapeHtml(item.text)}</p><small>${item.sent ? "sent" : "queued"}</small>`;
    views.queue.append(node);
  }
}

function card(event) {
  const node = document.createElement("article");
  node.className = `event ${event.notification?.severity ?? ""}`;
  node.innerHTML = `
    <header><strong>${escapeHtml(event.elementLabel || event.selector || "Interaction")}</strong><span>${escapeHtml(event.outcome)}</span></header>
    <p>${escapeHtml(event.declaredIntent || "No declared expectation")}</p>
    <small>${escapeHtml(event.pageUrl)}</small>
  `;
  return node;
}

function selectEvent(node, event) {
  selectedEventId = event.id;
  for (const composer of views.timeline.querySelectorAll(".composer")) composer.remove();
  appendCommentComposer(node, event);
}

function appendCommentComposer(node, event) {
  const form = document.createElement("form");
  form.className = "composer";
  form.innerHTML = `
    <textarea name="text" rows="3" placeholder="Add a comment"></textarea>
    <button type="submit">Queue comment</button>
  `;
  form.addEventListener("click", (clickEvent) => clickEvent.stopPropagation());
  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const text = new FormData(form).get("text");
    await comment(event, String(text ?? ""));
  });
  node.append(form);
  form.querySelector("textarea").focus();
}

function showApprovalEditor(node, event) {
  node.querySelector(".composer")?.remove();
  const form = document.createElement("form");
  form.className = "composer";
  form.innerHTML = `
    <textarea name="text" rows="4">${escapeHtml(defaultApprovalText(event))}</textarea>
    <button type="submit">Queue approval</button>
  `;
  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const text = new FormData(form).get("text");
    await approve(event, String(text ?? ""));
  });
  node.append(form);
  form.querySelector("textarea").focus();
}

async function comment(event, text) {
  if (!text.trim()) return;
  await fetch("/api/comments", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ origin, text, sourceEventId: event.id })
  });
  await refresh();
}

async function approve(event, text) {
  await fetch(`/api/notifications/${encodeURIComponent(event.id)}/approve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ origin, text })
  });
  await refresh();
}

async function dismiss(event) {
  await fetch(`/api/notifications/${encodeURIComponent(event.id)}/dismiss`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ origin })
  });
  await refresh();
}

function authHeaders() {
  return { "content-type": "application/json", "x-fathom-token": token };
}

function defaultApprovalText(event) {
  return `Expected ${event.declaredIntent ?? "an observable effect"}, but observed ${event.outcome}.`;
}

function showTab(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

refresh();
setInterval(refresh, 2000);
