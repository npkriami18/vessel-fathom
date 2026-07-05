const origin = document.body.dataset.origin;
const views = Object.fromEntries([...document.querySelectorAll("[data-view]")].map((node) => [node.dataset.view, node]));
const statusNode = document.querySelector("[data-role='status']");

for (const button of document.querySelectorAll("[data-tab]")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}

async function refresh() {
  if (!origin) return;
  statusNode.textContent = "loading";
  const response = await fetch(`/api/session?origin=${encodeURIComponent(origin)}`);
  const body = await response.json();
  render(body.session);
  statusNode.textContent = "live";
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
    actions.querySelector("[data-action='approve']").addEventListener("click", () => approve(event));
    actions.querySelector("[data-action='dismiss']").addEventListener("click", () => dismiss(event));
    node.append(actions);
    views.notifications.append(node);
  }
}

function renderTimeline(events) {
  views.timeline.innerHTML = events.length ? "" : `<p class="empty">No interactions yet</p>`;
  for (const event of events.toReversed()) views.timeline.append(card(event));
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

async function approve(event) {
  await fetch(`/api/notifications/${encodeURIComponent(event.id)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin })
  });
  await refresh();
}

async function dismiss(event) {
  await fetch(`/api/notifications/${encodeURIComponent(event.id)}/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origin })
  });
  await refresh();
}

function showTab(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

refresh();
setInterval(refresh, 2000);
