function formatPlainText(text) {
  if (!text) return '';
  return String(text).replace(/\r/g, '').trim();
}

function buildPreview(content, maxChars = 200) {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  const normalized = formatPlainText(content);
  if (!normalized) {
    return null;
  }

  return `${normalized.substring(0, maxChars)}${normalized.length > maxChars ? '…' : ''}`;
}

export function buildUploadSuccessMessage(kind, result, { formatFileSize = (bytes) => `${bytes} B` } = {}) {
  const isPhoto = kind === 'photo';
  const title = isPhoto ? '✅ Image Processed Successfully!' : '✅ Document Processed Successfully!';
  const icon = isPhoto ? '🖼️' : '📄';

  const filename = formatPlainText(result.original_filename || 'Uploaded file');
  const thoughtId = result.id ?? result.thought_id ?? 'N/A';
  const fullContentLength = Number.isFinite(result.full_content_length)
    ? result.full_content_length
    : (typeof result.content === 'string' ? result.content.length : 0);

  const lengthLabel = isPhoto ? '📝 Extracted Text' : '📝 Content Length';

  const lines = [
    title,
    '',
    `${icon} File: ${filename}`,
    `📏 Size: ${formatFileSize(result.file_size || 0)}`,
    `${lengthLabel}: ${fullContentLength} characters`,
    `🆔 Thought ID: ${thoughtId}`,
  ];

  if (Number.isFinite(result.chunk_count)) {
    lines.push(`🧩 Chunks: ${result.chunk_count}`);
  }

  if (result.deduplicated) {
    lines.push('♻️ Duplicate source detected; existing memory reused.');
  }

  const preview = buildPreview(result.content);
  if (preview) {
    lines.push('', `Preview: ${preview}`);
  }

  return lines.join('\n').trim();
}
