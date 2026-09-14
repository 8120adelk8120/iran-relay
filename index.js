const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { execFile } = require('child_process');

let ffmpegPath = 'ffmpeg';
try {
  ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
} catch (_) {}

let sharp = null;
try {
  sharp = require('sharp');
} catch (_) {}

const app = express();

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(uploadDir));

app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Darkube Media & FFmpeg Video Engine' });
});

// اندپوینت آپلود مدیا
app.post('/upload', (req, res) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      let ext = '.jpg';
      if (file && file.originalname && file.originalname.includes('.')) {
        ext = path.extname(file.originalname);
      } else if (file && file.mimetype) {
        if (file.mimetype.includes('video')) ext = '.mp4';
        else if (file.mimetype.includes('png')) ext = '.png';
      }
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  });

  const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }).single('file');
  upload(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'فایلی ارسال نشد.' });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    res.json({
      success: true,
      url: `${protocol}://${host}/uploads/${req.file.filename}`,
      filename: req.file.filename
    });
  });
});

// تابع کمکی شکست خطوط متن فارسی برای جلوگیری از بیرون‌زدگی
function wrapPersianText(text, maxChars = 32) {
  const words = (text || '').trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length <= maxChars) {
      current = (current + ' ' + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

// اندپوینت اختصاصی رندر ویدیو با FFmpeg (جایگزین کامل کریتومیت)
app.post('/video/render', async (req, res) => {
  try {
    const { imageUrl, text, duration = 5 } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'آدرس تصویر ارسال نشده است.' });

    // ۱. دریافت فایل تصویر پس‌زمینه
    let bgBuffer = null;
    if (imageUrl.includes('/uploads/')) {
      const localName = imageUrl.split('/uploads/')[1].split('?')[0];
      const localPath = path.join(uploadDir, localName);
      if (fs.existsSync(localPath)) bgBuffer = fs.readFileSync(localPath);
    }
    if (!bgBuffer) {
      const download = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      bgBuffer = download.data;
    }

    const tempId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const tempBgPath = path.join(uploadDir, `temp_bg_${tempId}.jpg`);
    const tempOverlayPath = path.join(uploadDir, `temp_overlay_${tempId}.png`);
    const outputVideoName = `video_${tempId}.mp4`;
    const outputVideoPath = path.join(uploadDir, outputVideoName);

    fs.writeFileSync(tempBgPath, bgBuffer);

    // ۲. ساخت کارت گرافیکی عنوان فارسی با SVG
    const lines = wrapPersianText(text || 'نوآوری و خلاقیت در کسب‌وکار');
    const tspans = lines
      .map((line, idx) => `<tspan x="540" dy="${idx === 0 ? 0 : 58}">${line}</tspan>`)
      .join('');

    const boxHeight = 160 + lines.length * 45;
    const boxY = 1000 - boxHeight;

    const svgOverlay = `
    <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0" />
          <stop offset="60%" stop-color="#000000" stop-opacity="0.6" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.95" />
        </linearGradient>
      </defs>
      <rect x="0" y="500" width="1080" height="580" fill="url(#bgGrad)" />
      <rect x="70" y="${boxY}" width="940" height="${boxHeight}" rx="24" fill="#090d16" fill-opacity="0.88" stroke="#38bdf8" stroke-width="3" />
      <text x="540" y="${boxY + 75}" font-size="42" font-family="Tahoma, Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle" direction="rtl">
        ${tspans}
      </text>
      <text x="540" y="${boxY + boxHeight - 25}" font-size="22" font-family="Tahoma, Arial, sans-serif" fill="#94a3b8" text-anchor="middle" direction="rtl">
        اتاق بین‌المللی نوآوری و خلاقیت
      </text>
    </svg>`;

    if (sharp) {
      await sharp(Buffer.from(svgOverlay)).png().toFile(tempOverlayPath);
    } else {
      fs.writeFileSync(tempOverlayPath, Buffer.from(svgOverlay));
    }

    // ۳. دستور بهینه FFmpeg: موشن زوم سینمایی + قرارگیری تایتل + ساخت فایل MP4
    const totalFrames = duration * 25;
    const filterComplex = `[0:v]scale=1200:1200,zoompan=z='min(zoom+0.001,1.15)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1080[bg];[bg][1:v]overlay=0:0[v]`;

    const args = [
      '-y',
      '-loop', '1', '-t', `${duration}`, '-i', tempBgPath,
      '-loop', '1', '-t', `${duration}`, '-i', tempOverlayPath,
      '-f', 'lavfi', '-t', `${duration}`, '-i', 'anullsrc=r=44100:cl=stereo',
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-map', '2:a',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      outputVideoPath
    ];

    execFile(ffmpegPath, args, (err) => {
      try {
        if (fs.existsSync(tempBgPath)) fs.unlinkSync(tempBgPath);
        if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
      } catch (_) {}

      if (err) {
        console.error('[FFmpeg Render Error]:', err.message);
        return res.status(500).json({ error: 'خطا در رندر ویدیو با FFmpeg', details: err.message });
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const videoUrl = `${protocol}://${host}/uploads/${outputVideoName}`;

      res.json({
        success: true,
        url: videoUrl,
        filename: outputVideoName
      });
    });
  } catch (err) {
    console.error('[Render Exception]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// رله‌های پیام‌رسان‌ها و آپارات
app.all('/bale/*', async (req, res) => {
  try {
    const r = await axios({
      method: req.method,
      url: `https://tapi.bale.ai/${req.params[0]}`,
      data: req.body,
      params: req.query,
      headers: { 'Content-Type': 'application/json' },
      timeout: 45000
    });
    res.status(r.status).json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.all('/eitaa/*', async (req, res) => {
  try {
    const targetUrl = `https://eitaayar.ir/${req.params[0]}`;
    if (req.params[0].includes('sendFile') && req.body && req.body.file) {
      let fileBuffer = null;
      let fileName = 'file.jpg';
      const fileUrl = req.body.file;

      if (typeof fileUrl === 'string' && fileUrl.includes('/uploads/')) {
        const localPath = path.join(uploadDir, fileUrl.split('/uploads/')[1].split('?')[0]);
        if (fs.existsSync(localPath)) fileBuffer = fs.readFileSync(localPath);
      }
      if (!fileBuffer && typeof fileUrl === 'string' && fileUrl.startsWith('http')) {
        const d = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 45000 });
        fileBuffer = d.data;
      }

      if (fileBuffer) {
        const formData = new FormData();
        formData.append('chat_id', req.body.chat_id);
        if (req.body.caption) formData.append('caption', req.body.caption);
        formData.append('file', new Blob([fileBuffer]), fileName);
        const eitaaRes = await fetch(targetUrl, { method: 'POST', body: formData });
        return res.status(eitaaRes.status).json(await eitaaRes.json());
      }
    }
    const r = await axios({ method: req.method, url: targetUrl, data: req.body, timeout: 45000 });
    res.status(r.status).json(r.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
  }
});

app.post('/aparat/upload', async (req, res) => {
  try {
    const { username, password, ltoken, videoUrl, title, description, category, tags } = req.body;
    let token = ltoken;

    if (!token && username && password) {
      const hashPass = crypto.createHash('md5').update(password).digest('hex');
      const loginRes = await axios.get(`https://www.aparat.com/etc/api/login/luser/${username}/lpass/${hashPass}`);
      if (loginRes.data?.login?.type !== 'success') {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور آپارات اشتباه است.' });
      }
      token = loginRes.data.login.ltoken;
    }

    const formRes = await axios.get(`https://www.aparat.com/etc/api/uploadform/luser/${username}/ltoken/${token}`);
    const uploadData = formRes.data?.uploadform;
    if (!uploadData?.formAction) return res.status(500).json({ error: 'خطا در دریافت فرم آپلود آپارات' });

    let fileBuffer = null;
    if (videoUrl && videoUrl.includes('/uploads/')) {
      const localPath = path.join(uploadDir, videoUrl.split('/uploads/')[1].split('?')[0]);
      if (fs.existsSync(localPath)) fileBuffer = fs.readFileSync(localPath);
    }
    if (!fileBuffer && videoUrl) {
      const d = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fileBuffer = d.data;
    }

    const formData = new FormData();
    formData.append('video', new Blob([fileBuffer]), 'video.mp4');
    formData.append('frm-id', uploadData['frm-id']);
    formData.append('title', title || 'ویدیو جدید');
    formData.append('category', category || '7');
    formData.append('description', description || '');
    formData.append('tags', tags || 'خلاقیت,نوآوری,کسب_و_کار');

    const aparatRes = await fetch(uploadData.formAction, { method: 'POST', body: formData });
    res.json({ success: true, aparatResponse: await aparatRes.json() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Relay Server running on port ${PORT}`));
