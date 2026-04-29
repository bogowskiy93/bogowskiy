// Получает доминантный цвет текстуры (для кнопок-свотчей).
// Подход: даунсемплим картинку до 32×32, усредняем непрозрачные пиксели.

const cache = new Map();

export async function getDominantColor(url) {
  if (cache.has(url)) return cache.get(url);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const SZ = 32;
      const c = document.createElement('canvas');
      c.width = SZ;
      c.height = SZ;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SZ, SZ);

      try {
        const data = ctx.getImageData(0, 0, SZ, SZ).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 16) continue; // прозрачные пропускаем
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (count === 0) { resolve('#666'); return; }
        resolve(`rgb(${(r / count) | 0}, ${(g / count) | 0}, ${(b / count) | 0})`);
      } catch (err) {
        resolve('#666');
      }
    };
    img.onerror = () => resolve('#666');
    img.src = url;
  });

  cache.set(url, promise);
  return promise;
}
