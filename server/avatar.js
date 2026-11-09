import { HttpError } from "./profile.js";

const maxBytes = 96 * 1024;
export const avatarBase64Limit = Math.ceil(maxBytes / 3) * 4;

export function decodeAvatar(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.length <= avatarBase64Limit) {
    const image = Buffer.from(value, "base64");
    if (image.toString("base64") === value && isAvatarJpeg(image)) return image;
  }
  throw new HttpError(400, "头像图片无效，请重新上传。");
}

function isAvatarJpeg(image) {
  const end = image.length - 2;
  if (image.length < 8 || image.readUInt16BE(0) !== 0xffd8 || image.readUInt16BE(end) !== 0xffd9) return false;
  let offset = 2;
  let frame = false;
  while (offset + 4 <= end && image[offset] === 0xff) {
    const marker = image[offset + 1];
    offset += 2;
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > end) return false;
    if (marker === 0xda) return frame && length >= 8 && offset + length < end;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 11 || image[offset + 2] !== 8) return false;
      const height = image.readUInt16BE(offset + 3);
      const width = image.readUInt16BE(offset + 5);
      if (width < 1 || width > 256 || height < 1 || height > 256) return false;
      frame = true;
    }
    offset += length;
  }
  return false;
}
