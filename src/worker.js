import { solve, solveTwin } from './engine.js?v=2a46e88dd0ce';

self.onmessage = ({ data }) => {
  try {
    if (data.mode === 'twin') {
      const result = solveTwin(data.students, data.options || {}, Math.min(5, data.limit || 5), {
        onProgress: (progress) => self.postMessage({ id: data.id, progress }),
      });
      self.postMessage({ id: data.id, ...result });
    } else {
      const result = solve(data.courses, data.settings, data.preset, Math.min(5, data.limit || 5), {
        onProgress: (progress) => self.postMessage({ id: data.id, progress }),
      });
      self.postMessage({ id: data.id, ...result });
    }
  } catch (error) {
    self.postMessage({ id: data.id, results: [], reason: error.message });
  }
};
