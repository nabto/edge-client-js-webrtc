# Edge Client WebRTC Javascript library

This Javascript Nabto Client library can be used to implement Nabto Edge WebRTC in a website. This library is used to implement the demo site described in the [WebRTC demo.](https://docs.nabto.com/developer/guides/webrtc/quickstart.html) There are currently no publicly available examples for this library. Currently, the documentation is limited to API level documentation in the [source.](src/edge_webrtc.ts)

Below are a list of features and a list of limitations. The current limitations are all things we aim to add to the features list with future updates.

## Features

* Establish a WebRTC connection to a Device through a Signaling Service
* Make CoAP requests to the Device
* Perform Password Authentication to the device
* Validate the device fingerprint (See our [docs](https://docs.nabto.com/developer/guides/webrtc/intro.html#security) for details.)
* Receive Media Tracks created by the device.

## Limitations
* Open Nabto Streams
* IAM util ([edge_webrtc_iamutil.ts](src/edge_webrtc_iamutil.ts) exists, but API is not stable, and many features are missing)
