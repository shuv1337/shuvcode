"""Offline regression checks for the ShuvBro-derived native voice scripts."""

import asyncio
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest


VOICE = Path(__file__).resolve().parents[2] / "src" / "supervisor" / "voice"
sys.path.insert(0, str(VOICE))
import fm_voice_frame as frame
import fm_voice_records as records


def script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), VOICE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


relay = script("fm-voice-relay.py")
client = script("fm-voice-client.py")


class VoiceOfflineTests(unittest.TestCase):
    def test_frame_round_trip_and_truncation(self):
        stream = io.BytesIO(frame.MAGIC + frame.encode(frame.TALK_START) + frame.encode(frame.AUDIO, b"\x00\x01"))
        self.assertEqual(stream.read(len(frame.MAGIC)), frame.MAGIC)
        reader = frame.Reader(stream)
        self.assertEqual(reader.read(), (frame.TALK_START, b""))
        self.assertEqual(reader.read(), (frame.AUDIO, b"\x00\x01"))
        self.assertIsNone(reader.read())
        with self.assertRaises(frame.FrameError):
            frame.Reader(io.BytesIO(frame.encode(frame.AUDIO, b"123")[:-1])).read()

    def test_native_client_command_and_push_to_talk_boundary(self):
        argv = ["/path with space/shuvcode", "supervisor", "voice", "serve", "--home", "/home/voice space"]
        options = client.parse_args(["--host", "desktop", "--relay-command-json", json.dumps(argv),
                                     "--in-file", "/tmp/clip.pcm", "--out-file", "/tmp/reply.pcm"])
        self.assertEqual(options.listen, client.PUSH_TO_TALK)
        self.assertEqual(client.relay_command(options), [
            "ssh", "-T", "desktop", "'/path with space/shuvcode' supervisor voice serve --home '/home/voice space'"])
        local = client.parse_args(["--local", "--relay-command-json", json.dumps(argv)])
        self.assertEqual(client.relay_command(local), argv)
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                client.parse_args(["--local", "--relay-command-json", '["shuvcode"]', "--listen", "open-mic"])
            with self.assertRaises(SystemExit):
                client.parse_args(["--local", "--relay-command-json", '["shuvcode", 1]'])

    def test_explicit_relay_configuration_and_trailing_silence(self):
        options = relay.parse_args(["--serve", "--home", "/supervisor", "--region", "us-test-1",
                                    "--model", "nova-test"])
        relay.resolve_settings(options)
        self.assertEqual((options.profile, options.voice, options.tail_ms), ("", "matthew", 400))
        with self.assertRaises(records.RecordError):
            relay.resolve_settings(relay.parse_args(["--serve", "--home", "/supervisor"]))

        session = relay.Session.__new__(relay.Session)
        session.options = options
        session.verbose = False
        session.prompt = "prompt-id"
        session.audio_content = "audio-id"
        session.turn = {}
        sent = []

        async def audio(pcm):
            sent.append(("audio", pcm))

        async def send(event):
            sent.append(("event", event))

        session.audio = audio
        session._send = send
        asyncio.run(session.talk_end())
        self.assertEqual(sent[0], ("audio", b"\x00" * (400 * 32)))
        self.assertEqual(sent[1][1]["contentEnd"]["contentName"], "audio-id")
        self.assertIsNone(session.audio_content)

    def test_credentials_are_cached_across_sessions_and_reconnect(self):
        calls = []
        original_resolve = relay.resolve_credentials

        def resolve(profile, verbose=False, margin=0, allow_ambient=True):
            calls.append(profile)
            return {"aws_access_key_id": "test", "aws_secret_access_key": "test"}, None, relay.FROM_PROFILE

        relay.resolve_credentials = resolve
        try:
            cache = relay.Credentials("test-profile")

            async def repeated():
                self.assertEqual(await cache.get(), await cache.get())

            asyncio.run(repeated())
            self.assertEqual(calls, ["test-profile"])

            previous = types.SimpleNamespace(credentials=cache)
            closed = []

            async def close():
                closed.append(True)

            previous.close = close
            original_session = relay.Session

            class Fresh:
                def __init__(self, options, down, credentials):
                    self.credentials = credentials
                    self.connect_seconds = 0.02

                async def start(self):
                    return None

                async def close(self):
                    return None

            relay.Session = Fresh
            down = types.SimpleNamespace(send_json=lambda kind, payload: closed.append(payload))
            try:
                fresh = asyncio.run(relay.renew(previous, types.SimpleNamespace(verbose=False), down))
            finally:
                relay.Session = original_session
            self.assertIs(fresh.credentials, cache)
            self.assertEqual(calls, ["test-profile"])
            self.assertEqual(closed[1]["event"], "renewed")
        finally:
            relay.resolve_credentials = original_resolve

    def test_native_bridge_reuses_spoken_interaction_id_and_never_requests_scope_override(self):
        with tempfile.TemporaryDirectory() as root:
            fake = Path(root) / "voice-command.py"
            state = Path(root) / "state.json"
            fake.write_text("import json, os, sys\n"
                            "from pathlib import Path\n"
                            "args = sys.argv[1:]\n"
                            "path = Path(os.environ['VOICE_TEST_STATE'])\n"
                            "state = json.loads(path.read_text()) if path.exists() else {'calls': [], 'items': {}}\n"
                            "state['calls'].append(args)\n"
                            "if args[:3] != ['supervisor', 'voice', 'snapshot'] and args[:3] != ['supervisor', 'voice', 'enqueue']:\n"
                            "    sys.exit(2)\n"
                            "if args[2] == 'snapshot':\n"
                            "    result = {'schema_version': 1, 'read_scope': 'counts', 'counts': {'in_flight': 2, 'waiting_for_user': 1}}\n"
                            "else:\n"
                            "    key = args[args.index('--interaction-id') + 1]\n"
                            "    body = args[args.index('--request') + 1]\n"
                            "    result = state['items'].setdefault(key, {'queued': True, 'note_id': 'voice:' + key, 'queued_text': body, 'handover': 'queued'})\n"
                            "path.write_text(json.dumps(state))\n"
                            "print(json.dumps(result))\n")
            prior_command = os.environ.get("SHUVCODE_VOICE_COMMAND_JSON")
            prior_state = os.environ.get("VOICE_TEST_STATE")
            os.environ["SHUVCODE_VOICE_COMMAND_JSON"] = json.dumps([sys.executable, str(fake)])
            os.environ["VOICE_TEST_STATE"] = str(state)
            try:
                self.assertEqual(records.read_scope(root), "counts")
                self.assertEqual(records.fleet_status(root)["counts"]["in_flight"], 2)
                first = records.queue_request("ship it", root, interaction_id="spoken-1")
                repeat = records.queue_request("different words", root, interaction_id="spoken-1")
                self.assertEqual(repeat, first)
                self.assertEqual(first["note_id"], "voice:spoken-1")
                calls = json.loads(state.read_text())["calls"]
                self.assertTrue(all("--scope" not in call for call in calls))
                self.assertEqual(calls[-1][-4:], ["--interaction-id", "spoken-1", "--request", "different words"])
                with self.assertRaises(records.RecordError):
                    records.queue_request("", root, interaction_id="spoken-2")
            finally:
                if prior_command is None:
                    os.environ.pop("SHUVCODE_VOICE_COMMAND_JSON", None)
                else:
                    os.environ["SHUVCODE_VOICE_COMMAND_JSON"] = prior_command
                if prior_state is None:
                    os.environ.pop("VOICE_TEST_STATE", None)
                else:
                    os.environ["VOICE_TEST_STATE"] = prior_state

    def test_pcm_file_round_trip_uses_native_client_and_framed_relay_contract(self):
        with tempfile.TemporaryDirectory() as root:
            clip = Path(root) / "question.pcm"
            answer = Path(root) / "answer.pcm"
            captured = Path(root) / "captured.pcm"
            fake = Path(root) / "fake-relay.py"
            clip.write_bytes(b"\x01\x02" * 3200)
            fake.write_text(
                "import sys\n"
                "from pathlib import Path\n"
                "sys.path.insert(0, sys.argv[1])\n"
                "import fm_voice_frame as frame\n"
                "sys.stdout.buffer.write(frame.MAGIC)\n"
                "sys.stdout.buffer.flush()\n"
                "writer = frame.Writer(sys.stdout.buffer)\n"
                "reader = frame.Reader(sys.stdin.buffer)\n"
                "writer.send_json(frame.NOTICE, {'event': 'ready', 'model': 'fake', 'region': 'test', 'read_scope': 'counts', 'connect_seconds': 0})\n"
                "audio = bytearray()\n"
                "while True:\n"
                "    item = reader.read()\n"
                "    if item is None: break\n"
                "    kind, payload = item\n"
                "    if kind == frame.AUDIO: audio.extend(payload)\n"
                "    if kind == frame.TALK_END:\n"
                "        Path(sys.argv[2]).write_bytes(audio)\n"
                "        writer.send(frame.AUDIO, b'\\x11\\x22' * 1200)\n"
                "        writer.send_json(frame.MARK, {'mark': 'reply_end', 'since_talk_end': 0.1, 'tool_calls': 0})\n"
                "    if kind == frame.QUIT:\n"
                "        writer.send(frame.BYE)\n"
                "        break\n"
            )
            command = [sys.executable, str(fake), str(VOICE), str(captured)]
            done = subprocess.run(
                [sys.executable, str(VOICE / "fm-voice-client.py"), "--local",
                 "--relay-command-json", json.dumps(command), "--in-file", str(clip),
                 "--out-file", str(answer), "--timeout", "2", "--audio-idle", "0"],
                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10,
                check=False)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(captured.read_bytes(), clip.read_bytes())
            self.assertEqual(answer.read_bytes(), b"\x11\x22" * 1200)
            self.assertTrue(json.loads(done.stdout)["answered"])


if __name__ == "__main__":
    unittest.main()
