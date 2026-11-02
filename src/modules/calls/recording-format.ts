export interface RecordingFormat {
  extension: string;
  mimeType: string;
}

const ascii = (buffer: Buffer, start: number, end: number): string =>
  buffer.subarray(start, end).toString('latin1');

/**
 * What a file really is, from its first bytes. What the phone says about the file isn't
 * trusted, and only the audio formats phones record calls in are let through.
 */
export const sniffRecordingFormat = (buffer: Buffer): RecordingFormat | null => {
  if (buffer.length < 12) return null;

  if (ascii(buffer, 4, 8) === 'ftyp') {
    return ascii(buffer, 8, 11) === '3gp'
      ? { extension: '3gp', mimeType: 'audio/3gpp' }
      : { extension: 'm4a', mimeType: 'audio/mp4' };
  }
  if (ascii(buffer, 0, 3) === 'ID3') return { extension: 'mp3', mimeType: 'audio/mpeg' };
  if (ascii(buffer, 0, 5) === '#!AMR') return { extension: 'amr', mimeType: 'audio/amr' };
  if (ascii(buffer, 0, 4) === 'OggS') return { extension: 'ogg', mimeType: 'audio/ogg' };
  if (ascii(buffer, 0, 4) === 'fLaC') return { extension: 'flac', mimeType: 'audio/flac' };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') {
    return { extension: 'wav', mimeType: 'audio/wav' };
  }
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) return { extension: 'webm', mimeType: 'audio/webm' };
  // A raw frame: 11 sync bits, then the layer bits tell AAC (00) from MP3.
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return (buffer[1] & 0x06) === 0
      ? { extension: 'aac', mimeType: 'audio/aac' }
      : { extension: 'mp3', mimeType: 'audio/mpeg' };
  }
  return null;
};
