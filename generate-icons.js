/**
 * Gera ícones PWA com fundo escuro a partir do logo Gestão 5X.
 *
 * Execute UMA VEZ:
 *   npm install sharp
 *   node generate-icons.js
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const logoPath = path.join(__dirname, 'assets', 'logo-gestao5x-transparente.png');
const outDir   = path.join(__dirname, 'assets', 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Fundo escuro do sistema: #0d1720
const BG = { r: 13, g: 23, b: 32, alpha: 1 };

async function generateIcon(size, logoScale, outFile) {
  const logoSize = Math.round(size * logoScale);
  const offset   = Math.round((size - logoSize) / 2);

  const logoBuffer = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: 'inside',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG }
  })
  .composite([{ input: logoBuffer, top: offset, left: offset }])
  .png()
  .toFile(path.join(outDir, outFile));

  console.log(`✓ ${outFile}  (${size}x${size}px)`);
}

(async () => {
  console.log('Gerando ícones PWA — Gestão 5X...\n');
  try {
    // Ícone padrão 256×256 (favicon + apple-touch-icon)
    await generateIcon(256, 0.88, 'icon-256-dark.png');

    // Ícone 192×192 (Android PWA)
    await generateIcon(192, 0.88, 'icon-192.png');

    // Ícone 512×512 (splash screen Android + Chrome)
    await generateIcon(512, 0.88, 'icon-512.png');

    // Maskable 512×512 (logo dentro da safe zone 60%)
    await generateIcon(512, 0.60, 'icon-maskable-512.png');

    console.log('\n✓ Todos os ícones criados em assets/icons/');
    console.log('  Copie icon-256-dark.png para assets/favicon.png se quiser atualizar o favicon também.');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error('\n❌ Módulo "sharp" não encontrado.');
      console.error('   Instale com:  npm install sharp');
      console.error('   Depois rode:  node generate-icons.js\n');
    } else {
      console.error('\n❌ Erro:', err.message);
    }
    process.exit(1);
  }
})();
