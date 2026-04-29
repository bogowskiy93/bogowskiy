/**
 * Автоматически обнаруживает модели в папке models/.
 *
 * Как это работает:
 * 1. Читает листинг директории models/ (python -m http.server отдаёт HTML с ссылками)
 * 2. Для каждой вложенной папки ищет .obj, .mtl, стандартные текстуры
 * 3. Название на сайте = имя папки (например папка "штаны" → "штаны")
 * 4. Год/заказчик/назначение берутся из meta.json (необязательный файл в папке модели)
 *
 * Формат meta.json (необязательный, кладётся в папку модели):
 * {
 *   "year": 2025,
 *   "client": "Студия X",
 *   "purpose": "Game-ready asset"
 * }
 *
 * Чтобы добавить новую модель: просто создай папку с нужным названием,
 * положи туда .obj и текстуры, обнови страницу — всё появится автоматически.
 */

const MODELS_ROOT = 'models/';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

/** Парсит HTML-листинг директории и возвращает имена папок */
function parseFolders(html) {
  const matches = [...html.matchAll(/href="([^".][^"/]*)\/"/g)];
  return matches.map((m) => m[1]).filter((name) => name !== '..').sort();
}

/** Парсит HTML-листинг директории и возвращает имена файлов */
function parseFiles(html) {
  const matches = [...html.matchAll(/href="([^"./][^"]*\.[^"]+)"/g)];
  return matches.map((m) => m[1]);
}

/** Короткий 32-битный хеш строки (djb2) */
function hash32(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Считает отпечаток папки: HEAD-запросы по всем файлам, конкатенация
 * Last-Modified / Content-Length, хеш. При изменении любого файла отпечаток меняется
 * → инвалидируются HTTP-кэш текстур (через ?v=) и локальный кэш превью.
 */
async function computeFingerprint(path, files) {
  const stamps = await Promise.all(
    files.map(async (f) => {
      try {
        const res = await fetch(path + f, { method: 'HEAD', cache: 'no-store' });
        const lm = res.headers.get('last-modified') || '';
        const cl = res.headers.get('content-length') || '';
        return `${f}:${lm}:${cl}`;
      } catch {
        return `${f}:?`;
      }
    })
  );
  return hash32(stamps.join('|'));
}

export async function discoverProjects() {
  // 1. Сначала пробуем HTTP-листинг (работает локально с python -m http.server)
  //    Это даёт полную автоматизацию: добавил папку — появилась на сайте.
  try {
    const rootHtml = await fetchText(MODELS_ROOT);
    const folders = parseFolders(rootHtml);
    if (folders.length > 0) {
      const results = await Promise.all(folders.map((folderName) => discoverFolder(folderName)));
      const valid = results.filter(Boolean);
      if (valid.length > 0) return valid;
    }
  } catch {
    // листинг не доступен (например, Netlify) — пойдём по manifest.json
  }

  // 2. Fallback — manifest.json (для статик-хостинга вроде Netlify, где нет листинга)
  const manifest = await fetchJSON(MODELS_ROOT + 'manifest.json');
  if (Array.isArray(manifest)) {
    return buildFromManifest(manifest);
  }

  console.error('[discover] Не удалось обнаружить модели. Запусти start.bat или сгенерируй models/manifest.json.');
  return [];
}

async function discoverFolder(folderName) {
  const path = `${MODELS_ROOT}${folderName}/`;

  let files = [];
  try {
    const html = await fetchText(path);
    files = parseFiles(html);
  } catch {
    return null;
  }

  const objFile = files.find((f) => f.toLowerCase().endsWith('.obj'));
  if (!objFile) return null;

  const mtlFile = files.find((f) => f.toLowerCase().endsWith('.mtl')) || null;

  // Все файлы вида base.png, base1.png, base2.png... — варианты расцветки
  const baseRegex = /^base(\d*)\.(png|jpg|jpeg|webp)$/i;
  const baseMaps = files
    .filter((f) => baseRegex.test(f))
    .sort((a, b) => {
      const na = a.match(baseRegex)[1];
      const nb = b.match(baseRegex)[1];
      return (na === '' ? 0 : +na) - (nb === '' ? 0 : +nb);
    });

  const textures = {};
  if (baseMaps.length)              textures.maps       = baseMaps;
  if (files.includes('normal.png')) textures.normalMap  = 'normal.png';
  if (files.includes('spec.png'))   textures.specMap    = 'spec.png';

  const fpFiles = [objFile, mtlFile, ...baseMaps, textures.normalMap, textures.specMap].filter(Boolean);

  // Готовое превью (если лежит файлом в папке)
  const previewFile = ['preview.jpg','preview.jpeg','preview.png','preview.webp'].find((p) => files.includes(p));

  // meta.json и fingerprint грузим параллельно
  const [meta, version] = await Promise.all([
    fetchJSON(path + 'meta.json'),
    computeFingerprint(path, fpFiles),
  ]);

  const m = meta || {};

  return {
    id:      folderName,
    title:   m.title   || folderName,
    year:    m.year    || new Date().getFullYear(),
    client:  m.client  || '—',
    purpose: m.purpose || 'Game-ready asset',
    preview: previewFile ? path + previewFile : null,
    model: {
      path,
      obj: objFile,
      mtl: mtlFile,
      textures: Object.keys(textures).length ? textures : undefined,
      version,
    },
  };
}

/** Если manifest.json есть — строим проекты из него (для production) */
async function buildFromManifest(manifest) {
  const projects = [];

  for (const item of manifest) {
    const path = `${MODELS_ROOT}${item.id}/`;
    projects.push({
      id:      item.id,
      title:   item.title || item.id,
      year:    item.year    || new Date().getFullYear(),
      client:  item.client  || '—',
      purpose: item.purpose || 'Game-ready asset',
      preview: item.preview ? `${path}${item.preview}` : null,
      model: {
        path,
        obj:  item.obj  || `${item.id}.obj`,
        mtl:  item.mtl  || `${item.id}.mtl`,
        textures: item.textures || {
          map: 'base.png',
          normalMap: 'normal.png',
          specMap: 'spec.png',
        },
      },
    });
  }

  return projects;
}
