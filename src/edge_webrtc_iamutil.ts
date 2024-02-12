import { EdgeWebrtcConnection } from "./edge_webrtc";
import { EdgeWebrtcIamUtilImpl } from "./impl/edge_webrtc_iam_impl";

export type IamUser = {
  Username: string,
  Role?: string,
  DisplayName?: string,
  Fingerprint?: string,
  Sct?: string,
  Password?: string,
};

// TODO: This interface is NOT considered stable and may be subject to changes.
export interface EdgeWebrtcIamUtil {
  createUser(connection: EdgeWebrtcConnection, username: string, role: string): Promise<IamUser>;
  listIamRoles(connection: EdgeWebrtcConnection ): Promise<string[]>;
  getMe(connection: EdgeWebrtcConnection ): Promise<IamUser>;

}

export function createEdgeWebrtcIamUtil() {
  return new EdgeWebrtcIamUtilImpl();
}
