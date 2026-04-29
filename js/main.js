import { discoverProjects } from './discover.js';
import { Viewer } from './viewer.js';
import { generatePreview, releaseSharedViewer } from './preview.js';
import { getModelStats, formatNumber } from './stats.js';
import { getDominantColor } from './swatches.js';

// ─── Typewriter для HTML со тегами <b> ───────────────────────────
// Парсит html вида "<b>12345</b> трис · <b>678</b> поли" на сегменты,
// затем печатает посимвольно с задержкой ms. Если вызвать повторно
// до завершения — предыдущий набор прерывается через токен.
let _twToken = 0;
function typewriterHTML(el, html, ms = 20, delay = 0) {
  const token = ++_twToken;

  // Разбиваем на сегменты: { text, bold }
  const segments = [];
  const re = /<b>(.*?)<\/b>|([^<]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== undefined) segments.push({ text: m[1], bold: true });
    else if (m[2])          segments.push({ text: m[2], bold: false });
  }

  // Собираем плоский массив символов с флагом bold
  const chars = [];
  for (const seg of segments) {
    for (const ch of seg.text) chars.push({ ch, bold: seg.bold });
  }

  el.innerHTML = '';
  let i = 0;

  const tick = () => {
    if (token !== _twToken) return; // прерван новым вызовом
    if (i >= chars.length) return;

    const { ch, bold } = chars[i++];
    if (bold) {
      // Дополняем последний <b> или создаём новый
      let last = el.lastChild;
      if (!last || last.nodeName !== 'B') {
        last = document.createElement('b');
        el.appendChild(last);
      }
      last.textContent += ch;
    } else {
      // Текстовый узел в конце
      let last = el.lastChild;
      if (!last || last.nodeType !== Node.TEXT_NODE) {
        last = document.createTextNode('');
        el.appendChild(last);
      }
      last.textContent += ch;
    }

    setTimeout(tick, ms);
  };

  setTimeout(tick, delay);
}

// ─── Splash ───────────────────────────────────────────────────────
const splashEl     = document.getElementById('splash');
const splashFill   = document.getElementById('splash-fill');
const splashStatus = document.getElementById('splash-status');

function setSplashProgress(loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  splashFill.style.width = pct + '%';
  splashStatus.textContent = total > 0
    ? `Загрузка превью ${loaded} / ${total}`
    : 'Загрузка...';
}

function hideSplash() {
  splashStatus.textContent = 'Готово';
  splashFill.style.width = '100%';
  setTimeout(() => splashEl.classList.add('hidden'), 400);
}

// ─── Инициализация после обнаружения моделей ─────────────────────
const PER_PAGE  = 6;
const worksRow  = document.getElementById('works-row');
const pagesList = document.getElementById('pages-list');

let projects = [];
const cardImages = [];
let currentPage  = 0;

// Failsafe: если что-то пошло не так на хостинге — сплэш не должен висеть вечно.
const SPLASH_FAILSAFE_MS = 20000;
const splashFailsafe = setTimeout(() => {
  if (!splashEl.classList.contains('hidden')) {
    splashStatus.textContent = 'Долго грузится… открываю сайт без превью';
    hideSplash();
  }
}, SPLASH_FAILSAFE_MS);

discoverProjects()
  .then((discovered) => {
    projects = discovered;
    setSplashProgress(0, projects.length);
    projects.forEach((project, idx) => buildCard(project, idx));
    buildPagesList();
    showPage(0, true);
    return loadPreviews();
  })
  .catch((err) => {
    console.error('[main] init error:', err);
    splashStatus.textContent = 'Ошибка загрузки';
    hideSplash();
  })
  .finally(() => {
    clearTimeout(splashFailsafe);
  });

function buildCard(project, idx) {
  const card = document.createElement('div');
  card.className = 'work-card';
  card.style.display = 'none'; // показываем только нужные в showPage()
  // Анимация появления играет каждый раз, когда добавляем класс .entering
  card.addEventListener('animationend', () => card.classList.remove('entering'));

  // Thumbnail
  const thumb = document.createElement('div');
  thumb.className = 'work-thumb';

  const spinner = document.createElement('div');
  spinner.className = 'thumb-spinner';
  thumb.appendChild(spinner);

  const img = document.createElement('img');
  img.alt = project.title;
  img.style.display = 'none';
  img.onload = () => {
    spinner.style.display = 'none';
    img.style.display = 'block';
  };
  thumb.appendChild(img);

  cardImages.push({ img, spinner });

  // Info
  const info = document.createElement('div');
  info.className = 'work-info';
  info.innerHTML = `
    <span class="work-title">${project.title}</span>
    <span class="work-year">${project.year}</span>
  `;

  card.appendChild(thumb);
  card.appendChild(info);
  if (project.model) card.addEventListener('click', () => openModal(idx));
  worksRow.appendChild(card);
}

// ─── Пагинация: список страниц справа ────────────────────────────
function buildPagesList() {
  const totalPages = Math.max(1, Math.ceil(projects.length / PER_PAGE));
  pagesList.innerHTML = '';

  if (totalPages <= 1) {
    pagesList.style.display = 'none';
    return;
  }
  pagesList.style.display = '';

  for (let i = 0; i < totalPages; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'page-btn';
    btn.textContent = String(i + 1).padStart(2, '0');
    btn.addEventListener('click', () => {
      if (i !== currentPage) showPage(i);
    });
    pagesList.appendChild(btn);
  }
}

function showPage(pageIdx, isInitial = false) {
  currentPage = pageIdx;
  const start = pageIdx * PER_PAGE;
  const end   = start + PER_PAGE;
  const baseDelay = isInitial ? 200 : 60;

  worksRow.querySelectorAll('.work-card').forEach((card, idx) => {
    if (idx >= start && idx < end) {
      const order = idx - start;
      card.style.display = '';
      card.style.setProperty('--enter-delay', `${baseDelay + order * 80}ms`);
      card.classList.remove('entering');
      void card.offsetWidth; // форсим reflow, чтобы анимация перезапустилась
      card.classList.add('entering');
    } else {
      card.classList.remove('entering');
      card.style.display = 'none';
    }
  });

  pagesList.querySelectorAll('.page-btn').forEach((b, i) => {
    b.classList.toggle('active', i === pageIdx);
  });
}

async function loadPreviews() {
  // Внутренний фейлсейф: если генерация превью зависла — скрываем сплэш всё равно.
  const previewFailsafe = setTimeout(() => {
    if (!splashEl.classList.contains('hidden')) {
      splashStatus.textContent = 'Превью грузятся слишком долго…';
      hideSplash();
    }
  }, 25000);

  let loaded = 0;
  const total = projects.length;

  // Сначала всё, что имеет готовый файл превью — грузим мгновенно как картинку
  const needGenerate = [];
  for (let i = 0; i < total; i++) {
    if (!projects[i].model) {
      cardImages[i].spinner.style.display = 'none';
      loaded++;
      setSplashProgress(loaded, total);
      continue;
    }
    if (projects[i].preview) {
      cardImages[i].img.src = projects[i].preview;
      loaded++;
      setSplashProgress(loaded, total);
      continue;
    }
    needGenerate.push(i);
  }

  // Остальное генерим в браузере. Параллельно по 2.
  const CONCURRENCY = 2;
  let cursor = 0;
  const worker = async () => {
    while (cursor < needGenerate.length) {
      const i = needGenerate[cursor++];
      try {
        const dataURL = await generatePreview(projects[i]);
        cardImages[i].img.src = dataURL;
      } catch (err) {
        console.warn(`[preview] failed for ${projects[i].id}:`, err);
        cardImages[i].spinner.style.display = 'none';
      }
      loaded++;
      setSplashProgress(loaded, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  releaseSharedViewer();
  hideSplash();

  clearTimeout(previewFailsafe);
}

// ─── Экспорт превью в файлы (для разовой подготовки) ─────────────
// Запусти в консоли: exportPreviews() — после генерации скачает все JPG.
// Положи их в папки моделей как preview.jpg, перегенерируй manifest —
// сайт будет грузить превью мгновенно.
window.exportPreviews = async function () {
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    if (!p.model) continue;
    const src = cardImages[i].img.src;
    if (!src || !src.startsWith('data:')) {
      console.warn(`[exportPreviews] нет данных для ${p.id} — открой страницу до конца`);
      continue;
    }
    const a = document.createElement('a');
    a.href = src;
    a.download = `${p.id}_preview.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('[exportPreviews] готово. Переименуй файлы в preview.jpg и положи в папки моделей.');
};

// ─── Вьюер ────────────────────────────────────────────────────────
let viewer = null;
let currentIdx = -1;

const modal      = document.getElementById('modal');
const loaderEl   = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const canvas     = document.getElementById('viewer-canvas');

function ensureViewer() {
  // alpha:true → canvas прозрачный, фон берётся из CSS .canvas-wrap (зависит от темы)
  if (!viewer) viewer = new Viewer(canvas, { interactive: true, alpha: true });
}

// ─── Открыть модалку ──────────────────────────────────────────────
async function openModal(idx) {
  const project = projects[idx];
  const isSwap = modal.classList.contains('open'); // уже открыта — значит это переключение
  const modalBox = modal.querySelector('.modal-box');
  currentIdx = idx;

  // Плавная подмена контента при переходе пред/след
  if (isSwap) modalBox.classList.add('swapping');

  document.getElementById('modal-title').textContent   = project.title;
  document.getElementById('modal-year').textContent    = project.year;
  document.getElementById('modal-client').textContent  = project.client;
  document.getElementById('modal-purpose').textContent = project.purpose;

  // Статы модели — фоном, с typewriter-эффектом при появлении
  const statsEl = document.getElementById('viewer-stats');
  statsEl.textContent = '';
  getModelStats(project.model).then((s) => {
    const html = `<b>${formatNumber(s.triangles)}</b> трис · <b>${formatNumber(s.polygons)}</b> поли · <b>${formatNumber(s.vertices)}</b> верш.`;
    typewriterHTML(statsEl, html, 18, isSwap ? 0 : 380);
  }).catch(() => { statsEl.textContent = '—'; });

  // Кнопки-свотчи расцветок
  buildVariantSwatches(project);

  const prevBtn = document.getElementById('modal-prev');
  const nextBtn = document.getElementById('modal-next');
  prevBtn.classList.toggle('hidden', idx <= 0);
  nextBtn.classList.toggle('hidden', idx >= projects.length - 1);

  modal.classList.add('open');
  modal.removeAttribute('aria-hidden');

  loaderEl.classList.remove('hidden');
  loaderText.textContent = 'Загрузка...';

  ensureViewer();

  // Сброс режима
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  document.querySelector('.mode-btn[data-mode="material"]').classList.add('active');
  viewer.mode = 'material';

  // Кнопки каналов — disable пока модель не загружена
  setChannelButtonsState(project.model, false);

  // Сброс освещения при открытии новой модели
  if (viewer) viewer.setLightIntensity(1);

  try {
    await viewer.load(project.model, (p) => {
      loaderText.textContent = `Загрузка... ${Math.round(p * 100)}%`;
    });
    loaderEl.classList.add('hidden');
    // Активируем кнопки каналов в зависимости от наличия текстур
    setChannelButtonsState(project.model, true);
  } catch (err) {
    loaderText.textContent = 'Ошибка загрузки';
    console.error('[main] load error:', err);
  } finally {
    // Снимаем класс с небольшой задержкой — чтобы fade-in совпал по фазе с появлением модели
    if (isSwap) {
      requestAnimationFrame(() => modalBox.classList.remove('swapping'));
    }
  }
}

// ─── Активация/блокировка кнопок каналов ──────────────────────────
function setChannelButtonsState(modelConfig, loaded) {
  const tex = modelConfig?.textures || {};
  const hasDiffuse = !!(tex.maps?.length || tex.map);
  const hasNormal  = !!tex.normalMap;
  const hasSpec    = !!(tex.specMap || tex.roughnessMap);
  // UV-checker генерируется всегда
  const hasUV      = true;

  const rules = { diffuse: hasDiffuse, normal: hasNormal, spec: hasSpec };

  document.querySelectorAll('.channel-btn').forEach((btn) => {
    const mode = btn.dataset.mode;
    const available = loaded && (rules[mode] ?? true);
    btn.disabled = !available;
    btn.title = available ? '' : (loaded ? 'Карта не доступна для этой модели' : 'Загрузка...');
  });
}

// ─── Лайтбокс текстуры ────────────────────────────────────────────
const texLightbox = document.getElementById('tex-lightbox');
const texLbCanvas = document.getElementById('tex-lb-canvas');
const texLbWrap   = document.getElementById('tex-lb-img-wrap');
const texLbInfo   = document.getElementById('tex-lb-info');
const texLbChan   = document.getElementById('tex-lb-channel');

const CHANNEL_LABELS = {
  diffuse: 'Diffuse',
  normal:  'Normal Map',
  spec:    'Spec / Roughness',
};

// Очистка canvas
function clearTexCanvas() {
  const ctx = texLbCanvas.getContext('2d');
  ctx.clearRect(0, 0, texLbCanvas.width, texLbCanvas.height);
  texLbCanvas.width = 0;
  texLbCanvas.height = 0;
}

function openTexLightbox(mode) {
  if (!viewer || !projects[currentIdx]) return;

  const model = projects[currentIdx].model;
  const tex   = model?.textures || {};
  const v     = model?.version ? `?v=${model.version}` : '';

  let src = null;

  if (mode === 'diffuse') {
    const maps = tex.maps || (tex.map ? [tex.map] : []);
    const file = maps[viewer.currentVariant] || maps[0];
    if (file) src = model.path + file + v;
  } else if (mode === 'normal' && tex.normalMap) {
    src = model.path + tex.normalMap + v;
  } else if (mode === 'spec') {
    const file = tex.specMap || tex.roughnessMap;
    if (file) src = model.path + file + v;
  }

  if (!src) return;

  texLbChan.textContent = CHANNEL_LABELS[mode] || mode;
  texLbInfo.textContent = '—';
  clearTexCanvas();

  // Грузим картинку в Image и тут же рисуем в canvas — никакого src в DOM,
  // правый клик «Сохранить» вернёт только canvas-снимок (без оригинального файла).
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    texLbInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    texLbCanvas.width  = img.naturalWidth;
    texLbCanvas.height = img.naturalHeight;
    const ctx = texLbCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
  };
  img.onerror = () => { texLbInfo.textContent = 'Ошибка загрузки'; };
  img.src = src;

  texLightbox.classList.add('open');
  texLightbox.removeAttribute('aria-hidden');
}

function closeTexLightbox() {
  texLightbox.classList.remove('open');
  texLightbox.setAttribute('aria-hidden', 'true');
  clearTexCanvas();
}

document.getElementById('tex-lb-close').addEventListener('click', closeTexLightbox);
texLightbox.addEventListener('click', (e) => { if (e.target === texLightbox) closeTexLightbox(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && texLightbox.classList.contains('open')) closeTexLightbox();
  // Блокируем Ctrl+S / Cmd+S пока открыт лайтбокс
  if (texLightbox.classList.contains('open') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
  }
});

// Защита от скачивания: блокируем правый клик и drag внутри лайтбокса
['contextmenu', 'dragstart', 'selectstart'].forEach((evt) => {
  texLightbox.addEventListener(evt, (e) => e.preventDefault());
});

// ─── Свотчи расцветок ─────────────────────────────────────────────
async function buildVariantSwatches(project) {
  const row  = document.getElementById('modal-variants-row');
  const list = document.getElementById('modal-variants');
  list.innerHTML = '';

  const maps = project.model?.textures?.maps || [];
  if (maps.length < 2) {
    row.classList.add('hidden');
    return;
  }
  row.classList.remove('hidden');

  const v = project.model.version ? `?v=${project.model.version}` : '';

  // Сначала рисуем кружки-плейсхолдеры (серые), потом подкрашиваем
  const buttons = maps.map((file, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    if (i === 0) btn.classList.add('active');
    btn.title = file;
    btn.style.background = '#444';
    btn.addEventListener('click', () => {
      if (!viewer) return;
      list.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      // В режимах каналов без цвета (normal/spec/uv/wireframe) — переключаем на diffuse
      const channelOnlyModes = ['normal', 'spec', 'uv', 'wireframe'];
      if (channelOnlyModes.includes(viewer.mode)) {
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
        document.querySelector('.mode-btn[data-mode="diffuse"]').classList.add('active');
        viewer.mode = 'diffuse';
      }
      viewer.setVariant(i);
    });
    list.appendChild(btn);
    return btn;
  });

  // Анимация появления: первый «надувается», остальные выкатываются из-под него
  // Шаг = 24px (ширина) + 8px (gap) = 32px на один кружок
  const STEP = 32; // px
  const BASE_DELAY = 100; // мс между кружками

  buttons.forEach((btn, i) => {
    if (i === 0) {
      btn.style.animationDelay = '0ms';
      btn.classList.add('anim-first');
    } else {
      // CSS-переменная: смещение назад к позиции первого кружка
      btn.style.setProperty('--sw-offset', `${-(i * STEP)}px`);
      btn.style.animationDelay = `${i * BASE_DELAY}ms`;
      btn.classList.add('anim-roll');
    }
  });

  // Подгружаем доминантные цвета для каждого варианта параллельно
  maps.forEach((file, i) => {
    getDominantColor(project.model.path + file + v).then((color) => {
      buttons[i].style.background = color;
    });
  });
}

// ─── Закрыть ──────────────────────────────────────────────────────
function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

document.getElementById('modal-close').addEventListener('click', closeModal);

modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (!modal.classList.contains('open')) return;
  if (e.key === 'ArrowLeft'  && currentIdx > 0)                    openModal(currentIdx - 1);
  if (e.key === 'ArrowRight' && currentIdx < projects.length - 1)  openModal(currentIdx + 1);
});

document.getElementById('modal-prev').addEventListener('click', () => {
  if (currentIdx > 0) openModal(currentIdx - 1);
});

document.getElementById('modal-next').addEventListener('click', () => {
  if (currentIdx < projects.length - 1) openModal(currentIdx + 1);
});

// ─── Режимы ───────────────────────────────────────────────────────
const CHANNEL_MODES = new Set(['diffuse', 'normal', 'spec']);

document.querySelectorAll('.mode-btn:not(.channel-btn):not(.light-btn)').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn:not(.channel-btn):not(.light-btn)').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    if (viewer) viewer.setMode(btn.dataset.mode);
  });
});

// Кнопки каналов — только лайтбокс, модель не трогаем
document.querySelectorAll('.channel-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (CHANNEL_MODES.has(btn.dataset.mode)) openTexLightbox(btn.dataset.mode);
  });
});

