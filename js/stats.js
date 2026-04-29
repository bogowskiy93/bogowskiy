// Считает геометрические характеристики OBJ-модели.
// polygons — количество исходных граней (могут быть quad/n-gon)
// triangles — количество треугольников после триангуляции
// vertices — количество уникальных вершин (v-строк)

const cache = new Map();

export async function getModelStats(modelConfig) {
  const v = modelConfig.version ? `?v=${modelConfig.version}` : '';
  const url = modelConfig.path + modelConfig.obj + v;
  if (cache.has(url)) return cache.get(url);

  const text = await fetch(url).then((r) => r.text());

  let polygons = 0;
  let triangles = 0;
  let vertices = 0;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      vertices++;
    } else if (line.startsWith('f ')) {
      const verts = line.split(/\s+/).length - 1;
      if (verts >= 3) {
        polygons++;
        triangles += verts - 2;
      }
    }
  }

  const stats = { polygons, triangles, vertices };
  cache.set(url, stats);
  return stats;
}

const fmt = new Intl.NumberFormat('ru-RU');
export const formatNumber = (n) => fmt.format(n);
