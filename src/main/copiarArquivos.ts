import { cpSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Copia HTML, CSS e as bibliotecas (Bootstrap) para dist/renderer. A lógica continua toda em TypeScript.
const raiz = resolve(__dirname, '../..');
const destino = join(raiz, 'dist', 'renderer');
const vendor = join(destino, 'vendor');
mkdirSync(vendor, { recursive: true });
copyFileSync(join(raiz, 'src/renderer/index.html'), join(destino, 'index.html'));
cpSync(join(raiz, 'src/renderer/css'), join(destino, 'css'), { recursive: true });
copyFileSync(join(raiz, 'node_modules/bootstrap/dist/css/bootstrap.min.css'), join(vendor, 'bootstrap.min.css'));
copyFileSync(join(raiz, 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js'), join(vendor, 'bootstrap.bundle.min.js'));
copyFileSync(join(raiz, 'node_modules/bootstrap-icons/font/bootstrap-icons.min.css'), join(vendor, 'bootstrap-icons.min.css'));
cpSync(join(raiz, 'node_modules/bootstrap-icons/font/fonts'), join(vendor, 'fonts'), { recursive: true });
console.log('Arquivos HTML, CSS e Bootstrap copiados para dist/renderer.');
