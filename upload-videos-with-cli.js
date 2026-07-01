#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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
    fail(`No se encontró ${path.basename(filePath)}.`);
  }
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function timestamp() {
  return new Date().toISOString();
}

function parseUrlFromBlobOutput(output) {
  const text = `${output || ""}`.trim();
  const urlMatch = text.match(/https?:\/\/[^\s"'`<>\]]+/);
  return urlMatch ? urlMatch[0] : null;
}

function runBlobPut(localPath, token, useOidc, storeId, oidcToken) {
  const args = ["blob", "put", localPath, "--public", "--yes"];

  if (token) {
    args.push("--rw-token", token);
  } else if (useOidc && storeId && oidcToken) {
    args.push("--oidc-token", oidcToken, "--store-id", storeId);
  }

  const result = spawnSync("vercel", args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    shell: false,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  return {
    code: result.status || 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

function ensureMapContainsAllKeys(map, keys) {
  const missing = keys.filter((key) => !(key in map));
  if (missing.length > 0) {
    fail(`Faltan claves en video-url-map.json: ${missing.join(", ")}`);
  }
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN || process.env.RW_TOKEN;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  const storeId = process.env.BLOB_STORE_ID;
  const useOidc = !!(oidcToken && storeId);

  if (!token && !useOidc) {
    console.log("Estado de credenciales:");
    console.log("  - No se detectó BLOB_READ_WRITE_TOKEN.");
    console.log("  - No se detectó VERCEL_OIDC_TOKEN + BLOB_STORE_ID para modo OIDC.");
    fail(
      "No hay credenciales de Blob disponibles. Define BLOB_READ_WRITE_TOKEN o VERCEL_OIDC_TOKEN/BLOB_STORE_ID."
    );
  }

  const list = readLines(UPLOAD_LIST_PATH);
  let map;
  try {
    map = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  } catch (err) {
    fail(`No se pudo leer video-url-map.json: ${err.message}`);
  }

  ensureMapContainsAllKeys(map, list);

  const report = [];
  let changed = false;

  for (const localPath of list) {
    const absolutePath = path.join(PROJECT_ROOT, localPath);
    if (!fileExists(absolutePath)) {
      const entry = {
        localPath,
        fileName: path.basename(localPath),
        status: "failed",
        error: "Archivo no encontrado",
      };
      report.push(entry);
      console.error(`✗ ${localPath}: no se encontró el archivo`);
      continue;
    }

    const stat = fs.statSync(absolutePath);
    const sizeBytes = stat.size;

    const run = runBlobPut(localPath, token, useOidc, storeId, oidcToken);
    if (run.code !== 0) {
      const entry = {
        localPath,
        fileName: path.basename(localPath),
        sizeBytes,
        status: "failed",
        code: run.code,
        error: run.stderr || run.stdout || "Error sin mensaje",
      };
      report.push(entry);
      console.error(`✗ ${localPath}: ${entry.error}`);
      continue;
    }

    const url = parseUrlFromBlobOutput(run.stdout);
    if (!url) {
      const entry = {
        localPath,
        fileName: path.basename(localPath),
        sizeBytes,
        status: "failed",
        error: `No se detectó URL en la salida de ` +
          "`vercel blob put`.",
      };
      report.push(entry);
      console.error(`✗ ${localPath}: ${entry.error}`);
      continue;
    }

    map[localPath] = url;
    changed = true;
    report.push({
      localPath,
      fileName: path.basename(localPath),
      sizeBytes,
      url,
      status: "uploaded",
    });
    console.log(`✓ ${localPath} -> ${url}`);
  }

  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + "\n", "utf8");

  const pending = Object.values(map).some(
    (value) => typeof value === "string" && value.includes(PENDING_TOKEN)
  );
  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: timestamp(),
        totalVideos: list.length,
        uploads: report,
        pendingUrls: pending,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  if (!pending && changed) {
    console.log("URL listas. Ejecutando node replace-video-urls.js...");
    const replace = spawnSync("node", ["replace-video-urls.js"], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      shell: false,
    });
    if (replace.status !== 0) {
      fail("replace-video-urls.js terminó con error.");
    }
    console.log("Reemplazo ejecutado y completado.");
  } else if (changed) {
    console.log(
      "Hay URLs pendientes en video-url-map.json; no se ejecutó reemplazo automático."
    );
  } else {
    console.log("No hubo cambios en video-url-map.json.");
  }
}

main();
