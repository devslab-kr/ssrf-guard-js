import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPublisher, renderPublisherHtml, serializeJsonLd } from "@devslab/site-kit";
import { DEVSLAB_PUBLISHER } from "@devslab/site-kit/devslab";

const root = new URL("../../", import.meta.url);
const config = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const check = process.argv.includes("--check");
const { link, reference } = buildPublisher(DEVSLAB_PUBLISHER);
const start = "<!-- publisher:start -->";
const end = "<!-- publisher:end -->";
const markdown = `${start}\n${config.attributionLabel ?? "Open source by"} [${link.label}](${link.href}).\n${end}`;
const source = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "@id": `${config.repository}#software`,
  name: config.name,
  url: config.url,
  codeRepository: config.repository,
  publisher: reference,
};
const html = `${start}\n<p class="publisher-attribution">Open source by ${renderPublisherHtml(DEVSLAB_PUBLISHER)}</p>\n<script type="application/ld+json">${serializeJsonLd(source)}</script>\n${end}`;

async function update(relative, transform) {
  const url = new URL(relative, root);
  const current = (await readFile(url, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  })).replaceAll("\r\n", "\n");
  const next = transform(current);
  if (current === next) return;
  if (check) throw new Error(`Publisher output is stale: ${fileURLToPath(url)}; run npm run sync --prefix tools/publisher`);
  await writeFile(url, next);
}
function replaceBlock(text, value) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from < 0 || to < from) throw new Error("Missing publisher markers");
  return text.slice(0, from) + value + text.slice(to + end.length);
}
for (const path of config.readmes ?? ["README.md", "README.ko.md"]) {
  await update(path, (text) => replaceBlock(text, markdown));
}
if (config.kind === "mkdocs") {
  await update("docs/overrides/publisher.html", () => html + "\n");
}
for (const path of config.pages) {
  await update(path, (text) => replaceBlock(text, html));
}
console.log(check ? "Publisher output is current." : "Publisher output synchronized.");
