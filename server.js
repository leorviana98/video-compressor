const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Multer config
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mts)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Formato de vídeo não suportado'));
    }
  }
});

// Store progress and file info
const jobs = new Map();

// Get video metadata with ffprobe
function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const format = metadata.format;
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
      resolve({
        duration: parseFloat(format.duration),
        size: parseInt(format.size),
        bitrate: parseInt(format.bit_rate),
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
        audioBitrate: audioStream ? parseInt(audioStream.bit_rate || 128000) : 0,
        width: videoStream?.width,
        height: videoStream?.height
      });
    });
  });
}

// Upload endpoint
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const filePath = req.file.path;
    const info = await getVideoInfo(filePath);
    const fileId = path.basename(req.file.filename, path.extname(req.file.filename));

    jobs.set(fileId, {
      inputPath: filePath,
      originalName: req.file.originalname,
      info,
      progress: 0,
      status: 'uploaded'
    });

    res.json({
      fileId,
      originalName: req.file.originalname,
      size: info.size,
      duration: info.duration,
      bitrate: info.bitrate,
      resolution: `${info.width}x${info.height}`,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compress endpoint
app.post('/api/compress', (req, res) => {
  const { fileId, mode, value, unit } = req.body;

  const job = jobs.get(fileId);
  if (!job) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }

  const { info, inputPath } = job;
  let targetSizeBytes;

  if (mode === 'percentage') {
    targetSizeBytes = info.size * (value / 100);
  } else if (mode === 'targetSize') {
    const multipliers = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    targetSizeBytes = value * (multipliers[unit] || multipliers.MB);
  } else {
    return res.status(400).json({ error: 'Modo inválido' });
  }

  if (targetSizeBytes >= info.size) {
    return res.status(400).json({ error: 'O tamanho alvo deve ser menor que o tamanho original' });
  }

  // Calculate target video bitrate
  const audioBitrate = info.audioBitrate || 128000;
  const targetTotalBitrate = (targetSizeBytes * 8) / info.duration;
  let targetVideoBitrate = Math.floor(targetTotalBitrate - audioBitrate);

  if (targetVideoBitrate < 50000) {
    targetVideoBitrate = 50000; // minimum 50kbps
  }

  const ext = path.extname(inputPath);
  const outputPath = path.join('compressed', `${fileId}${ext}`);

  job.status = 'compressing';
  job.progress = 0;
  job.outputPath = outputPath;

  ffmpeg(inputPath)
    .videoCodec('libx264')
    .audioCodec('aac')
    .videoBitrate(Math.floor(targetVideoBitrate / 1000) + 'k')
    .audioBitrate(Math.floor(audioBitrate / 1000) + 'k')
    .outputOptions([
      `-maxrate ${Math.floor(targetVideoBitrate / 1000)}k`,
      `-bufsize ${Math.floor(targetVideoBitrate / 500)}k`
    ])
    .on('progress', (progress) => {
      job.progress = Math.round(progress.percent || 0);
    })
    .on('end', () => {
      const stats = fs.statSync(outputPath);
      job.status = 'done';
      job.progress = 100;
      job.compressedSize = stats.size;
    })
    .on('error', (err) => {
      job.status = 'error';
      job.error = err.message;
    })
    .save(outputPath);

  res.json({
    message: 'Compressão iniciada',
    targetSize: targetSizeBytes,
    targetVideoBitrate
  });
});

// Progress endpoint
app.get('/api/progress/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job não encontrado' });
  }
  res.json({
    status: job.status,
    progress: job.progress,
    compressedSize: job.compressedSize || null,
    error: job.error || null
  });
});

// Download endpoint
app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Arquivo não disponível' });
  }
  const downloadName = job.originalName.replace(/(\.[^.]+)$/, '_compressed$1');
  res.download(job.outputPath, downloadName);
});

// Cleanup old files every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status === 'done' || job.status === 'error') {
      try {
        if (fs.existsSync(job.inputPath)) fs.unlinkSync(job.inputPath);
        if (job.outputPath && fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
      } catch {}
      jobs.delete(id);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
