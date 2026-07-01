# Flujo de migración de videos a CDN/servidor externo

Objetivo: mantener la landing en GitHub sin subir videos pesados, usando URLs externas y manteniendo los mismos nombres de archivo.

## Archivos incluidos en el flujo
- `video-upload-list.txt`
- `video-url-map.json`
- `replace-video-urls.js`
- `index.local-videos.backup.html`
- `large-video-report.txt`

## 1) Preparar upload
1. Revisar `video-upload-list.txt` (lista exacta de archivos usados en `index.html`).
2. Subir cada archivo a tu CDN/servidor:
   - Vercel Blob
   - Cloudflare R2
   - Bunny
   - S3
3. **Conservar exactamente el mismo nombre de archivo** al subir:
   - `hero-video.mp4`
   - `workshop-aula-video.mp4`
   - `testimonio-medico-01.mp4`
   - `testimonio-medico-02.mp4`
   - `testimonio-medico-03.mp4`
   - `testimonio-paciente-01.mp4`
   - `testimonio-paciente-02.mp4`

## 2) Completar map
1. Abrir `video-url-map.json`.
2. Reemplazar cada `PENDING_URL/...` con la URL pública final exacta para ese mismo nombre.
3. El nombre final debe quedar idéntico al local (solo cambia protocolo y dominio).

## 3) Aplicar reemplazo local
- Ejecutar:
  - `node replace-video-urls.js`
- El script:
  - valida que cada archivo local exista,
  - rechaza URLs que aún tengan `PENDING_URL`,
  - genera un backup adicional de `index.html` con timestamp,
  - reemplaza solo rutas de video en el HTML,
  - imprime cada reemplazo realizado.

## 3 bis) Flujo con Vercel Blob (si aún no tienes configuración)

1. Instalar dependencias (si no existen en tu entorno):
   - `npm init -y` (solo la primera vez)
   - `npm i @vercel/blob`

2. Crear token de Blob en Vercel:
   - Entrar a Vercel → **Storage** → **Blob** → **Create token** (o desde dashboard de proyecto)
   - Copiar token de acceso completo (`BLOB_READ_WRITE`).

3. Configurar variable de entorno:
   - En local:
     - `export BLOB_READ_WRITE_TOKEN="tu_token"`
   - En Vercel:
     - `Project Settings` → `Environment Variables`
     - Crear `BLOB_READ_WRITE_TOKEN` con el token
     - Scope: `Preview` + `Production`

4. Ejecutar script de subida:
   - `node upload-videos-to-blob.js`

El script:
- lee `video-upload-list.txt`
- sube los archivos a Blob con el mismo nombre
- actualiza `video-url-map.json` con URL públicas reales
- si todas las URLs quedan resueltas (sin `PENDING_URL`), ejecuta `node replace-video-urls.js`

## 4) Validación local
- `python3 -m http.server 8000`
- abrir `http://localhost:8000`
- verificar que los videos cargan desde URLs externas.

## 5) Subida a GitHub
- Hacer commit/subir cambios de:
  - `index.html`
  - `video-url-map.json`
  - `replace-video-urls.js`
  - `video-upload-list.txt`
  - `video-cdn-instructions.md`
  - `large-video-report.txt`
- NO subir los `.mp4` pesados al repo (si ya fueron externalizados).
