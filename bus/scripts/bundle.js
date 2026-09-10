import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
export async function buildWorker() {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['worker/entry.js'],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some((p) => /fflate|kawasaki\/static|scripts\/|\/test\//.test(p))
    || /AllLines\.zip|stop_times\.txt|AllLines-\d{8}\.zip/.test(result.outputFiles[0].text)) throw Error('BUS_HEAVY_STATIC_IN_RUNTIME');
  return { text: result.outputFiles[0].text, bytes: result.outputFiles[0].contents.length, inputs };
}
