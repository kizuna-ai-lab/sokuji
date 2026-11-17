// Runs in the app's page, before any of its scripts (Playwright addInitScript).
// Plain JavaScript on purpose: the test runner transpiles .ts files and the
// helpers it adds do not exist in the page.
//
// The microphone the app hears. Chromium's --use-file-for-fake-audio-capture
// is silent under Electron 44 (plain Chromium hears the same file), so the
// audio is injected here instead: getUserMedia answers with a looping buffer.
// The app's constraints (echo cancellation, noise suppression) do not apply
// to it. --use-fake-device-for-media-stream stays on the command line: it is
// what puts "Fake Audio Input 1" in enumerateDevices(), the device the app
// selects.
//
// The sound is bursts of a voiced-sounding tone with pauses between them, so
// a recording of it is never silent and has a shape that can be recognised.
(() => {
  const md = navigator.mediaDevices;
  if (!md || md.__e2eMic) return;
  const real = md.getUserMedia.bind(md);
  let ctx;
  let dest;
  const stream = async () => {
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 48000 });
      const seconds = 4;
      const buffer = ctx.createBuffer(1, seconds * ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / ctx.sampleRate;
        const speaking = t % 2 < 1.4; // 1.4 s of sound, 0.6 s of pause
        const envelope = speaking ? 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t) : 0;
        data[i] = 0.25 * envelope * (Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t));
      }
      dest = ctx.createMediaStreamDestination();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(dest);
      source.start();
    }
    if (ctx.state !== 'running') await ctx.resume();
    return new MediaStream(dest.stream.getAudioTracks().map((track) => track.clone()));
  };
  md.getUserMedia = (constraints) => (constraints && constraints.audio && !constraints.video ? stream() : real(constraints));
  md.__e2eMic = true;
})();
