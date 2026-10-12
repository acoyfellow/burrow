# WebAuthn / security keys / passkeys in a remote browser

Constraint: client is a standalone PWA on any device, iPhone included. No extension, no native helper.

Legend: **[V]** verified in this session (GitHub search/API). **[I]** inferred from prior knowledge or docs not re-fetched this session. Treat [I] as leads to confirm.

## Core problem

WebAuthn binds a credential to an origin (RP ID) and the browser that calls `navigator.credentials`. In a remote browser, the call happens on the server, where no authenticator is attached. You have three options. (1) Forward the raw USB/CTAP device to the server. (2) Intercept the remote WebAuthn call and replay it in the local browser. (3) Hand the login to the user's own browser and move the session (cookies/tokens) over. A PWA cannot do raw USB on iOS. A PWA also cannot sign for a foreign RP ID unless that RP opts in. That leaves option 3, or option 2 limited to RPs you control.

## Projects and products

| Project | Approach | No ext/app? | iOS? |
|---|---|---|---|
| neko (m1k1o/neko) | WebRTC browser streaming. No WebAuthn forwarding. Open request: issue #304 "WebAuthn authentication support" [V] https://github.com/m1k1o/neko/issues/304 | n/a (unsupported) | No |
| selkies-gstreamer | WebRTC desktop streaming. GitHub search found no WebAuthn issues [V]. No forwarding [I]. | n/a | No |
| Kasm Workspaces | Container streaming (KasmVNC). USB passthrough needs the Kasm desktop client or a local service, not a plain browser [I]. | No | No |
| Apache Guacamole | HTML5 RDP/VNC gateway. Relies on RDP's own device redirection, which needs a native RDP client. Not available through the HTML5 client [I]. | No | No |
| Chrome Remote Desktop + `chrome.webAuthenticationProxy` | Extension API. The remote-side extension intercepts `navigator.credentials` calls, sends them to the client, and the client runs the real ceremony. Used by CRD [I]. Docs: https://developer.chrome.com/docs/extensions/reference/api/webAuthenticationProxy | No (extension on remote; the client side is a Chrome app/session) | No |
| Citrix / VMware Horizon / Azure Virtual Desktop | "WebAuthn redirection". A hook in the VDI browser/OS sends the request to the local endpoint, which calls the local OS WebAuthn API. Needs the native Workspace / Horizon / Windows App client [I]. | No | Partial with native iOS clients only [I] |
| Browserbase | Cloud headless Chrome with a "Live View" iframe so a human can take over. Persistent "contexts" keep cookies. No hardware-key forwarding [I]. | Yes for live view | Live view yes, keys no |
| Steel.dev | Same model: session viewer and human takeover, plus profile/cookie reuse [I]. | Yes | Keys no |
| Hyperbeam | Embeddable shared cloud browser. Takeover by streaming [I]. | Yes | Keys no |
| Anchor Browser | Agent browser. Promotes auth profiles and human-in-the-loop live view [I]. | Yes | Keys no |
| Browser Use cloud | Agent browser with live view and profile sync [I]. | Yes | Keys no |
| Cloudflare Browser Isolation | Draws remote DOM in the local browser (NVR). For WebAuthn, the docs say requests are handled or passed through to the local browser [I, confirm with internal docs/team]. Needs Cloudflare One / WARP or the clientless prefix URL [I]. | Clientless mode is plain browser [I] | To confirm |
| Mighty, Neverinstall, Shadow | Mighty shut down in 2022 [I]. Neverinstall/Shadow are streamed apps/VMs that depend on native clients for USB [I]. | No | No |
| Quiq/webauthn_proxy | Not a relay. A reverse proxy that puts *its own* WebAuthn login in front of apps [V] https://github.com/Quiq/webauthn_proxy | Yes | Yes, but different problem |
| remote-webauthn repos (TestlabMobileSecurity, root-intruder) | Tiny, unstarred, no description [V]. Not usable. | – | – |

GitHub searches for "webauthn relay", "fido relay", and "ctap websocket" returned nothing [V]. "passkey remote browser" was not run separately.

## Platform building blocks

- **Related Origin Requests (`/.well-known/webauthn`)**: lets an RP list other origins that may use its RP ID. Shipped in Chrome 128 and Safari 18 (iOS 18 included). Firefox support is pending [I]. It only helps if the *RP* lists your origin. That works for your own apps and not for third-party sites.
- **WebUSB / WebHID**: Chromium blocks FIDO devices on both (they are on the protected usage list), so a page cannot talk CTAP directly [I]. Neither API exists on iOS Safari [I].
- **Web NFC**: Chrome Android only. The FIDO applet is blocked there too [I]. Not on iOS.
- **FIDO hybrid (caBLE)**: phone acts as authenticator over QR + BLE + tunnel server. It runs between the *browser/OS* and the phone. A web page cannot act as the hybrid client, and BLE proximity to the *remote* machine is impossible [I]. Hybrid works fine when the user logs in from their *own* browser.
- **iOS PWA**: `navigator.credentials` works in home-screen PWAs, but only for the PWA's own RP ID (plus related origins) [I]. Security keys work over NFC/Lightning/USB-C through the system sheet [I].

## Ranked approaches under the PWA-only constraint

1. **Local login, then session handoff** [I, most viable]. Open the target login page in the user's real browser (on iOS, `ASWebAuthenticationSession` isn't available to a PWA, so use a new tab or popup). The user completes passkey/YubiKey/hybrid natively. Then move the resulting session into the remote browser. Paths: an OAuth/OIDC redirect back to your origin, a device-code style flow, or the user pasting a one-time link. Works for any authenticator on iOS. Hard part: cookies from a third-party site can't be read cross-origin. So this only fully works where the RP has an OAuth/SSO/magic-link path, or where the identity provider is yours (e.g. Cloudflare Access issues the token).
2. **WebAuthn relay for RPs you control** [I]. Inject a shim into the remote page that overrides `navigator.credentials`. It sends `PublicKeyCredentialCreationOptions`/`RequestOptions` over your WebSocket to the PWA. The PWA calls `navigator.credentials.get()` locally and the assertion goes back. This works only if the PWA's origin is allowed for that RP ID, either because it is the same RP ID or through `/.well-known/webauthn` Related Origins. `clientDataJSON.origin` will show the PWA origin, so the RP must accept it. This is the PWA-native copy of `webAuthenticationProxy`. Works on iOS 18+.
3. **Human takeover via live view + non-WebAuthn fallback** [I]. Like Browserbase/Steel/Anchor: stream the remote browser, and the user picks TOTP, SMS, email link, or "approve on phone" push. Works everywhere. Skips WebAuthn altogether.
4. **Persistent profiles** [I]. Log in once (via 1 or 3), keep cookies in an encrypted remote profile, and re-auth only when the session expires. Doesn't solve WebAuthn but cuts how often it's needed.
5. **Not viable**: USB/CTAP forwarding from a PWA (blocked on WebUSB/WebHID, and missing on iOS). Hybrid/caBLE to the remote host. Signing for arbitrary third-party RPs (origin binding stops it, by design).

## Open verification items

- Cloudflare Browser Isolation's exact WebAuthn behaviour in clientless mode.
- Current Related Origin Requests support matrix (Firefox status).
- Whether any agent-browser vendor ships a WebAuthn shim (check Browserbase/Anchor docs).
