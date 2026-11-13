import { _electron } from "playwright";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(new URL("./package.json", import.meta.url));
const data = await mkdtemp(path.join(tmpdir(), "studystep-icons-"));
const runtime = await _electron.launch({
  executablePath: require("electron"),
  args: [
    fileURLToPath(new URL("./main.mjs", import.meta.url)),
    `--study-data=${data}`,
  ],
});
try {
  const page = await runtime.firstWindow();
  const original = await readFile(
    new URL("../public/favicon.svg", import.meta.url),
    "utf8",
  );
  for (const dev of [false, true]) {
    const svg = dev
      ? original.replace(
          "</svg>",
          '<rect x="40" y="41" width="23" height="22" rx="5" fill="#ff9a48"/><text x="51.5" y="57" text-anchor="middle" font-family="Segoe UI" font-weight="bold" font-size="16" fill="#080c12">D</text></svg>',
        )
      : original;
    await page.setContent(
      "<style>html,body{margin:0;background:transparent}svg{width:256px;height:256px}</style>" +
        svg,
    );
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const header = Buffer.alloc(6 + 16 * sizes.length);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    const images = [];
    let offset = header.length;
    for (const [index, size] of sizes.entries()) {
      await page.locator("svg").evaluate((svg, pixels) => {
        svg.style.width = svg.style.height = pixels + "px";
      }, size);
      const png = await page.screenshot({
        clip: { x: 0, y: 0, width: size, height: size },
        omitBackground: true,
      });
      const entry = 6 + 16 * index;
      header[entry] = header[entry + 1] = size % 256;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += png.length;
      images.push(png);
    }
    await writeFile(
      new URL(dev ? "icon-dev.ico" : "icon.ico", import.meta.url),
      Buffer.concat([header, ...images]),
    );
  }
} finally {
  await runtime.close();
}
