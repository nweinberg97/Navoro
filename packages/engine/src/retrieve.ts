/**
 * Lexical retrieval (BM25) over knowledge chunks and structured objects.
 * Runs in-process with no external index; adequate for per-application corpora
 * of a few thousand chunks. A vector index can be added behind the same
 * interface later (see docs/ARCHITECTURE.md).
 */

const STOPWORDS = new Set(
  'a an and are as at be but by can do does for from how i if in into is it its me my of on or our so that the their then there this to too was we what when where which who why will with you your should would could please want need get'.split(' '),
);

/** Light stemming so "reports"/"report", "creating"/"create" match. */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  return token
    .replace(/tion$/, 't')
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed)$/, '')
    .replace(/(es|s)$/, '')
    .replace(/e$/, '');
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) ?? [])
    .filter((token) => !STOPWORDS.has(token) && token.length > 1)
    .map(stem);
}

export interface Document<T> {
  item: T;
  /** Weighted fields: text and weight (e.g. heading ×2). */
  fields: Array<{ text: string; weight: number }>;
}

export interface Scored<T> {
  item: T;
  score: number;
  /** Fraction of distinct query terms present in the document (0–1). */
  coverage: number;
}

export function bm25<T>(query: string, docs: Array<Document<T>>, k1 = 1.4, b = 0.7): Array<Scored<T>> {
  const queryTerms = [...new Set(tokenize(query))];
  if (!queryTerms.length || !docs.length) return [];
  const docTerms = docs.map((doc) => {
    const counts = new Map<string, number>();
    let length = 0;
    for (const field of doc.fields) {
      for (const token of tokenize(field.text)) {
        counts.set(token, (counts.get(token) ?? 0) + field.weight);
        length += field.weight;
      }
    }
    return { counts, length };
  });
  const avgLength = docTerms.reduce((sum, doc) => sum + doc.length, 0) / docTerms.length || 1;
  const docFreq = new Map<string, number>();
  for (const term of queryTerms) docFreq.set(term, docTerms.filter((doc) => doc.counts.has(term)).length);

  return docs
    .map((doc, index) => {
      const terms = docTerms[index];
      if (!terms) return { item: doc.item, score: 0, coverage: 0 };
      let score = 0;
      let matched = 0;
      for (const term of queryTerms) {
        const tf = terms.counts.get(term) ?? 0;
        if (!tf) continue;
        matched += 1;
        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * terms.length) / avgLength));
      }
      return { item: doc.item, score, coverage: matched / queryTerms.length };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
}
