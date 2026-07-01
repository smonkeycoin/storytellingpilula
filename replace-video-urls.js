#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.resolve(process.cwd(), "index.html");
const MAP_PATH = path.resolve(process.cwd(), "video-url-map.json");
const PENDING_TOKEN = "PENDING_URL";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function backupWithTimestamp(filePath) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.${ts}.bak`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
  return backupPath;
}

function main() {
  if (!fs.existsSync(MAP_PATH)) {
    fail(`No se encontró ${MAP_PATH}`);
  }

  let mapRaw;
  try {
    mapRaw = fs.readFileSync(MAP_PATH, "utf8");
  } catch (err) {
    fail(`No se pudo leer ${MAP_PATH}: ${err.message}`);
  }

  let map;
  try {
    map = JSON.parse(mapRaw);
  } catch (err) {
    fail(`video-url-map.json no es JSON válido: ${err.message}`);
  }

  if (typeof map !== "object" || map === null) {
    fail("El archivo de mapeo no contiene un objeto JSON válido.");
  }

  const entries = Object.entries(map);
  if (entries.length === 0) {
    fail("video-url-map.json está vacío.");
  }

  for (const [localPath, remoteUrl] of entries) {
    const local = path.resolve(process.cwd(), localPath);
    if (!fs.existsSync(local)) {
      fail(`Archivo local faltante: ${localPath}`);
    }
    if (typeof remoteUrl !== "string" || remoteUrl.includes(PENDING_TOKEN)) {
      fail(`URL pendiente o inválida para ${localPath}: ${remoteUrl}`);
    }
    if (!/^https?:\/\//i.test(remoteUrl)) {
      fail(`URL inválida para ${localPath}: ${remoteUrl}`);
    }
  }

  if (!fs.existsSync(INDEX_PATH)) {
    fail(`No se encontró ${INDEX_PATH}`);
  }

  let html;
  try {
    html = fs.readFileSync(INDEX_PATH, "utf8");
  } catch (err) {
    fail(`No se pudo leer index.html: ${err.message}`);
  }

  let output = html;
  let replacedCount = 0;

  for (const [localPath, remoteUrl] of entries) {
    const escaped = localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\"${escaped}\"`, "g");
    const next = output.replace(regex, `"${remoteUrl}"`);
    const didReplace = next !== output;
    if (didReplace) {
      replacedCount += 1;
      console.log(`Reemplazo: ${localPath} -> ${remoteUrl}`);
      output = next;
    } else {
      console.log(`Sin cambios: ${localPath} (no se encontró en index.html)`);
    }
  }

  if (replacedCount === 0) {
    fail("No se realizó ningún reemplazo. Verifica que las rutas en el mapa existan en index.html.");
  }

  backupWithTimestamp(INDEX_PATH);
  fs.writeFileSync(INDEX_PATH, output, "utf8");
  console.log(`index.html actualizado correctamente. Reemplazos aplicados: ${replacedCount}`);
}

main();
