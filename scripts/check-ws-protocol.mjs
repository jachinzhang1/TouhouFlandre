// 校验 contracts/ws/protocol.yaml（`task check:ws-protocol` / CI）：
// 1. 结构：信封 schema、事件表（含唯一逐观察者事件）、客户端消息、控制帧、示例齐备；
// 2. 正例：examples.valid 逐一通过 schema 校验（信封 + payload）与连接时序校验；
// 3. 反例：examples.invalid 必须按 expectFail 类别失败（正反例双测）；
// 4. TS 一致性：packages/shared/src/multi.ts 的 payload 类型字段名集合与协议 schema 对齐。
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolPath = resolve(root, "contracts/ws/protocol.yaml");
const tsPath = resolve(root, "packages/shared/src/multi.ts");

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

const doc = parseYaml(readFileSync(protocolPath, "utf8"));

// ---------- 迷你 JSON Schema 校验器（支持本协议用到的子集） ----------
const definitions = doc.definitions ?? {};
const resolveRef = (ref) => {
  if (!ref.startsWith("#/definitions/")) {
    throw new Error(`不支持的 $ref: ${ref}`);
  }
  const name = ref.slice("#/definitions/".length);
  if (!(name in definitions)) throw new Error(`未知 definition: ${name}`);
  return definitions[name];
};

const errors = [];
const validate = (schema, value, path) => {
  if (schema.$ref) {
    validate(resolveRef(schema.$ref), value, path);
    return;
  }
  if (schema.oneOf) {
    const attempts = [];
    const ok = schema.oneOf.some((sub) => {
      const before = errors.length;
      validate(sub, value, path);
      if (errors.length > before) {
        attempts.push(errors.splice(before).join("; "));
        return false;
      }
      return true;
    });
    if (!ok) {
      errors.push(`${path}: 不满足 oneOf（${attempts.join(" | ")}）`);
    }
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: 期望 const=${JSON.stringify(schema.const)}，实际 ${JSON.stringify(value)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 值 ${JSON.stringify(value)} 不在枚举 [${schema.enum.join(", ")}]`);
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const okType = types.some((t) => {
      if (t === "null") return value === null;
      if (t === "integer") return typeof value === "number" && Number.isInteger(value);
      if (t === "array") return Array.isArray(value);
      return typeof value === t;
    });
    if (!okType) {
      errors.push(`${path}: 期望类型 ${schema.type}，实际 ${typeof value}`);
      return;
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
  }
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) {
    errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: ${value.length} < minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: ${value.length} > maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push(`${path}: 缺 required 字段 "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) validate(sub, value[key], `${path}.${key}`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(schema.properties && key in schema.properties)) {
          errors.push(`${path}: 额外字段 "${key}"（additionalProperties=false）`);
        }
      }
    }
  }
};

// 校验一个消息体：server 事件走信封 + payload；控制帧/客户端消息走平铺 payload schema。
const checkMessage = (message) => {
  errors.length = 0;
  const type = message.type;

  if (type === "hello" || type === "ack") {
    const entry = doc.clientMessages.find((m) => m.type === type);
    validate(entry.payload, message, `message(${type})`);
    return errors.length === 0;
  }
  if (["hello-ok", "replaced"].includes(type)) {
    const entry = doc.control.find((m) => m.type === type);
    validate(entry.payload, message, `message(${type})`);
    return errors.length === 0;
  }
  const event = doc.events.find((e) => e.type === type);
  if (!event) return false;
  validate(doc.envelope, message, `envelope(${type})`);
  if (errors.length) return false;
  validate(event.payload, message.payload, `payload(${type})`);
  return errors.length === 0;
};

// ---------- 结构检查 ----------
console.log("[check-ws-protocol] 结构检查");
if (!doc.info?.version) fail("缺少 info.version");
if (!doc.envelope) fail("缺少 envelope");
const envelopeKeys = Object.keys(doc.envelope.properties ?? {});
if (JSON.stringify(envelopeKeys) !== JSON.stringify(["type", "eventId", "roomId", "sequence", "occurredAt", "payload"])) {
  fail(`envelope 字段与 08 §8.2 不一致: ${envelopeKeys.join(", ")}`);
}

const opponentEvents = doc.events.filter((e) => e.observer === "opponent");
if (opponentEvents.length !== 1 || opponentEvents[0]?.type !== "round.opponent.guess") {
  fail("round.opponent.guess 必须是唯一逐观察者事件（08 §8.3）");
}
const spectatorEvents = doc.events.filter((e) => e.observer === "spectator");
if (spectatorEvents.length !== 1 || spectatorEvents[0]?.type !== "round.spectator.guess") {
  fail("round.spectator.guess 必须是唯一观战者专用事件");
}
const expectedEventTypes = [
  "room.updated",
  "match.started",
  "match.rematch",
  "round.started",
  "round.playing",
  "round.opponent.guess",
  "round.spectator.guess",
  "round.shared.guess",
  "round.turn.timeout",
  "round.turn.pass",
  "round.ended",
  "match.ended",
  "room.closed",
];
const actualEventTypes = doc.events.map((e) => e.type);
if (JSON.stringify(actualEventTypes) !== JSON.stringify(expectedEventTypes)) {
  fail(`事件类型集合与 08 §8.3 不一致: ${actualEventTypes.join(", ")}`);
}
for (const e of doc.events) {
  if (!e.payload) fail(`事件 ${e.type} 缺 payload schema`);
}
for (const t of ["hello", "ack"]) {
  if (!doc.clientMessages.some((m) => m.type === t)) fail(`客户端消息 ${t} 缺失`);
}
for (const t of ["hello-ok", "replaced"]) {
  if (!doc.control.some((m) => m.type === t)) fail(`控制帧 ${t} 缺失`);
}

// ---------- 正例 ----------
console.log("[check-ws-protocol] 正例校验");
const validSeen = new Set();
let sawHello = false;
for (const example of doc.examples.valid) {
  const { label, message } = example;
  const type = message.type;
  if (type === "hello" || type === "ack") {
    // 连接模拟：客户端首条消息必须是 hello，ack 只能在其后
    if (!sawHello && type !== "hello") {
      fail(`正例「${label}」：客户端首条消息必须是 hello`);
      continue;
    }
    if (type === "hello") sawHello = true;
  }
  if (!checkMessage(message)) {
    fail(`正例「${label}」校验失败: ${errors.join("; ")}`);
    continue;
  }
  validSeen.add(type);
}
const covered = [...validSeen].filter((t) => !["hello", "ack", "hello-ok", "replaced"].includes(t));
for (const t of expectedEventTypes) {
  if (!validSeen.has(t)) fail(`事件 ${t} 缺少有效示例`);
}
for (const t of ["hello", "ack", "hello-ok", "replaced"]) {
  if (!validSeen.has(t)) fail(`消息 ${t} 缺少有效示例`);
}

// ---------- 反例 ----------
console.log("[check-ws-protocol] 反例校验");
for (const example of doc.examples.invalid) {
  const { label, expectFail, message } = example;
  const type = message.type;
  let actual = null;
  const known = [...expectedEventTypes, "hello", "ack", "hello-ok", "replaced"];
  if (!known.includes(type)) {
    actual = "unknown-type";
  } else if (type === "hello" || type === "ack") {
    // 每条反例独立模拟一次全新连接：首条客户端消息必须是 hello
    if (type !== "hello") {
      actual = "first-frame";
    } else if (!checkMessage(message)) {
      actual = "schema";
    }
  } else if (!checkMessage(message)) {
    actual = "schema";
  }
  if (actual !== expectFail) {
    fail(`反例「${label}」预期失败类别 ${expectFail}，实际 ${actual ?? "通过"}`);
  }
}

// ---------- TS 类型一致性（字段名集合比对） ----------
console.log("[check-ws-protocol] TS 类型一致性");
if (!existsSync(tsPath)) {
  fail(`缺少 ${tsPath}（Phase 1 应提交 packages/shared/src/multi.ts）`);
} else {
  const tsSource = readFileSync(tsPath, "utf8");
  const interfaceProps = (name) => {
    const start = tsSource.search(new RegExp(`interface\\s+${name}\\s*\\{`));
    if (start === -1) return null;
    const open = tsSource.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < tsSource.length; i += 1) {
      if (tsSource[i] === "{") depth += 1;
      else if (tsSource[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return null;
    const body = tsSource.slice(open + 1, end);
    const props = [];
    for (const line of body.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)(\?)?:/);
      if (m) props.push(m[1]);
    }
    return props.sort();
  };
  const schemaProps = (schema) => Object.keys(schema.properties ?? {}).sort();

  const tsTypeFor = {
    "room.updated": "RoomUpdatedPayload",
    "match.started": "MatchStartedPayload",
    "match.rematch": "MatchRematchPayload",
    "round.started": "RoundStartedPayload",
    "round.playing": "RoundPlayingPayload",
    "round.opponent.guess": "RoundOpponentGuessPayload",
    "round.spectator.guess": "RoundSpectatorGuessPayload",
    "round.shared.guess": "RoundSharedGuessPayload",
    "round.turn.timeout": "RoundTurnTimeoutPayload",
    "round.turn.pass": "RoundTurnPassPayload",
    "round.ended": "RoundEndedPayload",
    "match.ended": "MatchEndedPayload",
    "room.closed": "RoomClosedPayload",
    "hello": "HelloMessage",
    "ack": "AckMessage",
    "hello-ok": "HelloOkMessage",
    "replaced": "ReplacedMessage",
  };
  const entries = [
    ...doc.events.map((e) => [e.type, e.payload]),
    ...doc.clientMessages.map((m) => [m.type, m.payload]),
    ...doc.control.map((m) => [m.type, m.payload]),
  ];
  for (const [type, schema] of entries) {
    const tsName = tsTypeFor[type];
    if (!tsName) {
      fail(`协议类型 ${type} 未映射到 TS 类型名`);
      continue;
    }
    const props = interfaceProps(tsName);
    if (!props) {
      fail(`TS 缺少 interface ${tsName}`);
      continue;
    }
    const expected = schemaProps(schema);
    if (JSON.stringify(props) !== JSON.stringify(expected)) {
      fail(`${tsName} 字段与协议不一致: TS=[${props.join(", ")}] schema=[${expected.join(", ")}]`);
    }
  }
  // 信封字段集合
  const envelopeProps = interfaceProps("Envelope");
  if (!envelopeProps) {
    fail("TS 缺少 interface Envelope");
  } else if (JSON.stringify(envelopeProps) !== JSON.stringify(schemaProps(doc.envelope))) {
    fail(`Envelope 字段与协议不一致: TS=[${envelopeProps.join(", ")}]`);
  }
}

if (failures > 0) {
  console.error(`[check-ws-protocol] 失败：${failures} 项`);
  process.exit(1);
}
console.log("[check-ws-protocol] OK：结构、正反例与 TS 一致性全部通过。");
