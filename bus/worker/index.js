// Keep the original Worker/test import path; the handler uses standard Web APIs only.
export { createHttpHandler as createWorker } from '../http/handler.js';
