//! Newline-delimited JSON messages exchanged with the plugin over stdio.

use std::io::Write;
use std::sync::Arc;
use std::sync::Mutex;

use serde::Deserialize;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    /// Create the peer and return an SDP offer.
    Start {
        #[serde(default)]
        input: InputSpec,
        #[serde(default)]
        output: OutputSpec,
        /// Lower other apps' audio for the length of the call.
        #[serde(default, rename = "duckOthers")]
        duck_others: bool,
    },
    /// Apply the SDP answer from GPT-Live and start audio once connected.
    Answer { sdp: String },
    /// Mute or unmute the microphone. Silence keeps flowing so the stream stays alive.
    Mute { muted: bool },
    /// Drop queued speaker audio, e.g. when the user interrupts.
    Clear {},
    /// List the default audio devices without starting a call.
    Devices {},
    /// Tear everything down and exit.
    Close {},
}

/// Microphone source: the default input device, or a WAV file (headless testing).
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum InputSpec {
    #[default]
    #[serde(skip)]
    Device,
    File {
        file: String,
    },
}

/// Speaker sink: the default output device, "none" (discard), or a WAV file.
#[derive(Debug, Default, Deserialize)]
#[serde(untagged)]
pub enum OutputSpec {
    #[default]
    #[serde(skip)]
    Device,
    Named(String),
    File {
        file: String,
    },
}

/// Writes one JSON object per line to stdout. Cloneable and thread-safe.
#[derive(Clone)]
pub struct Emitter {
    out: Arc<Mutex<std::io::Stdout>>,
}

impl Emitter {
    pub fn new() -> Self {
        Self {
            out: Arc::new(Mutex::new(std::io::stdout())),
        }
    }

    pub fn emit(&self, value: serde_json::Value) {
        let Ok(mut line) = serde_json::to_vec(&value) else {
            return;
        };
        line.push(b'\n');
        if let Ok(mut out) = self.out.lock() {
            let _ = out.write_all(&line);
            let _ = out.flush();
        }
    }

    pub fn error(&self, message: impl std::fmt::Display, fatal: bool) {
        self.emit(serde_json::json!({
            "type": "error",
            "message": message.to_string(),
            "fatal": fatal,
        }));
    }
}
