import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_STATE_DIR = path.join(os.homedir(), ".fathom");

/** @typedef {"no_change"|"navigation"|"dom_mutation"|"network_call"|"combination"} Outcome */
/** @typedef {{ url: string, title: string, firstVisitedAt: string, discoveredVia?: string }} PageNode */
/** @typedef {{ id: string, sourceEventId: string | null, text: string, createdAt: string, sent: boolean }} QueueItem */
/** @typedef {{ severity: "high"|"likely"|"info", reason: string, status: "open"|"approved"|"dismissed" }} NotificationFlag */
/** @typedef {{ url: string, domHash: string, domSubtreeDiff?: string, screenshot: string, pendingNetworkCalls: unknown[], consoleErrors: string[] }} Snapshot */
/** @typedef {{ verdict: "match"|"mismatch"|"partial"|"unclear", reasoning: string, confidence: number }} Judgment */
/** @typedef {{ id: string, timestamp: string, pageUrl: string, selector: string, elementLabel: string, declaredIntent: string | null, before: Snapshot, after: Snapshot, outcome: Outcome, judgment: Judgment | null, notification: NotificationFlag | null, comments: string[] }} InteractionEvent */
/** @typedef {{ id: string, origin: string, startedAt: string, pages: PageNode[], timeline: InteractionEvent[], queue: QueueItem[] }} Session */

/**
 * @param {string} value
 * @returns {string}
 */
export function canonicalOrigin(value) {
  if (!value || typeof value !== "string") {
    throw new TypeError("origin or URL is required");
  }

  const parsed = new URL(value.includes("://") ? value : `http://${value}`);
  return parsed.origin;
}

/**
 * @param {string} origin
 * @returns {string}
 */
export function sessionIdForOrigin(origin) {
  return createHash("sha256").update(canonicalOrigin(origin)).digest("hex").slice(0, 16);
}

/**
 * @param {Partial<Session> & { origin: string }} input
 * @returns {Session}
 */
export function normalizeSession(input) {
  const origin = canonicalOrigin(input.origin);
  return {
    id: input.id ?? sessionIdForOrigin(origin),
    origin,
    startedAt: input.startedAt ?? new Date().toISOString(),
    pages: input.pages ?? [],
    timeline: input.timeline ?? [],
    queue: input.queue ?? []
  };
}

export class SessionStore {
  /**
   * @param {{ stateDir?: string }} [options]
   */
  constructor(options = {}) {
    this.stateDir = options.stateDir ?? DEFAULT_STATE_DIR;
    this.sessionsDir = path.join(this.stateDir, "sessions");
  }

  /** @returns {Promise<void>} */
  async ensureReady() {
    await mkdir(this.sessionsDir, { recursive: true });
  }

  /**
   * @param {string} originOrUrl
   * @returns {string}
   */
  sessionPath(originOrUrl) {
    return path.join(this.sessionsDir, `${sessionIdForOrigin(originOrUrl)}.json`);
  }

  /**
   * @param {string} originOrUrl
   * @returns {Promise<Session | null>}
   */
  async read(originOrUrl) {
    await this.ensureReady();
    try {
      const raw = await readFile(this.sessionPath(originOrUrl), "utf8");
      return normalizeSession(JSON.parse(raw));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * @param {string} originOrUrl
   * @returns {Promise<Session>}
   */
  async getOrCreate(originOrUrl) {
    const existing = await this.read(originOrUrl);
    if (existing) return existing;

    const session = normalizeSession({ origin: originOrUrl });
    await this.write(session);
    return session;
  }

  /**
   * @param {Session} session
   * @returns {Promise<Session>}
   */
  async write(session) {
    await this.ensureReady();
    const normalized = normalizeSession(session);
    const target = this.sessionPath(normalized.origin);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tmp, target);
    return normalized;
  }

  /**
   * @param {string} originOrUrl
   * @param {(session: Session) => void} mutator
   * @returns {Promise<Session>}
   */
  async update(originOrUrl, mutator) {
    const session = await this.getOrCreate(originOrUrl);
    mutator(session);
    return this.write(session);
  }

  /**
   * @param {string} originOrUrl
   * @param {string} eventId
   * @param {"approved"|"dismissed"} status
   * @param {{ text?: string }} [options]
   * @returns {Promise<{ session: Session, queueItem: QueueItem | null }>}
   */
  async updateNotification(originOrUrl, eventId, status, options = {}) {
    let queueItem = null;
    const session = await this.update(originOrUrl, (draft) => {
      const event = draft.timeline.find((candidate) => candidate.id === eventId);
      if (!event || !event.notification) {
        throw new Error(`notification not found for event ${eventId}`);
      }

      event.notification = { ...event.notification, status };

      if (status === "approved") {
        queueItem = {
          id: randomUUID(),
          sourceEventId: event.id,
          text: options.text ?? `Expected ${event.declaredIntent ?? "an observable effect"}, but observed ${event.outcome}.`,
          createdAt: new Date().toISOString(),
          sent: false
        };
        draft.queue.push(queueItem);
        event.comments.push(queueItem.id);
      }
    });

    return { session, queueItem };
  }

  /**
   * @param {string} originOrUrl
   * @param {PageNode} page
   * @returns {Promise<Session>}
   */
  async upsertPage(originOrUrl, page) {
    const session = await this.getOrCreate(originOrUrl);
    const existingIndex = session.pages.findIndex((candidate) => candidate.url === page.url);
    if (existingIndex === -1) {
      session.pages.push(page);
    } else {
      session.pages[existingIndex] = { ...session.pages[existingIndex], ...page };
    }
    return this.write(session);
  }

  /**
   * @param {string} originOrUrl
   * @param {Omit<InteractionEvent, "id"|"timestamp"|"comments"> & Partial<Pick<InteractionEvent, "id"|"timestamp"|"comments">>} event
   * @returns {Promise<InteractionEvent>}
   */
  async appendInteraction(originOrUrl, event) {
    const session = await this.getOrCreate(originOrUrl);
    const interaction = {
      ...event,
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      comments: event.comments ?? []
    };
    session.timeline.push(interaction);
    await this.write(session);
    return interaction;
  }

  /**
   * @param {string} originOrUrl
   * @param {{ text: string, sourceEventId?: string | null, id?: string, createdAt?: string, sent?: boolean }} item
   * @returns {Promise<QueueItem>}
   */
  async enqueue(originOrUrl, item) {
    const session = await this.getOrCreate(originOrUrl);
    const queueItem = {
      id: item.id ?? randomUUID(),
      sourceEventId: item.sourceEventId ?? null,
      text: item.text,
      createdAt: item.createdAt ?? new Date().toISOString(),
      sent: item.sent ?? false
    };
    session.queue.push(queueItem);
    await this.write(session);
    return queueItem;
  }

  /**
   * @param {string} originOrUrl
   * @returns {Promise<QueueItem[]>}
   */
  async drainQueue(originOrUrl) {
    const session = await this.getOrCreate(originOrUrl);
    const unsent = session.queue.filter((item) => !item.sent);
    if (unsent.length === 0) return [];

    const sentIds = new Set(unsent.map((item) => item.id));
    session.queue = session.queue.map((item) => (sentIds.has(item.id) ? { ...item, sent: true } : item));
    await this.write(session);
    return unsent;
  }
}
