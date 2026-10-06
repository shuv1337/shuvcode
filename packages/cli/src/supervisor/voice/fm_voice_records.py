"""Native Shuvcode bridge for the ShuvBro-derived voice relay.

The voice model receives only the supervisor's bounded voice snapshot. Real work
is admitted to the lead's durable inbox with a stable ID for the spoken turn.
No ShuvBro records, task notes, or completed history are read here.
"""

import json
import os
import subprocess


SCOPES = ("counts", "full")


class RecordError(Exception):
    """The native voice bridge refused or could not complete an operation."""


def default_home():
    home = os.environ.get("SHUVCODE_SUPERVISOR_HOME")
    if not home:
        raise RecordError("native supervisor home is required; pass --home")
    return home


def command():
    raw = os.environ.get("SHUVCODE_VOICE_COMMAND_JSON")
    if raw is None:
        return ["shuvcode"]
    try:
        argv = json.loads(raw)
    except ValueError as exc:
        raise RecordError("SHUVCODE_VOICE_COMMAND_JSON is not JSON") from exc
    if not isinstance(argv, list) or not argv or not all(
            isinstance(part, str) and part for part in argv):
        raise RecordError("SHUVCODE_VOICE_COMMAND_JSON must be a nonempty argv list")
    return argv


def invoke(home, action, *args):
    argv = command() + ["supervisor", "voice", action, "--home", home] + list(args)
    try:
        done = subprocess.run(
            argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
            timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RecordError("native voice bridge unavailable: {}".format(exc)) from exc
    if done.returncode != 0:
        raise RecordError("native voice {} failed: {}".format(
            action, (done.stderr or done.stdout).strip()[:500]))
    try:
        result = json.loads(done.stdout)
    except ValueError as exc:
        raise RecordError("native voice {} did not return JSON".format(action)) from exc
    if not isinstance(result, dict):
        raise RecordError("native voice {} returned an invalid object".format(action))
    return result


def fleet_status(home=None, scope=None):
    # The CLI snapshot reads the operator's configured scope. Never forward a
    # model/client-selected scope or assemble records independently here.
    return invoke(home or default_home(), "snapshot")


def read_scope(home):
    scope = fleet_status(home).get("read_scope", "counts")
    if scope not in SCOPES:
        raise RecordError("native voice snapshot returned an invalid read scope")
    return scope


def queue_request(text, home=None, root=None, interaction_id=None):
    body = (text or "").strip()
    if not body:
        raise RecordError("refusing to queue an empty request")
    if not interaction_id:
        raise RecordError("voice handover requires a stable interaction ID")
    result = invoke(home or default_home(), "enqueue", "--interaction-id", interaction_id,
                    "--request", body)
    if result.get("queued") is not True or not isinstance(result.get("note_id"), str):
        raise RecordError("native voice enqueue did not confirm durable admission")
    return result
