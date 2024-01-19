import { CoapContentFormat, EdgeWebrtcConnection } from "../edge_webrtc";
import { EdgeWebrtcIamUtil, IamUser } from "../edge_webrtc_iamutil";
var cbor = require('cbor');


export class EdgeWebrtcIamUtilImpl implements EdgeWebrtcIamUtil {
  async createUser(connection: EdgeWebrtcConnection, username: string, role: string): Promise<IamUser>
  {
    const resp = await connection.coapInvoke("POST", `/iam/users`, CoapContentFormat.APPLICATION_CBOR, cbor.encode({ Username: username }));
    if (resp.statusCode != 201) {
      throw new Error(`Failed to create user with status: ${resp.statusCode}`);
    }

    // TODO: determine a better way to create passwords
    let pwd = crypto.randomUUID().substring(0,16);
    const pwdResp = await connection.coapInvoke("PUT", `/iam/users/${username}/password`, CoapContentFormat.APPLICATION_CBOR, cbor.encode(pwd));
    if (pwdResp.statusCode != 204) {
      throw new Error(`Failed to set password for user with status: ${pwdResp.statusCode}`);
    }

    // TODO: do not add all as admins
    console.log("Setting user role: ", role);
    const roleResp = await connection.coapInvoke("PUT", `/iam/users/${username}/role`, CoapContentFormat.APPLICATION_CBOR, cbor.encode(role));
    if (roleResp.statusCode != 204) {
      throw new Error(`Failed to set role for user with status: ${roleResp.statusCode}`);
    }

    const userResp = await connection.coapInvoke("GET", `/iam/users/${username}`, undefined, undefined);
    if (userResp.statusCode != 205) {
      throw new Error(`Failed to get user with status: ${userResp.statusCode}`);
    }

    if (!userResp.payload) {
      throw new Error(`Failed to get IAM user. Response had no payload`);
    }
    let payloadObj = cbor.decodeAllSync(Buffer.from(userResp.payload))[0];

    payloadObj.Password = pwd;
    return payloadObj;

  }

  async listIamRoles(connection: EdgeWebrtcConnection ): Promise<string[]>
  {
    const resp = await connection.coapInvoke("GET", "/iam/roles");
    if (resp.statusCode != 205) {
      throw new Error(`Failed to get IAM roles with status: ${resp.statusCode}`);
    }
    if (!resp.payload) {
      throw new Error(`Failed to list IAM roles. Response had no payload`);
    }
    let payloadObj = cbor.decodeAllSync(Buffer.from(resp.payload))[0];
    return payloadObj;

  }

  async getMe(connection: EdgeWebrtcConnection ): Promise<IamUser>
  {
    const me = await connection.coapInvoke("GET", `/iam/me`, undefined, undefined);
    if (me.statusCode != 205) {
      throw new Error(`Failed to get own user with status: ${me.statusCode}`);
    } else if (!me.payload) {
      throw new Error(`Failed to get IAM user. Response had no payload`);
    } else {
      let payloadObj = cbor.decodeAllSync(Buffer.from(me.payload))[0];
      return payloadObj;
    }


  }
};
