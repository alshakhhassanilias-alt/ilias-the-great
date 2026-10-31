// Does the heavy per-frame work off the page's main thread, so the camera view and
// buttons stay smooth: finding/following the board and sampling the squares.
//
// In:  { type: 'frame', bitmap (ImageBitmap or VideoFrame) | pixels, width, height, expected }
//      { type: 'reset' }                     look for the board again
//      { type: 'manual', corners }           corners tapped by hand (frame pixels)
//      { type: 'corners', corners }          corners rotated/dragged by the user
// Out: { type: 'result', mode, corners, locked, margin, lost, sig, prevSig, width, height, ms }
//      { type: 'error', message, bitmap }

import { boardToImage } from './homography.js?v=4';
import { sampleSignature } from './vision.js?v=4';
import { BoardFollower } from './pose.js?v=4';

const follower = new BoardFollower();
let prevImg = null;
let canvas = null, ctx = null;

function pixelsOf(msg) {
  if (msg.pixels) return { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.pixels) };
  if (!canvas || canvas.width !== msg.width || canvas.height !== msg.height) {
    canvas = new OffscreenCanvas(msg.width, msg.height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  try {
    ctx.drawImage(msg.bitmap, 0, 0, msg.width, msg.height);   // ImageBitmap or VideoFrame
  } finally {
    msg.bitmap.close();
  }
  return ctx.getImageData(0, 0, msg.width, msg.height);
}

self.onmessage = ({ data: msg }) => {
  if (msg.type === 'reset') { follower.reset(); prevImg = null; return; }
  if (msg.type === 'manual') { follower.setManual(msg.corners); return; }
  if (msg.type === 'corners') { follower.setCorners(msg.corners); return; }
  if (msg.type !== 'frame') return;
  try {
    processFrame(msg);
  } catch (err) {
    // e.g. no OffscreenCanvas here: the page then sends plain pixels instead
    self.postMessage({ type: 'error', message: String(err), bitmap: !!msg.bitmap });
  }
};

function processFrame(msg) {
  const t0 = performance.now();
  const img = pixelsOf(msg);
  const pose = follower.update(img, msg.expected);
  let sig = null, prevSig = null;
  if (pose.corners) {
    const H = boardToImage(pose.corners);
    sig = sampleSignature(img, H);
    // The previous frame sampled with the same pose, so pose updates don't look like motion.
    if (prevImg && prevImg.width === img.width && prevImg.height === img.height) prevSig = sampleSignature(prevImg, H);
  }
  prevImg = img;
  const out = { type: 'result', ...pose, sig, prevSig, width: img.width, height: img.height, ms: performance.now() - t0 };
  self.postMessage(out, [sig, prevSig].filter(Boolean).map((a) => a.buffer));
}
