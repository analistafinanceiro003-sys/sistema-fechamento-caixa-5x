/**
 * Gera ícones PWA a partir de assets/favicon.png (256x256 com fundo escuro).
 *
 * ANTES de rodar:
 *   1. Salve o ícone correto (fundo escuro + logo) como  assets/favicon.png
 *   2. npm install sharp
 *   3. node generate-icons.js
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// Fonte: o favicon.png que você salvou (256x256, fundo escuro, logo correto)
const SOURCE = path.join(__dirname, 'assets', 'favicon.png');
const OUT    = path.join(__dirname, 'assets', 'icons');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

if (!fs.existsSync(SOURCE)) {
  console.error('❌  assets/favicon.png não encontrado.');
  console.error('   Salve o ícone correto (256x256, fundo escuro) como assets/favicon.png e rode novamente.');
  process.exit(1);
}

async function resize(size, outFile, maskable = false) {
  const input = sharp(SOURCE);

  if (maskable) {
    // Maskable: logo com padding interno de ~18% para respeitar a safe zone Android
    const logoSize = Math.round(size * 0.64);
    const offset   = Math.round((size - logoSize) / 2);
    const logoBuffer = await sharp(SOURCE).resize(logoSize, logoSize).png().toBuffer();

    await sharp({
      create: { width: size, height: size, channels: 4,
                background: { r: 13, g: 23, b: 32, alpha: 1 } }
    })
    .composite([{ input: logoBuffer, top: offset, left: offset }])
    .png()
    .toFile(path.join(OUT, outFile));
  } else {
    await input.resize(size, size).png().toFile(path.join(OUT, outFile));
  }

  console.log(`✓ ${outFile}  (${size}x${size}px)`);
}

(async () => {
  console.log('Gerando ícones PWA — Gestão 5X...\n');
  try {
    await resize(256,  'icon-256-dark.png');       // apple-touch-icon + manifest
    await resize(192,  'icon-192.png');            // Android PWA
    await resize(512,  'icon-512.png');            // splash Android
    await resize(512,  'icon-maskable-512.png', true); // maskable (Android adaptável)
    console.log('\n✓ Todos os ícones criados em assets/icons/');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error('\n❌ Instale o sharp:  npm install sharp');
    } else {
      console.error('\n❌ Erro:', err.message);
    }
    process.exit(1);
  }
})();
