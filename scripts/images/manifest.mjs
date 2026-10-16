// Writes src/data/photoNames.ts from the photos in public/img/photo
import { readdirSync, writeFileSync } from 'node:fs';
const names = readdirSync('public/img/photo').filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort();
writeFileSync('src/data/photoNames.ts', `// Written by scripts/images/manifest.mjs\nexport const PHOTO_NAMES: readonly string[] = ${JSON.stringify(names, null, 2)};\n`);
console.log(names.length, 'photos');
