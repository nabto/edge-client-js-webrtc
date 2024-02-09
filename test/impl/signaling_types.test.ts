import { describe, expect, test, beforeAll, jest, it } from '@jest/globals';

import { SignalingMessage, signalingMessageType, SignalingMessageTypes, LoginRequest } from '../../src/impl/signaling_types'

describe("test signaling message parse", () => {

    it("parse LOGIN_REQUEST", () => {
        const msg = {
            type: SignalingMessageTypes.LOGIN_REQUEST,
            productId: "foo",
            deviceId: "bar",
            sct: "baz"
        }
        const message: SignalingMessage = signalingMessageType.parse(msg);

        expect(message.type).toBe(SignalingMessageTypes.LOGIN_REQUEST);
        if (message.type == SignalingMessageTypes.LOGIN_REQUEST) {
            const loginRequest: LoginRequest = message;
            expect(loginRequest.deviceId).toBe(msg.deviceId);
            expect(loginRequest.productId).toBe(msg.productId);
            expect(loginRequest.sct).toBe(msg.sct);
            expect(loginRequest.jwt).toBe(undefined);
        }
    })

    it("invalid type", () => {
        const msg = {
            type: 42
        }
        expect(() => { const message: SignalingMessage = signalingMessageType.parse(msg); }).toThrow();
    })
})
