// Genera los PNG del ícono desde interfaz/logo.svg y los deja versionados como base64 en
// interfaz/logo-datos.js.
//
// Se corre A MANO y solo cuando cambia el logo. Usa el Chromium del sistema si está; si no,
// avisa y no hace nada. Así el ARMADO sigue sin depender de nada: solo decodifica base64,
// que Node sabe hacer solo.
//
// Uso: node herramientas/logo.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAMANOS = [180, 192, 512]; // iOS · Android · tiendas y pantallas grandes

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (e) {
  try {
    ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
  } catch (e2) {
    console.log("· Playwright no está instalado: no se regeneran los PNG del logo.");
    console.log("  Los que ya están en interfaz/logo-datos.js siguen siendo válidos.");
    process.exit(0);
  }
}

const svg = readFileSync(join(RAIZ, "interfaz/logo.svg"), "utf8");
const navegador = await chromium.launch();
const png = {};

for (const tamano of TAMANOS) {
  const pagina = await navegador.newPage({ viewport: { width: tamano, height: tamano } });
  await pagina.setContent(
    `<body style="margin:0">${svg.replace('width="512" height="512"', `width="${tamano}" height="${tamano}"`)}</body>`,
  );
  png[tamano] = (await pagina.screenshot({ omitBackground: false })).toString("base64");
  await pagina.close();
  console.log(`  · ${tamano}×${tamano} — ${(png[tamano].length / 1024).toFixed(1)} KB en base64`);
}

await navegador.close();

const salida = `// GENERADO por herramientas/logo.mjs desde interfaz/logo.svg. No editar a mano.
//
// El ícono vive aquí en base64 para que el armado no necesite ningún programa de imágenes:
// Node decodifica esto con Buffer.from(b64, "base64") y escribe los PNG, o los incrusta como
// data: URI en el archivo autónomo.

export const LOGO_SVG = ${JSON.stringify(svg.replace(/<!--[\\s\\S]*?-->\\s*/, "").trim())};

export const LOGO_PNG = {
${TAMANOS.map((t) => `  ${t}: "${png[t]}",`).join("\n")}
};
`;

writeFileSync(join(RAIZ, "interfaz/logo-datos.js"), salida);
console.log(`\n✓ interfaz/logo-datos.js regenerado (${TAMANOS.length} tamaños)\n`);
