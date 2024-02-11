
import BN from 'bn.js';
import { ec, curve } from 'elliptic'
import * as crypto from 'crypto';

export class Spake2Client {

  M_data = '04886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f5ff355163e43ce224e0b0e65ff02ac8e5c7be09419c785e0ca547d55a12e2d20';
  N_data = '04d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b4907d60aa6bfade45008a636337f5168c64d9bd36034808cd564490b1e656edbe7';

  forceX = false;

  curve: curve.base;
  username: string;
  password: string;
  G: curve.base.BasePoint;
  n: BN;
  M: curve.base.BasePoint;
  N: curve.base.BasePoint;
  w?: Buffer;
  x?: BN;
  X?: curve.base.BasePoint;
  T?: curve.base.BasePoint;
  S?: curve.base.BasePoint;
  K?: curve.base.BasePoint;
  TT?: Buffer;
  key?: Buffer;
  Ke?: Buffer;
  Ka?: Buffer;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
    this.curve = new ec("p256").curve;
    this.G = this.curve.g;
    this.n = this.curve.n;
    this.M = this.curve.decodePoint(this.M_data, "hex");
    this.N = this.curve.decodePoint(this.N_data, "hex");
  }

  // Calculate the T-value and return it as an arrayBuffer ready to send as "T" in the round 1 payload to the device
  calculateT() {
    this.w = crypto.createHash('sha256').update(this.password).digest();
    if (!this.forceX) {
      this.x = this.randomInteger(new BN('0', 10), this.n);
    }
    if (!this.x) {
      throw new Error("invalid state");
    }
    this.X = this.G.mul(this.x);

    this.T = this.M.mul(new BN(this.w)).add(this.X);
    const message = Buffer.from(this.T.encode('hex', true));

    return message;
  }

  calculateKHex(S: string) {
    this.S = this.curve.decodePoint(S, "hex");
    if (!this.w || this.x == null) {
      throw new Error("invalid state");
    }
    this.K = this.S.add(this.N.neg().mul(new BN(this.w))).mul(this.x)

  }

  calculateK(S: Buffer) {
    const Shex = this.toHexString(S);
    this.calculateKHex(Shex);
  }

  calculateKey(clientFp: string, deviceFp: string) {
    if (this.w == null || this.S == null || this.T == null || this.K == null) {
      throw new Error("invalid state");
    }
    this.TT = this.concat(Buffer.from(this.fromHexString(clientFp)), Buffer.from(this.fromHexString(deviceFp)), Buffer.from(this.T.encode('array', false)), Buffer.from(this.S.encode('array', false)), Buffer.from(this.K.encode('array', false)), Buffer.from(this.w));
    this.key = crypto.createHash('sha256').update(this.TT).digest();
    this.Ke = crypto.createHash('sha256').update(this.key).digest();
    this.Ka = crypto.createHash('sha256').update(this.Ke).digest();
    return this.Ka;
  }

  validateKey(ke: Buffer) {
    // TODO: check lengths
    if (!this.Ke) {
      throw new Error("invalid state");
    }

    for (let i = 0; i < this.Ke.length; i++) {
      if (ke[i] != this.Ke[i]) {
        console.log("FAILURE at index: ", i, " ", ke[i], " != ", this.Ke[i] );
        console.log("Matching incoming: ", ke, " vs. ", this.Ke);
        return false;
      }
    }
    return true;
  }


  randomInteger(l: BN, r: BN): BN {
    const range = r.sub(l)
    const size = Math.ceil(range.sub(new BN(1)).toString(16).length / 2)
    const v = new BN(crypto.randomBytes(size + 8).toString('hex'), 16)
    return v.mod(range).add(l)
  }

  concat (...bufs: Buffer[]): Buffer {
    let outBuf = Buffer.from([])
    for (const buf of bufs) {
      const bufLen = new BN(buf.length).toArrayLike(Buffer, 'be', 4)
      if (buf.length === 0) continue
      outBuf = Buffer.concat(
        [outBuf, bufLen, buf],
        outBuf.length + bufLen.length + buf.length
      )
    }
    return outBuf
  }

  toHexString(byteArray: Buffer): string {
    return Array.from(byteArray, function(byte) {
      return ('0' + (byte & 0xFF).toString(16)).slice(-2);
    }).join('')
  }

  fromHexString(str: string): number[] {
    const result: number[] = [];
    // Ignore any trailing single digit; I don't know what your needs
    // are for this case, so you may want to throw an error or convert
    // the lone digit depending on your needs.
    while (str.length >= 2) {
        result.push(parseInt(str.substring(0, 2), 16));
        str = str.substring(2, str.length);
    }

    return result;
}


  forceXVal(x: string) {
    this.forceX = true;
    this.x = new BN(x, 'hex');
  }

}
