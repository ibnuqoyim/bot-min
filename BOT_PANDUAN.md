# Panduan Penggunaan Bot WhatsApp Toko

Bot ini dioperasikan lewat **pesan teks WhatsApp**. Semua perintah diawali dengan `/` (garis miring).

---

## Daftar Isi

1. [Pertama Kali Pakai](#1-pertama-kali-pakai)
2. [Kelola Produk](#2-kelola-produk)
3. [Batch PO](#3-batch-po)
4. [Order](#4-order)
5. [Update Order](#5-update-order)
6. [Invoice & Pembayaran](#6-invoice--pembayaran)
7. [Multi-Store](#7-multi-store)
8. [Buat Toko Baru](#8-buat-toko-baru)
9. [Perintah Umum](#9-perintah-umum)
10. [Catatan Penting](#10-catatan-penting)

---

## 1. Pertama Kali Pakai

Sebelum bisa menggunakan bot, nomor kamu harus terdaftar di whitelist toko.

**Dapatkan Store ID dari dashboard** → Menu *Stores* → pilih toko → salin Store ID.

Kirim perintah berikut ke bot:

```
/whitelist <store-id>
```

**Contoh:**
```
/whitelist a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

Setelah berhasil, ketik `/help` untuk melihat semua perintah yang tersedia.

---

## 2. Kelola Produk

### Lihat Daftar Produk

```
/produk
```
Menampilkan semua produk beserta **kode** dan harganya.

```
/produk ready
```
Hanya menampilkan produk yang sedang berstatus *ready* di batch PO aktif.

```
/produk <kata kunci>
```
Cari produk berdasarkan nama atau kode.

**Contoh:**
```
/produk sour
/produk SD
```

---

### Tambah / Update Produk via Form (Direkomendasikan)

```
/produk baru
```

Bot akan mengirim template form:

```
Kode | Nama Produk | HPP | Harga Jual
```

Copy form tersebut, isi data produk (satu baris per produk), lalu kirim kembali:

```
Kode | Nama Produk | HPP | Harga Jual
SD | Sourdough Loaf | 25000 | 35000
CR | Croissant | 15000 | 22000
BGL | Bagel Polos | 12000 | 18000
```

> Bisa gunakan `|` atau `,` sebagai pemisah kolom.  
> Kalau kode sudah ada → harga & nama diupdate. Kalau belum ada → produk baru dibuat.  
> HPP = Harga Pokok Produksi (modal).

---

### Tambah / Update Produk Massal (Admin / Cepat)

```
/produk upsert
<kode> , <nama> , <hpp> , <harga>
<kode> , <nama> , <hpp> , <harga>
...
```

**Contoh:**
```
/produk upsert
SD , Sourdough Loaf , 25000 , 35000
CR , Croissant , 15000 , 22000
BGL , Bagel Polos , 12000 , 18000
```

---

## 3. Batch PO

Batch PO adalah **periode pre-order**. Setiap order harus masuk ke dalam sebuah batch.

### Buat Batch PO Baru via Form (Direkomendasikan)

```
/po baru
```

Bot akan mengirim form berisi daftar produk aktif:

```
📋 Form Batch PO Baru — Nama Toko

Nama Batch: 

*— Buka Produk —*
(isi ✓ di kolom terakhir untuk membuka produk di batch ini)

SD | Sourdough Loaf | Rp 35.000 | 
CR | Croissant | Rp 22.000 | 
BGL | Bagel Polos | Rp 18.000 | 
```

Copy form, isi nama batch dan tandai produk yang ingin dibuka, lalu kirim kembali:

```
Nama Batch: April W2

SD | Sourdough Loaf | Rp 35.000 | ✓
CR | Croissant | Rp 22.000 | ✓
BGL | Bagel Polos | Rp 18.000 | 
```

> Kolom terakhir boleh diisi apa saja (✓, y, v, dll) — asal tidak kosong.  
> Produk yang kolom terakhirnya kosong tidak akan dibuka di batch ini.

---

### Buat Batch PO Cepat (Admin)

```
/po baru <nama batch>
```

**Dengan sekaligus set produk yang ready:**
```
/po baru <nama batch> | <kode1>, <kode2>, ...
```

**Contoh:**
```
/po baru April W2
/po baru April W2 | SD, CR, BGL
```

---

### Lihat Ringkasan Batch Aktif

```
/resume
```

Menampilkan ringkasan semua order di batch terbaru: nama pemesan, produk, total, dan status bayar.

---

## 4. Order

### Buat Order via Form (Direkomendasikan untuk Customer)

Customer cukup kirim satu perintah, bot otomatis mengirimkan form berisi daftar produk yang tersedia.

```
/order baru
```

Bot akan membalas dengan form seperti ini:

```
📋 Form Order — Nama Toko
📦 Batch: April W2

Isi form berikut lalu kirim kembali 👇

Nama: 
No. HP: 

— Produk —
(isi angka qty, biarkan kosong jika tidak order)

SD | Sourdough Loaf | Rp 35.000 | 
CR | Croissant | Rp 22.000 | 
BGL | Bagel Polos | Rp 18.000 | 
```

Customer **copy form tersebut**, isi nama, nomor HP, dan qty produk yang diinginkan, lalu kirim kembali:

```
Nama: Budi Santoso
No. HP: 08123456789

— Produk —
(isi angka qty, biarkan kosong jika tidak order)

SD | Sourdough Loaf | Rp 35.000 | 2
CR | Croissant | Rp 22.000 | 1
BGL | Bagel Polos | Rp 18.000| 
```

> Produk yang kosong atau 0 diabaikan otomatis.  
> No. HP boleh dikosongkan.  
> Daftar produk disesuaikan otomatis dengan batch aktif (produk ready) atau semua produk aktif jika tidak ada batch.

---

### Buat Order Cepat (Admin/Operator)

Untuk admin yang sudah hafal kode produk, gunakan format singkat:

```
/order <nama pemesan> | <kode>:<qty>, <kode>:<qty>, ...
```

**Contoh:**
```
/order Budi Santoso | SD:2, CR:1
/order Siti | BGL:3, SD:1
```

> Gunakan **kode produk**, bukan nama lengkap. Cek kode dengan `/produk`.

---

### Cari Order

```
/cari <nama pemesan>
```

Mencari order berdasarkan nama (tidak harus lengkap).

**Contoh:**
```
/cari Budi
/cari siti
```

---

## 5. Update Order

### Tambah Produk ke Order

```
/update <nama> tambah <kode>:<qty>, <kode>:<qty>
```

**Contoh:**
```
/update Budi tambah CR:2
/update Siti tambah SD:1, BGL:2
```

> Kalau produk sudah ada di order → qty ditambahkan (bukan diganti).

---

### Ganti Qty Produk

```
/update <nama> qty <produk>:<qty baru>
```

**Contoh:**
```
/update Budi qty sourdough:3
/update Siti qty croissant:0
```

> Ketik `0` untuk **menghapus** produk dari order.

---

### Set Ongkos Kirim

```
/update <nama> ongkir <biaya>
/update <nama> ongkir <kurir>:<biaya>
```

**Contoh:**
```
/update Budi ongkir 15000
/update Siti ongkir JNE:20000
```

---

## 6. Invoice & Pembayaran

### Kirim Invoice PDF

Bot akan mengirim file PDF invoice langsung ke chat.

```
/invoice <nama pemesan>
```

**Contoh:**
```
/invoice Budi
/invoice Siti
```

---

### Tandai Lunas

```
/bayar <nama pemesan>
```

**Contoh:**
```
/bayar Budi
/bayar Siti
```

Bot akan membalas dengan ringkasan total pembayaran dan mengubah status order menjadi **LUNAS**.

---

## 7. Multi-Store

Satu nomor WhatsApp bisa terdaftar di **beberapa toko sekaligus**. Gunakan perintah berikut untuk berpindah antar toko.

### Lihat Semua Toko

```
/store list
```

Contoh balasan bot:
```
🏪 Store kamu (2):

1. Toko Utama ✅
   ID: `a1b2c3d`
2. Cabang Selatan
   ID: `f7e6d5c`

/store switch <ID> untuk ganti toko
```

Tanda ✅ = toko yang sedang aktif.

---

### Ganti Toko Aktif

```
/store switch <store-id>
```

Cukup ketik **8 karakter pertama** dari Store ID (tidak perlu UUID penuh).

**Contoh:**
```
/store switch f7e6d5c
```

Setelah ganti toko, semua perintah (`/order`, `/resume`, `/invoice`, dll) akan otomatis menggunakan toko yang baru dipilih.

> Pilihan toko aktif hanya berlaku untuk **sesi ini**. Jika bot restart, toko kembali ke default (toko pertama yang didaftarkan).

---

## 8. Buat Toko Baru

Buat toko baru langsung dari bot melalui **flow multi-langkah**.

### Langkah 1 — Mulai

```
/store baru
```

Bot akan mengirim template form seperti ini:

```
Nama Toko: 
No. Telepon: 
Nama Bank: 
No. Rekening: 
Atas Nama: 
Pesan Penutup Invoice: 
Kode Invoice: 
```

### Langkah 2 — Isi dan Kirim Kembali

Copy template di atas, isi semua field yang diperlukan, lalu kirim balik ke bot.

**Contoh:**
```
Nama Toko: Cabang Selatan
No. Telepon: 628112345678
Nama Bank: BCA
No. Rekening: 1234567890
Atas Nama: Budi Santoso
Pesan Penutup Invoice: Terima kasih sudah order!
Kode Invoice: CB
```

> Field **Nama Toko** wajib diisi. Field lain boleh dikosongkan.  
> Kode Invoice akan muncul di nomor invoice (contoh: `CB-202604001`). Kosongkan jika tidak pakai prefix.

### Langkah 3 — Upload Logo

Setelah form diproses, bot akan meminta **foto logo toko**. Kirim foto logo langsung di chat.

Logo akan diupload otomatis ke server dan dipasang sebagai watermark di invoice PDF.

Ketik `/batal` kapanpun untuk membatalkan proses atau skip langkah logo.

---

## 9. Perintah Umum

| Perintah | Fungsi |
|---|---|
| `/help` | Tampilkan daftar semua perintah |
| `/status` | Cek status bot dan toko aktif |
| `/reset` | Hapus riwayat percakapan AI |
| `/batal` | Batalkan proses yang sedang berlangsung |

---

## 10. Catatan Penting

**Nama pemesan tidak harus lengkap** — bot akan mencari yang paling cocok. Tapi gunakan nama yang cukup unik agar tidak salah order.

**Kode produk bersifat exact** — `SD` tidak akan cocok dengan `SDCC`. Pastikan kode yang diketik persis sesuai yang terdaftar.

**Pencarian batch** — perintah seperti `/cari`, `/invoice`, dan `/bayar` akan mencari di **batch terbaru** terlebih dahulu. Jika tidak ditemukan, baru mencari ke semua batch.

**AI chat** — selain perintah `/`, kamu bisa **mengobrol bebas** dengan bot. Bot akan menjawab pertanyaan seputar toko menggunakan AI.

**Dashboard** — untuk pengaturan toko, produk massal, laporan keuangan, dan konfigurasi lanjutan, gunakan dashboard web di browser.
