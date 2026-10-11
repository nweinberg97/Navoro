/** Navoro engine: pure guidance logic shared by the browser SDK (local mode) and Node. */
export { answerLocally, contactFallback, normalizeLabel, slug, type LocalAnswer } from './answer.ts';
export { chooseStartStep, validatePack, PackError } from './pack.ts';
export { bm25, tokenize, stem } from './retrieve.ts';
