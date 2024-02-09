import { LoginRequest, LoginResponse, SignalingMessage, SignalingMessageTypes, TurnResponse, WebRTCAnswer, WebRTCIceCandidate, WebRTCMetadata, WebRTCOffer, signalingMessageType } from "./signaling_types";

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

  onconnected?: (res: LoginResponse) => void;
  onoffer?: (offer: WebRTCOffer) => void;
  onanswer?: (answer: WebRTCAnswer) => void;
  onicecandidate?: (candidate: WebRTCIceCandidate) => void;
  onturncredentials?: (creds: TurnResponse) => void;
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
      if (!this.config) {
        console.log("missing configuration");
        return;
      }
      const loginRequest: LoginRequest = {
        type: SignalingMessageTypes.LOGIN_REQUEST,
        productId: this.config.productId,
        deviceId: this.config.deviceId,
        sct: this.config?.type == "SCT" ? this.config.sct : undefined,
        jwt: this.config?.type == "JWT" ? this.config.jwt : undefined
      }
      this.sendToServer(loginRequest);
    });

    ws.addEventListener("message", e => this.wsMessage(ws, e));
  }

  close() {
    this._ws?.close();
    this._ws = undefined;
  }

  sendOffer(offer: any, metadata: any) {
    console.log(`sendOffer metadata: ${JSON.stringify(metadata)}`);
    console.log(offer);
    this.sendToServer({
      type: SignalingMessageTypes.WEBRTC_OFFER,
      data: JSON.stringify(offer),
      metadata: metadata
    })
  }

  sendAnswer(answer: any, metadata: WebRTCMetadata) {
    const message: WebRTCAnswer = {
      type: SignalingMessageTypes.WEBRTC_ANSWER,
      data: JSON.stringify(answer),
      metadata: metadata
    }
    this.sendToServer(message);
  }

  sendIceCandidate(candidate: any) {
    this.sendToServer({
      type: SignalingMessageTypes.WEBRTC_ICE_CANDIDATE,
      data: JSON.stringify(candidate)
    })
  }

  requestTurnCredentials() {
    this.sendToServer({
      type: SignalingMessageTypes.TURN_REQUEST
    })
  }

  private wsMessage(ws: WebSocket, event: MessageEvent) {
    console.log(`Message received: ${event.data}`);

    const json = JSON.parse(event.data);

    const msg: SignalingMessage = signalingMessageType.parse(json);


    switch (msg.type) {
      case SignalingMessageTypes.LOGIN_RESPONSE: {
        // WEBSOCK_LOGIN_RESPONSE
        this.onconnected?.(msg as LoginResponse);
        break;
      }

      case SignalingMessageTypes.WEBRTC_OFFER: {
        // video offer (potentially used for renegotiation)
        console.log(msg);
        this.onoffer?.(msg as WebRTCOffer);
        break;
      }

      case SignalingMessageTypes.WEBRTC_ANSWER: {
        // video answer from device
        this.onanswer?.(msg as WebRTCAnswer);
        break;
      }

      case SignalingMessageTypes.WEBRTC_ICE_CANDIDATE: {
        this.onicecandidate?.(msg as WebRTCIceCandidate);
        break;
      }

      case SignalingMessageTypes.TURN_RESPONSE: {
        this.onturncredentials?.(msg as TurnResponse);
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
    console.log(`sendToServer ${json}`);
    this.ws.send(json);
  }
}
