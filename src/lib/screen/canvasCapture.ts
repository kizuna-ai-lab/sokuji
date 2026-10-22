/**
 * The `Capture` over a video track: a `<video>` fed the track, and a canvas the
 * current frame is drawn onto and read back from, or encoded from. Browser-only
 * (jsdom has no canvas), kept thin on purpose: the live tests exercise it, and
 * everything that decides what to do with a picture lives in the sampler.
 *
 * What the sampler may rely on:
 *  - `grab()` returns the picture already fitted inside 1280×720 (`fitInside`,
 *    never upscaled), so the sampler's thumb and the JPEG come from the pixels
 *    that are sent.
 *  - `grab()` always settles. It resolves null when the track has ended, the
 *    video has no frame or no size yet, or drawing fails: all of them are a
 *    source that yields nothing, which the sampler turns into a loss it tells.
 *  - `encode()` rejects with an `Error` naming the cause when the canvas cannot
 *    be encoded (no 2D context, `toBlob` throws, or yields null); the sampler
 *    skips a frame whose encode rejects.
 */
import { describeCause } from '../diagnostics/describeCause';
import { fitInside } from './pixels';
import type { Capture, Picture } from './sampler';

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: a frame is there to draw. */
const HAVE_CURRENT_DATA = 2;

export function canvasCapture(track: MediaStreamTrack): Omit<Capture, 'name' | 'kind'> & { close(): void } {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  // A refused or interrupted play() is not worth a failure here: no frame ever arriving reads as null grabs.
  void video.play().catch(() => {});

  // Two canvases, so an encode in flight never shares pixels with the next grab.
  const grabCanvas = document.createElement('canvas');
  const encodeCanvas = document.createElement('canvas');

  return {
    async grab() {
      try {
        if (track.readyState === 'ended') return null;
        if (video.readyState < HAVE_CURRENT_DATA || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return null;
        const { width, height } = fitInside(video.videoWidth, video.videoHeight);
        grabCanvas.width = width;
        grabCanvas.height = height;
        const context = grabCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        return { rgba: image.data, width: image.width, height: image.height };
      } catch {
        return null;
      }
    },

    encode(picture: Picture, quality: number) {
      return new Promise<Uint8Array>((resolve, reject) => {
        // The raw value rides along as `cause` (the target's lib has no ErrorOptions); the message names it for the log.
        const fail = (cause: unknown) => reject(Object.assign(new Error(`JPEG encode failed: ${describeCause(cause)}`), { cause }));
        try {
          // `set` would take a short array and leave the rest black: a frame that looks fine and is not the picture.
          if (picture.rgba.length !== picture.width * picture.height * 4) throw new RangeError('picture pixels do not match its size');
          encodeCanvas.width = picture.width;
          encodeCanvas.height = picture.height;
          const context = encodeCanvas.getContext('2d');
          if (!context) throw new Error('no 2D canvas context');
          const image = context.createImageData(picture.width, picture.height);
          image.data.set(picture.rgba);
          context.putImageData(image, 0, 0);
          encodeCanvas.toBlob((blob) => {
            if (!blob) {
              fail(new Error('canvas.toBlob yielded no JPEG'));
              return;
            }
            blob.arrayBuffer().then((bytes) => resolve(new Uint8Array(bytes)), fail);
          }, 'image/jpeg', quality);
        } catch (cause) {
          fail(cause);
        }
      });
    },

    /** Lets go of the video; the track belongs to whoever opened the capture. */
    close() {
      video.pause();
      video.srcObject = null;
    },
  };
}
