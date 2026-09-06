export function audioToBase64(bytes: Uint8Array) {
  const parts: string[] = [], chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  return btoa(parts.join(''));
}

export function base64ToAudio(value: string) {
  const source = value.replace(/^data:audio\/[\w.+-]+;base64,/i, '');
  const binary = atob(source), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
