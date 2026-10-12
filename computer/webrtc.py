import json
import os
import socket
import subprocess

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import GLib, Gst, GstSdp, GstWebRTC

PORT = int(os.environ.get("COIL_WEBRTC_PORT", "5901"))
DISPLAY = os.environ.get("DISPLAY", ":99")
STUN = os.environ.get("COIL_STUN", "stun://stun.cloudflare.com:3478")
PIPELINE = (
    f"ximagesrc display-name={DISPLAY} use-damage=false show-pointer=true "
    "! video/x-raw,framerate=30/1 ! videoconvert ! queue max-size-buffers=1 leaky=downstream "
    "! vp8enc deadline=1 cpu-used=8 target-bitrate=4000000 keyframe-max-dist=60 "
    "! rtpvp8pay pt=96 ! application/x-rtp,media=video,encoding-name=VP8,payload=96 "
    f"! webrtcbin name=rtc bundle-policy=max-bundle stun-server={STUN}"
)
BUTTONS = {0: "1", 1: "2", 2: "3"}


def xdotool(*args):
    subprocess.Popen(["xdotool", *args], env={**os.environ, "DISPLAY": DISPLAY})


def handle_input(event):
    kind = event.get("type")
    x, y = str(int(event.get("x", 0))), str(int(event.get("y", 0)))
    if kind == "move":
        xdotool("mousemove", x, y)
    elif kind in ("down", "up"):
        xdotool("mousemove", x, y, "mousedown" if kind == "down" else "mouseup", BUTTONS.get(event.get("button", 0), "1"))
    elif kind == "wheel":
        button = "5" if event.get("dy", 0) > 0 else "4"
        clicks = min(10, max(1, abs(int(event.get("dy", 0))) // 40))
        xdotool("click", "--repeat", str(clicks), button)
    elif kind == "key" and event.get("keysym"):
        xdotool("keydown" if event.get("down") else "keyup", event["keysym"])
    elif kind == "text" and event.get("text"):
        xdotool("type", "--delay", "0", event["text"])


class Session:
    def __init__(self, conn):
        self.conn = conn
        self.buffer = b""
        self.pipe = Gst.parse_launch(PIPELINE)
        self.rtc = self.pipe.get_by_name("rtc")
        self.rtc.connect("on-negotiation-needed", self.on_negotiation)
        self.rtc.connect("on-ice-candidate", self.on_candidate)
        self.watch = GLib.io_add_watch(conn.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self.on_readable)
        self.pipe.set_state(Gst.State.PLAYING)

    def send(self, message):
        data = (json.dumps(message) + "\n").encode()
        GLib.idle_add(self._write, data)

    def _write(self, data):
        try:
            self.conn.sendall(data)
        except OSError:
            self.close()
        return False

    def on_negotiation(self, element):
        promise = Gst.Promise.new_with_change_func(self.on_offer, element, None)
        element.emit("create-offer", None, promise)

    def on_offer(self, promise, element, _):
        reply = promise.get_reply()
        offer = reply.get_value("offer")
        element.emit("set-local-description", offer, Gst.Promise.new())
        self.send({"sdp": {"type": "offer", "sdp": offer.sdp.as_text()}})

    def on_candidate(self, _element, mline, candidate):
        self.send({"ice": {"candidate": candidate, "sdpMLineIndex": mline}})

    def on_readable(self, _fd, condition):
        if condition & (GLib.IO_HUP | GLib.IO_ERR):
            self.close()
            return False
        try:
            chunk = self.conn.recv(65536)
        except OSError:
            chunk = b""
        if not chunk:
            self.close()
            return False
        self.buffer += chunk
        *lines, self.buffer = self.buffer.split(b"\n")
        for line in lines:
            if line.strip():
                try:
                    self.receive(json.loads(line))
                except (ValueError, KeyError, TypeError):
                    continue
        return True

    def receive(self, message):
        if "sdp" in message:
            _, sdp = GstSdp.SDPMessage.new_from_text(message["sdp"]["sdp"])
            answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdp)
            self.rtc.emit("set-remote-description", answer, Gst.Promise.new())
        elif "ice" in message and message["ice"].get("candidate"):
            self.rtc.emit("add-ice-candidate", int(message["ice"].get("sdpMLineIndex") or 0), message["ice"]["candidate"])
        elif "input" in message:
            handle_input(message["input"])

    def close(self):
        if self.pipe is None:
            return
        self.pipe.set_state(Gst.State.NULL)
        self.pipe = None
        try:
            self.conn.close()
        except OSError:
            pass


def main():
    Gst.init(None)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", PORT))
    server.listen(4)
    sessions = []

    def on_accept(_fd, _condition):
        conn, _ = server.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        sessions.append(Session(conn))
        return True

    GLib.io_add_watch(server.fileno(), GLib.IO_IN, on_accept)
    GLib.MainLoop().run()


main()
