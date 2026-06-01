import { safeErr } from "./errors.js";

function cleanMeta(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (/token|secret|key|authorization|password/i.test(key)) {
      out[key + "Set"] = Boolean(value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function write(level, msg, meta = {}) {
  const payload = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...cleanMeta(meta),
  };

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg, meta = {}) => write("info", msg, meta),
  warn: (msg, meta = {}) => write("warn", msg, meta),
  error: (msg, meta = {}) => write("error", msg, meta),
  exception: (msg, err, meta = {}) => write("error", msg, { ...meta, err: safeErr(err) }),
};
