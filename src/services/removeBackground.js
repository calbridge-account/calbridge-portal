/**
 * Background removal using Jimp
 * Samples the corner pixels to detect background color,
 * then flood-fills matching pixels to transparent.
 * Saves result as PNG regardless of input format.
 */
const Jimp = require('jimp');
const path = require('path');

/**
 * Remove background from an image file in-place (converts to PNG)
 * @param {string} inputPath  - path to uploaded image
 * @param {string} outputPath - path to save the result (should end in .png)
 * @param {number} tolerance  - color distance tolerance 0–100 (default 30)
 */
async function removeBackground(inputPath, outputPath, tolerance = 35) {
  const img = await Jimp.read(inputPath);
  const width  = img.getWidth();
  const height = img.getHeight();

  // Sample the 4 corners to determine background color candidates
  const corners = [
    img.getPixelColor(0, 0),
    img.getPixelColor(width - 1, 0),
    img.getPixelColor(0, height - 1),
    img.getPixelColor(width - 1, height - 1)
  ];

  // Pick the most common corner color as the background
  const bgColor = corners.reduce((acc, c) =>
    corners.filter(x => colorDistance(x, c) < 20).length >
    corners.filter(x => colorDistance(x, acc) < 20).length ? c : acc
  );

  const { r: bgR, g: bgG, b: bgB } = Jimp.intToRGBA(bgColor);

  // Also detect near-white and near-black backgrounds
  const isWhiteBg = bgR > 220 && bgG > 220 && bgB > 220;
  const isBlackBg = bgR < 35  && bgG < 35  && bgB < 35;

  img.scan(0, 0, width, height, function(x, y, idx) {
    const r = this.bitmap.data[idx + 0];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    const a = this.bitmap.data[idx + 3];

    if (a === 0) return; // already transparent

    const dist = Math.sqrt((r-bgR)**2 + (g-bgG)**2 + (b-bgB)**2);

    // Make transparent if: matches bg color within tolerance, or near-white, or near-black bg
    if (dist < tolerance ||
        (isWhiteBg && r > 235 && g > 235 && b > 235) ||
        (isBlackBg && r < 20  && g < 20  && b < 20)) {
      this.bitmap.data[idx + 3] = 0; // set alpha to 0
    }
  });

  await img.writeAsync(outputPath);
}

function colorDistance(c1, c2) {
  const a = Jimp.intToRGBA(c1);
  const b = Jimp.intToRGBA(c2);
  return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

module.exports = { removeBackground };
