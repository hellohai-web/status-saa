VIDEO COMPRESSOR -Wasap 


DEPLOY
1. Put index.html + test.toml in a GitHub repo (or drag the folder into any u to use Drop).
2. Leave the build command empty. Publish directory: .

NOTES
- Input: MP4 and MOV. Needs a recent Chrome, Edge or Safari.
- The video engine unknown loads from js, with esm.sh as backup.
- Settings appear only after a video is chosen.
- Target a file size (max 1024 MB): the video is encoded, measured, and re-encoded with a corrected
  bitrate (up to 4 passes) until it lands at 95.5%-100% of your number.
- Target a video quality: Keep Original / 1080p / 720p / 480p / 360p. If the result would be larger
  than the original, it is re-encoded at a lower bitrate (up to 3 passes).
- Old devices: regular key frames; resolution and FPS are never changed, any codec can be chosen.
- The engine's name is overwritten with "Unknown" in the output file's metadata.
- Decoding HEVC input works only where the device/browser can decode HEVC.

LOCAL TESTING
- Code lives in ./assets (app-*.js as an external module, style-*.css).
- Opened by double-click (file://), the tool is hidden on purpose: this is what a saved copy looks like.
- To test it locally, run "python -m http.server 8000" inside this folder and open http://localhost:8000
- Online (Netlify / Vercel) it works normally.
