# Tsuki Reader

A free, offline comic and book reader that runs in the browser and installs like an app (PWA).
Everything is stored on your device (IndexedDB). No accounts, no ads, no paywall.

**Comics:** CBZ, CBR, CB7, CBT (also zip / rar / 7z / tar) — ComicInfo.xml metadata supported
**Books & documents:** PDF, EPUB, DOCX, TXT, Markdown

## Features
- Library grid with NEW / READING badges, progress bars, favorites, tags, collections
- Browse by Series, Authors, Years, Tags, Collections; list-style "My Files" view
- Reader: left-to-right, manga right-to-left, webtoon vertical scroll; pinch / double-tap zoom;
  fit screen / width / height / original; double-page spreads; page thumbnails; bookmarks;
  undo/redo jumps; save page image; night dimming; keyboard shortcuts
- Document reader: contents, search, bookmarks, font / size / spacing / width, 5 reading themes
- 10 app themes (Light, Dark, AMOLED, Sepia, Ocean, Forest, Rose, Lavender, Sunset, Auto)
- Edit book info; export / share the original file; works fully offline once installed

## Run locally
    bash tools/setup.sh              # once: downloads libraries into vendor/ and generates icons/ (needs Node + Python)
    python3 -m http.server 8080      # then open http://localhost:8080
(Service workers and file handling need http://localhost or https.)

## Deploy
- **Netlify:** connect the repo (the included `netlify.toml` runs the setup step), or run `bash tools/setup.sh` locally and drag the folder onto https://app.netlify.com/drop
- **GitHub Pages:** push to a repo's `main` branch → Settings → Pages → Source: *GitHub Actions*
  (the included workflow runs the setup step and deploys it). The app uses relative paths, so repo sub-paths work.

## Install on a phone
Open the deployed URL in Chrome → menu → *Add to Home screen* / *Install app*.

## Keyboard shortcuts (reader)
←/→ turn page · Space/PageDown next · Home/End first/last · +/− zoom · F fullscreen · M toggle controls · B bookmark · Esc back

## Third-party libraries (fetched into /vendor)
pdf.js (Apache-2.0), JSZip (MIT), libarchive.js (BSD/Apache), mammoth.js (BSD-2), marked (MIT) — downloaded from npm by `tools/setup.sh`.
Material icon paths: Apache-2.0. This project is an independent app and contains no code or assets from Kuro Reader.
