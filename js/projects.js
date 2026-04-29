// Каталог проектов.
// Чтобы добавить новую модель:
// 1. Создай папку models/ИМЯ/ и положи туда .obj, .mtl, текстуры
// 2. Добавь объект в этот массив

export const projects = [
  {
    id: 'm1',
    title: 'Штаны',
    year: 2025,
    client: '—',
    purpose: 'Game-ready asset',
    preview: null, // заполнится автоматически
    model: {
      path: 'models/m1/',
      obj: 'm1.obj',
      mtl: 'm1.mtl',
      textures: {
        map: 'base.png',         // diffuse (цвет)
        normalMap: 'normal.png', // карта нормалей (рельеф)
        specMap: 'spec.png',     // specular из движка — авто-инвертится в roughness
        // Если карта изначально PBR-roughness, используй: roughnessMap: 'rough.png'
      },
    },
  },

  {
    id: 'm2',
    title: 'Куртка',
    year: 2025,
    client: '—',
    purpose: 'Game-ready asset',
    preview: null,
    model: {
      path: 'models/m2/',
      obj: 'm1.obj',
      mtl: 'm1.mtl',
      textures: { map: 'base.png', normalMap: 'normal.png', specMap: 'spec.png' },
    },
  },
  {
    id: 'm3',
    title: 'Толстовка',
    year: 2025,
    client: '—',
    purpose: 'Game-ready asset',
    preview: null,
    model: {
      path: 'models/m3/',
      obj: 'm1.obj',
      mtl: 'm1.mtl',
      textures: { map: 'base.png', normalMap: 'normal.png', specMap: 'spec.png' },
    },
  },
  {
    id: 'm4',
    title: 'Обувь',
    year: 2024,
    client: '—',
    purpose: 'Game-ready asset',
    preview: null,
    model: {
      path: 'models/m4/',
      obj: 'm1.obj',
      mtl: 'm1.mtl',
      textures: { map: 'base.png', normalMap: 'normal.png', specMap: 'spec.png' },
    },
  },
  {
    id: 'm5',
    title: 'Аксессуар',
    year: 2024,
    client: '—',
    purpose: 'Game-ready asset',
    preview: null,
    model: {
      path: 'models/m5/',
      obj: 'm1.obj',
      mtl: 'm1.mtl',
      textures: { map: 'base.png', normalMap: 'normal.png', specMap: 'spec.png' },
    },
  },
];
