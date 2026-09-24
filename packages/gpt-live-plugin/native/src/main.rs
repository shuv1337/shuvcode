//! gpt-live-host: owns the WebRTC peer, microphone, speaker and echo cancellation for
//! GPT-Live voice sessions. Controlled by the opencode-gpt-live plugin over stdio using
//! newline-delimited JSON (see `protocol.rs`). Authentication never reaches this process:
//! the plugin exchanges the SDP offer for an answer and passes the answer back.

mod audio;
mod duck;
mod protocol;
mod transport;

use std::io::BufRead;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;

use audio::engine::Engine;
use audio::io::AudioIo;
use audio::io::InputKind;
use audio::io::OutputKind;
use protocol::Command;
use protocol::Emitter;
use protocol::InputSpec;
use protocol::OutputSpec;
use transport::Transport;

/// Release builds get the plugin version injected (GPT_LIVE_VERSION); local builds use Cargo's.
const VERSION: &str = match option_env!("GPT_LIVE_VERSION") {
    Some(version) if !version.is_empty() => version,
    _ => env!("CARGO_PKG_VERSION"),
};

enum Control {
    Command(Command),
    Invalid(String),
    Eof,
}

fn main() {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--version") => {
            println!("{VERSION}");
            return;
        }
        Some("--devices") => {
            println!("{}", audio::io::describe_defaults());
            return;
        }
        Some(other) => {
            eprintln!("unknown argument: {other}");
            std::process::exit(2);
        }
        None => {}
    }

    let emitter = Emitter::new();
    let (control_tx, control_rx) = std_mpsc::channel::<Control>();
    std::thread::Builder::new()
        .name("control".into())
        .spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let message = match serde_json::from_str::<Command>(&line) {
                    Ok(command) => Control::Command(command),
                    Err(error) => Control::Invalid(error.to_string()),
                };
                if control_tx.send(message).is_err() {
                    return;
                }
            }
            let _ = control_tx.send(Control::Eof);
            // Exit even if the main thread is stuck, e.g. after the parent died.
            std::thread::sleep(Duration::from_secs(3));
            std::process::exit(0);
        })
        .expect("failed to spawn control thread");

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            emitter.error(format!("failed to start runtime: {error}"), true);
            std::process::exit(1);
        }
    };

    emitter.emit(serde_json::json!({
        "type": "ready",
        "version": VERSION,
        "protocol": protocol::PROTOCOL_VERSION,
    }));

    let mut session = Session::default();
    while let Ok(message) = control_rx.recv() {
        match message {
            Control::Command(Command::Close {}) | Control::Eof => break,
            Control::Command(command) => {
                if let Err(error) = session.handle(command, &runtime, &emitter) {
                    emitter.error(format!("{error:#}"), false);
                }
            }
            Control::Invalid(error) => emitter.error(format!("invalid command: {error}"), false),
        }
    }
    session.shutdown(&runtime);
    emitter.emit(serde_json::json!({ "type": "closed" }));
}

#[derive(Default)]
struct Session {
    transport: Option<Transport>,
    pending: Option<Pending>,
    engine: Option<Engine>,
    muted: bool,
    /// Other apps' audio lowered for the call, restored when dropped.
    ducking: Option<duck::Ducking>,
}

/// Resources created by `start` and consumed once the answer connects.
struct Pending {
    io: AudioIo,
    incoming: std_mpsc::Receiver<transport::IncomingPacket>,
    outgoing: tokio::sync::mpsc::Sender<transport::OutgoingFrame>,
}

impl Session {
    fn handle(
        &mut self,
        command: Command,
        runtime: &tokio::runtime::Runtime,
        emitter: &Emitter,
    ) -> anyhow::Result<()> {
        match command {
            Command::Start {
                input,
                output,
                duck_others,
            } => {
                if self.transport.is_some() {
                    anyhow::bail!("session already started");
                }
                if duck_others && self.ducking.is_none() {
                    self.ducking = duck::Ducking::start();
                }
                let input = match input {
                    InputSpec::File { file } => InputKind::File(file),
                    InputSpec::Device => InputKind::Device,
                };
                let output = match output {
                    OutputSpec::File { file } => OutputKind::File(file),
                    OutputSpec::Named(name) if name == "none" => OutputKind::None,
                    OutputSpec::Named(_) | OutputSpec::Device => OutputKind::Device,
                };
                // Open devices first so permission prompts and missing hardware fail fast.
                let io = AudioIo::open(input, output, emitter.clone())?;
                emitter.emit(serde_json::json!({
                    "type": "audio",
                    "input": { "name": io.input.name, "rate": io.input.rate, "channels": io.input.channels },
                    "output": { "name": io.output.name, "rate": io.output.rate, "channels": io.output.channels },
                }));
                let (incoming_tx, incoming_rx) = std_mpsc::sync_channel(256);
                let (outgoing_tx, outgoing_rx) = tokio::sync::mpsc::channel(64);
                let transport =
                    runtime.block_on(Transport::new(emitter.clone(), incoming_tx, outgoing_rx))?;
                let sdp = runtime.block_on(transport.offer())?;
                self.transport = Some(transport);
                self.pending = Some(Pending {
                    io,
                    incoming: incoming_rx,
                    outgoing: outgoing_tx,
                });
                emitter.emit(serde_json::json!({ "type": "offer", "sdp": sdp }));
            }
            Command::Answer { sdp } => {
                let transport = self
                    .transport
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("session not started"))?;
                let pending = self
                    .pending
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("answer already applied"))?;
                runtime.block_on(transport.apply_answer(sdp))?;
                self.engine = Some(Engine::start(
                    pending.io,
                    pending.incoming,
                    pending.outgoing,
                    emitter.clone(),
                    self.muted,
                )?);
                emitter.emit(serde_json::json!({ "type": "connected" }));
            }
            Command::Mute { muted } => {
                self.muted = muted;
                if let Some(engine) = &self.engine {
                    engine.set_muted(muted);
                }
                emitter.emit(serde_json::json!({ "type": "muted", "muted": muted }));
            }
            Command::Clear {} => {
                // Speaker queue is owned by the output endpoint; the engine forwards the flag.
                if let Some(engine) = &self.engine {
                    engine.clear_output();
                }
            }
            Command::Devices {} => emitter.emit(audio::io::describe_defaults()),
            Command::Close {} => {}
        }
        Ok(())
    }

    fn shutdown(&mut self, runtime: &tokio::runtime::Runtime) {
        self.engine.take();
        self.pending.take();
        if let Some(transport) = self.transport.take() {
            runtime.block_on(transport.close());
        }
        self.ducking.take();
    }
}
