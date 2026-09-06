export function audioToBase64(bytes: Uint8Array) {
  const parts: string[] = [], chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  return btoa(parts.join(''));
}
