# Hardening nginx untuk server produksi Vicend

## Kenapa dokumen ini ada

Saat memeriksa salinan lokal Vicend di `C:\laragon\www\video-gen`, ditemukan bahwa
berkas kredensial dapat diunduh lewat HTTP:

```
http://localhost/video-gen/.env   ->  HTTP 200, 430 byte
```

Penyebabnya: folder berada di DocumentRoot web server tanpa penolakan dotfile, dan
directory listing menyala sehingga `.env`, `.git/`, dan `.next/` tampil sebagai tautan.

Untuk web server berbasis Apache/Laragon, hal itu sudah ditutup dengan berkas
`.htaccess` di root proyek. **Namun server produksi `192.168.1.100` menjalankan
nginx/1.18.0 (Ubuntu) — nginx mengabaikan `.htaccess` sepenuhnya.** Karena itu
penolakan harus ditulis di konfigurasi nginx.

> Status: **belum dipasang.** Dokumen ini disiapkan untuk Anda jalankan di server.
> Saya tidak memiliki akses ke server tersebut.

## Risiko bila dibiarkan

| Berkas | Dampak bila terbaca |
|---|---|
| `.env` | `SESSION_SECRET` (pemalsuan sesi login), `SUPERADMIN_PASSWORD`, `DATABASE_URL` (kredensial MySQL), token/kunci API |
| `.git/` | Riwayat commit, alamat remote, dan sisa konfigurasi |
| `.next/` | Manifest build, terkadang jejak variabel lingkungan saat build |
| Directory listing | Memudahkan penyerang memetakan aplikasi |

## Cara 1 — Blok di level server (disarankan)

Tambahkan pada blok `server` yang melayani `/video-gen` (biasanya di
`/etc/nginx/sites-available/...`):

```nginx
# Tolak berkas/direktori tersembunyi (dotfile): .env, .git, .next, .gitignore
location ~ /\. {
    deny all;
    access_log off;
    log_not_found off;
    return 404;
}

# Tolak berkas kredensial & artefak build walau tidak diawali titik
location ~* ^/video-gen/(\.env.*|next\.config\.(ts|js|mjs)|tsconfig\.json|package(-lock)?\.json|pnpm-lock\.yaml)$ {
    deny all;
    return 404;
}

# Tolak folder internal
location ~* ^/video-gen/(node_modules|database|uploads)/ {
    deny all;
    return 404;
}

# Matikan directory listing secara global
autoindex off;
```

Lalu uji konfigurasi dan muat ulang:

```bash
sudo nginx -t          # harus: syntax is ok / test is successful
sudo systemctl reload nginx
```

## Cara 2 — Kalau `deny all` tidak cukup karena ada rule lain

Bila ada `location /video-gen` yang lebih spesifik dan menang, letakkan blok
penolakan **di dalam** location tersebut, dan pastikan urutannya lebih dulu:

```nginx
location /video-gen {
    # letakkan di paling atas blok ini
    location ~ /\. { deny all; return 404; }

    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}
```

Catatan: aplikasi memerlukan `X-Forwarded-Proto`/`X-Forwarded-Host` yang benar bila
di belakang proxy, karena kode memakainya untuk menyusun URL absolut
(`requestOrigin()` di `src/generation/actions.ts`).

## Verifikasi setelah dipasang

Jalankan dari komputer lain (bukan server), ganti `IP` sesuai server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://IP/video-gen/.env          # harap 403/404
curl -s -o /dev/null -w "%{http_code}\n" http://IP/video-gen/.git/config   # harap 403/404
curl -s -o /dev/null -w "%{http_code}\n" http://IP/video-gen/.next/BUILD_ID # harap 403/404
curl -s -o /dev/null -w "%{http_code}\n" http://IP/video-gen/              # harap 200 (aplikasi hidup)
curl -s -o /dev/null -w "%{http_code}\n" http://IP/video-gen/login          # harap 200
```

Dua baris terakhir memastikan penolakan tidak merusak aplikasi.

## Tindakan tambahan yang disarankan

1. **Rotasi kredensial.** Karena `.env` sempat dapat dibaca lewat jaringan, ganti
   `SESSION_SECRET` dan `SUPERADMIN_PASSWORD` produksi setelah hardening terpasang.
   Mengganti `SESSION_SECRET` akan memaksa semua sesi login lama berakhir — itu wajar
   dan justru diinginkan.
2. **Batasi akses jaringan.** Bila aplikasi hanya untuk pegawai, batasi port 80 di
   firewall ke subnet kantor saja.
3. **Jangan simpan kunci API di `.env` produksi** bila bisa dihindari — aplikasi ini
   sudah menyimpan kunci OpenRouter per akun dalam bentuk terenkripsi di database.
