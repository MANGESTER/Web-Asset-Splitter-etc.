'use strict';

/* =========================================================
   Sprite Splitter
   Bagian: Konfigurasi · State · Helper · Memuat gambar ·
           Hapus warna latar · Tampilan · Memotong · Hasil ·
           Ekspor · Animasi · Event
   ========================================================= */


/* ---------- Konfigurasi ---------- */

const MAX_BOXES = 2500;        // batas jumlah potongan agar halaman tidak membeku
const MAX_COMPONENTS = 5000;   // batas objek pada mode otomatis
const MSG_EMPTY = 'Belum ada hasil. Unggah gambar lalu klik “Potong sekarang”.';
const MSG_NONE = 'Tidak ada aset yang terdeteksi. Coba ubah pengaturan.';
const MSG_TOO_MANY = 'Terlalu banyak potongan (lebih dari 2.500). ' +
  'Perbesar ukuran sel, atau naikkan ambang alpha / jarak gabung.';


/* ---------- State ---------- */

const state = {
  source: null,        // canvas gambar asli
  work: null,          // canvas gambar kerja (setelah latar dihapus)
  boxes: [],           // daftar potongan {x, y, w, h, name, selected}
  zoom: 1,
  mode: 'grid',        // 'grid' | 'auto'
  eyedropper: false,
  bgColor: null,       // [r, g, b] atau null
  fileName: 'sprite',
  frames: [],          // potongan terpilih untuk animasi
  frameIndex: 0,
  playing: true,
  lastTick: 0,
};


/* ---------- Helper ---------- */

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

/** Konteks 2D untuk kanvas yang sering dibaca pikselnya (lebih cepat di browser). */
function readCtx(c) {
  return c.getContext('2d', { willReadFrequently: true });
}

function createCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function canvasToBlob(c) {
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name) {
  return (name || 'sprite').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').trim() || 'sprite';
}

function setHidden(id, hidden) {
  $(id).hidden = hidden;
}


/* ---------- Memuat gambar ---------- */

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;

  state.fileName = file.name.replace(/\.[^.]+$/, '') || 'sprite';
  $('namePrefix').value = state.fileName;

  const img = new Image();
  const url = URL.createObjectURL(file);

  img.onload = () => {
    state.source = createCanvas(img.naturalWidth, img.naturalHeight);
    readCtx(state.source).drawImage(img, 0, 0);
    state.work = createCanvas(img.naturalWidth, img.naturalHeight);
    state.bgColor = null;
    state.boxes = [];
    URL.revokeObjectURL(url);

    setHidden('btnResetBg', true);
    setHidden('dropzone', true);
    setHidden('viewer', false);
    ['btnSplit', 'btnEyedropper', 'btnCleanSheet'].forEach((id) => {
      $(id).disabled = false;
    });

    applyBackgroundRemoval();
    fitZoom();
    renderResults();

    $('imageInfo').textContent = `${state.source.width} × ${state.source.height} px` +
      (hasTransparency() ? '' : ' · tanpa transparansi, coba “Hapus warna latar”');
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert('Gagal membaca gambar. Gunakan format PNG, JPG, GIF, atau WebP.');
  };

  img.src = url;
}

function hasTransparency() {
  const { width, height } = state.source;
  const data = readCtx(state.source).getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}


/* ---------- Hapus warna latar ---------- */

function applyBackgroundRemoval() {
  const { work, source, bgColor } = state;
  const workCtx = readCtx(work);

  workCtx.clearRect(0, 0, work.width, work.height);
  workCtx.drawImage(source, 0, 0);
  if (!bgColor) return;

  const image = workCtx.getImageData(0, 0, work.width, work.height);
  const data = image.data;
  const tolerance = Number($('tolerance').value);
  const [r, g, b] = bgColor;

  for (let i = 0; i < data.length; i += 4) {
    const match =
      Math.abs(data[i] - r) <= tolerance &&
      Math.abs(data[i + 1] - g) <= tolerance &&
      Math.abs(data[i + 2] - b) <= tolerance;
    if (match) data[i + 3] = 0;
  }
  workCtx.putImageData(image, 0, 0);
}

function pickBackgroundColor(x, y) {
  const { source } = state;
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;

  const [r, g, b, a] = readCtx(source).getImageData(x, y, 1, 1).data;
  if (a === 0) return; // piksel sudah transparan, bukan warna latar
  state.bgColor = [r, g, b];
  setEyedropper(false);
  setHidden('btnResetBg', false);
  applyBackgroundRemoval();
  drawPreview();
}

function setEyedropper(on) {
  state.eyedropper = on;
  $('btnEyedropper').textContent = on ? 'Klik warna di gambar…' : '🎯 Pilih warna latar';
  canvas.style.cursor = on ? 'crosshair' : 'default';
}


/* ---------- Tampilan pratinjau ---------- */

function fitZoom() {
  const stageWidth = Math.max(100, $('stage').clientWidth - 4);
  const maxHeight = window.innerHeight * 0.6;
  setZoom(Math.min(8, stageWidth / state.source.width, maxHeight / state.source.height));
}

function setZoom(value) {
  state.zoom = Math.max(0.1, Math.min(32, value));
  canvas.style.width = `${state.source.width * state.zoom}px`;
  canvas.style.height = `${state.source.height * state.zoom}px`;
  $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  drawPreview();
}

function drawPreview() {
  const { work, boxes, zoom } = state;
  if (!work) return;

  if (canvas.width !== work.width || canvas.height !== work.height) {
    canvas.width = work.width;
    canvas.height = work.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(work, 0, 0);

  const lineWidth = Math.max(1, 1.5 / zoom);
  ctx.lineWidth = lineWidth;

  boxes.forEach((box) => {
    ctx.strokeStyle = box.selected ? '#16a34a' : '#ef4444';
    ctx.fillStyle = box.selected ? 'rgba(22, 163, 74, 0.18)' : 'rgba(239, 68, 68, 0.10)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(
      box.x + lineWidth / 2,
      box.y + lineWidth / 2,
      box.w - lineWidth,
      box.h - lineWidth
    );
  });
}

function onCanvasClick(event) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / state.zoom);
  const y = Math.floor((event.clientY - rect.top) / state.zoom);

  if (state.eyedropper) {
    pickBackgroundColor(x, y);
    return;
  }

  // Cari dari belakang agar kotak paling atas yang terpilih
  for (let i = state.boxes.length - 1; i >= 0; i--) {
    const box = state.boxes[i];
    const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
    if (inside) {
      box.selected = !box.selected;
      renderResults();
      return;
    }
  }
}


/* ---------- Memotong: mode grid ---------- */

/** Mengembalikan daftar kotak, atau null jika jumlahnya melebihi batas. */
function getGridBoxes() {
  const { width, height } = state.work;
  const margin = Number($('margin').value);
  const gap = Number($('spacing').value);
  let cellW, cellH, cols, rows;

  if ($('gridMode').value === 'count') {
    cols = Math.max(1, Number($('cols').value));
    rows = Math.max(1, Number($('rows').value));
    cellW = Math.floor((width - 2 * margin - gap * (cols - 1)) / cols);
    cellH = Math.floor((height - 2 * margin - gap * (rows - 1)) / rows);
  } else {
    cellW = Math.max(1, Number($('cellW').value));
    cellH = Math.max(1, Number($('cellH').value));
    cols = Math.floor((width - 2 * margin + gap) / (cellW + gap));
    rows = Math.floor((height - 2 * margin + gap) / (cellH + gap));
  }

  if (!(cellW >= 1 && cellH >= 1 && cols >= 1 && rows >= 1)) return [];
  if (cols * rows > MAX_BOXES) return null;

  const boxes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      boxes.push({
        x: margin + c * (cellW + gap),
        y: margin + r * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return boxes;
}


/* ---------- Memotong: mode otomatis ---------- */

/** Mencari objek terpisah (8 arah) dengan flood fill. Null jika terlalu banyak. */
function findComponents(data, width, height, threshold) {
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  const found = [];

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[start * 4 + 3] <= threshold) continue;

    let top = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    stack[top++] = start;
    visited[start] = 1;

    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p / width) | 0;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const q = ny * width + nx;
          if (!visited[q] && data[q * 4 + 3] > threshold) {
            visited[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }

    found.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    if (found.length > MAX_COMPONENTS) return null;
  }
  return found;
}

function isNear(a, b, gap) {
  return (
    a.x - gap <= b.x + b.w && b.x - gap <= a.x + a.w &&
    a.y - gap <= b.y + b.h && b.y - gap <= a.y + a.h
  );
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Menggabungkan kotak yang saling berdekatan hingga tidak ada lagi yang bisa digabung. */
function mergeNearbyBoxes(boxes, gap) {
  const result = [...boxes];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (isNear(result[i], result[j], gap)) {
          result[i] = unionBox(result[i], result[j]);
          result.splice(j, 1);
          j--;
          changed = true;
        }
      }
    }
  }
  return result;
}

/** Mengurutkan seperti membaca: baris atas ke bawah, lalu kiri ke kanan. */
function sortReadingOrder(boxes) {
  const rows = [];

  [...boxes].sort((a, b) => a.y - b.y).forEach((box) => {
    const row = rows.find((r) => box.y < r.y + r.h * 0.6 && box.y + box.h > r.y);
    if (row) {
      row.items.push(box);
      row.y = Math.min(row.y, box.y);
    } else {
      rows.push({ y: box.y, h: box.h, items: [box] });
    }
  });

  return rows.flatMap((row) => row.items.sort((a, b) => a.x - b.x));
}

/** Mengembalikan daftar kotak, atau null jika terlalu banyak objek. */
function getAutoBoxes() {
  const { width, height } = state.work;
  const data = readCtx(state.work).getImageData(0, 0, width, height).data;
  const threshold = Number($('alphaThreshold').value);

  const components = findComponents(data, width, height, threshold);
  if (!components) return null;

  const minSize = Number($('minSize').value);
  const merged = mergeNearbyBoxes(components, Number($('mergeGap').value));
  const filtered = merged.filter((b) => b.w >= minSize && b.h >= minSize);
  return sortReadingOrder(filtered);
}


/* ---------- Memotong: proses utama ---------- */

/** Mencari batas piksel yang tidak transparan di dalam sebuah kotak. */
function getOpaqueBounds(box, threshold) {
  const data = readCtx(state.work).getImageData(box.x, box.y, box.w, box.h).data;
  let minX = box.w, minY = box.h, maxX = -1, maxY = -1;

  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      if (data[(y * box.w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // seluruh kotak transparan
  return { x: box.x + minX, y: box.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function splitSprites() {
  if (!state.work) return;

  const isGrid = state.mode === 'grid';
  const found = isGrid ? getGridBoxes() : getAutoBoxes();

  if (!found) {
    state.boxes = [];
    renderResults(MSG_TOO_MANY);
    return;
  }

  const trim = $('trimEmpty').checked;
  const skipEmpty = isGrid && $('skipEmpty').checked;
  const threshold = isGrid ? 0 : Number($('alphaThreshold').value);

  const boxes = found
    .map((box) => {
      if (!trim && !skipEmpty) return box;
      const bounds = getOpaqueBounds(box, threshold);
      if (!bounds) return skipEmpty ? null : box;
      return trim ? bounds : box;
    })
    .filter(Boolean);

  const prefix = $('namePrefix').value;
  const digits = Math.max(2, String(boxes.length).length);

  state.boxes = boxes.map((box, i) => ({
    ...box,
    selected: true,
    name: `${prefix}_${String(i + 1).padStart(digits, '0')}`,
  }));

  renderResults(MSG_NONE);
  $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


/* ---------- Daftar hasil ---------- */

function cropBox(box, scale) {
  const c = createCanvas(box.w * scale, box.h * scale);
  const cropCtx = c.getContext('2d');
  cropCtx.imageSmoothingEnabled = false;
  cropCtx.drawImage(state.work, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  return c;
}

function createAssetCard(box) {
  const card = document.createElement('div');
  card.className = 'asset' + (box.selected ? ' selected' : '');

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const preview = cropBox(box, 1);
  const fit = Math.floor(Math.min(100 / box.w, 76 / box.h));
  if (fit > 1) preview.style.width = `${box.w * fit}px`;
  thumb.appendChild(preview);
  thumb.onclick = () => {
    box.selected = !box.selected;
    renderResults();
  };

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = box.name;
  nameInput.oninput = () => { box.name = nameInput.value; };

  const meta = document.createElement('div');
  meta.className = 'asset-meta';

  const size = document.createElement('span');
  size.textContent = `${box.w}×${box.h}`;

  const button = document.createElement('button');
  button.textContent = '⬇ PNG';
  button.onclick = async () => {
    const blob = await canvasToBlob(cropBox(box, Number($('exportScale').value)));
    downloadBlob(`${safeName(box.name)}.png`, blob);
  };

  meta.append(size, button);
  card.append(thumb, nameInput, meta);
  return card;
}

/** Menggambar ulang pratinjau dan daftar hasil. */
function renderResults(emptyMessage = MSG_EMPTY) {
  const { boxes } = state;
  const selected = boxes.filter((b) => b.selected);

  drawPreview();

  const list = $('assetList');
  list.replaceChildren(...boxes.map(createAssetCard));

  $('resultCount').textContent = boxes.length;
  $('selectedCount').textContent = selected.length;
  $('emptyMessage').textContent = emptyMessage;
  setHidden('emptyMessage', boxes.length > 0);

  $('btnZip').disabled = selected.length === 0;
  setHidden('animCard', selected.length < 2);
  state.frames = selected;
}

function setAllSelected(fn) {
  state.boxes.forEach((box) => { box.selected = fn(box); });
  renderResults();
}


/* ---------- Ekspor ---------- */

async function exportZip() {
  const selected = state.boxes.filter((b) => b.selected);
  if (selected.length === 0) return;

  if (typeof JSZip === 'undefined') {
    $('btnZip').textContent = 'ZIP tidak tersedia · unduh satuan';
    return;
  }

  const button = $('btnZip');
  button.disabled = true;
  button.textContent = 'Membuat ZIP…';

  try {
    const zip = new JSZip();
    const scale = Number($('exportScale').value);
    const usedNames = {};

    for (const box of selected) {
      let name = safeName(box.name);
      usedNames[name] = (usedNames[name] || 0) + 1;
      if (usedNames[name] > 1) name += `_${usedNames[name]}`;
      zip.file(`${name}.png`, await canvasToBlob(cropBox(box, scale)));
    }

    if ($('includeJson').checked) {
      const atlas = {
        image: state.fileName,
        size: { w: state.source.width, h: state.source.height },
        frames: selected.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })),
      };
      zip.file('atlas.json', JSON.stringify(atlas, null, 2));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(`${safeName(state.fileName)}_sprites.zip`, blob);
  } finally {
    button.textContent = '⬇ Unduh terpilih (ZIP)';
    button.disabled = false;
  }
}

async function exportCleanSheet() {
  const blob = await canvasToBlob(state.work);
  downloadBlob(`${safeName(state.fileName)}_clean.png`, blob);
}


/* ---------- Pratinjau animasi ---------- */

function animationLoop(time) {
  requestAnimationFrame(animationLoop);

  const { frames } = state;
  const hidden = $('animCard').hidden;
  if (!state.playing || frames.length < 2 || hidden) return;
  if (time - state.lastTick < 1000 / Number($('fps').value)) return;
  state.lastTick = time;

  state.frameIndex = (state.frameIndex + 1) % frames.length;
  const frame = frames[state.frameIndex];

  const maxW = Math.max(...frames.map((f) => f.w));
  const maxH = Math.max(...frames.map((f) => f.h));
  const scale = Math.max(1, Math.floor(Math.min(240 / maxW, 240 / maxH)));

  const animCanvas = $('animCanvas');
  if (animCanvas.width !== maxW * scale || animCanvas.height !== maxH * scale) {
    animCanvas.width = maxW * scale;
    animCanvas.height = maxH * scale;
  }

  const animCtx = animCanvas.getContext('2d');
  animCtx.imageSmoothingEnabled = false;
  animCtx.clearRect(0, 0, animCanvas.width, animCanvas.height);
  animCtx.drawImage(
    state.work,
    frame.x, frame.y, frame.w, frame.h,
    Math.floor((maxW - frame.w) / 2) * scale,
    Math.floor((maxH - frame.h) / 2) * scale,
    frame.w * scale,
    frame.h * scale
  );
}


/* ---------- Event ---------- */

function setMode(mode) {
  state.mode = mode;
  $('tabGrid').classList.toggle('active', mode === 'grid');
  $('tabAuto').classList.toggle('active', mode === 'auto');
  setHidden('panelGrid', mode !== 'grid');
  setHidden('panelAuto', mode !== 'auto');
}

function toggleTheme() {
  const root = document.documentElement;
  const isDark = getComputedStyle(root).getPropertyValue('--bg').trim() === '#161615';
  root.dataset.theme = isDark ? 'light' : 'dark';
}

function bindEvents() {
  // Memilih / menyeret / menempel gambar
  $('btnPick').onclick = () => $('fileInput').click();
  $('dropzone').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => loadFile(e.target.files[0]);

  ['dragover', 'dragenter'].forEach((type) => {
    document.body.addEventListener(type, (e) => {
      e.preventDefault();
      $('dropzone').classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    document.body.addEventListener(type, (e) => {
      e.preventDefault();
      $('dropzone').classList.remove('over');
    });
  });
  document.body.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  window.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const item = items.find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  // Pengaturan pemotongan
  $('tabGrid').onclick = () => setMode('grid');
  $('tabAuto').onclick = () => setMode('auto');
  $('gridMode').onchange = () => {
    const byCount = $('gridMode').value === 'count';
    setHidden('gridCountFields', !byCount);
    setHidden('gridSizeFields', byCount);
  };
  $('alphaThreshold').oninput = () => {
    $('alphaValue').textContent = $('alphaThreshold').value;
  };
  $('btnSplit').onclick = splitSprites;

  // Hapus warna latar
  $('btnEyedropper').onclick = () => setEyedropper(!state.eyedropper);
  $('tolerance').oninput = () => {
    $('toleranceValue').textContent = $('tolerance').value;
    if (state.bgColor) {
      applyBackgroundRemoval();
      drawPreview();
    }
  };
  $('btnResetBg').onclick = () => {
    state.bgColor = null;
    applyBackgroundRemoval();
    setHidden('btnResetBg', true);
    drawPreview();
  };

  // Zoom & klik pada kanvas
  $('btnZoomIn').onclick = () => setZoom(state.zoom * 1.25);
  $('btnZoomOut').onclick = () => setZoom(state.zoom / 1.25);
  $('btnZoomFit').onclick = fitZoom;
  canvas.onclick = onCanvasClick;

  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (state.work && window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      fitZoom();
    }
  });

  // Pilihan hasil
  $('btnSelectAll').onclick = () => setAllSelected(() => true);
  $('btnSelectNone').onclick = () => setAllSelected(() => false);
  $('btnInvert').onclick = () => setAllSelected((box) => !box.selected);

  // Ekspor
  $('btnZip').onclick = exportZip;
  $('btnCleanSheet').onclick = exportCleanSheet;

  // Animasi
  $('fps').oninput = () => { $('fpsValue').textContent = $('fps').value; };
  $('btnPlay').onclick = () => {
    state.playing = !state.playing;
    $('btnPlay').textContent = state.playing ? '⏸ Jeda' : '▶ Putar';
  };

  $('btnTheme').onclick = toggleTheme;
}

bindEvents();
requestAnimationFrame(animationLoop);
