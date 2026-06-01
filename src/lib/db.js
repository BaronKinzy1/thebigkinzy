import { MongoClient } from "mongodb";
import { cfg } from "./config.js";
import { log } from "./log.js";

let client = null;
let db = null;
let indexesReady = false;

export async function getDb() {
  if (db) return db;
  if (!cfg.MONGODB_URI) return null;

  try {
    client = new MongoClient(cfg.MONGODB_URI, {
      ignoreUndefined: true,
      serverSelectionTimeoutMS: 10000,
    });
    await client.connect();
    db = client.db();
    log.info("db_connected", { hasMongoUri: true });
    await ensureIndexes();
    return db;
  } catch (err) {
    log.exception("db_connect_failed", err, { collection: "all", operation: "connect" });
    db = null;
    client = null;
    return null;
  }
}

export async function getCollection(name) {
  const activeDb = await getDb();
  if (!activeDb) return null;
  return activeDb.collection(name);
}

export async function ensureIndexes() {
  if (!db || indexesReady) return;

  try {
    await db.collection("daily_digests").createIndex({ date: 1 }, { unique: true });
    await db.collection("source_snapshots").createIndex({ date: 1 }, { unique: true });
    await db.collection("message_context").createIndex({ chatId: 1, createdAt: -1 });
    indexesReady = true;
    log.info("db_indexes_ready", {
      collections: ["daily_digests", "source_snapshots", "message_context"],
    });
  } catch (err) {
    log.exception("db_index_failed", err, { collection: "multiple", operation: "createIndex" });
  }
}

export async function closeDb() {
  if (!client) return;
  await client.close().catch((err) => {
    log.exception("db_close_failed", err, { collection: "all", operation: "close" });
  });
  client = null;
  db = null;
  indexesReady = false;
}
