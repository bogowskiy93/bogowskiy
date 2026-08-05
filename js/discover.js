/**
 * Автоматически обнаруживает модели в папке models/.
 *
 * Как это работает:
 * 1. По умолчанию читает models/manifest1.json — только видимые модели.
 * 2. models/manifest2.json — полный список (в т.ч. hidden). Нужен для режима q1.
 * 3. Названия карточек: Model 1, Model 2… (у скрытых — их id).
 * 4. Если манифесты недоступны — автообнаружение папок models/.
 *
 * Скрыть модель: в manifest2.json поставь "hidden": true и убери её из manifest1.json
 * (или используй q1 / q2 в консоли).
 */

const MODELS_ROOT = 'models/';
export const MANIFEST1_URL = MODELS_ROOT + 'manifest1.json';
export const MANIFEST2_URL = MODELS_ROOT + 'manifest2.json';

export async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
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

export function applyAutoTitles(projects) {
  let visibleIndex = 0;
  return projects
    .filter((project) => project)
    .map((project) => {
      if (project.hidden === true) {
        return { ...project, title: project.id };
      }
      visibleIndex += 1;
      return { ...project, title: `Model ${visibleIndex}` };
    });
}

/** Строит проекты из массива манифеста */
export function buildFromManifest(manifest) {
  const projects = [];

  for (const item of manifest) {
    const path = `${MODELS_ROOT}${item.id}/`;
    projects.push({
      id:      item.id,
      hidden:  item.hidden === true,
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

/** Обычная загрузка сайта — manifest1, иначе manifest2, иначе сканирование папок. */
export async function discoverProjects() {
  // 1. manifest1.json — основной (только видимые)
  const m1 = await fetchJSON(MANIFEST1_URL);
  if (Array.isArray(m1) && m1.length) {
    const visible = m1.filter((item) => item && item.hidden !== true);
    return applyAutoTitles(buildFromManifest(visible));
  }

  // 2. manifest2.json — полный список, скрытые отфильтруем
  const m2 = await fetchJSON(MANIFEST2_URL);
  if (Array.isArray(m2) && m2.length) {
    return applyAutoTitles(buildFromManifest(m2));
  }

  // 3. Fallback — автообнаружение папок (локальный http.server)
  try {
    const rootHtml = await fetchText(MODELS_ROOT);
    const folders = parseFolders(rootHtml);
    if (folders.length > 0) {
      const results = await Promise.all(folders.map((folderName) => discoverFolder(folderName)));
      const valid = results.filter((p) => p && p.hidden !== true);
      if (valid.length > 0) return applyAutoTitles(valid);
    }
  } catch {
    // листинг не доступен
  }

  console.error(
    '[discover] Не удалось обнаружить модели. Нужен models/manifest1.json. Запусти start.bat.'
  );
  return [];
}

/** Полный список для режима q1 */
export async function discoverAllProjects() {
  const manifest = await fetchJSON(MANIFEST2_URL);
  if (Array.isArray(manifest)) {
    return applyAutoTitles(buildFromManifest(manifest));
  }
  console.error('[discover] Нет models/manifest2.json');
  return null;
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

  const previewFile = ['preview.jpg','preview.jpeg','preview.png','preview.webp'].find((p) => files.includes(p));

  const [meta, version] = await Promise.all([
    fetchJSON(path + 'meta.json'),
    computeFingerprint(path, fpFiles),
  ]);

  const m = meta || {};

  return {
    id:      folderName,
    hidden:  m.hidden === true,
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
