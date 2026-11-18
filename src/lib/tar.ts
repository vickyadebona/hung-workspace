import zlib from 'node:zlib';

export interface TarFile {
  name: string;
  data: string | Buffer;
  mtime?: Date;
}

const BLOCK = 512;

function field(buf: Buffer, offset: number, length: number, value: string) {
  buf.write(value.slice(0, length), offset, 'utf8');
}

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

/** A .tar.gz made in memory (works anywhere Node does, including Vercel, which has no `tar` command). */
export function tarGz(files: TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    if (Buffer.byteLength(f.name) > 100) throw new Error(`File name too long for tar: ${f.name}`);
    const header = Buffer.alloc(BLOCK);
    field(header, 0, 100, f.name);
    field(header, 100, 8, octal(0o644, 8));
    field(header, 108, 8, octal(0, 8));
    field(header, 116, 8, octal(0, 8));
    field(header, 124, 12, octal(data.length, 12));
    field(header, 136, 12, octal(Math.floor((f.mtime ?? new Date()).getTime() / 1000), 12));
    field(header, 148, 8, '        '); // checksum placeholder: eight spaces while summing
    header.write('0', 156); // regular file
    field(header, 257, 6, 'ustar\0');
    field(header, 263, 2, '00');
    let sum = 0;
    for (const b of header) sum += b;
    field(header, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(header, data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end of archive
  return zlib.gzipSync(Buffer.concat(parts));
}
