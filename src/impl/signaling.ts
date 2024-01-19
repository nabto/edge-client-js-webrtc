const enum SignalMessage {
  OFFER = 0,
  ANSWER,
  ICE_CANDIDATE,
  TURN_REQUEST,
  TURN_RESPONSE,
  REQUEST_OFFER,

  LOGIN_REQUEST = 20,
  LOGIN_RESPONSE = 21
};

interface SctDeviceConfig {
  type: "SCT",
  productId: string,
  deviceId: string,
  sct: string
};

interface JwtDeviceConfig {
  type: "JWT",
  productId: string,
  deviceId: string,
  jwt: string
};

type DeviceConfig = SctDeviceConfig | JwtDeviceConfig;

export type TurnServer = {
  hostname: string,
  port: number,
  username: string,
  password: string
};

export interface MetaTrack {
  mid: string,
  trackId: string,
  error?: "OK" | "ACCESS_DENIED" | "UNKNOWN_TRACK_ID" | "INVALID_CODECS" | "UNKNOWN_ERROR",
};

export interface Metadata {
  status?: "OK" | "FAILED",
  tracks: MetaTrack[],
  noTrickle?: boolean,
};

export default class NabtoWebrtcSignaling {
  signalingHost = "";
  private config?: DeviceConfig;
  private _ws?: WebSocket;
  get ws() {
    if (!this._ws) {
      throw new Error("Signaling websocket has not yet been initialized!");
    }
    return this._ws;
  }
  set ws(val: WebSocket) {
    this._ws = val;
  }

  onconnected?: (res: { type: SignalMessage }) => void;
  onoffer?: (offer: { type: SignalMessage, data: string, metadata?: Metadata }) => void;
  onanswer?: (answer: { type: SignalMessage, data: string, metadata?: Metadata }) => void;
  onicecandidate?: (candidate: { type: SignalMessage, data: string }) => void;
  onturncredentials?: (creds: { type: number, servers: TurnServer[] }) => void;
  onerror?: (errorString: string, errorObject: any) => void;

  setDeviceConfigSct(productId: string, deviceId: string, sct: string) {
    this.config = {
      type: "SCT",
      productId,
      deviceId,
      sct
    };
  }

  setDeviceConfigJwt(productId: string, deviceId: string, jwt: string) {
    this.config = {
      type: "JWT",
      productId,
      deviceId,
      jwt
    };
  }

  signalingConnect() {
    if (!this.config) {
      throw new Error("NabtoWebrtcSignaling attempted to call signalingConnect with invalid configuration state.")
    }

    console.log(this.signalingHost);
    const ws = new WebSocket(this.signalingHost, "json");
    this.ws = ws;

    ws.addEventListener("error", e => {
      console.log("Websocket error: ", e);
      this.onerror?.("Websocket connection error", e);
    });

    ws.addEventListener("close", e => {
      console.log("WS closed: ", e);
      this.onerror?.("Websocket connection error", e);
      this._ws = undefined;
    });

    ws.addEventListener("open", e => {
      this.sendToServer({
        type: SignalMessage.LOGIN_REQUEST,
        productId: this.config?.productId,
        deviceId: this.config?.deviceId,
        sct: this.config?.type == "SCT" ? this.config.sct : undefined,
        jwt: this.config?.type == "JWT" ? this.config.jwt : undefined
      });
    });

    ws.addEventListener("message", e => this.wsMessage(ws, e));
  }

  close() {
    this._ws?.close();
    this._ws = undefined;
  }

  sendOffer(offer: any, metadata: any) {
    console.log("sendOffer");
    console.log(offer);
    this.sendToServer({
      type: SignalMessage.OFFER,
      data: JSON.stringify(offer),
      metadata: metadata
    })
  }

  sendAnswer(answer: any) {
    this.sendToServer({
      type: SignalMessage.ANSWER,
      data: JSON.stringify(answer)
    })
  }

  sendIceCandidate(candidate: any) {
    this.sendToServer({
      type: SignalMessage.ICE_CANDIDATE,
      data: JSON.stringify(candidate)
    })
  }

  requestTurnCredentials() {
    this.sendToServer({
      type: SignalMessage.TURN_REQUEST
    })
  }

  private wsMessage(ws: WebSocket, event: MessageEvent) {
    console.log(`Message received: ${event.data}`);
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case SignalMessage.LOGIN_RESPONSE: {
        // WEBSOCK_LOGIN_RESPONSE
        this.onconnected?.(msg);
        break;
      }

      case SignalMessage.OFFER: {
        // video offer (potentially used for renegotiation)
        console.log(msg);
        this.onoffer?.(msg);
        break;
      }

      case SignalMessage.ANSWER: {
        // video answer from device
        this.onanswer?.(msg);
        break;
      }

      case SignalMessage.ICE_CANDIDATE: {
        this.onicecandidate?.(msg);
        break;
      }

      case SignalMessage.TURN_RESPONSE: {
        this.onturncredentials?.(msg);
        break;
      }

      default: {
        console.error(`Received unknown message: ${msg}`);
        this.onerror?.("Unknown Nabto Signaling message", msg);
        break;
      }
    }
  }

  private sendToServer(msg: any) {
    const json = JSON.stringify(msg);
    this.ws.send(json);
  }
}
