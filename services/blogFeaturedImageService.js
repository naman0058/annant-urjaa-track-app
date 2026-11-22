'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { blogMediaConfig } = require('../config/blogMediaConfig');

const UPLOAD_ROOT = path.join(__dirname, '..', 'public', 'uploads', blogMediaConfig.uploadSubdir);

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  const head6 = buffer.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function mimeForType(type) {
  const map = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[type] || null;
}

function isBlockedPayload(buffer) {
  const start = buffer.slice(0, 256).toString('utf8').toLowerCase();
  if (start.includes('<?php') || start.includes('<script')) return true;
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return true;
  }
  return false;
}

function safeFilename(postId, type) {
  const ext = type === 'jpeg' ? 'jpg' : type;
  const stamp = Date.now();
  const rand = crypto.randomBytes(6).toString('hex');
  return `blog_${postId}_${stamp}_${rand}.${ext}`;
}

function publicUrl(filename) {
  return `/uploads/${blogMediaConfig.uploadSubdir}/${filename}`;
}

function writeFileSecure(absPath, data) {
  fs.writeFileSync(absPath, data, { mode: 0o644 });
  try {
    fs.chmodSync(absPath, 0o644);
  } catch {
    /* Windows */
  }
}

function aspectRatioOk(width, height) {
  if (!width || !height) return false;
  const r = width / height;
  const target = blogMediaConfig.targetAspect;
  return Math.abs(r - target) <= blogMediaConfig.aspectTolerance;
}

let sharpLoadLogged = false;

async function getSharp() {
  try {
    return require('sharp');
  } catch (err) {
    if (!sharpLoadLogged) {
      sharpLoadLogged = true;
      console.warn(
        'blog images: sharp not available — storing originals without resize/WebP.',
        err.message || ''
      );
    }
    return null;
  }
}

function readBasicDimensions(buffer, type) {
  try {
    if (type === 'png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (type === 'gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (type === 'jpeg') {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        const len = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        offset += 2 + len;
      }
    }
    if (type === 'webp' && buffer.length >= 30) {
      const riff = buffer.toString('ascii', 12, 16);
      if (riff === 'VP8 ') {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return { width: null, height: null };
}

function storeOriginalOnly({ buffer, type, postId }) {
  const { width, height } = readBasicDimensions(buffer, type);
  if (width && height) {
    if (width < blogMediaConfig.minWidth || height < blogMediaConfig.minHeight) {
      const err = new Error(
        `Image too small (min ${blogMediaConfig.minWidth}×${blogMediaConfig.minHeight})`
      );
      err.code = 'IMAGE_TOO_SMALL';
      throw err;
    }
  }
  const baseName = safeFilename(postId, type);
  const absOriginal = path.join(UPLOAD_ROOT, baseName);
  writeFileSecure(absOriginal, buffer);
  const variants = {
    original: publicUrl(baseName),
    width,
    height,
    aspect: width && height ? Math.round((width / height) * 1000) / 1000 : null,
    aspectOk: aspectRatioOk(width, height),
    recommendedAspect: '16:9',
    mime: mimeForType(type),
    processor: 'original-only',
  };
  return {
    featured_image: variants.original,
    featured_image_variants: variants,
    featured_image_alt: null,
    aspectWarning: variants.aspectOk
      ? null
      : 'Image aspect ratio is not close to 16:9 — consider cropping for editorial consistency.',
  };
}

function validateUpload({ buffer, mimetype, originalname }) {
  if (!buffer || !buffer.length) {
    const err = new Error('Empty upload');
    err.code = 'IMAGE_EMPTY';
    throw err;
  }
  if (buffer.length > blogMediaConfig.maxBytes) {
    const err = new Error(`Image exceeds ${blogMediaConfig.maxBytes} bytes`);
    err.code = 'IMAGE_TOO_LARGE';
    throw err;
  }
  if (isBlockedPayload(buffer)) {
    const err = new Error('File content not allowed');
    err.code = 'IMAGE_BLOCKED';
    throw err;
  }

  const type = detectImageType(buffer);
  if (!type) {
    const err = new Error('Unrecognized image file signature');
    err.code = 'IMAGE_SIGNATURE';
    throw err;
  }
  const expectedMime = mimeForType(type);
  if (mimetype && !blogMediaConfig.allowedMime.has(mimetype)) {
    const err = new Error('MIME type not allowed');
    err.code = 'IMAGE_MIME';
    throw err;
  }
  if (mimetype && expectedMime && mimetype !== expectedMime) {
    const err = new Error('MIME type does not match file content');
    err.code = 'IMAGE_MIME_MISMATCH';
    throw err;
  }
  if (originalname) {
    const raw = String(originalname);
    const base = path.basename(raw);
    if (raw !== base || base.includes('..') || /[/\\]/.test(raw)) {
      const err = new Error('Invalid original filename');
      err.code = 'IMAGE_FILENAME';
      throw err;
    }
  }
  return { type, expectedMime };
}

async function processAndStore({ buffer, mimetype, originalname, postId }) {
  ensureUploadDir();
  const { type } = validateUpload({ buffer, mimetype, originalname });

  const sharp = await getSharp();
  if (!sharp) {
    return storeOriginalOnly({ buffer, type, postId });
  }
  let width;
  let height;
  let working = buffer;

  {
    const img = sharp(buffer, { failOn: 'error' });
    const meta = await img.metadata();
    width = meta.width;
    height = meta.height;

    if (!width || !height) {
      const err = new Error('Could not read image dimensions');
      err.code = 'IMAGE_DIMENSIONS';
      throw err;
    }
    if (width < blogMediaConfig.minWidth || height < blogMediaConfig.minHeight) {
      const err = new Error(
        `Image too small (min ${blogMediaConfig.minWidth}×${blogMediaConfig.minHeight})`
      );
      err.code = 'IMAGE_TOO_SMALL';
      throw err;
    }
    if (width > blogMediaConfig.maxWidth || height > blogMediaConfig.maxHeight) {
      working = await img
        .resize({
          width: blogMediaConfig.maxWidth,
          height: blogMediaConfig.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
      const m2 = await sharp(working).metadata();
      width = m2.width;
      height = m2.height;
    }
  }

  const baseName = safeFilename(postId, type);
  const absOriginal = path.join(UPLOAD_ROOT, baseName);
  writeFileSecure(absOriginal, working);

  const variants = {
    original: publicUrl(baseName),
    width,
    height,
    aspect: width && height ? Math.round((width / height) * 1000) / 1000 : null,
    aspectOk: aspectRatioOk(width, height),
    recommendedAspect: '16:9',
    mime: mimeForType(type),
    files: [absOriginal],
  };

  if (sharp && type !== 'gif') {
    const pipeline = sharp(working);
    if (blogMediaConfig.enableWebp) {
      const webpName = baseName.replace(/\.[^.]+$/, '.webp');
      const absWebp = path.join(UPLOAD_ROOT, webpName);
      await pipeline.clone().webp({ quality: 82 }).toFile(absWebp);
      writeFileSecure(absWebp, fs.readFileSync(absWebp));
      variants.webp = publicUrl(webpName);
      variants.files.push(absWebp);
    }

    for (const w of blogMediaConfig.responsiveWidths) {
      if (width && width < w) continue;
      const jpgName = baseName.replace(/\.[^.]+$/, `-${w}.jpg`);
      const absJ = path.join(UPLOAD_ROOT, jpgName);
      await sharp(working)
        .resize({ width: w, withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(absJ);
      writeFileSecure(absJ, fs.readFileSync(absJ));
      variants[`w${w}`] = publicUrl(jpgName);
      variants.files.push(absJ);

      if (blogMediaConfig.enableWebp) {
        const webpW = baseName.replace(/\.[^.]+$/, `-${w}.webp`);
        const absW = path.join(UPLOAD_ROOT, webpW);
        await sharp(working).resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toFile(absW);
        writeFileSecure(absW, fs.readFileSync(absW));
        variants[`webp${w}`] = publicUrl(webpW);
        variants.files.push(absW);
      }
    }
  }

  delete variants.files;

  return {
    featured_image: variants.original,
    featured_image_variants: variants,
    featured_image_alt: null,
    aspectWarning: variants.aspectOk
      ? null
      : 'Image aspect ratio is not close to 16:9 — consider cropping for editorial consistency.',
  };
}

function collectPathsFromVariants(variantsRaw, featured) {
  const paths = new Set();
  if (featured) paths.add(featured);
  let v = variantsRaw;
  if (typeof variantsRaw === 'string') {
    try {
      v = JSON.parse(variantsRaw);
    } catch {
      v = null;
    }
  }
  if (v && typeof v === 'object') {
    for (const val of Object.values(v)) {
      if (typeof val === 'string' && val.startsWith('/uploads/')) paths.add(val);
    }
  }
  return [...paths];
}

async function countPathReferences(db, publicPath) {
  if (!publicPath) return 0;
  const like = `%${publicPath.replace(/\\/g, '/').replace(/"/g, '')}%`;
  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS c FROM blog_posts
    WHERE deleted_at IS NULL
      AND (featured_image = :p OR og_image = :p OR featured_image_variants LIKE :like)
    `,
    { p: publicPath, like }
  );
  return Number(row.c) || 0;
}

async function deletePathsIfUnreferenced(db, paths, excludePostId = null) {
  const deleted = [];
  for (const publicPath of paths) {
    const [[row]] = await db.query(
      `
      SELECT COUNT(*) AS c FROM blog_posts
      WHERE deleted_at IS NULL
        AND id <> COALESCE(:exclude, -1)
        AND (featured_image = :p OR og_image = :p OR featured_image_variants LIKE :like)
      `,
      {
        p: publicPath,
        like: `%${publicPath}%`,
        exclude: excludePostId,
      }
    );
    const count = Number(row.c) || 0;
    if (count > 0) continue;
    const rel = publicPath.replace(/^\/uploads\/blog\//, '');
    const abs = path.join(UPLOAD_ROOT, rel);
    if (abs.startsWith(UPLOAD_ROOT) && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
        deleted.push(publicPath);
      } catch {
        /* keep */
      }
    }
  }
  return deleted;
}

async function removeFeaturedImage(db, postId) {
  const [rows] = await db.query(
    `SELECT featured_image, featured_image_variants, og_image FROM blog_posts WHERE id = :id`,
    { id: postId }
  );
  const row = rows[0];
  if (!row) {
    const err = new Error('Post not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const paths = collectPathsFromVariants(row.featured_image_variants, row.featured_image);

  await db.query(
    `
    UPDATE blog_posts SET
      featured_image = NULL,
      featured_image_variants = NULL,
      featured_image_alt = NULL,
      og_image = IF(og_image = :fi, NULL, og_image)
    WHERE id = :id
    `,
    { id: postId, fi: row.featured_image || '' }
  );

  await deletePathsIfUnreferenced(db, paths, postId);
  return { removed: true };
}

async function applyFeaturedImage(db, postId, uploadResult, altText) {
  const [rows] = await db.query(
    `SELECT featured_image, featured_image_variants FROM blog_posts WHERE id = :id AND deleted_at IS NULL`,
    { id: postId }
  );
  const existing = rows[0];
  if (!existing) {
    const err = new Error('Post not found');
    err.code = 'NOT_FOUND';
    throw err;
  }

  const oldPaths = collectPathsFromVariants(
    existing.featured_image_variants,
    existing.featured_image
  );

  const alt = String(altText || '').trim().slice(0, 255) || null;

  await db.query(
    `
    UPDATE blog_posts SET
      featured_image = :fi,
      featured_image_variants = :variants,
      featured_image_alt = :alt,
      og_image = :fi
    WHERE id = :id
    `,
    {
      id: postId,
      fi: uploadResult.featured_image,
      variants: JSON.stringify(uploadResult.featured_image_variants),
      alt,
    }
  );

  await deletePathsIfUnreferenced(db, oldPaths, postId);

  return {
    ...uploadResult,
    featured_image_alt: alt,
    aspectWarning: uploadResult.aspectWarning,
  };
}

module.exports = {
  processAndStore,
  applyFeaturedImage,
  removeFeaturedImage,
  validateUpload,
  collectPathsFromVariants,
  deletePathsIfUnreferenced,
  UPLOAD_ROOT,
};