import { ClosedCallback, CoapContentFormat, CoapMethod, CoapResponse, ConnectedCallback, ConnectionOptions, EdgeWebrtcConnection, OnTrackCallback } from "../edge_webrtc";
import { NabtoWebrtcConnection } from "./peer_connection";
import NabtoWebrtcSignaling, { Metadata, TurnServer } from "./signaling";
import * as jwt from 'jsonwebtoken';

export class WebrtcConnectionImpl implements EdgeWebrtcConnection {
  connectionOpts?: ConnectionOptions;
  connectedCb?: ConnectedCallback;
  closedCb?: ClosedCallback;
  onTrackCb?: OnTrackCallback;

  signaling = new NabtoWebrtcSignaling();
  connection = new NabtoWebrtcConnection();
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.nabto.net" }]
  });

  started = false;
  connected = false;

  private metadata?: Metadata;

  closeResolver?: (value: void | PromiseLike<void>) => void;

  setConnectionOptions(opts: ConnectionOptions): void {
    this.connectionOpts = opts;
  }

  onConnected(fn: ConnectedCallback): void {
    this.connectedCb = fn;
  }

  onClosed(fn: ClosedCallback): void {
    this.closedCb = fn;

  }

  onTrack(fn: OnTrackCallback): void {
    this.onTrackCb = fn;
  }


  connect(): Promise<void> {
    this.started = true;
    this.signaling = new NabtoWebrtcSignaling();
    this.connection = new NabtoWebrtcConnection();

    if (!this.connectionOpts) {
      throw new Error("Missing connection options");
    }

    if (this.connectionOpts.signalingServerUrl){
      console.log("Setting signaling URL: ", this.connectionOpts.signalingServerUrl)
      this.signaling.signalingHost = this.connectionOpts.signalingServerUrl;
    }
    this.signaling.setDeviceConfigSct(this.connectionOpts.productId, this.connectionOpts.deviceId, this.connectionOpts.sct);

    this.signaling.onconnected = async (msg: any) => {
      this.signaling.requestTurnCredentials();
    };

    this.signaling.onanswer = async (msg) => {
      const answer = JSON.parse(msg.data);
      this.setMetadata(msg.metadata);
      const desc = new RTCSessionDescription(answer);
      await this.pc.setRemoteDescription(desc).catch(reason => {
        console.error(`setRemoteDesc failed with ${reason}`);
        this.closeContext(reason);
      });
    };

    this.signaling.onoffer = async (msg) => {
      const offer = JSON.parse(msg.data);
      this.setMetadata(msg.metadata);
      const desc = new RTCSessionDescription(offer);
      await this.pc.setRemoteDescription(desc);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      this.signaling.sendAnswer(this.pc.localDescription);
    };

    this.signaling.onicecandidate = async (msg) => {
      try {
        const candidate = new RTCIceCandidate(JSON.parse(msg.data));
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        console.error(`Failed to add candidate to peer connection`, err);
      }
    };

    this.signaling.onerror = (msg, err) => {
      console.log("Signaling error: ", msg, err);
      this.closeContext(err);
    };

    this.signaling.onturncredentials = async (creds) => {
      this.setupPeerConnection(creds.servers);

      const coapChannel = this.pc.createDataChannel("coap");

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      this.signaling.sendOffer(this.pc.localDescription, { noTrickle: false });

      coapChannel.addEventListener("open", async (event) => {
        this.connection.setCoapDataChannel(coapChannel);
        this.connected = true;
        if (this.connectedCb) {
          this.connectedCb();
        }
      });

    };

    this.signaling.signalingConnect();

    return new Promise<void>((resolve) => {
      resolve();
    });
  }

  close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.started) {
        return reject(new Error("Invalid state"));
      }
      this.closeResolver = resolve;
      this.closeContext();
    });

  }


  async coapInvoke(method: CoapMethod, path: string, contentType?: number, payload?: Buffer): Promise<CoapResponse> {
    const response = await this.connection.coapInvoke(method, path, contentType, payload);
    const resp = JSON.parse(response);
    // TODO: ensure this follows the CoapResponse format.
    return resp;
  }

  passwordAuthenticate(username: string, password: string): Promise<void> {
    return this.connection.passwordAuthenticate(username, password);
  }

  async validateFingerprint(fingerprint: string): Promise<boolean> {
    const response = await this.connection.coapInvoke("POST", `/webrtc/challenge`, CoapContentFormat.APPLICATION_JSON, JSON.stringify({ challenge: crypto.randomUUID() }));
    const resp = JSON.parse(response);
    if (resp.statusCode != 205) {
      throw new Error(`Failed validate fingerprint with status: ${resp.statusCode}`);
    } else {
      let respPl = JSON.parse(String.fromCharCode.apply(null, resp.payload));
      console.log("respPl: ", respPl);
      let valid = await this.validateJwt(respPl.response, fingerprint);
      console.log("Fingerprint validity: ", valid);
      return valid;
    }

  }

  // TODO: our example currently do not use streams, so it is not implemented
  //openEdgeStream(streamPort: number): Promise<EdgeStream> {}

  // TODO: our example does not use this
  addTrack(track: MediaStreamTrack): void {
    console.error("addTrack() NOT IMPLEMENTED");
  }

  private setMetadata(data?: Metadata) {
    if (data && data.status && data.status == "FAILED") {
      if (data.tracks) {
        for (let t of data.tracks) {
          if (t.error) {
            console.error(`Device reported Track ${t.mid}:${t.trackId} failed with error: ${t.error}`);
          }
        }
      } else {
        console.error("Device reported track errors but no tracks was in the metadata: ", data);
      }
    }
    this.metadata = data;
  }

  private closeContext(error?: any) {
    if (this.started) {
      this.started = false;
      this.connected = false;
      console.log("Closing peer connection");

      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onsignalingstatechange = null;
      this.pc.onicegatheringstatechange = null;
      this.pc.onnegotiationneeded = null;

      try {
        this.pc.getTransceivers().forEach(t => {
          try {
            t.stop()
          } catch (err) {
            // ignore
          }

      });
    } catch (err) {
      // ignore
    }

      this.pc.close();
      this.signaling.close();
      if (this.closedCb) {
        this.closedCb(error);
      }
    }else {
      console.log("CloseContext when already closed")
    }
  }

  private setupPeerConnection(turnServers: TurnServer[]) {

    let iceServers: RTCIceServer[] = [{ urls: "stun:stun.nabto.net" }]
    for ( let s of turnServers) {
      iceServers.push({
        urls: `${s.hostname}`,
        username: s.username,
        credential: s.password,
      });
    }

    console.log("ice servers: ", iceServers);

    this.pc = new RTCPeerConnection({
      iceServers: iceServers,
      // iceTransportPolicy: "relay",
    });
    this.connection.setPeerConnection(this.pc);
    this.pc.onicecandidate = event => {
      if (event.candidate) {
        console.log(`New outgoing ICE candidate: ${event.candidate.candidate}`);
        this.signaling.sendIceCandidate(event.candidate);
      }
    };

    this.pc.oniceconnectionstatechange = (event) => {
      switch (this.pc.iceConnectionState) {
        case "closed":
        case "failed":
        case "disconnected": {
          console.log("closing from iceconnectionstatechange");
          this.closeContext("Connection closed by device");
          break;
        }
      }
    };

    this.pc.onicegatheringstatechange = (event) => {
      console.log(`ICE gathering state changed to: ${this.pc.iceGatheringState}`);
    };

    this.pc.onsignalingstatechange = (event) => {
      console.log(`WebRTC signaling state changed to: ${this.pc.signalingState}`);
      switch (this.pc.signalingState) {
        case "closed": {
          console.log("closing from signalingstatechange");
          this.closeContext();
          break;
        }
      }
    };

    this.pc.onnegotiationneeded = (event) => {
      console.log("Negotiation needed!!");
    };

    this.pc.ontrack = (ev: RTCTrackEvent) => {
      let mid = ev.transceiver.mid;
      if (this.onTrackCb) {
        if (this.metadata && this.metadata.tracks) {
          for (let t of this.metadata.tracks) {
            if (t.mid == mid) {
              return this.onTrackCb(ev, t.trackId, t.error);
            }
          }
          console.error(`Got track event but mid: ${mid} was not found in metadata`);
          return this.onTrackCb(ev, undefined);
        } else {
          console.error("Got track event but no metadata was received");
          return this.onTrackCb(ev, undefined);
        }
      } else {
        console.error("Got track event but no callback was set");
      }
    };

  }

  private async validateJwt(token: string, fingerprint: string): Promise<boolean>
  {
    let decoded = jwt.decode(token, {complete: true});
    if (decoded == null) {
      return false;
    }
    console.log("decoded JWT: ", decoded);
    let header: any = decoded.header;
    console.log("importing JWK: ", header.jwk)

    let signingData = token.substring(0, token.lastIndexOf('.'));
    console.log("SigningData: ", signingData);

    let pubKey = await crypto.subtle.importKey(
      "jwk",
      header.jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      true,
      ["verify"]);

    console.log("Signature: ", decoded.signature);
    console.log("Decoded signature: ", Buffer.from(decoded.signature, 'base64'));

    let valid = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: { name: "SHA-256"}
      },
      pubKey,
      Buffer.from(decoded.signature, 'base64'),
      Buffer.from(signingData)
    );
    console.log("Token validity: ", valid);
    if (!valid) {
      return false;
    }

    let pubKeyData = await crypto.subtle.exportKey("spki",pubKey);
    let fpBuf = await crypto.subtle.digest("SHA-256", pubKeyData);
    let fpArr = Array.from(new Uint8Array(fpBuf));
    const fp = fpArr
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
    console.log("FP: ", fp);

    return fp == fingerprint;

  }


}