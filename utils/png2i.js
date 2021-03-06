const path = require('path');
const PNG = require('png-js');
const fs = require('fs');

const asPixels = (data, w, h) => {
  const result = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    result[i] = data.readUInt32BE(i * 4);
  }
  return result;
}

function nextEmptyColumn(pixels, w, h, start) {
  const background = pixels[0];
  let y = 0;
  let x1 = start;
  let clearColumn = true;
  while (x1 < w) {
    if (pixels[x1 + y * w] !== background) {
      clearColumn = false;
    }
    y++;
    if (y === h) {
      if (clearColumn) {
        return x1;
      }
      clearColumn = true;
      y = 0;
      x1++;
    }
  }

  return w;
}

function cropVertical(pixels, w, h) {
  const background = pixels[0];
  let y1 = 0;
  let y2 = h - 1;
  let x1 = 0;
  let x2 = w - 1;
  let x = 0;
  // find first non-background pixel from the top
  while (y1 < h) {
    if (pixels[x + y1 * w] !== background) {
      break;
    }
    x++;
    if (x === w) {
      x = 0;
      y1++;
    }
  }

  x = 0;
  y2 = h - 1;
  // find first non-background pixel from the bottom
  while (y2 >= 0) {
    if (pixels[x + y2 * w] !== background) {
      break;
    }
    x++;
    if (x === w) {
      x = 0;
      y2--;
    }
  }
  y2++;

  return [y1, y2];
}

function findGlyphs(pixels, w, h) {
  const result = [];

  // find coordinates of non-background data in image
  let [y1, y2] = cropVertical(pixels, w, h);

  let x = 0;
  while (x < w) {
    let x1 = x;
    let x2 = nextEmptyColumn(pixels, w, h, x);
    if (x2 - x1 >= 1) {
      result.push([x1, y1, x2 - x1, y2 - y1]);
    }
    x = x2 + 1;
  }
  return result;
}

function encode(pixels, id, imgw, imgh, x1, y1, w, h) {
  const result = [];

  result.push(11); // type == font data
  result.push(id); // glyph id
  result.push(w); // width
  result.push(h); // height
  result.push(0); // x offset
  result.push(0); // y offset
  result.push(w); // x advance
  result.push(0); // number of kerning pairs

  const pixelData = [];
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
      const pixel = (pixels[x + y * imgw] >> 8) & 0xff;
      pixelData.push(pixel >> 2); // 6-bit
    }
  }
  rle(pixelData).forEach(p => result.push(p));

  const length = result.length;
  result.unshift(length & 0xff);
  result.unshift((length >> 8) & 0xff);
  return result;
}

async function main(argv) {
  argv.shift();
  argv.shift();

  let bw = false;
  let input = argv.shift();
  if (input === '--bw') {
    input = argv.shift();
    bw = true;
  }
  if (input === undefined) {
    console.error('Usage: png2raw [--bw] <filename.png>');
    process.exit(1);
  }

  // read and process the file
  const png = PNG.load(input);
  const data = await new Promise(resolve => png.decode(resolve));
  const pixels = asPixels(data, png.width, png.height); // as 32-bit RGBA data
  const glyphs = findGlyphs(pixels, png.width, png.height);

  const encoded = glyphs.map(([x, y, w, h], i) => encode(pixels, i, png.width, png.height, x, y, w, h));
  print(encoded, path.basename(input, ".png") + '.i');
  return;
}

main(process.argv);

function rle(content) {
  const data = content.map(i => i);
  result = [];
  while (data.length) {
    const val = data.shift();
    let length = 0;
    if (data[0] === val) {
      // start rle
      length = 1;
      while (data[0] === val && length < 256 && data.length) {
        length++;
        data.shift();
      }
      result.push(val + 0b10000000);
      result.push(length);
    } else {
      result.push(val);
    }
  }
  return result;
}

// unused

function print(glyphs, filename) {
  const totalLength = glyphs.reduce((a, b) => a + b.length, 0);
  console.log(`s.erase("${filename}");`);
  let offset = 0;
  glyphs.forEach((chunk, i) => {
    console.log(`s.write("${filename}", [${chunk.join(',')}], ${offset}, ${totalLength});`);
    console.log(`console.log("${filename} glyph ${i} done, written ${offset + chunk.length} of ${totalLength} bytes");`);
    offset += chunk.length;
  });
  console.log(`console.log("Upload ${filename} done", s.getFree(), "memory left");`);
}
