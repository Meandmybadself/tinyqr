(function () {
  "use strict";

  const lib = window.niimbluelib;
  const QRious = window.QRious;

  const urlInput = document.getElementById("urlInput");
  const generateBtn = document.getElementById("generateBtn");
  const urlError = document.getElementById("urlError");
  const modelSelect = document.getElementById("modelSelect");
  const labelMmInput = document.getElementById("labelMm");
  const printCanvas = document.getElementById("printCanvas");
  const canvasMeta = document.getElementById("canvasMeta");
  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const printBtn = document.getElementById("printBtn");
  const statusLine = document.getElementById("statusLine");
  const logPane = document.getElementById("logPane");
  const bluetoothNote = document.getElementById("bluetoothNote");

  if (!lib || !QRious) {
    document.body.innerHTML =
      "<p style=\"font-family:system-ui;padding:2rem\">Missing QR or Niimbot libraries. Check the script tags and network.</p>";
    return;
  }

  const {
    NiimbotBluetoothClient,
    ImageEncoder,
    modelsLibrary,
    getPrinterMetaByModel,
    RequestCommandId,
    ResponseCommandId,
    Utils,
  } = lib;

  let client = null;
  const qrScratch = document.createElement("canvas");

  const LS_MODEL = "tinyqr.printerModel";
  const LS_LABEL_MM = "tinyqr.labelMm";
  const URL_CAPTION_MAX = 25;
  /** Wide labels (e.g. B1): QR left, URL beside it for a larger code. */
  const STICKER_SIDE_MIN_WIDTH = 140;
  const STICKER_SIDE_MIN_WIDTH_RATIO = 1.12;
  /** Min horizontal space reserved beside the QR for the URL column. */
  const STICKER_SIDE_TEXT_RESERVE = 40;
  /** Horizontal space between QR and URL in side-by-side layout. */
  const STICKER_QR_TEXT_GAP = 40;

  function persistModel() {
    try {
      localStorage.setItem(LS_MODEL, modelSelect.value);
    } catch {
      /* private mode / quota */
    }
  }

  function persistLabelMm() {
    const n = parseFloat(labelMmInput.value, 10);
    if (!Number.isFinite(n)) return;
    try {
      localStorage.setItem(LS_LABEL_MM, String(n));
    } catch {
      /* ignore */
    }
  }

  function loadPreferences() {
    try {
      const savedModel = localStorage.getItem(LS_MODEL);
      if (
        savedModel &&
        Array.from(modelSelect.options).some((o) => o.value === savedModel)
      ) {
        modelSelect.value = savedModel;
      }
      const savedMm = localStorage.getItem(LS_LABEL_MM);
      if (savedMm != null) {
        const n = parseFloat(savedMm, 10);
        if (Number.isFinite(n) && n >= 6 && n <= 200) {
          labelMmInput.value = String(n);
        }
      }
    } catch {
      /* ignore */
    }
  }

  function stickerUrlWithoutScheme(href) {
    return href.replace(/^https?:\/\//i, "");
  }

  function stickerUrlCaption(href) {
    const display = stickerUrlWithoutScheme(href);
    if (display.length > URL_CAPTION_MAX) {
      return display.slice(0, URL_CAPTION_MAX) + "\u2026";
    }
    return display;
  }

  function captionFontPx(ctx, pw, ph, text) {
    let fontPx = Math.max(
      5,
      Math.min(14, Math.floor(Math.min(pw, ph) * 0.12))
    );
    ctx.save();
    ctx.textAlign = "center";
    for (;;) {
      ctx.font = `${fontPx}px ui-monospace, monospace, sans-serif`;
      if (ctx.measureText(text).width <= pw - 4 || fontPx <= 5) break;
      fontPx -= 1;
    }
    ctx.restore();
    return fontPx;
  }

  /** Vertical space reserved under the QR for the caption line. */
  function captionBandHeight(ctx, pw, ph, text) {
    return captionFontPx(ctx, pw, ph, text) + 3;
  }

  function drawUrlCaption(ctx, pw, ph, text) {
    const fontPx = captionFontPx(ctx, pw, ph, text);
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = `${fontPx}px ui-monospace, monospace, sans-serif`;
    ctx.fillText(text, pw / 2, ph - 1);
  }

  function shouldUseStickerSideLayout(pw, ph) {
    return (
      pw >= STICKER_SIDE_MIN_WIDTH &&
      pw >= ph * STICKER_SIDE_MIN_WIDTH_RATIO
    );
  }

  function wrapStickerCaption(text, charsPerLine) {
    const n = Math.max(1, charsPerLine);
    const lines = [];
    for (let i = 0; i < text.length; i += n) {
      lines.push(text.slice(i, i + n));
    }
    return lines.length ? lines : [""];
  }

  function fitStickerCaptionInRect(ctx, text, w, h) {
    let fontPx = Math.max(
      5,
      Math.min(16, Math.floor(Math.min(w, h) * 0.18))
    );
    let lines;
    let lineHeight;
    for (;;) {
      ctx.font = `${fontPx}px ui-monospace, monospace, sans-serif`;
      const cpl = Math.max(3, Math.floor(w / (fontPx * 0.55)));
      lines = wrapStickerCaption(text, cpl);
      lineHeight = fontPx + 1;
      if (lines.length * lineHeight <= h || fontPx <= 5) break;
      fontPx -= 1;
    }
    return { fontPx, lines, lineHeight };
  }

  function drawUrlCaptionInRect(ctx, x, y, w, h, text) {
    const { fontPx, lines, lineHeight } = fitStickerCaptionInRect(
      ctx,
      text,
      w,
      h
    );
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = `${fontPx}px ui-monospace, monospace, sans-serif`;
    const blockH = lines.length * lineHeight;
    let y0 = y + Math.max(0, (h - blockH) / 2);
    for (const line of lines) {
      ctx.fillText(line, x, y0);
      y0 += lineHeight;
    }
    ctx.restore();
  }

  function log(msg) {
    const line = typeof msg === "string" ? msg : String(msg);
    console.log(line);
    logPane.textContent += line + "\n";
    logPane.scrollTop = logPane.scrollHeight;
  }

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function showUrlError(message) {
    if (message) {
      urlError.textContent = message;
      urlError.hidden = false;
    } else {
      urlError.textContent = "";
      urlError.hidden = true;
    }
  }

  function isYouTubeVideoId(id) {
    return typeof id === "string" && /^[\w-]{11}$/.test(id);
  }

  /** Single-video YouTube links → https://youtu.be/VIDEO_ID (optional ?t= / ?start=). */
  function shortenYouTubeUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id = null;

    if (host === "youtu.be") {
      id =
        url.pathname.split("/").filter(Boolean)[0]?.split("?")[0] ?? null;
      if (!isYouTubeVideoId(id)) return null;
      const out = new URL(`https://youtu.be/${id}`);
      const t = url.searchParams.get("t") ?? url.searchParams.get("start");
      if (t) out.searchParams.set("t", t);
      return out.href;
    }

    const ytLong =
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com";

    if (!ytLong) return null;

    const path = url.pathname;
    if (path === "/watch" || path === "/watch/") {
      id = url.searchParams.get("v");
    } else if (path.startsWith("/embed/")) {
      id = path.split("/")[2] ?? null;
    } else if (path.startsWith("/v/")) {
      id = path.split("/")[2] ?? null;
    } else if (path.startsWith("/shorts/")) {
      id = path.split("/")[2] ?? null;
    } else if (path.startsWith("/live/")) {
      id = path.split("/")[2] ?? null;
    }

    if (!id || !isYouTubeVideoId(id)) return null;

    const out = new URL(`https://youtu.be/${id}`);
    const t = url.searchParams.get("t") ?? url.searchParams.get("start");
    if (t) out.searchParams.set("t", t);
    return out.href;
  }

  function normalizeUrl(raw) {
    const t = raw.trim();
    if (!t) return null;
    let href = null;
    try {
      const u = new URL(t);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
    } catch {
      /* try with https */
    }
    if (href == null) {
      try {
        const u = new URL("https://" + t);
        if (u.hostname) href = u.href;
      } catch {
        return null;
      }
    }
    const shortYt = shortenYouTubeUrl(href);
    return shortYt ?? href;
  }

  function feedPixels(meta, mm) {
    const n = Number(mm);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.max(1, Math.round((n / 25.4) * meta.dpi));
  }

  /** Set print canvas internal resolution from model meta + label length (mm). */
  function applyCanvasDimensions() {
    const modelKey = modelSelect.value;
    const meta = getPrinterMetaByModel(modelKey);
    const feed = feedPixels(meta, labelMmInput.value);
    if (!meta || feed == null) {
      canvasMeta.textContent = "";
      return null;
    }

    const head = meta.printheadPixels;
    if (meta.printDirection === "left") {
      printCanvas.width = feed;
      printCanvas.height = head;
    } else {
      printCanvas.width = head;
      printCanvas.height = feed;
    }

    canvasMeta.textContent =
      `${meta.model} · ${printCanvas.width}×${printCanvas.height}px · ` +
      `${meta.dpi} dpi · printDirection “${meta.printDirection}” (head ${head}px)`;

    return meta;
  }

  function fillWhite() {
    const ctx = printCanvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, printCanvas.width, printCanvas.height);
  }

  function drawQrForUrl(href) {
    const meta = applyCanvasDimensions();
    if (!meta) {
      showUrlError("Invalid label length or model.");
      return;
    }

    fillWhite();
    const ctx = printCanvas.getContext("2d");
    const pw = printCanvas.width;
    const ph = printCanvas.height;
    const captionText = stickerUrlCaption(href);
    const pad = 3;
    let side;
    let useSide = false;

    if (shouldUseStickerSideLayout(pw, ph)) {
      const maxByHeight = ph - 2 * pad;
      const maxByWidth =
        pw -
        2 * pad -
        STICKER_QR_TEXT_GAP -
        STICKER_SIDE_TEXT_RESERVE;
      const tentative = Math.floor(
        Math.min(maxByHeight, maxByWidth) * 0.97
      );
      if (tentative >= 28) {
        useSide = true;
        side = tentative;
      }
    }

    if (!useSide) {
      const capH = captionBandHeight(ctx, pw, ph, captionText);
      const avail = Math.min(pw, ph - capH);
      side = Math.floor(avail * 0.92);
      if (side < 28 || avail < 32) {
        showUrlError("Canvas too small for a QR code and caption.");
        return;
      }
    }

    qrScratch.width = side;
    qrScratch.height = side;
    try {
      new QRious({
        element: qrScratch,
        value: href,
        size: side,
        background: "#ffffff",
        foreground: "#000000",
        level: "M",
      });
    } catch (e) {
      showUrlError(e.message || "Could not build QR code.");
      return;
    }

    if (useSide) {
      const qx = pad;
      const qy = Math.max(pad, Math.floor((ph - side) / 2));
      ctx.drawImage(qrScratch, qx, qy);
      const textX = qx + side + STICKER_QR_TEXT_GAP;
      const textY = pad;
      const textW = pw - textX - pad;
      const textH = ph - 2 * pad;
      drawUrlCaptionInRect(ctx, textX, textY, textW, textH, captionText);
    } else {
      const capH = captionBandHeight(ctx, pw, ph, captionText);
      const bandTop = ph - capH;
      const x = Math.floor((pw - side) / 2);
      const y = Math.max(1, Math.floor((bandTop - side) / 2));
      ctx.drawImage(qrScratch, x, y);
      drawUrlCaption(ctx, pw, ph, captionText);
    }
    showUrlError("");
  }

  function generate() {
    const href = normalizeUrl(urlInput.value);
    if (!href) {
      showUrlError("Enter a valid http(s) URL (or a host like example.com).");
      applyCanvasDimensions();
      fillWhite();
      return;
    }
    urlInput.value = href;
    drawQrForUrl(href);
  }

  function populateModels() {
    const sorted = modelsLibrary.slice().sort((a, b) => {
      if (a.model < b.model) return -1;
      if (a.model > b.model) return 1;
      return 0;
    });
    modelSelect.innerHTML = "";
    for (const m of sorted) {
      const opt = document.createElement("option");
      opt.value = m.model;
      opt.textContent = m.model;
      modelSelect.appendChild(opt);
    }
    const want = "D110";
    const has = sorted.some((m) => m.model === want);
    modelSelect.value = has ? want : sorted[0]?.model ?? "";
  }

  function attachClientLogging(c) {
    c.on("packetsent", (e) => {
      const name = RequestCommandId[e.packet.command] ?? e.packet.command;
      log(`>> ${Utils.bufToHex(e.packet.toBytes())} (${name})`);
    });
    c.on("packetreceived", (e) => {
      const name = ResponseCommandId[e.packet.command] ?? e.packet.command;
      log(`<< ${Utils.bufToHex(e.packet.toBytes())} (${name})`);
    });
    c.on("connect", () => {
      setStatus("Connected.");
      disconnectBtn.disabled = false;
      printBtn.disabled = false;
      connectBtn.disabled = true;
      const detected = c.getPrintTaskType?.() ?? null;
      if (detected) {
        log(`Detected print task type: ${detected}`);
        const opt = Array.from(modelSelect.options).find((o) => o.value === detected);
        if (opt) {
          modelSelect.value = detected;
          persistModel();
        }
      }
    });
    c.on("disconnect", () => {
      setStatus("Disconnected.");
      disconnectBtn.disabled = true;
      printBtn.disabled = true;
      connectBtn.disabled = false;
    });
    c.on("printprogress", (e) => {
      log(
        `Print progress: page ${e.page}/${e.pagesTotal}, ` +
          `page ${e.pagePrintProgress}%, feed ${e.pageFeedProgress}%`
      );
    });
  }

  connectBtn.addEventListener("click", async () => {
    if (!navigator.bluetooth) {
      alert("Web Bluetooth is not available in this browser.");
      return;
    }
    if (client) {
      client.disconnect();
      client = null;
    }
    client = new NiimbotBluetoothClient();
    attachClientLogging(client);
    logPane.textContent = "";
    setStatus("Connecting…");
    try {
      await client.connect();
    } catch (e) {
      log(`Connect error: ${e.message || e}`);
      setStatus("Connection failed.");
      alert(e.message || String(e));
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      client = null;
    }
  });

  disconnectBtn.addEventListener("click", () => {
    if (client) {
      client.disconnect();
      client = null;
    }
  });

  printBtn.addEventListener("click", async () => {
    if (!client) {
      alert("Connect to the printer first.");
      return;
    }
    const meta = getPrinterMetaByModel(modelSelect.value);
    if (!meta) {
      alert("Unknown printer model.");
      return;
    }
    const href = normalizeUrl(urlInput.value);
    if (!href) {
      alert("Generate a valid QR from a URL first.");
      return;
    }

    const quantity = 1;
    const printDirection = meta.printDirection;
    let encoded;
    try {
      encoded = ImageEncoder.encodeCanvas(printCanvas, printDirection);
    } catch (e) {
      alert(e.message || String(e));
      return;
    }

    const printTaskName = client.getPrintTaskType?.() ?? modelSelect.value;
    const printTask = client.abstraction.newPrintTask(printTaskName, {
      totalPages: quantity,
      statusPollIntervalMs: 100,
      statusTimeoutMs: 8000,
    });

    log(`Starting print job (${printTaskName})…`);
    try {
      await printTask.printInit();
      await printTask.printPage(encoded, quantity);
      await printTask.waitForPageFinished();
      await printTask.waitForFinished();
      log("Print finished.");
    } catch (e) {
      log(`Print error: ${e.message || e}`);
      alert(e.message || String(e));
    } finally {
      await printTask.printEnd();
    }
  });

  generateBtn.addEventListener("click", generate);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") generate();
  });

  function onLayoutChange() {
    applyCanvasDimensions();
    const href = normalizeUrl(urlInput.value);
    if (href) drawQrForUrl(href);
    else fillWhite();
  }

  modelSelect.addEventListener("change", () => {
    persistModel();
    onLayoutChange();
  });
  labelMmInput.addEventListener("change", () => {
    persistLabelMm();
    onLayoutChange();
  });
  labelMmInput.addEventListener("input", () => {
    persistLabelMm();
    onLayoutChange();
  });

  function initFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("url") ?? params.get("u");
    if (!raw) return;
    try {
      urlInput.value = decodeURIComponent(raw);
    } catch {
      urlInput.value = raw;
    }
    generate();
  }

  if (!window.isSecureContext || !navigator.bluetooth) {
    bluetoothNote.hidden = false;
  }

  populateModels();
  loadPreferences();
  applyCanvasDimensions();
  fillWhite();
  initFromQuery();

  setStatus("Disconnected.");
})();
