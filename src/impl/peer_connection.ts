
import { CoapContentFormat, CoapMethod } from '../edge_webrtc';
import { Spake2Client } from './spake2';
// import * as cbor from 'cbor'
var cbor = require('cbor');
import { v4 as uuidv4 } from 'uuid';

type CoapCallback = (data: string) => void;

export class NabtoWebrtcConnection {

  myPeerConnection?: RTCPeerConnection;
  coapDataChannel?: RTCDataChannel;

  coapRequests = new Map<string, CoapCallback>();

  constructor() {

  }

  setPeerConnection(conn: RTCPeerConnection) {
    this.myPeerConnection = conn;
  }

  setCoapDataChannel(channel: RTCDataChannel) {
    this.coapDataChannel = channel;
    let self = this;
    channel.addEventListener("message", (event) => {
      console.log("Got datachannel message: ", event.data);
      let data = JSON.parse(event.data);
      let cb = self.coapRequests.get(data.requestId);
      self.coapRequests.delete(data.requestId);
      if (cb) {
        cb(event.data);
      }
    });
  }

  coapInvokeCb(method: CoapMethod, path: string, contentType: number | undefined, payload: Buffer | string | undefined, cb: CoapCallback){
    if (!this.coapDataChannel) {
      throw new Error("CoAP data channel not configured");
    }

    // crypto.randomUUID() is not available on remote http
    let requestId = uuidv4();//crypto.randomUUID();

    let pl = payload;
    if (payload && (typeof payload === "string")) {
      pl = Buffer.from(payload, "utf-8");
    }

    let req = {
      type: 0,
      requestId: requestId,
      method: method,
      path: path,
      contentType: contentType,
      payload: pl
    }

    this.coapRequests.set(requestId, cb);
    this.coapDataChannel.send(JSON.stringify(req));
  }

  coapInvoke(method: CoapMethod, path: string, contentType?: number, payload?: Buffer | string): Promise<string> {
      return new Promise((resolve) => {
        this.coapInvokeCb(method, path, contentType, payload, (response) => {
          resolve(response);
        });
      });
  }

  decodeCborPayload(payload: Buffer): any
  {
    let val = cbor.decodeAllSync(Buffer.from(payload));
    return val[0];
  }

  async passwordAuthenticate(username: string, password: string): Promise<void> {
    if (!this.coapDataChannel) {
      throw new Error("CoAP data channel not configured");
    }

    let s = new Spake2Client(username, password);

    let T = s.calculateT();
    let obj = {
      T: T,
      Username: username
    }
    let payload = cbor.encode(obj);

    let resp = await this.coapInvoke("POST", "/p2p/pwd-auth/1", CoapContentFormat.APPLICATION_CBOR, payload);

    console.log("Password round 1 response: ", resp);
    let response = JSON.parse(resp);

    if (!this.myPeerConnection || this.myPeerConnection.localDescription == null || this.myPeerConnection.remoteDescription == null) {
      throw new Error("Bad peerConnection");
    }
    let clifp = this.fpFromSdp(this.myPeerConnection.localDescription.sdp);
    let devFp = this.fpFromSdp(this.myPeerConnection.remoteDescription.sdp);

    s.calculateK(response.payload);
    let KcA = s.calculateKey(clifp, devFp);
    let resp2 = await this.coapInvoke("POST", "/p2p/pwd-auth/2", CoapContentFormat.APPLICATION_OCTET_STREAM, KcA);
    console.log("Password round 2 resp: ", resp2);
    let response2 = JSON.parse(resp2);
    if (s.validateKey(response2.payload)) {
      return;
    } else {
      throw new Error("Invalid username/password");
    }
  }

  readStream(channel: RTCDataChannel, cb: CoapCallback)
  {
    channel.addEventListener("message", (event) => {
      console.log("Got stream channel message: ", event.data);
      cb(event.data);
    });
  }


  fpFromSdp(sdp: string): string
  {
    const searchStr = "a=fingerprint:sha-256 ";
    let fpAttStart = sdp.search(searchStr);
    if (fpAttStart == -1) {
      console.log("Failed to find fingerprint in SDP: ", sdp);
      return "";
    }
    console.log("Found fpAttStart: ", fpAttStart);

    let fp = sdp.substring(fpAttStart+searchStr.length, fpAttStart+searchStr.length+64+31); //fp is 64 chars with a `:` between every 2 chars
    fp = fp.replace(/:/g, "");
    console.log("Found fingerprint: ", fp);
    return fp;
  }

}
