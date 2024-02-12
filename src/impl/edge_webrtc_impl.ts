import { ClosedCallback, CoapContentFormat, CoapMethod, CoapResponse, ConnectedCallback, ConnectionOptions, EdgeWebrtcConnection, OnTrackCallback } from "../edge_webrtc";
import { NabtoWebrtcConnection } from "./peer_connection";
import NabtoWebrtcSignaling from "./signaling";
import { WebRTCMetadata, TurnServer } from "./signaling_types";
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

  private metadata: WebRTCMetadata = { tracks: [] };

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
    return new Promise<void>((resolve) => {

      if (!this.connectionOpts) {
        throw new Error("Missing connection options");
      }

      if (this.connectionOpts.signalingServerUrl != null) {
        console.log("Setting signaling URL: ", this.connectionOpts.signalingServerUrl)
        this.signaling.signalingHost = this.connectionOpts.signalingServerUrl;
      }
      this.signaling.setDeviceConfigSct(this.connectionOpts.productId, this.connectionOpts.deviceId, this.connectionOpts.sct);

      this.signaling.onconnected = async () => {
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
        const localDescription = this.pc.localDescription;
        if (localDescription) {
          this.signaling.sendAnswer(localDescription, this.metadata);
        }
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

        // this.signaling.sendOffer(this.pc.localDescription, { noTrickle: false });

        coapChannel.addEventListener("open", async () => {
          this.connection.setCoapDataChannel(coapChannel);
          this.connected = true;
          if (this.connectedCb) {
            this.connectedCb();
          }
        });

      };

      this.signaling.signalingConnect();
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


  async coapInvoke(method: CoapMethod, path: string, contentFormat?: number, payload?: Buffer): Promise<CoapResponse> {
    const response = await this.connection.coapInvoke(method, path, contentFormat, payload);
    const resp = JSON.parse(response);
    const result: CoapResponse = {
      statusCode: resp.statusCode,
      contentFormat: resp.contentType,
      payload: resp.payload
    }
    // TODO: ensure this follows the CoapResponse format.
    return result;
  }

  passwordAuthenticate(username: string, password: string): Promise<void> {
    return this.connection.passwordAuthenticate(username, password);
  }

  async validateFingerprint(fingerprint: string): Promise<boolean> {
    const nonce = crypto.randomUUID();
    const response = await this.connection.coapInvoke("POST", `/webrtc/challenge`, CoapContentFormat.APPLICATION_JSON, JSON.stringify({ challenge: nonce }));
    const resp = JSON.parse(response);
    if (resp.statusCode != 205) {
      throw new Error(`Failed validate fingerprint with status: ${resp.statusCode}`);
    } else {
      const respPl = JSON.parse(String.fromCharCode.apply(null, resp.payload));
      console.log("respPl: ", respPl);
      const valid = await this.validateJwt(respPl.response, fingerprint, nonce);
      console.log("Fingerprint validity: ", valid);
      return valid;
    }

  }

  // TODO: our example currently do not use streams, so it is not implemented
  //openEdgeStream(streamPort: number): Promise<EdgeStream> {}

  // TODO: our example does not use this
  async addTrack(track: MediaStreamTrack, trackId: string): Promise<void> {
    console.log("My metadata: ", this.metadata);
    let mid: string | undefined;
    for (const t of this.metadata.tracks) {
      if (t.trackId == trackId) {
        mid = t.mid;
      }
    }
    if (mid == null) {
      console.error("did not find track ID in metadata creating new track currently not supported!!");
      throw new Error("New track is currently unsupported")
      return;
    }

    const trans = this.pc.getTransceivers();
    for (const t of trans) {
      if (t.mid == mid) {
        console.log("Found mid match! direction: ", t.currentDirection);
        t.direction = "sendrecv";
        t.sender.replaceTrack(track);
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return;
      }
    }

    console.error("NO MATCH FOUND")
    // stream.getTracks().forEach(track => this.pc.addTrack(track, stream));
    // const offer = await this.pc.createOffer();
    // await this.pc.setLocalDescription(offer);
  }

  private setMetadata(data: WebRTCMetadata) {
    if (data.status != null && data.status == "FAILED") {
      for (const t of data.tracks) {
        if (t.error != null) {
          console.error(`Device reported Track ${t.mid}:${t.trackId} failed with error: ${t.error}`);
        }
      }
    }
    this.metadata = data;
  }

  private closeContext(error?: Error | Event) {
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
    } else {
      console.log("CloseContext when already closed")
    }
  }

  private setupPeerConnection(turnServers: TurnServer[]) {

    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.nabto.net" }]
    for (const s of turnServers) {
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

    this.pc.oniceconnectionstatechange = () => {
      switch (this.pc.iceConnectionState) {
        case "closed":
        case "failed":
        case "disconnected": {
          console.log("closing from iceconnectionstatechange");
          this.closeContext(new Error("Connection closed by device"));
          break;
        }
        default: {
          // do not handle the other states
          break;
        }
      }
    };

    this.pc.onicegatheringstatechange = () => {
      console.log(`ICE gathering state changed to: ${this.pc.iceGatheringState}`);
    };

    this.pc.onsignalingstatechange = () => {
      console.log(`WebRTC signaling state changed to: ${this.pc.signalingState}`);
      switch (this.pc.signalingState) {
        case "have-local-offer": {
          const localDescription = this.pc.localDescription;
          if (localDescription) {
            this.signaling.sendOffer(localDescription, this.metadata);
          }
          break;
        }
        case "closed": {
          console.log("closing from signalingstatechange");
          this.closeContext();
          break;
        }
        default: {
          // Do not handle the other states
        }
      }
    };

    this.pc.onnegotiationneeded = () => {
      console.log("Negotiation needed!!");

    };

    this.pc.ontrack = (ev: RTCTrackEvent) => {
      const mid = ev.transceiver.mid;
      if (this.onTrackCb) {
        for (const t of this.metadata.tracks) {
          if (t.mid == mid) {
            return this.onTrackCb(ev, t.trackId, t.error);
          }
        }
        console.error(`Got track event but mid: ${mid} was not found in metadata`);
        return this.onTrackCb(ev, undefined);

      } else {
        console.error("Got track event but no callback was set");
      }
    };

  }

  private async validateJwt(token: string, fingerprint: string, nonce: string): Promise<boolean> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      return false;
    }
    console.log("decoded JWT: ", decoded);

    type JwtHeaderWithJwk = jwt.JwtHeader & { jwk?: JsonWebKey }

    const header: JwtHeaderWithJwk = decoded.header;

    if (!header.jwk) {
      return false;
    }

    console.log("importing JWK: ", header.jwk)

    const payload: jwt.JwtPayload | string = decoded.payload;
    if (typeof(payload) == "string" || payload.nonce == null || payload.nonce != nonce) {
      return false;
    }

    const signingData = token.substring(0, token.lastIndexOf('.'));
    console.log("SigningData: ", signingData);

    const pubKey = await crypto.subtle.importKey(
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

    const valid = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: { name: "SHA-256" }
      },
      pubKey,
      Buffer.from(decoded.signature, 'base64'),
      Buffer.from(signingData)
    );
    console.log("Token validity: ", valid);
    if (!valid) {
      return false;
    }

    const pubKeyData = await crypto.subtle.exportKey("spki", pubKey);
    const fpBuf = await crypto.subtle.digest("SHA-256", pubKeyData);
    const fpArr = Array.from(new Uint8Array(fpBuf));
    const fp = fpArr
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    console.log("FP: ", fp);

    return fp == fingerprint;

  }


}
