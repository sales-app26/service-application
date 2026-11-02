import { sniffRecordingFormat } from './recording-format';

const file = (head: Buffer | string): Buffer =>
  Buffer.concat([Buffer.from(head as string, 'latin1'), Buffer.alloc(32)]);

describe('sniffRecordingFormat', () => {
  it.each([
    ['m4a', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A ')]), 'audio/mp4'],
    ['3gp', Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp3gp4')]), 'audio/3gpp'],
    ['mp3', Buffer.from('ID3'), 'audio/mpeg'],
    ['mp3', Buffer.from([0xff, 0xfb]), 'audio/mpeg'],
    ['aac', Buffer.from([0xff, 0xf1]), 'audio/aac'],
    ['amr', Buffer.from('#!AMR'), 'audio/amr'],
    ['ogg', Buffer.from('OggS'), 'audio/ogg'],
    ['flac', Buffer.from('fLaC'), 'audio/flac'],
    ['wav', Buffer.from('RIFF\0\0\0\0WAVE'), 'audio/wav'],
    ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm'],
  ])('knows %s', (extension, head, mimeType) => {
    expect(sniffRecordingFormat(file(head))).toEqual({ extension, mimeType });
  });

  it.each([
    ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['a PDF', Buffer.from('%PDF-1.7')],
    ['a web page', Buffer.from('<html><script>')],
    ['a text file', Buffer.from('just some notes')],
  ])('refuses %s', (_, head) => {
    expect(sniffRecordingFormat(file(head))).toBeNull();
  });

  it('refuses a file too short to tell', () => {
    expect(sniffRecordingFormat(Buffer.from('ID3'))).toBeNull();
  });
});
