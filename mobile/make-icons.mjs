// Renders the source images @capacitor/assets turns into Android icons/splash.
import sharp from 'sharp';
const blue = '#1d5b86', gold = '#efc732';
const mark = (size, text = 'SI', fs = 0.42) =>
  `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size * fs}" fill="#fff">${text}</text>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${blue}"/><rect x="312" y="700" width="400" height="28" rx="14" fill="${gold}"/>${mark(1024)}</svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="362" y="640" width="300" height="22" rx="11" fill="${gold}"/>${mark(1024, 'SI', 0.3)}</svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${blue}"/></svg>`;
const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732"><rect width="2732" height="2732" fill="${blue}"/>${mark(2732, 'Shekhawati ERP', 0.07)}</svg>`;
for (const [name, svg] of [['icon-only', icon], ['icon-foreground', fg], ['icon-background', bg], ['splash', splash], ['splash-dark', splash]])
  await sharp(Buffer.from(svg)).png().toFile(`assets/${name}.png`);
