// Simple script to request microphone permission
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.info("🎉 Microphone access granted");
    // immediately stop tracks so the user doesn't see the "recording" indicator
    stream.getTracks().forEach(t => t.stop());
  })
  .catch(err => {
    console.error("🛑 Permission denied", err);
  });
