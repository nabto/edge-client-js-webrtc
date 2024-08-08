import { ClosedCallback, CoapContentFormat, CoapMethod, CoapResponse, ConnectionOptions, EdgeWebrtcConnection, NabtoWebrtcError, NabtoWebrtcErrorCode, OnTrackCallback } from "../edge_webrtc";
import { NabtoWebrtcConnection } from "./peer_connection";
import NabtoWebrtcSignaling from "./signaling";
import { WebRTCMetadata, WebRTCMetadataMetaTrack } from "./signaling_types";
import * as jwt from 'jsonwebtoken';

interface PendingMetadata {
  mediaStreamTrackTrackId: string;
  trackId: string;
}

export class WebrtcConnectionImpl implements EdgeWebrtcConnection {
  connectionOpts?: ConnectionOptions;
  closedCb?: ClosedCallback;
  onTrackCb?: OnTrackCallback;

  signaling = new NabtoWebrtcSignaling();
  connection = new NabtoWebrtcConnection();
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.nabto.net" }]
  });

  started = false;
  connected = false;

  polite: boolean = true;
  makingOffer: boolean = false;
  ignoreOffer: boolean = false;

  private addedMetadata: Array<PendingMetadata> = new Array<PendingMetadata>();
  private receivedMetadata: Map<string, WebRTCMetadataMetaTrack> = new Map<string, WebRTCMetadataMetaTrack>();

  closeResolver?: (value: void | PromiseLike<void>) => void;
  connectResolver?: {resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: unknown) => void}

  setConnectionOptions(opts: ConnectionOptions): void {
    this.connectionOpts = opts;
  }

  onClosed(fn: ClosedCallback): void {
    this.closedCb = fn;

  }

  onTrack(fn: OnTrackCallback): void {
    this.onTrackCb = fn;
  }

  createMetadata(): WebRTCMetadata {
    const m: WebRTCMetadata = { tracks: [] };

    this.pc.getTransceivers().forEach((transceiver) => {
      const mid = transceiver.mid;
      if (mid != null) {
        const metaTrack: WebRTCMetadataMetaTrack | undefined = this.receivedMetadata.get(mid);
        if (metaTrack) {
          m.tracks?.push(metaTrack);
        } else {
          this.addedMetadata.forEach((pm) => {
            if (transceiver.sender.track?.id === pm.mediaStreamTrackTrackId) {
              const mid = transceiver.mid;
              if (mid !== null) {
                m.tracks?.push({mid: mid, trackId: pm.trackId});
              } else {
                console.log(`mid === null for trackId ${pm.trackId}`);
              }
            }
          })
        }
      }
    })

    m.status = "OK";
    m.tracks?.forEach((track) => {
      if (track.error != null && track.error !== "OK") {
        m.status = "FAILED";
      }
    })
    return m;
  }

  async sendDescription(localDescription?: RTCSessionDescription | null): Promise<void> {
    if (localDescription) {
      if (localDescription.type === "offer") {
        this.signaling.sendOffer(localDescription, this.createMetadata());
      } else if (localDescription.type === "answer") {
        this.signaling.sendAnswer(localDescription, this.createMetadata());
      } else {
        console.log("Something happened which should not happen, please debug the code.");
      }
    }
  }

  async handleIceCandidate(candidate?: RTCIceCandidate) {
    if (candidate) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!this.ignoreOffer) {
          throw err;
        }
      }
    }
  }

  async handleDescription(description?: RTCSessionDescription, metadata?: WebRTCMetadata) : Promise<void> {
    try {
      if (description) {
        const offerCollision =
          description.type === "offer" &&
          (this.makingOffer || this.pc.signalingState !== "stable");

        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) {
          return;
        }

        if (metadata) {
          this.handleMetadata(metadata);
        }
        await this.pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await this.pc.setLocalDescription();
          const localDescription = this.pc.localDescription;
          this.sendDescription(localDescription);
        }
      }
    } catch (err) {
      console.error(err);
      this.closeContext(new NabtoWebrtcError("Unknown error", NabtoWebrtcErrorCode.UNKNOWN, err));
    }
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.started) {
        throw new Error("Invalid state");
      }

      if (!this.connectionOpts) {
        throw new Error("Missing connection options");
      }

      this.started = true;
      this.connectResolver = {resolve: resolve, reject: reject};
      this.signaling = new NabtoWebrtcSignaling();
      this.connection = new NabtoWebrtcConnection();

      if (this.connectionOpts.signalingServerUrl != null) {
        console.log(`Setting signaling URL: ${this.connectionOpts.signalingServerUrl}/signaling/v1`)
        this.signaling.signalingHost = `${this.connectionOpts.signalingServerUrl}/signaling/v1`;
      } else {
        console.log(`using default signaling URL: wss://${this.connectionOpts.productId}.signaling.nabto.net/signaling/v1`);
        this.signaling.signalingHost = `wss://${this.connectionOpts.productId}.signaling.nabto.net/signaling/v1`;
      }
      this.signaling.setDeviceConfigSct(this.connectionOpts.productId, this.connectionOpts.deviceId, this.connectionOpts.sct);

      this.signaling.onconnected = async () => {
        this.signaling.requestTurnCredentials();
      };

      this.signaling.onanswer = async (msg) => {
        const answer = JSON.parse(msg.data);
        const desc = new RTCSessionDescription(answer);
        await this.handleDescription(desc, msg.metadata);
      };

      this.signaling.onoffer = async (msg) => {
        const offer = JSON.parse(msg.data);
        const desc = new RTCSessionDescription(offer);
        await this.handleDescription(desc, msg.metadata);
      };

      this.signaling.onicecandidate = async (msg) => {
        const candidate = new RTCIceCandidate(JSON.parse(msg.data));
        await this.handleIceCandidate(candidate);
      };

      this.signaling.onerror = (err) => {
        console.log("Signaling error: ", err);
        this.closeContext(err);
      };

      this.signaling.onturncredentials = async (creds) => {
        if (creds.iceServers) {
          this.setupPeerConnection(creds.iceServers);
        } else if (creds.servers) {
          const iceServers: RTCIceServer[] = [];
          for (const s of creds.servers) {
            iceServers.push({
              urls: `${s.hostname}`,
              username: s.username,
              credential: s.password,
            });
          }
          this.setupPeerConnection(iceServers);
        }


        const coapChannel = this.pc.createDataChannel("coap");

        coapChannel.addEventListener("open", async () => {
          this.connection.setCoapDataChannel(coapChannel);
          this.connected = true;
          if (this.connectResolver) {
            this.connectResolver = undefined;
            resolve();
          }
        });

      };

      try {
        this.signaling.signalingConnect();
      } catch(err) {
        this.connectResolver = undefined;
        throw err;
      }
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
    if (!this.connected) {
      throw new Error("Not Connected")
    }
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
    if (!this.connected) {
      throw new Error("Not Connected")
    }
    return this.connection.passwordAuthenticate(username, password);
  }

  async validateFingerprint(fingerprint: string): Promise<boolean> {
    if (!this.connected) {
      throw new Error("Not Connected")
    }
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

  async addTrack(track: MediaStreamTrack, trackId: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Not Connected")
    }
    console.log("My receivedMetadata: ", this.receivedMetadata);
    let mid: string | undefined;
    for (const t of this.receivedMetadata.values()) {
      if (t.trackId == trackId) {
        mid = t.mid;
      }
    }

    if (mid == null) {
      // no transceiver was found which matches the trackId so adding a new track/transceiver/mid
      this.addedMetadata.push({ mediaStreamTrackTrackId: track.id, trackId: trackId });
      this.pc.addTransceiver(track, {});
      return;
    } else {
      const trans = this.pc.getTransceivers();
      for (const t of trans) {
        if (t.mid == mid) {
          console.log("Found mid match! direction: ", t.currentDirection);
          t.direction = "sendrecv";
          t.sender.replaceTrack(track);
          return;
        }
      }
      console.error(`NO MATCH FOUND, Could not find a transceiver with the mid ${mid}`)
      throw new Error(`Transceiver missing for mid: ${mid}`);
    }
  }

  async createDatachannel(label: string): Promise<RTCDataChannel> {
    const channel = this.pc.createDataChannel(label);
    return channel;
  }

  private handleMetadata(data: WebRTCMetadata) {
    if (data.status != null && data.status == "FAILED") {
      if (data.tracks) {
      for (const t of data.tracks) {
        if (t.error != null) {
          console.error(`Device reported Track ${t.mid}:${t.trackId} failed with error: ${t.error}`);
          }
        }
      }
    }

    // Update receivedMetadata with incoming metadata
    data.tracks?.forEach(element => {
      this.receivedMetadata.set(element.mid, element);
    });
  }

  private closeContext(error?: NabtoWebrtcError) {
    if (this.started) {
      const wasConnected = this.connected;
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
      if (this.connectResolver) {
        const rej = this.connectResolver.reject;
        this.connectResolver = undefined;
        rej(error);
      }
      if (this.closedCb && wasConnected) {
        this.closedCb(error);
      }
      if (this.closeResolver) {
        this.closeResolver();
      }
    } else {
      console.log("CloseContext when already closed")
    }
  }

  private setupPeerConnection(iceServers: RTCIceServer[]) {

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
          this.closeContext(new NabtoWebrtcError("Connection closed by device", NabtoWebrtcErrorCode.DEVICE_CLOSED));
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

    this.pc.onnegotiationneeded = async () => {
      console.log("Negotiation needed!!");
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        const localDescription = this.pc.localDescription;
        this.sendDescription(localDescription);
      } catch (err) {
        console.error(err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = (ev: RTCTrackEvent) => {
      const mid = ev.transceiver.mid;
      if (this.onTrackCb) {
        for (const t of this.receivedMetadata.values()) {
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
