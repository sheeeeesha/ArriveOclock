// Rasterize the ArriveO'Clock brand mark (pin + clock) into the source images
// @capacitor/assets needs, then run:  npx capacitor-assets generate --android
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('assets', { recursive: true });

const MARK = `
  <path d="M16 30s11-9.6 11-18.3A11 11 0 1 0 5 11.7C5 20.4 16 30 16 30z" fill="#ffffff"/>
  <circle cx="16" cy="11" r="6.6" fill="#0a0a0a"/>
  <path d="M16 6.8V11l3 2" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${inner}</svg>`;

// Adaptive background: solid brand black.
const background = svg(`<rect width="1024" height="1024" fill="#0a0a0a"/>`);
// Adaptive foreground: white mark centred within the safe zone (transparent bg).
const foreground = svg(`<g transform="translate(512 528) scale(17) translate(-16 -15.5)">${MARK}</g>`);
// Legacy / round: full black tile + mark.
const iconOnly = svg(`<rect width="1024" height="1024" fill="#0a0a0a"/><g transform="translate(512 528) scale(19) translate(-16 -15.5)">${MARK}</g>`);

const out = async (name, s) =>
  sharp(Buffer.from(s)).resize(1024, 1024).png().toFile(`assets/${name}.png`);

await Promise.all([
  out('icon-background', background),
  out('icon-foreground', foreground),
  out('icon-only', iconOnly),
]);
console.log('icon sources written to assets/');
