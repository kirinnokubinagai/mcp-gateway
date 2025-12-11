import { promises as fs } from 'fs';
import path from 'path';

export const parseJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return {};
  }
};

export const send = (res, status, data, headers = {}) => {
  const body = typeof data === 'string' || data instanceof Buffer ? data : JSON.stringify(data);
  const ct =
    data instanceof Buffer
      ? 'application/octet-stream'
      : typeof data === 'string'
      ? 'text/plain'
      : 'application/json';
  res.writeHead(status, {
    'Content-Type': ct,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers
  });
  res.end(body);
};

export const mimeFromPath = (filePath) => {
  const ext = path.extname(filePath);
  return ext === '.js'
    ? 'application/javascript'
    : ext === '.css'
    ? 'text/css'
    : ext === '.html'
    ? 'text/html'
    : 'application/octet-stream';
};

export const tryReadFile = async (filePath) => {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
};
