# Bot Deployment Guide

## Opsi A: VPS Ubuntu 22 + PM2 ✅ (Recommended)

### 1. Persiapan VPS (jalankan sebagai root atau sudo user)

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verifikasi
node -v   # harus v20.x.x
npm -v

# Install PM2 secara global
npm install -g pm2

# Install git
apt install -y git
```

---

### 2. Buat user khusus untuk bot (opsional tapi disarankan)

```bash
# Buat user 'bot' tanpa login shell
useradd -m -s /bin/bash botuser
su - botuser
```

---

### 3. Clone repository

```bash
# Clone ke /opt/store-bot (atau direktori lain)
git clone https://github.com/<user>/<repo>.git /opt/store-bot
cd /opt/store-bot/bot
```

> Kalau repo private, gunakan SSH key atau Personal Access Token:
> ```bash
> git clone https://<token>@github.com/<user>/<repo>.git /opt/store-bot
> ```

---

### 4. Install dependencies

```bash
cd /opt/store-bot/bot
npm install
```

---

### 5. Buat file `.env`

```bash
cp .env.example .env
nano .env   # atau: vim .env
```

Isi nilai yang wajib:

```env
# Pilih provider AI
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-xxxx
OPENROUTER_MODEL=openai/gpt-4o-mini

# Supabase (dari Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Opsional: nomor fallback sebelum Supabase dikonfigurasi
ALLOWED_WA_NUMBERS=628123456789

# Opsional: khusus satu toko (kosongkan untuk semua toko)
BOT_STORE_ID=
```

> `ALLOWED_WA_NUMBERS` hanya sebagai fallback. Setelah bot terhubung ke Supabase,
> whitelist dikelola dari dashboard → Stores.

---

### 6. Buat folder session dan logs

```bash
mkdir -p /opt/store-bot/bot/session
mkdir -p /opt/store-bot/bot/logs
```

---

### 7. Jalankan bot dengan PM2

```bash
cd /opt/store-bot/bot
pm2 start ecosystem.config.cjs

# Cek status
pm2 status
```

---

### 8. Scan QR WhatsApp

```bash
pm2 logs wa-bot --lines 50
```

QR code akan muncul di terminal. Buka WhatsApp di HP → Linked Devices → Link a Device → scan.

> Setelah terscan, session tersimpan di folder `session/` dan **tidak perlu scan ulang**
> meskipun bot direstart atau VPS reboot.

---

### 9. Set auto-start saat VPS reboot

```bash
# Generate systemd startup script
pm2 startup

# PM2 akan print satu perintah — copy-paste dan jalankan
# Contoh output:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Setelah menjalankan perintah di atas, simpan konfigurasi PM2
pm2 save
```

Verifikasi:
```bash
pm2 list          # harus ada wa-bot
systemctl status pm2-<user>   # harus active (running)
```

---

### 10. Update bot (saat ada perubahan kode)

```bash
cd /opt/store-bot
git pull origin main

# Kalau ada perubahan package.json
cd bot && npm install

# Restart bot
pm2 restart wa-bot
```

---

## Perintah PM2 sehari-hari

```bash
pm2 status                    # status semua process
pm2 logs wa-bot               # log realtime (Ctrl+C untuk keluar)
pm2 logs wa-bot --lines 100   # 100 baris log terakhir
pm2 restart wa-bot            # restart bot
pm2 stop wa-bot               # stop bot
pm2 start wa-bot              # start bot yang stopped
pm2 delete wa-bot             # hapus dari PM2
pm2 monit                     # dashboard realtime (CPU, RAM, log)
```

---

## Reset session WhatsApp (scan QR ulang)

```bash
pm2 stop wa-bot
rm -rf /opt/store-bot/bot/session/*
pm2 start wa-bot
pm2 logs wa-bot --lines 50    # QR muncul di sini
```

---

## Troubleshooting

### Bot tidak merespons
```bash
pm2 logs wa-bot --lines 100   # cek error
pm2 status                    # cek apakah running
```

### "Missing required env var"
```bash
cat /opt/store-bot/bot/.env   # cek nilai env
pm2 restart wa-bot
```

### Bot crash loop
```bash
pm2 logs wa-bot --err          # lihat error saja
# Kalau sering crash karena memori:
# Naikkan max_memory_restart di ecosystem.config.cjs → 500M
pm2 restart wa-bot
```

### Port 3001 sudah dipakai
```bash
# Ganti port di .env
echo "PORT=3002" >> .env
pm2 restart wa-bot
```

### Tidak bisa konek ke Supabase
```bash
# Test koneksi dari VPS
curl https://xxxx.supabase.co/rest/v1/ \
  -H "apikey: <service-role-key>"
# Harus return JSON, bukan error
```

---

## Keamanan VPS

```bash
# Blokir semua port kecuali SSH (bot tidak butuh port masuk)
ufw allow ssh
ufw enable

# Kalau ingin health-check dari luar (opsional)
ufw allow 3001/tcp
```

> Bot hanya butuh koneksi **keluar** ke:
> - WhatsApp servers (`*.whatsapp.net`)
> - Supabase (`*.supabase.co`)
> - AI provider (OpenRouter / Anthropic / OpenAI)
>
> Tidak perlu buka port apapun untuk bot berjalan normal.

---

## Backup session WhatsApp

Session tersimpan di `bot/session/`. Backup folder ini agar tidak perlu scan QR ulang:

```bash
# Backup
tar -czf wa-session-backup-$(date +%Y%m%d).tar.gz /opt/store-bot/bot/session/

# Restore
tar -xzf wa-session-backup-YYYYMMDD.tar.gz -C /
pm2 restart wa-bot
```

---

## Opsi B: Fly.io

### Setup pertama kali

```bash
# Install Fly CLI (macOS)
brew install flyctl

cd bot

# Login & buat app
fly auth login
fly apps create store-dashboard-bot

# Buat volume untuk persist session WhatsApp
fly volumes create wa_session --region sin --size 1

# Set env vars
fly secrets set \
  AI_PROVIDER="openrouter" \
  OPENROUTER_API_KEY="sk-or-xxxx" \
  OPENROUTER_MODEL="openai/gpt-4o-mini" \
  NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..."

# Deploy
fly deploy

# Scan QR
fly logs
```

### Update kode
```bash
cd bot
fly deploy
```

### Update dependencies (ada perubahan package.json)
```bash
fly machine list              # catat ID machine yang stopped
fly machine destroy <id>
fly deploy --no-cache
```

### Perintah Fly.io berguna
```bash
fly status
fly logs
fly machine restart
fly ssh console               # masuk ke container
fly secrets set KEY=value     # update env tanpa redeploy
```

### Reset session WhatsApp
```bash
fly ssh console
rm -rf /data/session/*
exit
fly machine restart
fly logs   # QR muncul di sini
```

---

## AI Provider (Production)

Ollama hanya bisa dipakai lokal. Untuk VPS/Fly.io gunakan cloud provider:

| Provider | Model | Biaya estimasi |
|----------|-------|----------------|
| OpenRouter | `openai/gpt-4o-mini` | ~$0.0001/pesan |
| OpenRouter | `google/gemma-3-4b-it:free` | Gratis |
| Anthropic | `claude-haiku-4-5-20251001` | ~$0.0002/pesan |
| OpenAI | `gpt-4o-mini` | ~$0.0001/pesan |

Ganti model tanpa restart (via Supabase dashboard → Bot Config):
- Dashboard → Stores → [toko] → Bot Config → ganti model → Simpan
- Bot ambil perubahan otomatis dalam ≤5 menit
