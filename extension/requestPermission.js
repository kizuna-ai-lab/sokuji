// Simple script to request microphone permission
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.info("[Sokuji] [Permission] 🎉 Microphone access granted");
    // immediately stop tracks so the user doesn't see the "recording" indicator
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => {
    console.error("[Sokuji] [Permission] 🛑 Permission denied", err);
  });
