'use strict';

const EXT_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav'
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff']);
const DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'txt', 'csv', 'md', 'json']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 20;

function extOf(name) {
  const base = String(name || '').split(/[\\/]/).pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

function sanitizeName(name) {
  const base = String(name || '').split(/[\\/]/).pop() || 'file';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim().slice(0, 140) || 'file';
}

function kindOf(ext) {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  if (ext === 'mp4') return 'video';
  if (ext === 'mp3' || ext === 'wav') return 'audio';
  if (ext === 'zip') return 'archive';
  return 'file';
}

module.exports = { EXT_MIME, IMAGE_EXTS, DOCUMENT_EXTS, MAX_FILE_BYTES, MAX_FILES_PER_BATCH, extOf, sanitizeName, kindOf };
