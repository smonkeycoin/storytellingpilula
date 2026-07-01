#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const cloudinary = require("cloudinary").v2;

const PROJECT_ROOT = process.cwd();
const UPLOAD_LIST_PATH = path.join(PROJECT_ROOT, "video-upload-list.txt");
const MAP_PATH = path.join(PROJECT_ROOT, "video-url-map.json");
const REPORT_PATH = path.join(PROJECT_ROOT, "video-upload-report.json");
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
    .filter(Boolean);
}

function formatBytes(size) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(size);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

function printEnvStatus() {
  const hasCredentials = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
  return hasCredentials;
}

async function main() {
  if (!printEnvStatus()) {
    console.log("Configuración necesaria:");
    console.log("  - CLOUDINARY_CLOUD_NAME");
    console.log("  - CLOUDINARY_API_KEY");
    console.log("  - CLOUDINARY_API_SECRET");
    fail("Faltan credenciales de Cloudinary.");
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const list = readLines(UPLOAD_LIST_PATH);
  const mapRaw = fs.readFileSync(MAP_PATH, "utf8");
  let map;
  try {
    map = JSON.parse(mapRaw);
  } catch (err) {
    fail(`video-url-map.json no es JSON válido: ${err.message}`);
  }

  const missing = list.filter((localPath) => !(localPath in map));
  if (missing.length > 0) {
    fail(`Faltan claves en video-url-map.json: ${missing.join(", ")}`);
  }

  const report = [];
  const successes = [];
  let hadFailure = false;

  for (const localPath of list) {
    const absolutePath = path.join(PROJECT_ROOT, localPath);
    const fileName = path.basename(localPath);
    const parsed = path.parse(fileName);
    const fileSize = fs.existsSync(absolutePath)
      ? fs.statSync(absolutePath).size
      : null;

    if (!fs.existsSync(absolutePath)) {
      console.error(`✗ ${localPath}: archivo no encontrado`);
      report.push({
        localPath,
        fileName,
        status: "failed",
        error: "Archivo no encontrado",
        sizeBytes: fileSize,
      });
      hadFailure = true;
      continue;
    }

    try {
      const result = await cloudinary.uploader.upload(absolutePath, {
        resource_type: "video",
        folder: "pilula/videos",
        public_id: parsed.name,
        use_filename: false,
        unique_filename: false,
        overwrite: true,
      });

      if (!result.secure_url) {
        throw new Error("Cloudinary no devolvió secure_url");
      }

      map[localPath] = result.secure_url;
      report.push({
        localPath,
        fileName,
        status: "uploaded",
        sizeBytes: fileSize,
        size: formatBytes(fileSize),
        secureUrl: result.secure_url,
      });
      successes.push({
        localPath,
        secureUrl: result.secure_url,
      });
      console.log(`✓ ${fileName} -> ${result.secure_url}`);
    } catch (error) {
      hadFailure = true;
      const message = error?.message || String(error);
      console.error(`✗ ${fileName}: ${message}`);
      report.push({
        localPath,
        fileName,
        status: "failed",
        sizeBytes: fileSize,
        size: fileSize != null ? formatBytes(fileSize) : null,
        error: message,
      });
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

  console.log(`\nReporte generado: ${REPORT_PATH}`);

  const pendingRemaining = Object.values(map).some((value) =>
    typeof value === "string" && value.includes(PENDING_TOKEN)
  );

  if (hadFailure) {
    fail("La subida terminó con errores. Revisa el reporte.");
  }

  if (!pendingRemaining) {
    console.log("No quedan URLs pendientes. Ejecutando replace-video-urls.js...");
    const replace = spawnSync("node", ["replace-video-urls.js"], {
      stdio: "inherit",
      cwd: PROJECT_ROOT,
    });
    if (replace.status !== 0) {
      fail("replace-video-urls.js finalizó con error.");
    }
    console.log("index.html actualizado desde video-url-map.json.");
  } else {
    console.log("Aún hay URLs pendientes; no se ejecutó reemplazo.");
  }

  if (successes.length > 0) {
    console.log("\nVideos subidos:");
    for (const item of successes) {
      console.log(`- ${item.localPath}: ${item.secureUrl}`);
    }
  }
}

main().catch((error) => {
  fail(error?.message || String(error));
});
