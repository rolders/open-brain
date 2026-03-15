import test from 'node:test';
import assert from 'node:assert/strict';

import { buildUploadSuccessMessage } from './upload-format.js';

test('buildUploadSuccessMessage handles async job-complete payload without content', () => {
  const message = buildUploadSuccessMessage('photo', {
    thought_id: 123,
    original_filename: 'photo_abc.jpg',
    file_size: 45678,
    full_content_length: 987,
    chunk_count: 3,
    deduplicated: false,
  });

  assert.match(message, /Image Processed Successfully!/);
  assert.match(message, /Thought ID: 123/);
  assert.match(message, /Extracted Text: 987 characters/);
  assert.doesNotMatch(message, /Preview:/);
});

test('buildUploadSuccessMessage includes preview when content is available', () => {
  const message = buildUploadSuccessMessage('document', {
    id: 42,
    original_filename: 'notes.txt',
    file_size: 120,
    full_content_length: 12,
    content: 'hello world',
  });

  assert.match(message, /Document Processed Successfully!/);
  assert.match(message, /Thought ID: 42/);
  assert.match(message, /Preview: hello world/);
});
