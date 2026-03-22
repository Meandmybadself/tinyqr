# TinyQR

**Repository:** [github.com/Meandmybadself/tinyqr](https://github.com/Meandmybadself/tinyqr)

Static client-only page: enter a URL, render a small QR code on a canvas sized for your Niimbot label, then print over **Web Bluetooth** using [@mmote/niimbluelib](https://www.npmjs.com/package/@mmote/niimbluelib) (pinned in `index.html`).

## Requirements

- **HTTPS** (e.g. GitHub Pages with “Enforce HTTPS”). Web Bluetooth is only available in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
- A **Chromium-based** browser with Web Bluetooth (Chrome, Edge, etc.). Safari does not support Web Bluetooth for this use case.

## URL query parameters

- `?url=` or `?u=` — prefill the URL field and generate the QR. Encode the value, e.g.  
  `?url=${encodeURIComponent('https://example.com/path')}`

**YouTube:** Watch, Shorts, embed, `music.youtube.com`, and `youtube-nocookie.com` single-video URLs are rewritten to **`https://youtu.be/VIDEO_ID`**. Timestamp `t` / `start` is kept when present; other query params are dropped.

## GitHub Pages and custom domain

1. Push this repo and enable **Settings → Pages** (source: branch or `/docs` as you prefer).
2. Add a `CNAME` file (already present) with your hostname: `tinyqr.meandmybadself.com`.
3. In your DNS provider, create a **CNAME** from `tinyqr.meandmybadself.com` to `<your-user>.github.io`.
4. After DNS propagates, enable **Enforce HTTPS** in the Pages settings.

See [GitHub: custom domains for Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).

## Niimbot / label sizing

Pick the **printer model** (fallback if auto-detection fails) and set **label length (mm)** along the feed axis to match your roll. The canvas uses the library’s `printheadPixels` and `printDirection` for the other axis. Wrong dimensions will stretch or clip on the physical label.

**Remembered settings:** `localStorage` keys `tinyqr.printerModel` and `tinyqr.labelMm` store the model dropdown and label length between visits. Bluetooth auto-detect updates the model and saves it when it matches a known option.

**Printed label:** The URL is shown in small monospace text without the `http://` or `https://` prefix, with a **line break after the hostname** (path/query/hash on the next line). It is truncated to 25 characters total with an ellipsis when longer. The QR still encodes the full normalized URL. On **wide** canvases (width ≥ 140px and width ≥ 1.12× height, e.g. B1-style labels), the QR is **left** and the URL is drawn in the strip **immediately to its right** (not flush to the far edge) so the QR can grow with label height; narrower labels keep the URL in a **band below** the QR.

## Disclaimer

NiimBlueLib is third-party, alpha, and not affiliated with Niimbot. Use at your own risk.
