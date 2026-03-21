const $ = (sel) => document.querySelector(sel);
const MAX_FILES = 10;

// State: array of video objects
let videos = [];

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// --- Dropzone ---
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFiles(fileInput.files);
});

function handleFiles(fileList) {
  const files = Array.from(fileList).slice(0, MAX_FILES - videos.length);
  if (files.length === 0) return;
  files.forEach(file => uploadFile(file));
}

// --- Upload single file ---
function uploadFile(file) {
  const id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const video = {
    localId: id,
    fileId: null,
    name: file.name,
    status: 'uploading', // uploading | uploaded | queued | compressing | done | error
    uploadProgress: 0,
    compressProgress: 0,
    size: file.size,
    compressedSize: null,
    info: null,
    error: null
  };
  videos.push(video);
  renderList();
  updateUI();

  const formData = new FormData();
  formData.append('video', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      video.uploadProgress = Math.round((e.loaded / e.total) * 100);
      renderCard(video);
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      video.fileId = data.fileId;
      video.status = 'uploaded';
      video.size = data.size;
      video.info = data;
      renderCard(video);
      updateUI();
    } else {
      try {
        const err = JSON.parse(xhr.responseText);
        video.error = err.error || 'Erro no upload';
      } catch {
        video.error = 'Erro no upload';
      }
      video.status = 'error';
      renderCard(video);
    }
  };

  xhr.onerror = () => {
    video.status = 'error';
    video.error = 'Erro de conexão';
    renderCard(video);
  };

  xhr.send(formData);
}

// --- Render ---
function renderList() {
  const list = $('#videoList');
  list.classList.remove('hidden');
  // Only add cards that don't exist yet
  videos.forEach(v => {
    if (!document.getElementById(v.localId)) {
      const card = document.createElement('div');
      card.id = v.localId;
      card.className = 'video-card';
      list.appendChild(card);
      renderCard(v);
    }
  });
  // Update dropzone hint
  if (videos.length >= MAX_FILES) {
    dropzone.classList.add('hidden');
  }
}

function renderCard(video) {
  const card = document.getElementById(video.localId);
  if (!card) return;

  let statusHTML = '';
  let actionsHTML = '';

  switch (video.status) {
    case 'uploading':
      statusHTML = `
        <div class="card-status uploading">
          <span>Enviando... ${video.uploadProgress}%</span>
          <div class="progress-bar"><div class="progress-fill" style="width:${video.uploadProgress}%"></div></div>
        </div>`;
      break;
    case 'uploaded':
      statusHTML = `
        <div class="card-status ready">
          <span class="badge badge-ready">Pronto</span>
          <span class="card-meta">${formatSize(video.size)} · ${formatDuration(video.info.duration)} · ${video.info.resolution}</span>
        </div>`;
      break;
    case 'queued':
      statusHTML = `
        <div class="card-status uploading">
          <span>Na fila... aguardando</span>
          <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
        </div>`;
      break;
    case 'compressing':
      statusHTML = `
        <div class="card-status compressing">
          <span>Comprimindo... ${video.compressProgress}%</span>
          <div class="progress-bar"><div class="progress-fill" style="width:${video.compressProgress}%"></div></div>
        </div>`;
      break;
    case 'done': {
      const reduction = ((1 - video.compressedSize / video.size) * 100).toFixed(1);
      statusHTML = `
        <div class="card-status done">
          <span class="badge badge-done">Concluído</span>
          <span class="card-meta">${formatSize(video.size)} → ${formatSize(video.compressedSize)} <strong class="highlight">(-${reduction}%)</strong></span>
        </div>`;
      actionsHTML = `<button class="btn-small" onclick="downloadVideo('${video.fileId}')">Baixar</button>`;
      break;
    }
    case 'error':
      statusHTML = `
        <div class="card-status error">
          <span class="badge badge-error">Erro</span>
          <span class="card-meta">${video.error}</span>
        </div>`;
      break;
  }

  card.innerHTML = `
    <div class="card-header">
      <span class="card-name" title="${video.name}">${video.name}</span>
      <button class="btn-remove" onclick="removeVideo('${video.localId}')" title="Remover">&times;</button>
    </div>
    ${statusHTML}
    ${actionsHTML ? `<div class="card-actions">${actionsHTML}</div>` : ''}
  `;
}

function updateUI() {
  const hasUploaded = videos.some(v => v.status === 'uploaded');
  const allDone = videos.length > 0 && videos.every(v => v.status === 'done' || v.status === 'error');
  const anyDone = videos.some(v => v.status === 'done');

  $('#settings').classList.toggle('hidden', !hasUploaded);
  $('#globalActions').classList.toggle('hidden', !allDone);
  $('#downloadAllBtn').classList.toggle('hidden', !anyDone);

  // Update compress button text
  const readyCount = videos.filter(v => v.status === 'uploaded').length;
  if (readyCount > 0) {
    $('#compressBtn').textContent = readyCount === 1
      ? 'Comprimir Vídeo'
      : `Comprimir ${readyCount} Vídeos`;
  }
}

// --- Remove video ---
window.removeVideo = function(localId) {
  videos = videos.filter(v => v.localId !== localId);
  const card = document.getElementById(localId);
  if (card) card.remove();
  if (videos.length === 0) {
    $('#videoList').classList.add('hidden');
  }
  if (videos.length < MAX_FILES) {
    dropzone.classList.remove('hidden');
  }
  updateUI();
};

// --- Download single ---
window.downloadVideo = function(fileId) {
  window.location.href = `/api/download/${fileId}`;
};

// --- Mode tabs ---
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    $('#percentageMode').classList.toggle('hidden', mode !== 'percentage');
    $('#targetSizeMode').classList.toggle('hidden', mode !== 'targetSize');
  });
});

// --- Slider ---
const slider = $('#percentSlider');
slider.addEventListener('input', () => {
  $('#percentValue').textContent = slider.value;
});

// --- Compress All ---
$('#compressBtn').addEventListener('click', () => {
  const activeMode = document.querySelector('.mode-tab.active').dataset.mode;
  const toCompress = videos.filter(v => v.status === 'uploaded');
  if (toCompress.length === 0) return;

  let sharedOpts = { mode: activeMode };
  if (activeMode === 'percentage') {
    sharedOpts.value = parseInt(slider.value);
  } else {
    const val = parseFloat($('#targetValue').value);
    if (!val || val <= 0) {
      alert('Informe um tamanho válido');
      return;
    }
    sharedOpts.value = val;
    sharedOpts.unit = $('#targetUnit').value;
  }

  $('#settings').classList.add('hidden');
  dropzone.classList.add('hidden');

  toCompress.forEach(video => {
    compressVideo(video, sharedOpts);
  });
});

async function compressVideo(video, opts) {
  video.status = 'queued';
  video.compressProgress = 0;
  renderCard(video);

  try {
    const res = await fetch('/api/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: video.fileId, ...opts })
    });

    if (!res.ok) {
      const err = await res.json();
      video.status = 'error';
      video.error = err.error || 'Erro ao iniciar compressão';
      renderCard(video);
      updateUI();
      return;
    }

    const data = await res.json();
    if (data.message === 'Na fila de compressão') {
      video.status = 'queued';
      renderCard(video);
    }

    pollProgress(video);
  } catch {
    video.status = 'error';
    video.error = 'Erro de conexão';
    renderCard(video);
    updateUI();
  }
}

function pollProgress(video) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/progress/${video.fileId}`);
      const data = await res.json();

      video.status = data.status;
      video.compressProgress = data.progress;
      renderCard(video);

      if (data.status === 'done') {
        clearInterval(interval);
        video.status = 'done';
        video.compressedSize = data.compressedSize;
        renderCard(video);
        updateUI();
      } else if (data.status === 'error') {
        clearInterval(interval);
        video.status = 'error';
        video.error = data.error || 'Erro na compressão';
        renderCard(video);
        updateUI();
      }
    } catch {
      clearInterval(interval);
      video.status = 'error';
      video.error = 'Erro ao verificar progresso';
      renderCard(video);
      updateUI();
    }
  }, 1000);
}

// --- Download All ---
$('#downloadAllBtn').addEventListener('click', () => {
  videos.filter(v => v.status === 'done').forEach((v, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = `/api/download/${v.fileId}`;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 500);
  });
});

// --- New Batch ---
$('#newBatchBtn').addEventListener('click', () => {
  videos = [];
  $('#videoList').innerHTML = '';
  $('#videoList').classList.add('hidden');
  $('#settings').classList.add('hidden');
  $('#globalActions').classList.add('hidden');
  dropzone.classList.remove('hidden');
  fileInput.value = '';
  slider.value = 50;
  $('#percentValue').textContent = '50';
});
