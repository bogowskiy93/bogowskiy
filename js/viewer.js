import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Viewer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ interactive?: boolean, fastPreview?: boolean }} opts
   *   interactive=false — без контролов, без resize observer
   *   fastPreview=true — только diffuse, без normal/spec и инверсий (для миниатюр)
   */
  constructor(canvas, { interactive = true, fastPreview = false, alpha = false } = {}) {
    this.canvas = canvas;
    this.interactive = interactive;
    this.fastPreview = fastPreview;
    this.alpha = alpha;
    this.currentObject = null;
    this.originalMaterials = [];
    this.mode = 'material';
    this.variants = [];      // массив THREE.Texture для разных расцветок
    this.currentVariant = 0;
    this._animId = null;
    this._init();
  }

  _init() {
    const { canvas, interactive } = this;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: this.alpha });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 600;
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.scene.background = this.alpha ? null : new THREE.Color(0x111111);

    // Environment (PBR reflections)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.001, 10000);
    this.camera.position.set(0, 0, 3);

    // 3-point lighting
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(5, 8, 6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-5, 2, -3);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(0, -5, -8);
    this.scene.add(rim);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    // Сохраняем источники для управления
    this._lights = { key, fill, rim, ambient };
    this.lightsEnabled = true;

    if (interactive) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.07;
      this.controls.screenSpacePanning = true;

      if (canvas.parentElement) {
        this._resizeObs = new ResizeObserver(() => this._resize());
        this._resizeObs.observe(canvas.parentElement);
      }

      this._animate();
    }
  }

  _resize() {
    const { canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _fitCamera(object, quarterView = false) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    object.position.sub(center);

    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.7;

    if (quarterView) {
      // 3/4 view from upper-right for previews
      this.camera.position.set(dist * 0.6, dist * 0.25, dist * 0.9);
    } else {
      this.camera.position.set(0, 0, dist);
    }

    this.camera.near = dist / 200;
    this.camera.far = dist * 200;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0, 0);

    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.minDistance = dist * 0.05;
      this.controls.maxDistance = dist * 20;
      this.controls.update();
    }
  }

  // ─── Применяем PBR-материалы поверх того что дал MTLLoader ───────
  // Возвращает Promise, который резолвится когда ВСЕ текстуры догружены.
  async _applyPBRTextures(object, textures, path, version) {
    if (!textures) return;

    const loader = new THREE.TextureLoader();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const v = version ? `?v=${version}` : '';

    const setupTex = (t, colorSpace = THREE.NoColorSpace) => {
      t.anisotropy = maxAniso;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.colorSpace = colorSpace;
    };

    const loadTexAsync = (filename, colorSpace = THREE.NoColorSpace) =>
      new Promise((resolve) => {
        loader.load(
          path + filename + v,
          (t) => { setupTex(t, colorSpace); resolve(t); },
          undefined,
          (err) => { console.warn('[Viewer] texture failed:', filename, err); resolve(null); }
        );
      });

    // Грузит изображение, инвертирует пиксели на canvas (spec → roughness).
    const loadInvertedTexAsync = (filename) =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < data.data.length; i += 4) {
            data.data[i]     = 255 - data.data[i];
            data.data[i + 1] = 255 - data.data[i + 1];
            data.data[i + 2] = 255 - data.data[i + 2];
          }
          ctx.putImageData(data, 0, 0);
          const tex = new THREE.CanvasTexture(c);
          setupTex(tex);
          tex.needsUpdate = true;
          resolve(tex);
        };
        img.onerror = (e) => { console.warn('[Viewer] inverted load failed:', filename, e); resolve(null); };
        img.src = path + filename + v;
      });

    // Список вариантов diffuse-карт. Поддержка legacy textures.map.
    const mapList = textures.maps || (textures.map ? [textures.map] : []);
    // Для превью грузим только первую, для интерактива — все
    const variantsToLoad = this.fastPreview ? mapList.slice(0, 1) : mapList;

    const [variantTexs, normalTex, roughnessTex, metalnessTex] = await Promise.all([
      Promise.all(variantsToLoad.map((f) => loadTexAsync(f, THREE.SRGBColorSpace))),
      this.fastPreview ? null : (textures.normalMap    ? loadTexAsync(textures.normalMap) : null),
      this.fastPreview ? null : (
        textures.specMap      ? loadInvertedTexAsync(textures.specMap)
        : textures.roughnessMap ? loadTexAsync(textures.roughnessMap)
        : null
      ),
      this.fastPreview ? null : (textures.metalnessMap ? loadTexAsync(textures.metalnessMap) : null),
    ]);

    this.variants = variantTexs.filter(Boolean);
    this.currentVariant = 0;
    const initialMap = this.variants[0] || null;

    // Сохраняем ссылки на все каналы — для режимов просмотра текстур
    this.channelTextures = {
      normal:   normalTex    || null,
      spec:     roughnessTex || null,  // spec/roughness
      uv:       this._getUVChecker(),
    };

    object.traverse((child) => {
      if (!child.isMesh) return;

      const oldMat = Array.isArray(child.material) ? child.material[0] : child.material;
      const mapTex = initialMap || oldMat?.map || null;

      child.material = new THREE.MeshStandardMaterial({
        map:          mapTex,
        normalMap:    normalTex,
        normalScale:  new THREE.Vector2(1, 1),
        roughnessMap: roughnessTex,
        roughness:    roughnessTex ? 1.0 : 0.85,
        metalnessMap: metalnessTex,
        metalness:    metalnessTex ? 1.0 : 0.0,
        side:         THREE.DoubleSide,
        envMapIntensity: 0.35,
      });
    });
  }

  /** Генерирует UV-checker текстуру (шахматка с разметкой).
   *  Создаётся один раз и переиспользуется. */
  _getUVChecker() {
    if (this._uvCheckerTex) return this._uvCheckerTex;

    const SIZE = 512;
    const CELLS = 8;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    const cellPx = SIZE / CELLS;

    const colors = ['#e8e8e8', '#333333'];
    const accent = ['#e05a2b', '#4a90d9'];

    for (let row = 0; row < CELLS; row++) {
      for (let col = 0; col < CELLS; col++) {
        const idx = (row + col) % 2;
        ctx.fillStyle = colors[idx];
        ctx.fillRect(col * cellPx, row * cellPx, cellPx, cellPx);

        // Маленький кружок в центре ячейки
        ctx.fillStyle = accent[idx];
        ctx.beginPath();
        ctx.arc(col * cellPx + cellPx / 2, row * cellPx + cellPx / 2, cellPx * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Сетка линий
    ctx.strokeStyle = 'rgba(128,128,128,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= CELLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellPx, 0);
      ctx.lineTo(i * cellPx, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellPx);
      ctx.lineTo(SIZE, i * cellPx);
      ctx.stroke();
    }

    // Координаты (U, V) в каждой ячейке
    ctx.font = `bold ${Math.round(cellPx * 0.18)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let row = 0; row < CELLS; row++) {
      for (let col = 0; col < CELLS; col++) {
        const u = (col / CELLS).toFixed(1);
        const v = (1 - row / CELLS).toFixed(1);
        const idx = (row + col) % 2;
        ctx.fillStyle = accent[idx];
        ctx.fillText(`${u},${v}`, col * cellPx + cellPx / 2, row * cellPx + cellPx * 0.08);
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this._uvCheckerTex = tex;
    return tex;
  }

  /**
   * Устанавливает интенсивность освещения.
   * multiplier = 1 — дефолтные значения, 0 — полная тьма, 5 — максимум.
   */
  setLightIntensity(multiplier) {
    const m = Math.max(0, multiplier);
    const { key, fill, rim, ambient } = this._lights;
    key.intensity     = 2.0 * m;
    fill.intensity    = 0.6 * m;
    rim.intensity     = 0.8 * m;
    ambient.intensity = 0.3 * m;
    this.scene.environmentIntensity = 0.6 * m;
    this.lightsEnabled = m > 0;
  }

  /** Переключить активную diffuse-текстуру (расцветку) */
  setVariant(idx) {
    if (idx < 0 || idx >= this.variants.length) return;
    this.currentVariant = idx;
    this.setMode(this.mode); // переприменим материал с новой текстурой
  }

  /** Сколько расцветок у модели сейчас */
  getVariantCount() {
    return this.variants.length;
  }

  // ─── Загрузка модели ──────────────────────────────────────────────
  load(modelConfig, onProgress) {
    return new Promise((resolve, reject) => {
      const { path, obj, mtl, textures, version } = modelConfig;
      const v = version ? `?v=${version}` : '';

      this._clearObject();

      const onLoaded = async (object) => {
        try {
          await this._applyPBRTextures(object, textures, path, version);
        } catch (e) {
          console.warn('[Viewer] textures error:', e);
        }
        object.traverse((c) => { if (c.isMesh) c.material.side = THREE.DoubleSide; });
        this._fitCamera(object, !this.interactive);
        this.scene.add(object);
        this.currentObject = object;
        this._collectMaterials(object);
        this.setMode(this.mode);
        if (!this.interactive) this.renderer.render(this.scene, this.camera);
        resolve(object);
      };

      const loadOBJ = (materials) => {
        const loader = new OBJLoader();
        if (materials) { materials.preload(); loader.setMaterials(materials); }
        loader.setPath(path);
        loader.load(
          obj + v,
          onLoaded,
          (xhr) => { if (onProgress && xhr.total) onProgress(xhr.loaded / xhr.total); },
          (err) => { console.error('[Viewer] OBJ error:', err); reject(err); }
        );
      };

      if (mtl) {
        const mtlLoader = new MTLLoader();
        mtlLoader.setPath(path);
        mtlLoader.load(mtl + v, loadOBJ, undefined, () => {
          console.warn('[Viewer] MTL failed, fallback to no material');
          loadOBJ(null);
        });
      } else {
        loadOBJ(null);
      }
    });
  }

  _clearObject() {
    if (!this.currentObject) return;
    // Убираем все wireframe-оверлеи
    this._removeWireOverlays(this.currentObject);
    this.scene.remove(this.currentObject);
    this.currentObject.traverse((c) => {
      if (!c.isMesh) return;
      c.geometry.dispose();
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      mats.forEach((m) => m.dispose());
    });
    this.currentObject = null;
    this.originalMaterials = [];
  }

  _collectMaterials(object) {
    this.originalMaterials = [];
    object.traverse((child) => {
      if (!child.isMesh || child.userData.isWireOverlay) return;
      const mat = Array.isArray(child.material) ? child.material[0] : child.material;
      this.originalMaterials.push({ mesh: child, mat: mat.clone() });
    });
  }

  // ─── Режимы отображения ───────────────────────────────────────────
  setMode(mode) {
    this.mode = mode;
    if (!this.currentObject) return;

    this._removeWireOverlays(this.currentObject);

    const variantTex = this.variants[this.currentVariant] || null;

    this.currentObject.traverse((child) => {
      if (!child.isMesh || child.userData.isWireOverlay) return;
      const entry = this.originalMaterials.find((e) => e.mesh === child);
      if (!entry) return;

      if (mode === 'material') {
        const m = entry.mat.clone();
        if (variantTex) m.map = variantTex;
        m.needsUpdate = true;
        child.material = m;

      } else if (mode === 'wireframe') {
        // Тёмно-синяя подложка — чтобы форма читалась
        child.material = new THREE.MeshBasicMaterial({
          color: 0x0d1f30,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 2,
          polygonOffsetUnits: 2,
        });
        // Оранжевая сетка поверх подложки
        const wire = new THREE.Mesh(
          child.geometry,
          new THREE.MeshBasicMaterial({ color: 0xff6d35, wireframe: true })
        );
        wire.userData.isWireOverlay = true;
        child.add(wire);

      } else if (mode === 'combined') {
        const m = entry.mat.clone();
        if (variantTex) m.map = variantTex;
        m.polygonOffset = true;
        m.polygonOffsetFactor = 2;
        m.polygonOffsetUnits = 2;
        m.needsUpdate = true;
        child.material = m;
        // Тёмные линии — хорошо видны на любой расцветке одежды
        const wire = new THREE.Mesh(
          child.geometry,
          new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.55 })
        );
        wire.userData.isWireOverlay = true;
        child.add(wire);

      // ─── Каналы текстур (MeshBasicMaterial — без освещения) ───────
      } else if (mode === 'diffuse') {
        child.material = new THREE.MeshBasicMaterial({
          map:  variantTex,
          side: THREE.DoubleSide,
        });

      } else if (mode === 'normal') {
        child.material = new THREE.MeshBasicMaterial({
          map:  this.channelTextures?.normal || null,
          side: THREE.DoubleSide,
        });

      } else if (mode === 'spec') {
        child.material = new THREE.MeshBasicMaterial({
          map:  this.channelTextures?.spec || null,
          side: THREE.DoubleSide,
        });

      } else if (mode === 'uv') {
        child.material = new THREE.MeshBasicMaterial({
          map:  this.channelTextures?.uv || null,
          side: THREE.DoubleSide,
        });
      }
    });
  }

  _removeWireOverlays(object) {
    object.traverse((child) => {
      if (!child.isMesh || child.userData.isWireOverlay) return;
      const toRemove = child.children.filter((c) => c.userData && c.userData.isWireOverlay);
      toRemove.forEach((c) => {
        child.remove(c);
        c.material.dispose();
      });
    });
  }

  renderToDataURL(type = 'image/jpeg', quality = 0.88) {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type, quality);
  }

  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    if (this._resizeObs) this._resizeObs.disconnect();
    if (this.controls) this.controls.dispose();
    this._clearObject();
    this.renderer.dispose();
  }
}
