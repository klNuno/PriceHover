import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'fs';

// "$→€" icon — dark background, white dollar, green arrow + euro
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#111111"/>

  <!-- $ — white, left -->
  <text x="38" y="88"
    font-family="Arial, Helvetica, sans-serif"
    font-size="72" font-weight="700"
    fill="#ffffff" text-anchor="middle">$</text>

  <!-- € — green, right -->
  <text x="90" y="88"
    font-family="Arial, Helvetica, sans-serif"
    font-size="72" font-weight="700"
    fill="#5fcc6f" text-anchor="middle">€</text>
</svg>`;

mkdirSync('public/icons', { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  writeFileSync(`public/icons/icon-${size}.png`, png);
  console.log(`✓ icon-${size}.png (${png.byteLength} bytes)`);
}
