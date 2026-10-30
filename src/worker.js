import { solve } from './engine.js';
self.onmessage = ({ data }) => {
  try {
    const result = solve(data.courses, data.settings, data.preset, Math.min(5, data.limit || 5), {
      onProgress: (progress) => self.postMessage({ id: data.id, progress }),
    });
    self.postMessage({ id: data.id, ...result });
  } catch (error) {
    self.postMessage({ id: data.id, results: [], reason: error.message });
  }
};
