const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeContent(content) {
  return String(content || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHashes({
  content,
  workspaceId = 'default',
  sourceType = 'unknown',
  sourceUri = '',
  sourceHash = null,
  sourceContext = '',
}) {
  const normalizedContent = normalizeContent(content);
  const contentHash = sha256(normalizedContent);

  const effectiveSourceHash = (typeof sourceHash === 'string' && sourceHash.trim())
    ? sourceHash.trim()
    : sha256(`${workspaceId}|${sourceType}|${sourceUri}|${sourceContext}|${contentHash}`);

  return {
    normalizedContent,
    contentHash,
    sourceHash: effectiveSourceHash,
  };
}

module.exports = {
  buildHashes,
};
