'use strict';
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/requireAuth');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.json', '.xlsx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// GET /upload — simple drag-and-drop page (no auth required for now)
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Calbridge File Upload</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; background: #f9fafb; }
    h2 { color: #1a1a2e; margin-bottom: 4px; }
    p { color: #6b7280; font-size: 14px; }
    .drop { border: 2px dashed #d1d5db; border-radius: 12px; padding: 40px; text-align: center; background: white; cursor: pointer; transition: border-color .2s; }
    .drop:hover, .drop.over { border-color: #2d5a27; background: #f0fdf4; }
    .drop input { display: none; }
    .drop label { cursor: pointer; color: #2d5a27; font-weight: 600; }
    .btn { display: inline-block; margin-top: 16px; padding: 10px 24px; background: #2d5a27; color: white; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 600; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    #status { margin-top: 16px; font-size: 14px; color: #374151; }
    #filename { margin-top: 8px; font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <h2>📁 Calbridge File Upload</h2>
  <p>Upload CSV or data files to the workspace.</p>
  <form id="form" enctype="multipart/form-data">
    <div class="drop" id="drop">
      <input type="file" id="file" name="file" accept=".csv,.json,.xlsx,.txt">
      <div style="font-size:48px;margin-bottom:12px">📂</div>
      <label for="file">Click to choose a file</label>
      <div style="color:#9ca3af;font-size:13px;margin-top:8px">or drag and drop here</div>
    </div>
    <div id="filename"></div>
    <button class="btn" id="btn" disabled>Upload</button>
  </form>
  <div id="status"></div>
  <script>
    const drop = document.getElementById('drop');
    const fileInput = document.getElementById('file');
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    const filenameEl = document.getElementById('filename');

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) {
        filenameEl.textContent = '📄 ' + fileInput.files[0].name + ' (' + (fileInput.files[0].size/1024).toFixed(1) + ' KB)';
        btn.disabled = false;
      }
    });

    ['dragover','dragenter'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
    ['dragleave','drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', ev => {
      const f = ev.dataTransfer.files[0];
      if (f) {
        const dt = new DataTransfer(); dt.items.add(f);
        fileInput.files = dt.files;
        filenameEl.textContent = '📄 ' + f.name + ' (' + (f.size/1024).toFixed(1) + ' KB)';
        btn.disabled = false;
      }
    });

    document.getElementById('form').addEventListener('submit', async e => {
      e.preventDefault();
      btn.disabled = true;
      status.textContent = 'Uploading...';
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      try {
        const r = await fetch('/upload', { method: 'POST', body: fd });
        const d = await r.json();
        if (r.ok) {
          status.innerHTML = '✅ <strong>Uploaded: ' + d.filename + '</strong><br><span style="color:#6b7280;font-size:13px">Saved to workspace. Ash will process it shortly.</span>';
        } else {
          status.textContent = '❌ ' + (d.error || 'Upload failed');
          btn.disabled = false;
        }
      } catch(e) {
        status.textContent = '❌ ' + e.message;
        btn.disabled = false;
      }
    });

    document.getElementById('form').addEventListener('submit', e => {});
  </script>
</body>
</html>`);
});

// POST /upload — receive the file
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received or invalid file type' });
  console.log('[upload] File received:', req.file.filename, req.file.size, 'bytes');
  res.json({ success: true, filename: req.file.originalname, saved_as: req.file.filename, path: req.file.path });
});

// ── SB Creative image upload ────────────────────────────────────────────────
// POST /upload/sb-creative  — accepts jpg/png/gif up to 5MB
// Returns { url, filename, width?, height? }
const SB_UPLOAD_DIR = path.join(__dirname, '../../public/uploads/sb-creatives');
if (!fs.existsSync(SB_UPLOAD_DIR)) fs.mkdirSync(SB_UPLOAD_DIR, { recursive: true });

const sbStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SB_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const sbUpload = multer({
  storage: sbStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only JPG, PNG, or GIF images are allowed'));
  },
});

router.post('/sb-creative', requireAuth, sbUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image received or invalid file type' });
  // Public URL — served as static from /public
  const url = `/uploads/sb-creatives/${req.file.filename}`;
  console.log('[upload] SB creative saved:', req.file.filename, req.file.size, 'bytes');
  res.json({ success: true, url, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

module.exports = router;
