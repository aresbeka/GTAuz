import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_MODELS_DIR = path.join(ROOT_DIR, 'models');
const PUBLIC_MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');

function formatCarName(filename) {
  const base = filename
    .replace(/\.glb$/i, '')
    .replace(/(?:[_-](?:opt|optimized|draco|compressed|lowpoly))+$/i, '');
  const cleaned = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Custom Car';
  return cleaned
    .split(' ')
    .map((word) => {
      if (word.length <= 3 && /^[a-z0-9]+$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function slugify(filename) {
  return (
    'car_' +
    filename
      .replace(/\.glb$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
}

async function listGlbFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.glb$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function syncModelsManifest() {
  await fs.mkdir(SOURCE_MODELS_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_MODELS_DIR, { recursive: true });

  const rootGlbs = await listGlbFiles(SOURCE_MODELS_DIR);
  const rootSet = new Set(rootGlbs);

  // Sync any .glb from /models/ -> /public/models/
  for (const fileName of rootGlbs) {
    const srcPath = path.join(SOURCE_MODELS_DIR, fileName);
    const destPath = path.join(PUBLIC_MODELS_DIR, fileName);
    let needsCopy = true;
    try {
      const [srcStat, destStat] = await Promise.all([fs.stat(srcPath), fs.stat(destPath)]);
      if (srcStat.size === destStat.size && srcStat.mtimeMs <= destStat.mtimeMs) {
        needsCopy = false;
      }
    } catch {
      needsCopy = true;
    }
    if (needsCopy) {
      await fs.copyFile(srcPath, destPath);
    }
  }

  // Also include any .glb placed directly inside /public/models/
  const publicGlbs = await listGlbFiles(PUBLIC_MODELS_DIR);
  const allFileNames = Array.from(new Set([...rootGlbs, ...publicGlbs])).sort((a, b) =>
    a.localeCompare(b)
  );

  const cars = [];
  for (let i = 0; i < allFileNames.length; i++) {
    const fileName = allFileNames[i];
    const destPath = path.join(PUBLIC_MODELS_DIR, fileName);
    let sizeBytes = 0;
    try {
      const st = await fs.stat(destPath);
      sizeBytes = st.size;
    } catch {
      sizeBytes = 0;
    }
    cars.push({
      id: `${slugify(fileName)}_${i + 1}`,
      fileName,
      url: `./models/${encodeURIComponent(fileName)}`,
      name: formatCarName(fileName),
      sizeBytes,
      source: rootSet.has(fileName) ? 'models' : 'public/models',
    });
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: cars.length,
    cars,
  };

  const manifestPath = path.join(PUBLIC_MODELS_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.log(
    `[sync-models] Discovered ${cars.length} custom .glb car model(s) -> public/models/manifest.json`
  );
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncModelsManifest().catch((err) => {
    console.error('[sync-models] Error:', err);
    process.exit(1);
  });
}
