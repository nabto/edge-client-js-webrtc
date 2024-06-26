import { WebrtcConnectionImpl } from "./impl/edge_webrtc_impl";

/**
 * Error codes used by the NabtoWebrtcError class
 */
export enum NabtoWebrtcErrorCode {
  DEVICE_CLOSED,
  DEVICE_SIGNALING_DENIED,
  DEVICE_INTERNAL_ERROR,
  BASESTATION_TOKEN_REJECTED,
  BASESTATION_DEVICE_OFFLINE,
  BASESTATION_UNKNOWN_PRODUCT_ID,
  BASESTATION_UNKNOWN_DEVICE_ID,
  CONNECTION_TIMEOUT,
  UNKNOWN,
}

/**
 * Error used by the `ClosedCallback()` and for Nabto specific promise rejections. Errors may have additional information for debugging in the `Error.cause`
 */
export class NabtoWebrtcError extends Error {
  code: NabtoWebrtcErrorCode
  constructor(message: string, code: NabtoWebrtcErrorCode, cause?: unknown) {
    if (cause !== undefined) {
      super(message, {cause: cause})
    } else {
      super(message);
    }
    this.code = code;
    Object.setPrototypeOf(this, NabtoWebrtcError.prototype);
  }
}

/**
 * Callback function when a connection is closed
 * @param error this is optional is is either a event from the websocket connection or an error object describing an error.
 */
export type ClosedCallback = (error?: NabtoWebrtcError) => void;

/**
 * Callback function when a new track is added by the device
 *
 * @param event The native RTCTrackEvent emitted by the browser
 * @param trackId The track ID reported by the device for this event
 * @param error An error if the device failed to handle this track properly
 */
export type OnTrackCallback = (event: RTCTrackEvent, trackId?: string, error?: string) => void;

/**
 * CoAP method type for making CoAP requests
 */
export type CoapMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * CoAP content Formats for CoAP payloads
 */
export enum CoapContentFormat {
  TEXT_PLAIN_UTF8 = 0,
  APPLICATION_LINK_FORMAT = 40,
  XML = 41,
  APPLICATION_OCTET_STREAM = 42,
  APPLICATION_JSON = 50,
  APPLICATION_CBOR = 60
}

/**
 * Options type used to define which device to connect to.
 */
export type ConnectionOptions = {
  productId: string,
  deviceId: string,
  sct: string,
  signalingServerUrl?: string,
};

/**
 * CoAP response object type returned when executing CoAP requests.
 */
export type CoapResponse = {
  statusCode: number,
  contentFormat?: number,
  payload?: Buffer,
}

// TODO: our example currently do not use streams, so it is not implemented
// export interface EdgeStream {
//   onClosed(fn: ClosedCallback): void;
//   read(): Promise<Buffer>;
//   write(data: Buffer): Promise<void>;
//   close(): Promise<void>;
// }

/**
 * Main Connection interface used to connect to a device and interact with it.
 */
export interface EdgeWebrtcConnection {
  /**
   * Set connection options for this WebRTC connection. Must be called before connect()
   *
   * @param opts Options for which connection to open
   */
  setConnectionOptions(opts: ConnectionOptions): void;

  /**
   * Set callback to be invoked when the connection WebRTC is closed
   *
   * @param fn The callback to set
   */
  onClosed(fn: ClosedCallback): void;

  /**
   * Set callback to be invoked when the device has added a track to the WebRTC connection
   *
   * @param fn The callback to set
   */
  onTrack(fn: OnTrackCallback): void;

  /**
   * Connect to the device specified in the ConnectionOptions
   *
   * @returns Promise resolved when the connection is established
   */
  connect(): Promise<void>;

  /**
   * Close the connection
   *
   * @returns Promise resolved when the connection has been closed
   */
  close(): Promise<void>;

  /**
   * Invoke a CoAP endpoint in the device using a WebRTC data channel on an established connection.
   *
   * The CoAP content format is defined as a number. This must follow the CoAP content format specified by IANA. Common content formats are available in the CoapContentFormat enum. CoAP payloads are sent as an ArrayBuffer, for convenience it can be provided as a string to be converted by the library.
   *
   * @param method CoAP method of the endpoint
   * @param path Path of the CoAP endpoint
   * @param contentFormat Content format of the payload if one is added
   * @param payload Payload of the CoAP request if needed
   * @returns Promise resolved when a response is ready
   */
  coapInvoke(method: CoapMethod, path: string, contentFormat?: number, payload?: ArrayBuffer | string): Promise<CoapResponse>;

  /**
   * Attempt password authentication on the device.
   *
   * @param username Username to authenticate as
   * @param password Password for authentication
   * @returns Promise resolved if the authentication succeeded.
   */
  passwordAuthenticate(username: string, password: string): Promise<void>;

  /**
   * Validate the fingerprint of the device.
   *
   * WebRTC connections uses one-time private keys meaning normal Nabto fingerprint validation cannot be used. This function will challenge the device to prove it is in possession of the private key used for normal Nabto Connections. The fingerprint to validate is the same as the one configured for the device in the Nabto Cloud Console.
   *
   * @param fingerprint The fingerprint to validate
   * @returns Promise resolved with true if the fingerprint was valid.
   */
  validateFingerprint(fingerprint: string): Promise<boolean>;


  // TODO: our example currently do not use streams, so it is not implemented
  //openEdgeStream(streamPort: number): Promise<EdgeStream>;

  // Warning: addTrack is experimental and may not be stable
  // Warning: addTrack will currently fail if a track with same trackId does not already exist (ie. you are adding downstream media to an track the device created)
  addTrack(track: MediaStreamTrack, trackId: string): Promise<void>;

  //
  /**
   * Warning: createDatachannel is experimental
   *
   * Create a new datachannel to the device. WebRTC Datachannels are used internally in Nabto for CoAP requests and streaming.
   *
   * This means datachannels MUST NEVER use the label `coap` or labels beginning with `stream-`!
   *
   * @param label Label to set for the datachannel.
   * @returns Promise with the created RTCDataChannel object
   */
  createDatachannel(label: string): Promise<RTCDataChannel>;

}

/**
 * Create a new WebRTC connection using Nabto Edge
 *
 * @returns The created EdgeWebrtcConnection
 */
export function createEdgeWebrtcConnection() {
  return new WebrtcConnectionImpl();
}

export { IamUser, EdgeWebrtcIamUtil, createEdgeWebrtcIamUtil } from './edge_webrtc_iamutil';
