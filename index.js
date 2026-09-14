const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const { execFile } = require('child_process');

let sharp = null;
try {
  sharp = require('sharp');
} catch (_) {
  console.warn('[Warning]: sharp is not loaded. SVG will be used directly.');
}

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
  res.json({ status: 'running', service: 'Darkube Media & FFmpeg Native Video Engine' });
});

// ۱. اندپوینت آپلود مدیا
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
    if (!req.file) return res.status(400).json({ error: 'هیچ فایلی با کلید "file" ارسال نشده است.' });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    res.json({
      success: true,
      url: `${protocol}://${host}/uploads/${req.file.filename}`,
      filename: req.file.filename
    });
  });
});

// تابع کمکی تنظیم شکست خطوط متن فارسی
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

// ۲. اندپوینت سبک و بهینه رندر ویدیو با FFmpeg بومی
app.post('/video/render', async (req, res) => {
  try {
    const { imageUrl, text, duration = 5 } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'آدرس تصویر ارسال نشده است.' });

    let bgBuffer = null;
    if (imageUrl.includes('/uploads/')) {
      const localPath = path.join(uploadDir, imageUrl.split('/uploads/')[1].split('?')[0]);
      if (fs.existsSync(localPath)) bgBuffer = fs.readFileSync(localPath);
    }
    if (!bgBuffer) {
      const download = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      bgBuffer = download.data;
    }

    const tempId = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const tempBgPath = path.join(uploadDir, `bg_${tempId}.jpg`);
    const tempOverlayPath = path.join(uploadDir, `ov_${tempId}.png`);
    const outputVideoName = `video_${tempId}.mp4`;
    const outputVideoPath = path.join(uploadDir, outputVideoName);

    fs.writeFileSync(tempBgPath, bgBuffer);

    // ساخت گرافیک عنوان فارسی با کادر شیشه‌ای تیره
    const lines = wrapPersianText(text || 'نوآوری و خلاقیت در کسب‌وکار');
    const tspans = lines.map((l, i) => `<tspan x="540" dy="${i === 0 ? 0 : 54}">${l}</tspan>`).join('');
    const boxHeight = 150 + lines.length * 45;
    const boxY = 1020 - boxHeight;

    const svgOverlay = `
    <svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.9"/>
        </linearGradient>
      </defs>
      <rect x="0" y="550" width="1080" height="530" fill="url(#g)"/>
      <rect x="70" y="${boxY}" width="940" height="${boxHeight}" rx="20" fill="#0b0f19" fill-opacity="0.9" stroke="#38bdf8" stroke-width="2"/>
      <text x="540" y="${boxY + 70}" font-size="38" font-family="'Noto Sans Arabic', Tahoma, Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle" direction="rtl">
        ${tspans}
      </text>
      <text x="540" y="${boxY + boxHeight - 22}" font-size="20" font-family="'Noto Sans Arabic', Tahoma, Arial, sans-serif" fill="#94a3b8" text-anchor="middle" direction="rtl">
        اتاق بین الملل خلاقیت و نوآوری
      </text>
    </svg>`;

    if (sharp) {
      await sharp(Buffer.from(svgOverlay)).png().toFile(tempOverlayPath);
    } else {
      fs.writeFileSync(tempOverlayPath, Buffer.from(svgOverlay));
    }

    // ساخت دستور FFmpeg بهینه (مصرف رم زیر ۵۰ مگابایت)
    const args = [
      '-y',
      '-loop', '1', '-t', `${duration}`, '-i', tempBgPath,
      '-loop', '1', '-t', `${duration}`, '-i', tempOverlayPath,
      '-f', 'lavfi', '-t', `${duration}`, '-i', 'anullsrc=r=44100:cl=stereo',
      '-filter_complex', '[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080[bg];[bg][1:v]overlay=0:0[v]',
      '-map', '[v]',
      '-map', '2:a',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      outputVideoPath
    ];

    execFile('ffmpeg', args, (err) => {
      try {
        if (fs.existsSync(tempBgPath)) fs.unlinkSync(tempBgPath);
        if (fs.existsSync(tempOverlayPath)) fs.unlinkSync(tempOverlayPath);
      } catch (_) {}

      if (err) {
        console.error('[FFmpeg Error]:', err.message);
        return res.status(500).json({ error: 'خطای رندر FFmpeg', details: err.message });
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      res.json({
        success: true,
        url: `${protocol}://${host}/uploads/${outputVideoName}`,
        filename: outputVideoName
      });
    });
  } catch (err) {
    console.error('[Render Exception]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ۳. رله پیام‌رسان بله
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

// ۴. رله هوشمند ایتا (تبدیل URL به FormData)
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
        if (req.body.title) formData.append('title', req.body.title);
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

// ۵. رله آپلود ویدیو به آپارات
app.post('/aparat/upload', async (req, res) => {
  try {
    const { username, password, ltoken, videoUrl, title, description, category, tags } = req.body;
    let token = ltoken;

    if (!token && username && password) {
      const hashPass = crypto.createHash('md5').update(password).digest('hex');
      const loginRes = await axios.get(`https://www.aparat.com/etc/api/login/luser/${username}/lpass/${hashPass}`);
      if (loginRes.data?.login?.type !== 'success') {
        return res.status(401).json({ error: 'نام کاربری یا رمز عبور آپارات نامعتبر است.' });
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

    if (!fileBuffer) return res.status(400).json({ error: 'فایل ویدیو یافت نشد.' });

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

// ۶. میدل‌ور سراسری مدیریت خطا
app.use((err, req, res, next) => {
  console.error('[Global Handler]:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Relay Server running on port ${PORT}`));
