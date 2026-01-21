/*! ***** BEGIN LICENSE BLOCK *****
 *!
 *! Copyright 2011-2012, 2014 Jean-Christophe Sirot <sirot@chelonix.com>
 *!
 *! This file is part of digest.js
 *!
 *! digest.js is free software: you can redistribute it and/or modify it under
 *! the terms of the GNU General Public License as published by the Free Software
 *! Foundation, either version 3 of the License, or (at your option) any later
 *! version.
 *!
 *! digest.js is distributed in the hope that it will be useful, but
 *! WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 *! or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 *! more details.
 *!
 *! You should have received a copy of the GNU General Public License along with
 *! digest.js. If not, see http://www.gnu.org/licenses/.
 *!
 *! ***** END LICENSE BLOCK *****  */

// Polyfill for ArrayBuffer.prototype.slice if not available
if (!ArrayBuffer.prototype.slice) {
  ArrayBuffer.prototype.slice = function (this: ArrayBuffer, start: number, end?: number): ArrayBuffer {
    const that = new Uint8Array(this);
    const endValue = end === undefined ? that.length : end;
    const result = new ArrayBuffer(endValue - start);
    const resultArray = new Uint8Array(result);
    for (let i = 0; i < resultArray.length; i++) {
      resultArray[i] = that[i + start];
    }
    return result;
  };
}

/* SHA-1 Engine */

class SHA1Engine {
  current: Uint32Array;
  currentLen: number;
  inLen: number;
  inbuf: Uint8Array;
  blockLen: number;
  digestLen: number;

  constructor() {
    this.current = new Uint32Array(new ArrayBuffer(20));
    this.currentLen = 0;
    this.inLen = 0;
    this.inbuf = new Uint8Array(new ArrayBuffer(64));
    this.blockLen = 64;
    this.digestLen = 20;
    this.reset();
  }

  processBlock(input: Uint8Array): void {
    let A = this.current[0];
    let B = this.current[1];
    let C = this.current[2];
    let D = this.current[3];
    let E = this.current[4];

    const W: number[] = [
      input[0] << 24 | input[1] << 16 | input[2] << 8 | input[3],
      input[4] << 24 | input[5] << 16 | input[6] << 8 | input[7],
      input[8] << 24 | input[9] << 16 | input[10] << 8 | input[11],
      input[12] << 24 | input[13] << 16 | input[14] << 8 | input[15],
      input[16] << 24 | input[17] << 16 | input[18] << 8 | input[19],
      input[20] << 24 | input[21] << 16 | input[22] << 8 | input[23],
      input[24] << 24 | input[25] << 16 | input[26] << 8 | input[27],
      input[28] << 24 | input[29] << 16 | input[30] << 8 | input[31],
      input[32] << 24 | input[33] << 16 | input[34] << 8 | input[35],
      input[36] << 24 | input[37] << 16 | input[38] << 8 | input[39],
      input[40] << 24 | input[41] << 16 | input[42] << 8 | input[43],
      input[44] << 24 | input[45] << 16 | input[46] << 8 | input[47],
      input[48] << 24 | input[49] << 16 | input[50] << 8 | input[51],
      input[52] << 24 | input[53] << 16 | input[54] << 8 | input[55],
      input[56] << 24 | input[57] << 16 | input[58] << 8 | input[59],
      input[60] << 24 | input[61] << 16 | input[62] << 8 | input[63]
    ];
    let T: number;

    for (let i = 16; i < 80; i++) {
      W.push((((W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]) << 1) | ((W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]) >>> 31)));
    }

    for (let i = 0; i < 80; i++) {
      T = ((A << 5) | (A >>> 27)) + E + W[i];
      if (i < 20) {
        T += ((B & C) | (~B & D)) + 0x5A827999 | 0;
      } else if (i < 40) {
        T += (B ^ C ^ D) + 0x6ED9EBA1 | 0;
      } else if (i < 60) {
        T += ((B & C) | (B & D) | (C & D)) + 0x8F1BBCDC | 0;
      } else {
        T += (B ^ C ^ D) + 0xCA62C1D6 | 0;
      }
      E = D;
      D = C;
      C = ((B << 30) | (B >>> 2));
      B = A;
      A = T;
    }

    this.current[0] += A;
    this.current[1] += B;
    this.current[2] += C;
    this.current[3] += D;
    this.current[4] += E;
    this.currentLen += 64;
  }

  doPadding(): Uint8Array {
    const datalen = (this.inLen + this.currentLen) * 8;
    const msw = 0; // FIXME
    const lsw = datalen & 0xFFFFFFFF;
    const zeros = this.inLen <= 55 ? 55 - this.inLen : 119 - this.inLen;
    const pad = new Uint8Array(new ArrayBuffer(zeros + 1 + 8));
    pad[0] = 0x80;
    pad[pad.length - 1] = lsw & 0xFF;
    pad[pad.length - 2] = (lsw >>> 8) & 0xFF;
    pad[pad.length - 3] = (lsw >>> 16) & 0xFF;
    pad[pad.length - 4] = (lsw >>> 24) & 0xFF;
    pad[pad.length - 5] = msw & 0xFF;
    pad[pad.length - 6] = (msw >>> 8) & 0xFF;
    pad[pad.length - 7] = (msw >>> 16) & 0xFF;
    pad[pad.length - 8] = (msw >>> 24) & 0xFF;
    return pad;
  }

  getDigest(): ArrayBuffer {
    const rv = new Uint8Array(new ArrayBuffer(20));
    rv[3] = this.current[0] & 0xFF;
    rv[2] = (this.current[0] >>> 8) & 0xFF;
    rv[1] = (this.current[0] >>> 16) & 0xFF;
    rv[0] = (this.current[0] >>> 24) & 0xFF;
    rv[7] = this.current[1] & 0xFF;
    rv[6] = (this.current[1] >>> 8) & 0xFF;
    rv[5] = (this.current[1] >>> 16) & 0xFF;
    rv[4] = (this.current[1] >>> 24) & 0xFF;
    rv[11] = this.current[2] & 0xFF;
    rv[10] = (this.current[2] >>> 8) & 0xFF;
    rv[9] = (this.current[2] >>> 16) & 0xFF;
    rv[8] = (this.current[2] >>> 24) & 0xFF;
    rv[15] = this.current[3] & 0xFF;
    rv[14] = (this.current[3] >>> 8) & 0xFF;
    rv[13] = (this.current[3] >>> 16) & 0xFF;
    rv[12] = (this.current[3] >>> 24) & 0xFF;
    rv[19] = this.current[4] & 0xFF;
    rv[18] = (this.current[4] >>> 8) & 0xFF;
    rv[17] = (this.current[4] >>> 16) & 0xFF;
    rv[16] = (this.current[4] >>> 24) & 0xFF;
    return rv.buffer;
  }

  reset(): void {
    this.currentLen = 0;
    this.inLen = 0;
    this.current[0] = 0x67452301;
    this.current[1] = 0xEFCDAB89;
    this.current[2] = 0x98BADCFE;
    this.current[3] = 0x10325476;
    this.current[4] = 0xC3D2E1F0;
  }
}

/* Input utility functions */

function fromASCII(s: string): Uint8Array {
  const buffer = new ArrayBuffer(s.length);
  const b = new Uint8Array(buffer);
  for (let i = 0; i < s.length; i++) {
    b[i] = s.charCodeAt(i);
  }
  return b;
}

function fromInteger(v: number): Uint8Array {
  const buffer = new ArrayBuffer(1);
  const b = new Uint8Array(buffer);
  b[0] = v;
  return b;
}

function convertToUint8Array(input: string | Uint8Array | ArrayBuffer | number): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  } else if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  } else if (typeof input === 'string') {
    return fromASCII(input);
  } else if (typeof input === 'number') {
    if (input > 0xFF) {
      throw new Error("For more than one byte, use an array buffer");
    } else if (input < 0) {
      throw new Error("Input value must be positive");
    }
    return fromInteger(input);
  } else {
    throw new Error("Unsupported type");
  }
}

function convertToUInt32(i: number): Uint8Array {
  const tmp = new Uint8Array(new ArrayBuffer(4));
  tmp[0] = (i & 0xFF000000) >> 24;
  tmp[1] = (i & 0x00FF0000) >> 16;
  tmp[2] = (i & 0x0000FF00) >> 8;
  tmp[3] = (i & 0x000000FF);
  return tmp;
}

/* Digest implementation */

interface DigestEngine {
  reset(): void;
  blockLen: number;
  digestLen: number;
  inbuf: Uint8Array;
  inLen: number;
  currentLen: number;
  processBlock(input: Uint8Array): void;
  doPadding(): Uint8Array;
  getDigest(): ArrayBuffer;
}

interface DigestInterface {
  update(input: string | Uint8Array | ArrayBuffer | number): void;
  finalize(): ArrayBuffer;
  digest(input: string | Uint8Array | ArrayBuffer | number): ArrayBuffer;
  reset(): void;
  digestLength(): number;
}

interface HMACInterface {
  setKey(key: string | Uint8Array | ArrayBuffer | number): void;
  update(input: string | Uint8Array | ArrayBuffer | number): void;
  finalize(): ArrayBuffer;
  mac(input: string | Uint8Array | ArrayBuffer | number): ArrayBuffer;
  reset(): void;
  hmacLength(): number;
}

function createDigest(Constructor: new () => DigestEngine): DigestInterface {
  const update = function (this: DigestEngine & { update: (input: Uint8Array) => void }, input: Uint8Array): void {
    let len = input.length;
    let offset = 0;
    while (len > 0) {
      let copyLen = this.blockLen - this.inLen;
      if (copyLen > len) {
        copyLen = len;
      }
      const tmpInput = input.subarray(offset, offset + copyLen);
      this.inbuf.set(tmpInput, this.inLen);
      offset += copyLen;
      len -= copyLen;
      this.inLen += copyLen;
      if (this.inLen === this.blockLen) {
        this.processBlock(this.inbuf);
        this.inLen = 0;
      }
    }
  };

  const finalize = function (this: DigestEngine & { update: (input: Uint8Array) => void; finalize: () => ArrayBuffer }): ArrayBuffer {
    const padding = this.doPadding();
    this.update(padding);
    const result = this.getDigest();
    this.reset();
    return result;
  };

  const engine = new Constructor();
  engine.inbuf = new Uint8Array(new ArrayBuffer(engine.blockLen));
  engine.reset();

  // Dynamically add methods to the engine
  (engine as any).update = update;
  (engine as any).finalize = finalize;

  return {
    update(input: string | Uint8Array | ArrayBuffer | number): void {
      (engine as any).update(convertToUint8Array(input));
    },

    finalize(): ArrayBuffer {
      return (engine as any).finalize();
    },

    digest(input: string | Uint8Array | ArrayBuffer | number): ArrayBuffer {
      (engine as any).update(convertToUint8Array(input));
      return (engine as any).finalize();
    },

    reset(): void {
      engine.reset();
    },

    digestLength(): number {
      return engine.digestLen;
    }
  };
}

/* HMAC implementation */

function createHMAC(digest: DigestInterface): HMACInterface {
  let initialized = false;
  let key: Uint8Array | undefined;
  let ipad: Uint8Array | undefined;
  let opad: Uint8Array | undefined;

  const init = function (): void {
    if (initialized) {
      return;
    }
    if (key === undefined) {
      throw new Error("MAC key is not defined");
    }
    let kbuf: Uint8Array;
    if (key.byteLength > 64) { /* B = 64 */
      kbuf = new Uint8Array(digest.digest(key));
    } else {
      kbuf = new Uint8Array(key);
    }
    ipad = new Uint8Array(new ArrayBuffer(64));
    for (let i = 0; i < kbuf.length; i++) {
      ipad[i] = 0x36 ^ kbuf[i];
    }
    for (let i = kbuf.length; i < 64; i++) {
      ipad[i] = 0x36;
    }
    opad = new Uint8Array(new ArrayBuffer(64));
    for (let i = 0; i < kbuf.length; i++) {
      opad[i] = 0x5c ^ kbuf[i];
    }
    for (let i = kbuf.length; i < 64; i++) {
      opad[i] = 0x5c;
    }
    initialized = true;
    digest.update(ipad.buffer as ArrayBuffer);
  };

  const resetMac = function (): void {
    initialized = false;
    key = undefined;
    ipad = undefined;
    opad = undefined;
    digest.reset();
  };

  const finalizeMac = function (): ArrayBuffer {
    const result = digest.finalize();
    digest.reset();
    digest.update(opad!.buffer as ArrayBuffer);
    digest.update(new Uint8Array(result));
    const finalResult = digest.finalize();
    resetMac();
    return finalResult;
  };

  const setKeyMac = function (k: Uint8Array): void {
    key = k;
  };

  return {
    setKey(keyInput: string | Uint8Array | ArrayBuffer | number): void {
      setKeyMac(convertToUint8Array(keyInput));
      init();
    },

    update(input: string | Uint8Array | ArrayBuffer | number): void {
      digest.update(convertToUint8Array(input));
    },

    finalize(): ArrayBuffer {
      return finalizeMac();
    },

    mac(input: string | Uint8Array | ArrayBuffer | number): ArrayBuffer {
      this.update(input);
      return this.finalize();
    },

    reset(): void {
      resetMac();
    },

    hmacLength(): number {
      return digest.digestLength();
    }
  };
}

export const Digest = {
  SHA1: function (): DigestInterface {
    return createDigest(SHA1Engine);
  },

  HMAC_SHA1: function (): HMACInterface {
    return createHMAC(createDigest(SHA1Engine));
  }
};
