/**
 * Emit a CycloneDX 1.5 SBOM from the pnpm production tree.
 * `npm sbom` does not understand this pnpm layout (npm 11 ESBOMPROBLEMS).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "sbom.json");

function npmPurl(name, version) {
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    return `pkg:npm/${scope.replace("@", "%40")}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function walk(node, acc) {
  if (!node || typeof node !== "object") return;
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!info || typeof info !== "object" || !info.version) continue;
    const purl = npmPurl(name, info.version);
    if (!acc.has(purl)) {
      const component = {
        type: "library",
        name,
        version: info.version,
        purl,
      };
      if (info.resolved) {
        component.externalReferences = [
          { type: "distribution", url: info.resolved },
        ];
      }
      acc.set(purl, component);
    }
    walk(info, acc);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const list = JSON.parse(
  execFileSync("pnpm", ["list", "--prod", "--json", "--depth", "Infinity"], {
    cwd: root,
    encoding: "utf8",
  })
);
const trees = Array.isArray(list) ? list : [list];
const components = new Map();
for (const tree of trees) walk(tree, components);

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: pkg.name,
      version: pkg.version,
      purl: npmPurl(pkg.name, pkg.version),
    },
  },
  components: [...components.values()].sort((a, b) =>
    a.purl.localeCompare(b.purl)
  ),
};

writeFileSync(outPath, `${JSON.stringify(bom, null, 2)}\n`);
