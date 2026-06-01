const log = {
  info:  (...a) => console.log(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

import { createHash } from "node:crypto";
import { getCollection } from "../lib/db.js";

const memory = {
  digests: new Map(),
  snapshots: new Map(),
  turns: new Map(),
};

function trimMap(map, max) {
  while (map.size > max) {
    const first = map.keys().next().value;
    map.delete(first);
  }
}

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value || {})).digest("hex");
}

function sanitizeMutable(obj = {}) {
  const next = { ...(obj || {}) };
  delete next._id;
  delete next.createdAt;
  return next;
}

export async function getDailyDigest(date = todayKey()) {
  const col = await getCollection("daily_digests");
  if (!col) return memory.digests.get(date) || null;

  try {
    return await col.findOne({ date });
  } catch (err) {
    log.exception("db_read_failed", err, { collection: "daily_digests", operation: "findOne" });
    return memory.digests.get(date) || null;
  }
}

export async function upsertDailyDigest(doc) {
  const date = doc?.date || todayKey();
  const mutable = sanitizeMutable({ ...doc, date, updatedAt: new Date() });

  memory.digests.set(date, { ...mutable, createdAt: new Date() });
  trimMap(memory.digests, 30);

  const col = await getCollection("daily_digests");
  if (!col) return;

  try {
    await col.updateOne(
      { date },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: mutable,
      },
      { upsert: true },
    );
  } catch (err) {
    log.exception("db_write_failed", err, { collection: "daily_digests", operation: "updateOne" });
  }
}

export async function saveSourceSnapshot(snapshot) {
  const date = snapshot?.date || todayKey();
  const mutable = sanitizeMutable({ ...snapshot, date, updatedAt: new Date() });

  memory.snapshots.set(date, { ...mutable, createdAt: new Date() });
  trimMap(memory.snapshots, 30);

  const col = await getCollection("source_snapshots");
  if (!col) return;

  try {
    await col.updateOne(
      { date },
      {
        $setOnInsert: { createdAt: new Date() },
        $set: mutable,
      },
      { upsert: true },
    );
  } catch (err) {
    log.exception("db_write_failed", err, { collection: "source_snapshots", operation: "updateOne" });
  }
}

export async function saveTurn({ chatId, userId, role, text, meta = {} }) {
  const key = String(chatId || "chat") + ":" + String(userId || "user");
  const row = {
    chatId: String(chatId || ""),
    userId: String(userId || ""),
    role: String(role || "user"),
    text: String(text || "").slice(0, 4000),
    meta,
    createdAt: new Date(),
  };

  const arr = memory.turns.get(key) || [];
  arr.push(row);
  memory.turns.set(key, arr.slice(-20));
  trimMap(memory.turns, 1000);

  const col = await getCollection("message_context");
  if (!col) return;

  try {
    await col.insertOne(row);
  } catch (err) {
    log.exception("db_write_failed", err, { collection: "message_context", operation: "insertOne" });
  }
}

export async function getRecentTurns({ chatId, userId, limit = 12 }) {
  const key = String(chatId || "chat") + ":" + String(userId || "user");
  const col = await getCollection("message_context");

  if (!col) {
    return (memory.turns.get(key) || []).slice(-limit).map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));
  }

  try {
    const rows = await col.find({ chatId: String(chatId || ""), userId: String(userId || "") })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return rows.reverse().map((turn) => ({ role: turn.role, text: turn.text }));
  } catch (err) {
    log.exception("db_read_failed", err, { collection: "message_context", operation: "find" });
    return (memory.turns.get(key) || []).slice(-limit).map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));
  }
}
