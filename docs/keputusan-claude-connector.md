# Keputusan: connector Claude untuk Vicend

Tujuan: akun Vicend menerbitkan token API (pribadi atau workspace tim yang sedang aktif). Token itu dipakai Claude.ai sebagai custom connector supaya generate gambar, video, dan audio tetap lewat Vicend dan tercatat di akun serta workspace token.

## Yang Claude minta (sumber resmi, 24 Nov 2026)

- Custom connector adalah server MCP remote. Transport yang dipakai Streamable HTTP, satu URL POST JSON-RPC, contoh `https://host/mcp`.
- Claude menghubungi server dari infrastruktur Anthropic, bukan dari browser pengguna. Host harus publik di HTTPS port 443. Port lain ditolak.
- Autentikasi yang cocok dengan tempel token: header tetap. Nama yang Claude izinkan tanpa review khusus: `Authorization`, `x-api-key`, `x-auth-token`. Token tidak boleh di query string.
- Header statis di paket Team/Enterprise masih beta untuk sebagian organisasi. Paket Pro/Max menampilkan Request headers saat menambah custom connector. OAuth per orang tidak dipilih, karena permintaan ini adalah satu token Vicend per connector.
- Server tidak mengirim `WWW-Authenticate` berisi `resource_metadata`, supaya Claude tidak memaksa alur OAuth.
- Direktori connector Anthropic tidak diajukan. Pengguna menambah URL sendiri.

Sumber: [Authentication for connectors](https://claude.com/docs/connectors/building/authentication), [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [MCP Streamable HTTP 2025-03-26](https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/).

## Keputusan di Vicend

| Keputusan | Alasan |
| --- | --- |
| Satu route `POST /mcp`, tanpa paket SDK | Protokol yang Claude pakai hanya initialize, tools/list, tools/call, ping, dan notifikasi. SDK menambah dependency tanpa mengubah perilaku. |
| Tanpa session MCP | Token Bearer sudah identitas. Session id kedua tidak mengubah pencatatan job. |
| `initialize` dan `tools/list` tanpa token | Claude bisa mengenali URL sebelum header diuji. Generate tetap menolak tanpa token. |
| Generate memakai `submitGeneration` yang sama dengan `POST /api/v1/generate` | Satu jalur katalog, kuota, job, galeri, dan usage. |
| Token baru menyimpan `team_id` workspace yang aktif saat dibuat | Kolom sudah ada di migrasi `012_teams.sql`. Token lama tetap `NULL` (personal). |
| Usage dan galeri API memakai `team_id` token, bukan cookie | Claude tidak punya sesi browser. |
| Tidak mengubah kunci platform | Token tetap membuka kunci OpenRouter atau Higgsfield milik pemilik token. Di tim, pemakaian kunci sendiri dicatat lewat `noteOwnKeyUsage` saat job sukses. |
| Uji langsung ke claude.ai tidak dijalankan | Diminta pengguna. Host lokal tidak terlihat Anthropic. |

## Cara pakai

1. Login Vicend. Pilih workspace Personal atau tim.
2. Buat API token dengan scope Read dan Start generations.
3. Di Claude: Customize atau Organization settings, Connectors, Add custom connector, Web.
4. URL: `https://<host-vicend>/mcp` (ikut base path bila ada, misalnya `https://host/video-gen/mcp`).
5. Authentication: No sign in.
6. Request header: nama `Authorization`, nilai `Bearer vic_...`.
7. Minta Claude memakai tool `vicend_list_models`, `vicend_generate`, lalu `vicend_job`.

Tool: `vicend_whoami`, `vicend_list_models`, `vicend_generate`, `vicend_job`.

## Yang belum

- Listing di direktori connector Anthropic.
- OAuth supaya tiap anggota Claude login Vicend sendiri. Header statis memakai satu token untuk semua orang yang memakai connector itu di organisasi Claude.
- Host produksi harus sudah HTTPS 443. `pnpm verify:studio` hanya membuktikan studio lokal, bukan jangkauan Anthropic.
