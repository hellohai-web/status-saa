        // Compression runs entirely in the browser with WebCodecs (hardware encoder when the device has one).
        const LIB_URLS = [
            'https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/+esm',
            'https://esm.sh/mediabunny@1.61.3'
        ];

        const $ = (id) => document.getElementById(id);
        const dropzone = $('dropzone'), fileInput = $('fileInput'), fileInfoBox = $('fileInfoBox');
        const fileName = $('fileName'), fileSize = $('fileSize'), fileMeta = $('fileMeta');
        const removeFileBtn = $('removeFileBtn'), optionsWrap = $('optionsWrap'), settingsFieldset = $('settingsFieldset');
        const codecSelect = $('codecSelect'), fpsSelect = $('fpsSelect'), methodSelect = $('methodSelect');
        const sizeContainer = $('sizeContainer'), targetSizeInput = $('targetSizeInput');
        const resolutionContainer = $('resolutionContainer'), resolutionSelect = $('resolutionSelect');
        const sliderContainer = $('sliderContainer'), sizeSlider = $('sizeSlider'), sliderValue = $('sliderValue');
        const compatCheck = $('compatCheck'), compressBtn = $('compressBtn'), statusText = $('statusText');
        const progressBox = $('progressBox'), progressBar = $('progressBar'), progressPct = $('progressPct');
        const progressLabel = $('progressLabel'), progressTrack = $('progressTrack'), cancelBtn = $('cancelBtn');
        const resultBox = $('resultBox'), previewVideo = $('previewVideo'), previewNote = $('previewNote');
        const resultInfo = $('resultInfo'), downloadBtn = $('downloadBtn');
        const encoderText = $('encoderText'), browserWarning = $('browserWarning');
        const inAppNotice = $('inAppNotice'), downloadHelp = $('downloadHelp'), downloadHelpText = $('downloadHelpText');
        const shareBtn = $('shareBtn'), openTabLink = $('openTabLink');

        const MB = 1024 * 1024;
        const CODEC_INFO = {
            avc:  { short: 'AVC',  factor: 1.00 },
            hevc: { short: 'HEVC', factor: 0.65 }
        };
        // bpp = bits per pixel per frame; keep = share of the original video bitrate that may be used.
        const QUALITY_LEVELS = [
            { name: 'Smallest', bpp: 0.035, keep: 0.30 },
            { name: 'Small',    bpp: 0.055, keep: 0.45 },
            { name: 'Balanced', bpp: 0.085, keep: 0.60 },
            { name: 'High',     bpp: 0.125, keep: 0.78 },
            { name: 'Best',     bpp: 0.180, keep: 0.92 }
        ];
        const defaultButtonHTML = '<i class="fa-solid fa-compress mr-2"></i> Compress Video Now';

        let selectedFile = null;
        let mediaInfo = null;          // details read from the chosen video
        let analyzeToken = 0;
        let isProcessing = false;
        let activeConversion = null;
        let canceled = false;
        let resultUrl = null;
        let resultBlob = null;
        let resultName = 'video_compressed.mp4';

        // In-app browsers (Instagram, TikTok, Facebook, Android WebView...) usually block blob downloads.
        const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|musical_ly|BytedanceWebview|TikTok|Snapchat|Twitter|; wv\)/i.test(navigator.userAgent);

        // iPhone / iPad / Safari (WebKit): the video encoder's default mode can stop producing output and the
        // conversion then hangs forever (mediabunny issues #333 / #541). 'realtime' mode avoids that.
        const IS_WEBKIT = /iPhone|iPad|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
            || /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
        if (IS_WEBKIT && typeof VideoEncoder === 'function') {
            const NativeVideoEncoder = VideoEncoder;
            window.VideoEncoder = class extends NativeVideoEncoder {
                configure(config) { return super.configure({ ...config, latencyMode: 'realtime' }); }
            };
        }

        // ---------- helpers ----------
        const setStatus = (m) => { statusText.textContent = m; };
        const even = (n) => Math.max(2, Math.round(n / 2) * 2);

        function formatBytes(bytes) {
            if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            if (bytes === 0) return '0 B';
            const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
            return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
        }
        function formatDuration(s) {
            if (!Number.isFinite(s)) return '';
            const m = Math.floor(s / 60), r = Math.round(s % 60);
            return m ? `${m}m ${r}s` : `${s.toFixed(1)}s`;
        }
        const safeBaseName = (name) => name.replace(/\.[^/.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'video';

        let libPromise = null;
        function loadLib() {
            if (!libPromise) {
                libPromise = (async () => {
                    let lastError;
                    for (const url of LIB_URLS) {
                        try { return await import(url); } catch (e) { lastError = e; }
                    }
                    console.error(lastError);
                    throw new Error('Could not load the video engine. Check your internet connection (turn off VPN or ad-blockers if you use them) and try again.');
                })();
                libPromise.catch(() => { libPromise = null; });
            }
            return libPromise;
        }

        // ---------- browser support ----------
        const supportsWebCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
        if (!supportsWebCodecs) {
            browserWarning.textContent = 'This browser does not support in-browser video encoding (WebCodecs). Please use the latest Chrome, Edge or Safari.';
            browserWarning.classList.remove('hidden');
        } else {
            loadLib().catch(showEngineError); // start downloading the engine while the user picks a file
        }
        if (IN_APP) inAppNotice.classList.remove('hidden');

        function showEngineError(error) {
            browserWarning.innerHTML = '';
            const msg = document.createElement('p');
            msg.textContent = error?.message || 'Could not load the video engine. Check your internet connection and try again.';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'mt-2 font-semibold underline';
            retry.textContent = 'Try again';
            retry.addEventListener('click', () => {
                browserWarning.classList.add('hidden');
                loadLib().catch(showEngineError);
            });
            browserWarning.append(msg, retry);
            browserWarning.classList.remove('hidden');
        }

        function updateEncoderText() {
            encoderText.textContent = `Encoder: ${CODEC_INFO[codecSelect.value].short} (Hardware)`;
        }
        codecSelect.addEventListener('change', updateEncoderText);

        // Grey out codecs this device cannot encode.
        async function markSupportedCodecs(width, height) {
            try {
                const { canEncodeVideo, Quality } = await loadLib();
                for (const option of codecSelect.options) {
                    const ok = await canEncodeVideo(option.value, {
                        width: even(width), height: even(height), quality: new Quality({ bitrate: 5e6 })
                    }).catch(() => false);
                    option.disabled = !ok;
                    option.textContent = option.textContent.replace(/ — not supported on this device$/, '') + (ok ? '' : ' — not supported on this device');
                }
                if (codecSelect.selectedOptions[0]?.disabled) {
                    const firstOk = [...codecSelect.options].find(o => !o.disabled);
                    if (firstOk) codecSelect.value = firstOk.value;
                }
                updateEncoderText();
            } catch (_) { /* keep all options enabled */ }
        }

        // ---------- file selection ----------
        function resetUI() {
            clearResult();
            progressBox.classList.add('hidden');
            fileInput.value = '';
            selectedFile = null;
            mediaInfo = null;
            analyzeToken++;
            fileInfoBox.classList.add('hidden');
            optionsWrap.classList.add('hidden');
            dropzone.classList.remove('hidden');
            compressBtn.disabled = true;
            fileMeta.textContent = '';
            setStatus('');
        }

        function clearResult() {
            resultBox.classList.add('hidden');
            previewNote.classList.add('hidden');
            previewVideo.removeAttribute('src');
            previewVideo.load();
            resultBlob = null;
            openTabLink.removeAttribute('href');
            shareBtn.classList.add('hidden');
            resultInfo.textContent = '';
            if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
        }

        async function analyzeFile(file) {
            const token = ++analyzeToken;
            fileMeta.textContent = 'Reading video details...';
            try {
                const { Input, BlobSource, ALL_FORMATS } = await loadLib();
                const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
                const videoTrack = await input.getPrimaryVideoTrack();
                if (!videoTrack) throw new Error('This file has no video track.');
                const audioTrack = await input.getPrimaryAudioTrack();
                const duration = await input.computeDuration();
                const width = await videoTrack.getDisplayWidth();
                const height = await videoTrack.getDisplayHeight();
                const codec = await videoTrack.getCodec();
                const canDecode = await videoTrack.canDecode();

                let fps = null, videoBitrate = null, audioBitrate = null, audioCodec = null;
                try {
                    const s = await videoTrack.computePacketStats(300);
                    fps = s.averagePacketRate ?? s.packetsPerSecond ?? null;
                    videoBitrate = s.averageBitrate || null;
                } catch (_) {}
                if (audioTrack) {
                    audioCodec = await audioTrack.getCodec().catch(() => null);
                    try { audioBitrate = (await audioTrack.computePacketStats(300)).averageBitrate || null; } catch (_) {}
                }
                if (token !== analyzeToken) return;

                mediaInfo = {
                    duration, width, height, codec, canDecode, hasAudio: Boolean(audioTrack), audioCodec,
                    fps: fps && fps > 1 ? Math.round(fps) : null,
                    videoBitrate: videoBitrate || (duration > 0 ? (file.size * 8) / duration : null),
                    audioBitrate
                };

                const parts = [`${width}×${height}`];
                if (mediaInfo.fps) parts.push(`${mediaInfo.fps} FPS`);
                parts.push(formatDuration(duration));
                if (codec) parts.push(String(codec).toUpperCase());
                fileMeta.textContent = parts.filter(Boolean).join(' · ');

                if (!canDecode) {
                    setStatus('This browser cannot read this video\'s codec (' + String(codec || 'unknown').toUpperCase() + '). Try Safari, or Chrome/Edge on a device with hardware support.');
                    compressBtn.disabled = true;
                } else {
                    compressBtn.disabled = false;
                    setStatus('Choose your settings, then press Compress.');
                    markSupportedCodecs(width, height);
                }
            } catch (error) {
                if (token !== analyzeToken) return;
                console.error(error);
                mediaInfo = null;
                fileMeta.textContent = '';
                compressBtn.disabled = true;
                setStatus('Could not read this video: ' + (error?.message || error));
            }
        }

        function handleFile(file) {
            if (isProcessing) return;
            const isSupported = /\.(mp4|mov)$/i.test(file.name) || /^video\/(mp4|quicktime)$/.test(file.type);
            if (!isSupported) { setStatus('Only MP4 and MOV videos are supported.'); return; }

            clearResult();
            selectedFile = file;
            fileName.textContent = file.name;
            fileSize.textContent = formatBytes(file.size);
            dropzone.classList.add('hidden');
            fileInfoBox.classList.remove('hidden');
            optionsWrap.classList.remove('hidden');   // settings appear only now
            compressBtn.disabled = true;
            setStatus('');
            updateEncoderText();
            if (supportsWebCodecs) analyzeFile(file);
            else setStatus('This browser does not support in-browser encoding.');
        }

        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => { if (e.target.files?.length) handleFile(e.target.files[0]); });
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('border-emerald-600', 'bg-emerald-50/50'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-emerald-600', 'bg-emerald-50/50'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('border-emerald-600', 'bg-emerald-50/50');
            const files = e.dataTransfer?.files;
            if (files?.length) handleFile(files[0]);
        });
        removeFileBtn.addEventListener('click', (e) => { e.stopPropagation(); if (!isProcessing) resetUI(); });

        // ---------- settings ----------
        methodSelect.addEventListener('change', () => {
            const bySize = methodSelect.value === 'size';
            sizeContainer.classList.toggle('hidden', !bySize);
            resolutionContainer.classList.toggle('hidden', bySize);
            sliderContainer.classList.toggle('hidden', bySize);
        });
        sizeSlider.addEventListener('input', () => {
            sliderValue.textContent = QUALITY_LEVELS[Number(sizeSlider.value) - 1].name;
        });

        // ---------- progress ----------
        function setProgress(fraction) {
            const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
            progressBar.style.width = pct + '%';
            progressPct.textContent = pct + '%';
            progressTrack.setAttribute('aria-valuenow', String(pct));
        }

        // ---------- compression ----------
        const MIN_VIDEO_BPS = 100e3;
        const MAX_VIDEO_BPS = 150e6;
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

        // Removes the engine's name from the file metadata (same-length overwrite, so the file stays valid).
        function scrubToolName(buffer) {
            const bytes = new Uint8Array(buffer);
            const word = 'mediabunny';
            const unknown = 'Unknown';
            const isVersionChar = (c) => c === 0x20 || c === 0x76 || c === 0x56 || c === 0x2E || c === 0x2D || (c >= 0x30 && c <= 0x39);
            const scan = (from, to) => {
                for (let i = from; i <= to - word.length; i++) {
                    if ((bytes[i] | 0x20) !== 0x6d) continue;                     // quick check for "m"/"M"
                    let match = true;
                    for (let k = 1; k < word.length; k++) {
                        if ((bytes[i + k] | 0x20) !== word.charCodeAt(k)) { match = false; break; }
                    }
                    if (!match) continue;
                    for (let k = 0; k < word.length; k++) bytes[i + k] = k < unknown.length ? unknown.charCodeAt(k) : 0x20;
                    let j = i + word.length;
                    while (j < bytes.length && j < i + word.length + 16 && isVersionChar(bytes[j])) { bytes[j] = 0x20; j++; }
                    i = j - 1;
                }
            };
            const REGION = 16 * MB; // the metadata box sits at the start (or end) of the file
            if (bytes.length <= 2 * REGION) scan(0, bytes.length);
            else { scan(0, REGION); scan(bytes.length - REGION, bytes.length); }
            return buffer;
        }

        function planEncode(lib) {
            const info = mediaInfo;
            const { Quality } = lib;
            const codec = codecSelect.value;
            const bySize = methodSelect.value === 'size';

            // Resolution: only the quality method resizes, and never enlarges.
            const shortSide = bySize ? 0 : Number(resolutionSelect.value);
            const baseVideo = { codec, hardwareAcceleration: 'prefer-hardware', keyFrameInterval: compatCheck.checked ? 1 : 2 };
            let outW = info.width, outH = info.height;
            const inShort = Math.min(info.width, info.height);
            if (shortSide && inShort > shortSide) {
                const scale = shortSide / inShort;
                outW = even(info.width * scale);
                outH = even(info.height * scale);
                if (info.width < info.height) baseVideo.width = shortSide; else baseVideo.height = shortSide;
            }

            // Frame rate: only changed when the user locks it, and never raised.
            const lockedFps = fpsSelect.value === 'original' ? 0 : Number(fpsSelect.value);
            let outFps = info.fps || 30;
            if (lockedFps && (!info.fps || info.fps > lockedFps)) { baseVideo.frameRate = lockedFps; outFps = lockedFps; }

            const plan = {
                bySize, audio: null, audioBps: 0,
                software: false,
                makeVideo: (bps) => ({
                    ...baseVideo,
                    ...(plan.software ? { hardwareAcceleration: 'prefer-software' } : {}),
                    quality: new Quality({ bitrate: Math.round(bps) })
                })
            };

            if (bySize) {
                plan.targetBytes = parseFloat(targetSizeInput.value) * MB;
                const totalBps = (plan.targetBytes * 8 * 0.97) / info.duration;
                let audioBps = info.hasAudio ? (info.audioCodec === 'aac' && info.audioBitrate ? info.audioBitrate : 128e3) : 0;
                // Audio would eat too much of a small budget: re-encode it smaller.
                if (info.hasAudio && audioBps > totalBps * 0.2) {
                    audioBps = totalBps > 600e3 ? 96e3 : 64e3;
                    plan.audio = { quality: new Quality({ bitrate: audioBps }) };
                }
                plan.audioBps = audioBps;
                plan.initialBitrate = clamp(totalBps - audioBps, MIN_VIDEO_BPS, MAX_VIDEO_BPS);
            } else {
                const level = QUALITY_LEVELS[Number(sizeSlider.value) - 1];
                let est = outW * outH * outFps * level.bpp * CODEC_INFO[codec].factor;
                if (info.videoBitrate) {
                    // Never ask for more than a share of what the original already uses.
                    const pixelRatio = (outW * outH) / (info.width * info.height);
                    est = Math.min(est, info.videoBitrate * level.keep * Math.pow(pixelRatio, 0.8));
                }
                // Floor so a heavily downscaled video does not turn blocky (the size check below still protects against growth).
                // The floor can never push the bitrate above what the original video uses.
                const floorBps = outW * outH * outFps * 0.02 * CODEC_INFO[codec].factor;
                const originalCap = info.videoBitrate ? info.videoBitrate * level.keep : Infinity;
                est = Math.max(est, Math.min(floorBps, originalCap));
                plan.initialBitrate = clamp(est, 150e3, MAX_VIDEO_BPS);
            }
            return plan;
        }

        function describeDiscard(conversion) {
            const reasons = conversion.discardedTracks.map(d => `${d.track?.type || 'track'}: ${d.reason}`).join(', ');
            if (/undecodable/.test(reasons)) return 'This browser cannot decode this video\'s codec. Try another browser or device.';
            if (/no_encodable_target_codec/.test(reasons)) return 'This device cannot encode the selected codec. Choose H.264 / AVC.';
            return 'The video could not be converted (' + reasons + ').';
        }

        function setBusy(busy) {
            isProcessing = busy;
            settingsFieldset.disabled = busy;
            removeFileBtn.classList.toggle('opacity-40', busy);
            compressBtn.disabled = busy;
            compressBtn.innerHTML = busy
                ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Compressing...'
                : defaultButtonHTML;
        }

        // One full encode at a given video bitrate. Returns the finished MP4 as an ArrayBuffer.
        async function runPass(lib, plan, videoBps, onProgress) {
            const { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion } = lib;
            const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(selectedFile) });
            const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
            const options = { input, output, video: plan.makeVideo(videoBps) };
            if (plan.audio) options.audio = plan.audio;

            const conversion = await Conversion.init(options);
            if (!conversion.isValid) throw new Error(describeDiscard(conversion));
            activeConversion = conversion;
            conversion.onProgress = onProgress;
            await conversion.execute();
            activeConversion = null;
            return output.target.buffer;
        }

        // Hang detection: some phones' encoders stall silently. If progress does not move for a while, stop and retry safely.
        const STALL_MS = 45000;
        let stalled = false;

        async function runPassSafe(lib, plan, videoBps, onProgress) {
            for (let attempt = 0; ; attempt++) {
                stalled = false;
                let lastValue = -1, lastMoveAt = performance.now();
                const timer = setInterval(() => {
                    if (activeConversion && performance.now() - lastMoveAt > STALL_MS) {
                        stalled = true;
                        Promise.resolve(activeConversion.cancel()).catch(() => {});
                    }
                }, 3000);
                try {
                    return await runPass(lib, plan, videoBps, (p) => {
                        if (p !== lastValue) { lastValue = p; lastMoveAt = performance.now(); }
                        onProgress(p);
                    });
                } catch (error) {
                    activeConversion = null;
                    if (canceled && !stalled) throw error;
                    if (attempt === 0 && !plan.software) {
                        console.warn('Pass failed, retrying with the software encoder:', error);
                        plan.software = true;
                        encoderText.textContent = `Encoder: ${CODEC_INFO[codecSelect.value].short} (Software, safer mode)`;
                        progressLabel.textContent = 'Retrying in a safer mode (slower)...';
                        continue;
                    }
                    if (stalled) throw new Error('STALLED');
                    throw error;
                } finally {
                    clearInterval(timer);
                }
            }
        }

        function friendlyError(error) {
            const text = String(error?.message || error);
            if (text === 'STALLED') {
                return 'Compression got stuck on this device. Try the H.264 / AVC codec, close other tabs, or try a shorter or smaller video.';
            }
            if (/Decoding task did not complete|undecodable|decode/i.test(text)) {
                return 'This browser could not decode the video. On iPhone this often happens with HDR or 4K HEVC videos. ' +
                       'Try a normal (non-HDR) video, or set iPhone Settings > Camera > Formats > Most Compatible and record again. (' + text + ')';
            }
            if (/memory|allocation|quota/i.test(text)) {
                return 'The device ran out of memory. Try a smaller video or a lower resolution.';
            }
            return 'Error: ' + text;
        }

        async function compress() {
            if (!selectedFile || !mediaInfo || isProcessing) return;

            if (methodSelect.value === 'size') {
                const mb = parseFloat(targetSizeInput.value);
                if (isNaN(mb) || mb <= 0) { setStatus('Please enter a Target Size (MB), or switch to "Target a video quality".'); targetSizeInput.focus(); return; }
                if (mb > 1024) { setStatus('Target size can be at most 1024 MB (1 GB).'); return; }
                if (mb * MB >= selectedFile.size) { setStatus(`Target size must be smaller than the original video (${formatBytes(selectedFile.size)}).`); return; }
            }

            clearResult();
            canceled = false;
            setBusy(true);
            setProgress(0);
            progressLabel.textContent = 'Preparing...';
            progressBox.classList.remove('hidden');
            setStatus('');
            const startedAt = performance.now();

            try {
                const lib = await loadLib();
                const plan = planEncode(lib);
                const original = selectedFile.size;
                const maxPasses = plan.bySize ? 4 : 3;
                const expectedPasses = plan.bySize ? 2 : 1;

                // Hardware encoders never hit a bitrate exactly, so the first result is measured and the
                // bitrate corrected until the file lands on the target (or is clearly smaller than the original).
                let bitrate = plan.initialBitrate;
                let best = null;       // { buffer, size }
                let shownProgress = 0;
                let hitFloor = false;

                for (let pass = 0; pass < maxPasses; pass++) {
                    progressLabel.textContent = pass === 0
                        ? 'Compressing video...'
                        : plan.bySize ? `Adjusting to reach ${targetSizeInput.value} MB (pass ${pass + 1})...`
                                      : `Making sure the file is smaller (pass ${pass + 1})...`;
                    const total = Math.max(expectedPasses, pass + 1);
                    const buffer = await runPassSafe(lib, plan, bitrate, (p) => {
                        shownProgress = Math.max(shownProgress, Math.min(0.99, (pass + p) / total));
                        setProgress(shownProgress);
                    });
                    const size = buffer.byteLength;

                    // Keep the best candidate only (saves memory).
                    const score = (n) => plan.bySize
                        ? (n <= plan.targetBytes ? plan.targetBytes - n : 1e15 + (n - plan.targetBytes))
                        : n;
                    if (!best || score(size) < score(best.size)) best = { buffer, size };

                    if (plan.bySize) {
                        if (size <= plan.targetBytes && size >= plan.targetBytes * 0.955) break;   // on target
                        if (bitrate <= MIN_VIDEO_BPS * 1.01 && size > plan.targetBytes) { hitFloor = true; break; }
                        // Everything except the video stream (audio + container) stays the same size.
                        const fixedBytes = (plan.audioBps * mediaInfo.duration) / 8 + size * 0.01;
                        const factor = clamp((plan.targetBytes * 0.98 - fixedBytes) / Math.max(size - fixedBytes, 1), 0.3, 3);
                        const next = clamp(bitrate * factor, MIN_VIDEO_BPS, MAX_VIDEO_BPS);
                        if (Math.abs(next - bitrate) / bitrate < 0.01) break;
                        bitrate = next;
                    } else {
                        if (size < original * 0.97) break;                                      // clearly smaller than the original
                        if (bitrate <= 150e3 * 1.01) break;
                        bitrate = Math.max(150e3, bitrate * 0.55);
                    }
                }

                setProgress(1);
                const finalSize = best.size;
                const blob = new Blob([scrubToolName(best.buffer)], { type: 'video/mp4' });
                resultUrl = URL.createObjectURL(blob);

                previewVideo.onerror = () => previewNote.classList.remove('hidden');
                previewVideo.src = resultUrl;
                resultBlob = blob;
                resultName = `${safeBaseName(selectedFile.name)}_compressed.mp4`;
                openTabLink.href = resultUrl;
                prepareDownloadHelp();

                const saved = Math.max(0, (1 - finalSize / original) * 100);
                let line = finalSize < original ? `${saved.toFixed(1)}% smaller` : 'Not smaller than the original — it is already highly compressed.';
                if (plan.bySize) {
                    if (hitFloor || finalSize > plan.targetBytes) line = `Could not go lower than this without breaking the video. ` + line;
                }
                resultInfo.innerHTML =
                    `<div><span class="text-gray-400">Original:</span> <b>${formatBytes(original)}</b> &nbsp;→&nbsp; ` +
                    `<span class="text-gray-400">Compressed:</span> <b class="text-emerald-700">${formatBytes(finalSize)}</b></div>` +
                    `<div class="text-xs text-gray-500 mt-1">${line} · took ${formatDuration((performance.now() - startedAt) / 1000)}</div>`;

                progressBox.classList.add('hidden');
                resultBox.classList.remove('hidden');
                setStatus('Compression finished.');
                resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                if (!IN_APP) saveResult();   // start the download by itself; the button below is the fallback
            } catch (error) {
                activeConversion = null;
                progressBox.classList.add('hidden');
                if (canceled || error?.name === 'ConversionCanceledError') {
                    setStatus('Compression canceled.');
                } else {
                    console.error(error);
                    setStatus(friendlyError(error));
                }
            } finally {
                setBusy(false);
                compressBtn.disabled = !(selectedFile && mediaInfo && mediaInfo.canDecode);
            }
        }

        // ---------- download ----------
        function prepareDownloadHelp() {
            downloadHelpText.textContent = IN_APP
                ? 'This in-app browser may block the download. Open this page in Chrome or Safari, or use one of the options below.'
                : 'The download starts by itself. If nothing happens, press the Download Video button again.';
            downloadHelp.className = IN_APP
                ? 'mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3'
                : 'mt-3 text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-lg p-3';
            // Share sheet lets phones save straight to Photos / Files when a normal download is blocked.
            try {
                const probe = new File([resultBlob], resultName, { type: 'video/mp4' });
                if (navigator.canShare && navigator.canShare({ files: [probe] })) shareBtn.classList.remove('hidden');
            } catch (_) {}
        }

        function saveResult() {
            if (!resultBlob || !resultUrl) { setStatus('Nothing to download yet. Compress a video first.'); return; }
            try {
                const a = document.createElement('a');
                a.href = resultUrl;
                a.download = resultName;
                a.rel = 'noopener';
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch (error) {
                console.error(error);
                downloadHelpText.textContent = 'The download could not start in this browser. Use "Save via Share menu" or "Open video in a new tab" below.';
            }
        }
        downloadBtn.addEventListener('click', saveResult);

        shareBtn.addEventListener('click', async () => {
            if (!resultBlob) return;
            try {
                await navigator.share({ files: [new File([resultBlob], resultName, { type: 'video/mp4' })] });
            } catch (error) {
                if (error?.name !== 'AbortError') downloadHelpText.textContent = 'Sharing is not available here. Try "Open video in a new tab" instead.';
            }
        });

        compressBtn.addEventListener('click', compress);
        cancelBtn.addEventListener('click', async () => {
            canceled = true;
            try { await activeConversion?.cancel(); } catch (_) {}
        });

        window.addEventListener('beforeunload', (e) => { if (isProcessing) { e.preventDefault(); e.returnValue = ''; } });
    