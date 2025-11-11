function normalizeDirection(value) {
  const str = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return str === 'retur' ? 'retur' : 'tur';
}

function isReturnDirection(value) {
  return normalizeDirection(value) === 'retur';
}

function ensureDirection(value) {
  if (typeof value !== 'string') return null;
  const str = value.toLowerCase().trim();
  if (str !== 'tur' && str !== 'retur') return null;
  return str === 'retur' ? 'retur' : 'tur';
}

module.exports = {
  normalizeDirection,
  isReturnDirection,
  ensureDirection,
};