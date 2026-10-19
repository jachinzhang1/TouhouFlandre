// Check source dependencies rather than transport-shaped text in comments/SQL.
// Rust's grouped use trees and relative paths are expanded before applying rules.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function tokens(source) {
  const result = [];
  for (let i = 0; i < source.length;) {
    if (source.startsWith("//", i)) { i = source.indexOf("\n", i); if (i < 0) break; continue; }
    if (source.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2; }
        else if (source.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    const raw = /^(?:br|cr|r)(#*)"/.exec(source.slice(i));
    if (raw) { const end = source.indexOf('"' + raw[1], i + raw[0].length); i = end < 0 ? source.length : end + 1 + raw[1].length; continue; }
    if (source[i] === '"') {
      i++; while (i < source.length) { if (source[i++] === "\\") i++; else if (source[i - 1] === '"') break; } continue;
    }
    // Only consume actual character literals, leaving lifetimes visible.
    const char = /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\])'/u.exec(source.slice(i));
    if (char) { i += char[0].length; continue; }
    const identifier = /^(?:r#)?[A-Za-z_][A-Za-z_0-9]*/.exec(source.slice(i));
    if (identifier) { result.push(identifier[0].replace(/^r#/, "")); i += identifier[0].length; continue; }
    if (source.startsWith("::", i)) { result.push("::"); i += 2; continue; }
    if ("{};,*.".includes(source[i])) result.push(source[i]);
    i++;
  }
  return result;
}
function dependencies(source) {
  const input = tokens(source), result = [], aliases = new Map();
  function tree(index, prefix = []) {
    let path = [...prefix];
    while (index < input.length) {
      const item = input[index];
      if (item === "{") {
        index++;
        while (index < input.length && input[index] !== "}") {
          index = tree(index, path);
          if (input[index] === ",") index++;
        }
        return index + 1;
      }
      if ([",", "}", ";"].includes(item)) break;
      if (item === "as") { aliases.set(input[index + 1], [...path]); index += 2; break; }
      if (item !== "::") path.push(item);
      index++;
    }
    if (path.length) {
      result.push(path);
      if (path.at(-1) !== "*") aliases.set(path.at(-1), path);
    }
    return index;
  }
  for (let i = 0; i < input.length; i++) {
    if (input[i] === "use") { i = tree(i + 1); continue; }
    // Also catch fully qualified dependencies in expressions, types and derives.
    if (/^[A-Za-z_]/.test(input[i]) && input[i + 1] === "::") {
      const path = [input[i]];
      while (input[i + 1] === "::" && /^[A-Za-z_]/.test(input[i + 2] ?? "")) { path.push(input[i + 2]); i += 2; }
      result.push(path);
    }
  }
  return { paths: result, aliases };
}
function resolvePath(path, filename) {
  const parts = filename.replaceAll("\\", "/").replace(/^apps\/api\/src\//, "").replace(/\.rs$/, "").split("/");
  if (parts.at(-1) === "mod" || parts.at(-1) === "lib") parts.pop();
  if (path[0] === "crate") return path.slice(1);
  if (path[0] === "self") return [...parts, ...path.slice(1)];
  if (path[0] === "super") {
    while (path[0] === "super") { parts.pop(); path = path.slice(1); }
    return [...parts, ...path];
  }
  return path;
}
export function checkRustFile(filename, source) {
  const file = filename.replaceAll("\\", "/").replace(/^apps\/api\/src\//, "");
  const guessingCore = file.startsWith("crates/touhouflandre-core/");
  const errors = [];
  const { paths, aliases } = dependencies(source);
  for (const raw of paths) {
    let expanded = raw;
    const seen = new Set();
    while (aliases.has(expanded[0]) && !["crate", "self", "super"].includes(expanded[0]) && !seen.has(expanded[0])) {
      seen.add(expanded[0]);
      const prefix = aliases.get(expanded[0]);
      if (prefix.length === 1 && prefix[0] === expanded[0]) break;
      expanded = [...prefix, ...expanded.slice(1)];
    }
    const path = resolvePath(expanded, file), target = path.join("::");
    const fail = (rule) => errors.push(`${file}: ${raw.join("::")} violates ${rule}`);
    if (guessingCore) {
      const application = ["touhouflandre_api", "app", "handler", "router", "repository", "service", "database", "realtime"].includes(path[0]);
      const runtime = ["sqlx", "axum", "tower", "tower_http", "reqwest", "tokio", "tokio_util", "tokio_tungstenite", "async_std", "smol", "hyper", "rusqlite", "diesel", "sea_orm"].includes(path[0]);
      const io = path[0] === "std" && (["fs", "net", "io", "process", "thread", "env"].includes(path[1]) || (path[1] === "time" && ["Instant", "SystemTime"].includes(path[2])));
      if (application || runtime || io) fail("guessing core must remain independent of application, I/O and async runtimes");
    }
    if (file.startsWith("game/") && ["sqlx", "axum", "tower", "tower_http", "reqwest", "app", "error", "handler", "router", "repository", "service", "database"].includes(path[0])) fail("game rules must not depend on storage or HTTP services");
    if (file.startsWith("realtime/") && ["sqlx", "database", "app", "error", "handler", "router", "repository", "service"].includes(path[0])) fail("realtime primitives must not own application or database state");
    if (file.startsWith("handler/") && ["sqlx", "repository", "database"].includes(path[0])) fail("handlers must call application services instead of storage");
    if (file.startsWith("service/")) {
      if (["handler", "router"].includes(path[0])) fail("application services must not depend on HTTP adapters");
      // The existing stable error mapping uses status constants; extractors,
      // bodies, headers and response construction belong exclusively to handlers.
      if (path[0] === "axum" && !target.startsWith("axum::http::StatusCode")) fail("application services must not use Axum request or response types");
    }
    if (file.startsWith("repository/") && ["app", "handler", "router", "service"].includes(path[0])) fail("repositories must not depend on application state or HTTP adapters");
    if (file === "router.rs" && ["service", "repository"].includes(path[0])) fail("routes must target handlers");
    if (file !== "router.rs" && (target === "axum::Router" || target.startsWith("axum::routing"))) fail("route registration belongs in router.rs");
    const mode = /^service\/multi\/(race|relay)(?:\/|\.rs$)/.exec(file)?.[1];
    if (mode && ["service::multi::*", "*"].includes(target)) fail("wildcard imports of all modes bypass explicit multiplayer boundaries");
    if (mode && (target.startsWith(`service::multi::${mode === "race" ? "relay" : "race"}`) || target.startsWith(`domain::${mode === "race" ? "relay" : "race"}`))) fail("race and relay must not depend on each other");
    if (file.startsWith("domain/")) {
      const application = ["axum", "tower", "tower_http", "reqwest", "app", "error", "handler", "router", "repository", "service", "database"].includes(path[0]);
      const storage = path[0] === "sqlx" && target !== "sqlx::FromRow";
      if (application || storage) fail("domain rules must not perform I/O or call adapters");
    }
  }
  const input = tokens(source);
  if (file.startsWith("handler/") && input.some((value, index) => value === "." && input[index + 1] === "pool")) errors.push(`${file}: handlers must not access the database pool`);
  return [...new Set(errors)];
}

// A convention check for direct Cargo dependencies, not a general TOML parser.
// Keep core dependencies explicit: strings, inline tables or dependency tables;
// inherited/path/git dependencies would hide the actual package being reviewed.
export function checkGuessingManifest(filename, source) {
  const errors = [], declarations = [];
  let dependencySection = false, development = false, current;
  const fail = (message) => errors.push(`${filename}: ${message}`);
  const unquote = (key) => key.replace(/^(?:"([^"]+)"|'([^']+)')$/, (_, double, single) => double ?? single);
  const cleanLine = (line) => {
    let quote;
    for (let i = 0; i < line.length; i++) {
      if (quote === '"' && line[i] === "\\") { i++; continue; }
      if (quote) { if (line[i] === quote) quote = undefined; }
      else if (["'", '"'].includes(line[i])) quote = line[i];
      else if (line[i] === "#") return line.slice(0, i).trim();
    }
    return line.trim();
  };
  for (const raw of source.split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    if (line.startsWith("[")) {
      const section = /^\[([^\[\]]+)\]$/.exec(line)?.[1];
      const dependency = section?.match(/(?:^|\.)(build-|dev-)?dependencies(?:\.([A-Za-z0-9_-]+|"[^"]+"|'[^']+'))?$/);
      dependencySection = Boolean(dependency);
      development = dependency?.[1] === "dev-";
      current = dependency?.[2] ? { name: unquote(dependency[2]), development, values: [] } : undefined;
      if (current) declarations.push(current);
      continue;
    }
    if (!dependencySection) continue;
    const entry = /^("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!entry) { fail("use explicit single-line dependency values in guessing core"); continue; }
    if (current) current.values.push(`${unquote(entry[1])} = ${entry[2]}`);
    else {
      const value = entry[2];
      if (!/^(?:"[^"\n]+"|'[^'\n]+'|\{.*\})$/.test(value)) fail("use explicit single-line dependency values in guessing core");
      declarations.push({ name: unquote(entry[1]), development, values: [value] });
    }
  }
  for (const { name, development, values } of declarations) {
    const declaration = values.join("\n");
    const actual = /\bpackage\s*=\s*["']([^"']+)["']/.exec(declaration)?.[1] ?? name;
    const allowed = ["thiserror", "serde"].includes(name) || (development && name === "serde_json");
    if (!allowed || actual !== name) fail(`guessing core dependency ${name} must be thiserror or optional serde; serde_json is allowed only for tests, without package aliases`);
    if (/\b(?:path|git|workspace)\s*=/.test(declaration)) fail(`guessing core dependency ${name} must declare a registry version directly`);
    if (name === "serde" && !/\boptional\s*=\s*true\b/.test(declaration)) fail("guessing core serde dependency must be optional");
  }
  return [...new Set(errors)];
}
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? entry.name === "target" ? [] : sources(join(dir, entry.name)) : entry.name.endsWith(".rs") ? [join(dir, entry.name)] : []);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files = [...sources(join(root, "apps/api/src")), ...sources(join(root, "crates/touhouflandre-core"))];
  const manifest = "crates/touhouflandre-core/Cargo.toml";
  const errors = [
    ...checkGuessingManifest(manifest, readFileSync(join(root, manifest), "utf8")),
    ...files.flatMap((file) => checkRustFile(relative(root, file), readFileSync(file, "utf8"))),
  ];
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log(`Rust architecture boundaries passed (${files.length} source files).`);
}
