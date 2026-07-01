#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { put } = require("@vercel/blob");

const PROJECT_ROOT = process.cwd();
const UPLOAD_LIST_PATH = path.join(PROJECT_ROOT, "video-upload-list.txt");
const MAP_PATH = path.join(PROJECT_ROOT, "video-url-map.json");
const REPORT_PATH = path.join(PROJECT_ROOT, "video-upload-report.json");
const HTML_PATH = path.join(PROJECT_ROOT, "index.html");
const PENDING_TOKEN = "PENDING_URL";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`No se encontró: ${path.basename(filePath)}`);
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(2)} ${units[idx]}`;
}

function ensureMapHasKeys(map, keys) {
  const missing = keys.filter((key) => !(key in map));
  if (missing.length > 0) {
    fail(`Faltan claves en video-url-map.json: ${missing.join(", ")}`);
  }
}

async function main() {
  const token =
    process.env.VERCEL_BLOB_TOKEN ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_TOKEN;

  if (!token) {
    console.log("Configuración faltante para Vercel Blob:");
    console.log(
      "  - Define una de estas variables de entorno: VERCEL_BLOB_TOKEN, BLOB_READ_WRITE_TOKEN o BLOB_TOKEN"
    );
    console.log(
      "  - En Vercel: Project Settings > Environment Variables > Add (scope: Preview y Production)."
    );
    fail("No se detectó token de Vercel Blob.");
  }

  const list = readLines(UPLOAD_LIST_PATH);
  const mapRaw = fs.readFileSync(MAP_PATH, "utf8");
  let map;
  try {
    map = JSON.parse(mapRaw);
  } catch (err) {
    fail(`video-url-map.json no es un JSON válido: ${err.message}`);
  }

  ensureMapHasKeys(map, list);

  const report = [];
  let updatedAny = false;

  for (const localPath of list) {
    const absolutePath = path.join(PROJECT_ROOT, localPath);
    if (!fs.existsSync(absolutePath)) {
      const entry = {
        localPath,
        fileName: path.basename(localPath),
        size: null,
        url: null,
        status: "failed",
        error: "Archivo no encontrado",
      };
      report.push(entry);
      console.error(`✗ ${localPath} no encontrado`);
      continue;
    }

    const stat = fs.statSync(absolutePath);
    const fileName = path.basename(localPath);
    const fileSize = stat.size;

    try {
      const stream = fs.createReadStream(absolutePath);
      const result = await put(fileName, stream, {
        access: "public",
        token,
      });

      if (!result || !result.url) {
        throw new Error("Respuesta de Vercel Blob sin URL.");
      }

      map[localPath] = result.url;
      updatedAny = true;
      report.push({
        localPath,
        fileName,
        size: formatBytes(fileSize),
        url: result.url,
        status: "uploaded",
      });
      console.log(`✓ ${localPath} -> ${result.url}`);
    } catch (error) {
      report.push({
        localPath,
        fileName,
        size: formatBytes(fileSize),
        url: null,
        status: "failed",
        error: error?.message || String(error),
      });
      console.error(`✗ ${localPath} (${error?.message || error})`);
    }
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalVideos: list.length,
        uploads: report,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const pendingRemaining = Object.values(map).some((url) =>
    typeof url === "string" && url.includes(PENDING_TOKEN)
  );

  if (updatedAny && !pendingRemaining) {
    console.log("No hay rutas pendientes en video-url-map.json; ejecutando reemplazo...");
    const replace = spawnSync("node", ["replace-video-urls.js"], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      shell: false,
    });

    if (replace.status !== 0) {
      fail("replace-video-urls.js terminó con error. Revisa la salida anterior.");
    }
    console.log(`Reemplazo ejecutado y reportado en index.html`);
  } else {
    console.log(
      "Aún quedan URLs pendientes en video-url-map.json, se omite replace-video-urls.js."
    );
  }

  const localRefs = list.filter((localPath) => {
    if (!fs.existsSync(HTML_PATH)) {
      return true;
    }
    return fs.readFileSync(HTML_PATH, "utf8").includes(`"${localPath}"`);
  }).length;

  const successUploads = report.filter((r) => r.status === "uploaded").length;
  const failedUploads = report.filter((r) => r.status === "failed").length;

  const summary = {
    totalVideos: report.length,
    successUploads,
    failedUploads,
    pendingUrlsInMap: pendingRemaining,
    localRefsRemaining: localRefs > 0,
  };

  console.log("Resumen:", JSON.stringify(summary, null, 2));

  if (failedUploads > 0) {
    fail(`Terminó con ${failedUploads} upload(s) fallido(s).`);
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
