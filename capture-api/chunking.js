function estimateTokenCount(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

function splitSectionToWindows(sectionText, maxTokens, overlapTokens) {
  const words = String(sectionText || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const maxWords = Math.max(50, Math.floor(maxTokens / 1.3));
  const overlapWords = Math.min(Math.floor(maxWords / 2), Math.max(0, Math.floor(overlapTokens / 1.3)));
  const stepWords = Math.max(1, maxWords - overlapWords);

  const chunks = [];
  for (let start = 0; start < words.length; start += stepWords) {
    const windowWords = words.slice(start, start + maxWords);
    if (windowWords.length === 0) break;

    chunks.push(windowWords.join(' '));

    if (start + maxWords >= words.length) break;
  }

  return chunks;
}

function parseHeadingSections(content) {
  const lines = String(content || '').split(/\r?\n/);
  const sections = [];

  let headingStack = [];
  let currentLines = [];

  const flushSection = () => {
    const text = currentLines.join('\n').trim();
    if (!text) return;

    sections.push({
      headingPath: headingStack.join(' > '),
      text,
    });

    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      flushSection();
      const level = match[1].length;
      const title = (match[2] || '').trim();

      if (title) {
        headingStack = headingStack.slice(0, level - 1);
        headingStack[level - 1] = title;
      }

      continue;
    }

    currentLines.push(line);
  }

  flushSection();

  if (sections.length === 0) {
    return [{ headingPath: '', text: String(content || '') }];
  }

  return sections;
}

function chunkDocument(content, options = {}) {
  const maxTokens = Number.isFinite(options.maxTokens) ? options.maxTokens : 350;
  const overlapTokens = Number.isFinite(options.overlapTokens) ? options.overlapTokens : 60;

  const sections = parseHeadingSections(content);
  const chunks = [];

  for (const section of sections) {
    const windows = splitSectionToWindows(section.text, maxTokens, overlapTokens);
    for (const windowText of windows) {
      const tokenCount = estimateTokenCount(windowText);
      chunks.push({
        content: windowText,
        token_count: tokenCount,
        heading_path: section.headingPath,
      });
    }
  }

  if (chunks.length === 0) {
    return [{
      content: String(content || '').trim(),
      token_count: estimateTokenCount(content),
      heading_path: '',
    }];
  }

  return chunks.map((chunk, index) => ({ ...chunk, chunk_index: index }));
}

module.exports = {
  chunkDocument,
};
