/* Runs level generation and the solver off the main thread. */
if (!self.ColorLabCore) importScripts('core.js');

self.onmessage = function (e) {
  const { id, type, payload } = e.data;
  const Core = self.ColorLabCore;
  try {
    let result;
    if (type === 'level') result = Core.generateLevel(payload.level);
    else if (type === 'custom') result = Core.generate(payload);
    else if (type === 'check') {
      result = Core.checkMix(payload.tubes, payload.cap, payload.history, { extraTube: payload.extraTube });
    } else if (type === 'solve') {
      result = Core.solve(payload.tubes, payload.cap, { weight: 2, maxNodes: payload.maxNodes || 60000 });
    } else throw new Error('Unknown job ' + type);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
