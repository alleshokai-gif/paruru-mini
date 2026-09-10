import { gzipSync } from 'node:zlib';
import { buildWorker } from './bundle.js';
try {
  const result = await buildWorker();
  console.log(JSON.stringify({ status: 'BUNDLE_CHECK_PASS', bytes: result.bytes, gzipBytes: gzipSync(result.text).length,
    runtimeModules: result.inputs.length, fullStaticParser: false, zipDownloader: false }));
} catch { console.log('{"error":"BUNDLE_CHECK_FAILED"}'); process.exitCode = 1; }
