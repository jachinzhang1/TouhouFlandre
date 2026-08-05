// 检查 OpenAPI 多文件规范的引用完整性：
// 1. 入口 openapi.yaml 必须存在；
// 2. 所有本地 $ref 指向的文件必须存在；
// 3. 所有拆分文件（非入口）必须被至少一个 $ref 引用（无孤儿文件）。
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";

const root = resolve(process.cwd(), "contracts/openapi");
const entry = join(root, "openapi.yaml");

if (!existsSync(entry)) {
  console.error(`[check-openapi-refs] 缺少入口文件: ${entry}`);
  process.exit(1);
}

const yamlFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".yaml")) yamlFiles.push(full);
  }
};
walk(root);

const referenced = new Set();
const missing = [];
const refPattern = /\$ref:\s*["']?(\.\/[^"'\s#]+)/g;

for (const file of yamlFiles) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(refPattern)) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target)) missing.push(`${relative(root, file)} -> ${match[1]}`);
    referenced.add(target);
  }
}

const orphans = yamlFiles.filter(
  (file) => file !== entry && !referenced.has(file),
);

let failed = false;
if (missing.length) {
  failed = true;
  console.error("[check-openapi-refs] 以下 $ref 指向不存在的文件:");
  for (const item of missing) console.error(`  - ${item}`);
}
if (orphans.length) {
  failed = true;
  console.error("[check-openapi-refs] 以下拆分文件未被任何 $ref 引用（孤儿文件）:");
  for (const file of orphans) console.error(`  - ${relative(root, file)}`);
}
if (!failed) {
  console.log(
    `[check-openapi-refs] OK: ${yamlFiles.length} 个 yaml，${referenced.size} 个本地引用，无孤儿文件。`,
  );
  process.exit(0);
}
process.exit(1);
