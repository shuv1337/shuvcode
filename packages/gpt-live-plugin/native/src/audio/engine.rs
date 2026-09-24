//! The audio engine: echo cancellation, Opus encode/decode and level metering.
//!
//! Capture:  device rate -> 48 kHz -> echo/noise/gain processing (10 ms) -> Opus (20 ms) -> RTP
//! Playback: RTP -> Opus decode (48 kHz) -> device rate -> speaker ring
//! The rendered speaker signal is fed back as the echo-cancellation reference.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::mpsc as std_mpsc;
use std::thread::JoinHandle;
use std::time::Duration;
use std::time::Instant;

use ringbuf::traits::Consumer;
use ringbuf::traits::Observer;
use ringbuf::traits::Producer;
use sonora::AudioProcessing;
use sonora::StreamConfig;
use sonora::config::AdaptiveDigital;
use sonora::config::EchoCanceller;
use sonora::config::GainController2;
use sonora::config::HighPassFilter;
use sonora::config::NoiseSuppression;
use sonora::config::NoiseSuppressionLevel;
use tokio::sync::mpsc;

use super::io::AudioIo;
use super::resample::Converter;
use crate::protocol::Emitter;
use crate::transport::IncomingPacket;
use crate::transport::OutgoingFrame;

const RATE: u32 = 48_000;
const BLOCK: usize = 480; // 10 ms at 48 kHz
const FRAME: usize = 960; // 20 ms at 48 kHz
const MAX_DECODED: usize = 5760; // 120 ms at 48 kHz
const MAX_CONCEALED_PACKETS: u16 = 5;
const LEVEL_INTERVAL: Duration = Duration::from_millis(50);
const SERVICE_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Default)]
pub struct EngineControl {
    pub muted: AtomicBool,
    pub stop: AtomicBool,
}

pub struct Engine {
    pub control: Arc<EngineControl>,
    playback: Arc<super::io::PlaybackControl>,
    thread: Option<JoinHandle<()>>,
}

impl Engine {
    pub fn start(
        mut io: AudioIo,
        incoming: std_mpsc::Receiver<IncomingPacket>,
        outgoing: mpsc::Sender<OutgoingFrame>,
        emitter: Emitter,
        muted: bool,
    ) -> anyhow::Result<Self> {
        let control = Arc::new(EngineControl::default());
        control.muted.store(muted, Ordering::Release);
        let rings = io
            .rings
            .take()
            .ok_or_else(|| anyhow::anyhow!("audio already started"))?;
        let state = State::new(io.input.rate, io.output.rate)?;
        let playback = io.control.clone();
        let thread_control = control.clone();
        let thread = std::thread::Builder::new()
            .name("audio-engine".into())
            .spawn(move || {
                let mut state = state;
                let mut rings = rings;
                let io = io;
                if let Err(error) = state.run(
                    &mut rings,
                    &io,
                    &incoming,
                    &outgoing,
                    &emitter,
                    &thread_control,
                ) {
                    emitter.error(format!("audio engine stopped: {error}"), true);
                }
                drop(io);
            })?;
        Ok(Self {
            control,
            playback,
            thread: Some(thread),
        })
    }

    pub fn set_muted(&self, muted: bool) {
        self.control.muted.store(muted, Ordering::Release);
    }

    pub fn clear_output(&self) {
        self.playback.clear.store(true, Ordering::Release);
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.control.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Meter {
    sum: f64,
    count: usize,
}

impl Meter {
    fn new() -> Self {
        Self { sum: 0.0, count: 0 }
    }

    fn add(&mut self, samples: &[f32]) {
        for sample in samples {
            self.sum += f64::from(*sample) * f64::from(*sample);
        }
        self.count += samples.len();
    }

    /// Returns a perceptual 0..1 level (-60 dBFS .. 0 dBFS) and resets.
    fn take(&mut self) -> f64 {
        let level = if self.count == 0 {
            0.0
        } else {
            let rms = (self.sum / self.count as f64).sqrt();
            let db = 20.0 * rms.max(1e-9).log10();
            ((db + 60.0) / 60.0).clamp(0.0, 1.0)
        };
        self.sum = 0.0;
        self.count = 0;
        level
    }
}

struct State {
    capture: Converter,
    reference: Converter,
    playback: Converter,
    apm: AudioProcessing,
    encoder: opus::Encoder,
    decoder: opus::Decoder,
    pending: Vec<f32>,
    expected_sequence: Option<u16>,
    output_rate: u32,
    mic: Meter,
    speaker: Meter,
    scratch: Vec<f32>,
}

impl State {
    fn new(input_rate: u32, output_rate: u32) -> anyhow::Result<Self> {
        let apm = AudioProcessing::builder()
            .config(sonora::Config {
                echo_canceller: Some(EchoCanceller::default()),
                high_pass_filter: Some(HighPassFilter::default()),
                // Voice calls often happen with music or a TV in the room; favor clarity.
                noise_suppression: Some(NoiseSuppression {
                    level: NoiseSuppressionLevel::High,
                    ..Default::default()
                }),
                gain_controller2: Some(GainController2 {
                    adaptive_digital: Some(AdaptiveDigital::default()),
                    ..Default::default()
                }),
                ..Default::default()
            })
            .capture_config(StreamConfig::new(RATE, 1))
            .render_config(StreamConfig::new(RATE, 1))
            .build();
        let mut encoder = opus::Encoder::new(RATE, opus::Channels::Mono, opus::Application::Voip)?;
        encoder.set_inband_fec(true)?;
        encoder.set_packet_loss_perc(5)?;
        let decoder = opus::Decoder::new(RATE, opus::Channels::Mono)?;
        Ok(Self {
            capture: Converter::new(input_rate, RATE)?,
            reference: Converter::new(output_rate, RATE)?,
            playback: Converter::new(RATE, output_rate)?,
            apm,
            encoder,
            decoder,
            pending: Vec::with_capacity(FRAME),
            expected_sequence: None,
            output_rate,
            mic: Meter::new(),
            speaker: Meter::new(),
            scratch: vec![0.0; 8192],
        })
    }

    fn run(
        &mut self,
        rings: &mut super::io::Rings,
        io: &AudioIo,
        incoming: &std_mpsc::Receiver<IncomingPacket>,
        outgoing: &mpsc::Sender<OutgoingFrame>,
        emitter: &Emitter,
        control: &EngineControl,
    ) -> anyhow::Result<()> {
        let mut last_levels = Instant::now();
        let mut was_muted = control.muted.load(Ordering::Acquire);
        while !control.stop.load(Ordering::Acquire) {
            // Speaker reference first so capture blocks see an up-to-date echo model.
            loop {
                let read = rings.reference.pop_slice(&mut self.scratch);
                if read == 0 {
                    break;
                }
                self.reference.push(&self.scratch[..read])?;
            }
            let mut block = [0.0f32; BLOCK];
            let mut processed = [0.0f32; BLOCK];
            while self.reference.take_exact(&mut block) {
                self.apm
                    .process_render_f32(&[&block], &mut [&mut processed])
                    .map_err(|_| anyhow::anyhow!("echo reference processing failed"))?;
            }

            // Capture.
            loop {
                let read = rings.capture.pop_slice(&mut self.scratch);
                if read == 0 {
                    break;
                }
                self.capture.push(&self.scratch[..read])?;
            }
            let muted = control.muted.load(Ordering::Acquire);
            if muted != was_muted {
                self.pending.clear();
                was_muted = muted;
            }
            let playback_delay_ms =
                rings.playback.occupied_len() as f64 * 1000.0 / f64::from(self.output_rate);
            let delay = (playback_delay_ms + 20.0).clamp(0.0, 500.0) as i32;
            while self.capture.take_exact(&mut block) {
                let _ = self.apm.set_stream_delay_ms(delay);
                self.apm
                    .process_capture_f32(&[&block], &mut [&mut processed])
                    .map_err(|_| anyhow::anyhow!("capture processing failed"))?;
                if muted || processed.iter().any(|sample| !sample.is_finite()) {
                    processed.fill(0.0);
                } else {
                    self.mic.add(&processed);
                }
                self.pending.extend_from_slice(&processed);
                if self.pending.len() >= FRAME {
                    let mut data = vec![0u8; 1275];
                    let len = self
                        .encoder
                        .encode_float(&self.pending[..FRAME], &mut data)?;
                    data.truncate(len);
                    self.pending.drain(..FRAME);
                    let _ = outgoing.try_send(OutgoingFrame { data });
                }
            }

            // Playback.
            while let Ok(packet) = incoming.try_recv() {
                self.receive(packet)?;
            }
            if self.playback.available() > 0 {
                let samples: Vec<f32> = self.playback.drain_all().collect();
                rings.playback.push_slice(&samples);
            }

            if last_levels.elapsed() >= LEVEL_INTERVAL {
                last_levels = Instant::now();
                emitter.emit(serde_json::json!({
                    "type": "levels",
                    "mic": (self.mic.take() * 1000.0).round() / 1000.0,
                    "speaker": (self.speaker.take() * 1000.0).round() / 1000.0,
                    "muted": muted,
                }));
            }
            let _ = io;
            std::thread::sleep(SERVICE_INTERVAL);
        }
        Ok(())
    }

    fn receive(&mut self, packet: IncomingPacket) -> anyhow::Result<()> {
        let mut decoded = [0.0f32; MAX_DECODED];
        if let Some(expected) = self.expected_sequence {
            let gap = packet.sequence.wrapping_sub(expected);
            if gap >= u16::MAX / 2 {
                // Late or duplicate packet: already concealed or played.
                return Ok(());
            }
            if gap > 0 && gap <= MAX_CONCEALED_PACKETS {
                for index in 0..gap {
                    // Use in-band FEC for the packet just before this one, PLC for older gaps.
                    let (input, fec) = if index + 1 == gap {
                        (packet.payload.as_slice(), true)
                    } else {
                        (&[][..], false)
                    };
                    let frame = &mut decoded[..FRAME];
                    if let Ok(len) = self.decoder.decode_float(input, frame, fec) {
                        self.play(&decoded[..len])?;
                    }
                }
            }
        }
        self.expected_sequence = Some(packet.sequence.wrapping_add(1));
        match self
            .decoder
            .decode_float(&packet.payload, &mut decoded, false)
        {
            Ok(len) => self.play(&decoded[..len]),
            Err(_) => Ok(()),
        }
    }

    fn play(&mut self, samples: &[f32]) -> anyhow::Result<()> {
        self.speaker.add(samples);
        self.playback.push(samples)
    }
}
