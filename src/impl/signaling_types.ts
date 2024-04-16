import { z } from 'zod';

export const enum SignalingMessageTypes {
    WEBRTC_OFFER = 0,
    WEBRTC_ANSWER,
    WEBRTC_ICE_CANDIDATE,
    TURN_REQUEST,
    TURN_RESPONSE,
    REQUEST_OFFER,

    LOGIN_REQUEST = 20,
    LOGIN_RESPONSE = 21
  }

export const loginRequestType = z.object({ type: z.literal(SignalingMessageTypes.LOGIN_REQUEST), productId: z.string(), deviceId: z.string(), sct: z.optional(z.string()), jwt: z.optional(z.string()), serverKey: z.optional(z.string()) });
export const loginResponseType = z.object({ type: z.literal(SignalingMessageTypes.LOGIN_RESPONSE) });
export const turnRequestType = z.object({ type: z.literal(SignalingMessageTypes.TURN_REQUEST) });
const turnServerType = z.object({ urls: z.array(z.string()), username: z.optional(z.string()), credential: z.optional(z.string()) });
export const turnResponseType = z.object({ type: z.literal(SignalingMessageTypes.TURN_RESPONSE), iceServers: z.array(turnServerType) });
export const webrtcIceCandidateType = z.object({ type: z.literal(SignalingMessageTypes.WEBRTC_ICE_CANDIDATE), data: z.string() });

export const webrtcMetadataMetaTrackType = z.object({ mid: z.string(), trackId: z.string(), error: z.optional(z.string()) });
export const webrtcMetadataType = z.object({ noTrickle: z.optional(z.boolean()), status: z.optional(z.string()), tracks: z.optional(z.array(webrtcMetadataMetaTrackType)) });
export const webrtcOfferType = z.object({ type: z.literal(SignalingMessageTypes.WEBRTC_OFFER), data: z.string(), metadata: webrtcMetadataType });
export const webrtcAnswerType = z.object({ type: z.literal(SignalingMessageTypes.WEBRTC_ANSWER), data: z.string(), metadata: webrtcMetadataType });

export const signalingMessageType = z.discriminatedUnion("type", [
    loginRequestType,
    loginResponseType,
    turnRequestType,
    turnResponseType,
    webrtcIceCandidateType,
    webrtcOfferType,
    webrtcAnswerType
]);

export type SignalingMessage = z.infer<typeof signalingMessageType>
export type LoginRequest = z.infer<typeof loginRequestType>
export type LoginResponse = z.infer<typeof loginResponseType>
export type TurnServer = z.infer<typeof turnServerType>
export type TurnRequest = z.infer<typeof turnRequestType>
export type TurnResponse = z.infer<typeof turnResponseType>
export type WebRTCIceCandidate = z.infer<typeof webrtcIceCandidateType>
export type WebRTCMetadataMetaTrack = z.infer<typeof webrtcMetadataMetaTrackType>
export type WebRTCMetadata = z.infer<typeof webrtcMetadataType>
export type WebRTCOffer = z.infer<typeof webrtcOfferType>
export type WebRTCAnswer = z.infer<typeof webrtcAnswerType>
