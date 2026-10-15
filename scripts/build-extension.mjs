import ts from "typescript";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checked = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "extension/tsconfig.json"], { stdio: "inherit" });
if (checked.status !== 0) process.exit(checked.status ?? 1);
await mkdir("extension/dist/sidepanel", { recursive: true });
for (const file of ["background", "content", "sidepanel/index"]) {
  const source = `${await readFile("extension/schedule.ts", "utf8")}\n${await readFile(`extension/${file}.ts`, "utf8")}`;
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, strict: true } });
  await writeFile(`extension/dist/${file}.js`, outputText);
}
for (const file of ["manifest.json", "sidepanel/index.html", "sidepanel/style.css"]) await copyFile(`extension/${file}`, `extension/dist/${file}`);
console.log("Extension build complete: extension/dist (Chrome에 압축해제된 확장프로그램으로 로드)");
