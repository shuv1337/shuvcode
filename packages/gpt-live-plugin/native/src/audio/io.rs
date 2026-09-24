//! Audio input and output endpoints: system devices via CPAL, or WAV files for testing.
//!
//! Endpoints run on their own threads and exchange mono f32 samples with the engine
//! through lock-free ring buffers:
//! - capture: endpoint -> engine, at the input rate
//! - playback: engine -> endpoint, at the output rate
//! - reference: endpoint -> engine, what was actually rendered (echo-cancellation input)

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::Duration;
use std::time::Instant;

use cpal::FromSample;
use cpal::SizedSample;
use cpal::traits::DeviceTrait;
use cpal::traits::HostTrait;
use cpal::traits::StreamTrait;
use ringbuf::HeapCons;
use ringbuf::HeapProd;
use ringbuf::HeapRb;
use ringbuf::traits::Consumer;
use ringbuf::traits::Observer;
use ringbuf::traits::Producer;
use ringbuf::traits::Split;

use crate::protocol::Emitter;

pub struct Rings {
    pub capture: HeapCons<f32>,
    pub playback: HeapProd<f32>,
    pub reference: HeapCons<f32>,
}

pub struct EndpointInfo {
    pub name: String,
    pub rate: u32,
    pub channels: u16,
}

/// Flags shared between the engine and the output endpoint.
#[derive(Default)]
pub struct PlaybackControl {
    pub clear: AtomicBool,
}

pub struct AudioIo {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    pub input: EndpointInfo,
    pub output: EndpointInfo,
    pub rings: Option<Rings>,
    pub control: Arc<PlaybackControl>,
}

impl Drop for AudioIo {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

pub enum InputKind {
    Device,
    File(String),
}

pub enum OutputKind {
    Device,
    None,
    File(String),
}

impl AudioIo {
    pub fn open(input: InputKind, output: OutputKind, emitter: Emitter) -> anyhow::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let control = Arc::new(PlaybackControl::default());
        let mut threads = Vec::new();

        let (input_info, capture_prod, capture_cons) = match input {
            InputKind::Device => {
                let (info_tx, info_rx) = mpsc::channel();
                let stop = stop.clone();
                let emitter = emitter.clone();
                threads.push(
                    std::thread::Builder::new()
                        .name("audio-input".into())
                        .spawn(move || run_device_input(stop, info_tx, emitter))?,
                );
                let (info, prod_cons) = info_rx
                    .recv_timeout(Duration::from_secs(10))
                    .map_err(|_| anyhow::anyhow!("microphone did not start"))??;
                (info, None, Some(prod_cons))
            }
            InputKind::File(path) => {
                let reader = hound::WavReader::open(&path)
                    .map_err(|error| anyhow::anyhow!("cannot open input file {path}: {error}"))?;
                let spec = reader.spec();
                let info = EndpointInfo {
                    name: format!("file:{path}"),
                    rate: spec.sample_rate,
                    channels: spec.channels,
                };
                let (prod, cons) = HeapRb::<f32>::new(spec.sample_rate as usize * 2).split();
                (info, Some((reader, prod)), Some(cons))
            }
        };
        if let Some((reader, prod)) = capture_prod {
            let stop = stop.clone();
            let rate = input_info.rate;
            threads.push(
                std::thread::Builder::new()
                    .name("audio-file-input".into())
                    .spawn(move || run_file_input(reader, rate, prod, stop))?,
            );
        }
        let capture = capture_cons.ok_or_else(|| anyhow::anyhow!("no capture ring"))?;

        let (output_info, playback, reference) = match output {
            OutputKind::Device => {
                let (info_tx, info_rx) = mpsc::channel();
                let stop = stop.clone();
                let control = control.clone();
                let emitter = emitter.clone();
                threads.push(
                    std::thread::Builder::new()
                        .name("audio-output".into())
                        .spawn(move || run_device_output(stop, control, info_tx, emitter))?,
                );
                info_rx
                    .recv_timeout(Duration::from_secs(10))
                    .map_err(|_| anyhow::anyhow!("speaker did not start"))??
            }
            OutputKind::None | OutputKind::File(_) => {
                let rate = 48_000;
                let (playback_prod, playback_cons) = HeapRb::<f32>::new(rate as usize * 4).split();
                let (reference_prod, reference_cons) = HeapRb::<f32>::new(rate as usize).split();
                let path = match &output {
                    OutputKind::File(path) => Some(path.clone()),
                    _ => None,
                };
                let info = EndpointInfo {
                    name: path
                        .clone()
                        .map_or_else(|| "none".into(), |path| format!("file:{path}")),
                    rate,
                    channels: 1,
                };
                let stop = stop.clone();
                let control = control.clone();
                threads.push(
                    std::thread::Builder::new()
                        .name("audio-file-output".into())
                        .spawn(move || {
                            run_virtual_output(
                                path,
                                rate,
                                playback_cons,
                                reference_prod,
                                control,
                                stop,
                            )
                        })?,
                );
                (info, playback_prod, reference_cons)
            }
        };

        Ok(Self {
            stop,
            threads,
            input: input_info,
            output: output_info,
            rings: Some(Rings {
                capture,
                playback,
                reference,
            }),
            control,
        })
    }
}

pub fn describe_defaults() -> serde_json::Value {
    let host = cpal::default_host();
    let describe = |device: Option<cpal::Device>, input: bool| {
        let Some(device) = device else {
            return serde_json::Value::Null;
        };
        let name = device
            .description()
            .map(|description| description.name().to_string())
            .unwrap_or_else(|_| "unknown".into());
        let config = if input {
            device.default_input_config()
        } else {
            device.default_output_config()
        };
        match config {
            Ok(config) => serde_json::json!({
                "name": name,
                "rate": config.sample_rate(),
                "channels": config.channels(),
            }),
            Err(error) => serde_json::json!({ "name": name, "error": error.to_string() }),
        }
    };
    serde_json::json!({
        "type": "devices",
        "host": host.id().name(),
        "input": describe(host.default_input_device(), true),
        "output": describe(host.default_output_device(), false),
    })
}

type InputReady = anyhow::Result<(EndpointInfo, HeapCons<f32>)>;
type OutputReady = anyhow::Result<(EndpointInfo, HeapProd<f32>, HeapCons<f32>)>;

fn device_name(device: &cpal::Device) -> String {
    device
        .description()
        .map(|description| description.name().to_string())
        .unwrap_or_else(|_| "default".into())
}

fn stream_error(emitter: Emitter, direction: &'static str) -> impl FnMut(cpal::Error) + Send {
    move |error: cpal::Error| {
        use cpal::ErrorKind;
        match error.kind() {
            ErrorKind::Xrun => {}
            ErrorKind::DeviceChanged => emitter.emit(serde_json::json!({
                "type": "warning",
                "message": format!("{direction} device changed"),
            })),
            _ => emitter.error(format!("{direction} device error: {error}"), false),
        }
    }
}

fn run_device_input(stop: Arc<AtomicBool>, ready: mpsc::Sender<InputReady>, emitter: Emitter) {
    let result = (|| -> anyhow::Result<(cpal::Stream, EndpointInfo, HeapCons<f32>)> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("no microphone found"))?;
        let supported = device.default_input_config()?;
        let config = supported.config();
        let channels = config.channels as usize;
        let rate = config.sample_rate;
        let (prod, cons) = HeapRb::<f32>::new(rate as usize * 2).split();
        let errors = stream_error(emitter.clone(), "microphone");
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => build_input::<f32>(&device, config, channels, prod, errors),
            cpal::SampleFormat::I16 => build_input::<i16>(&device, config, channels, prod, errors),
            cpal::SampleFormat::I32 => build_input::<i32>(&device, config, channels, prod, errors),
            cpal::SampleFormat::U16 => build_input::<u16>(&device, config, channels, prod, errors),
            cpal::SampleFormat::U8 => build_input::<u8>(&device, config, channels, prod, errors),
            cpal::SampleFormat::F64 => build_input::<f64>(&device, config, channels, prod, errors),
            other => anyhow::bail!("unsupported microphone sample format {other}"),
        }?;
        stream.play()?;
        let info = EndpointInfo {
            name: device_name(&device),
            rate,
            channels: channels as u16,
        };
        Ok((stream, info, cons))
    })();
    match result {
        Ok((stream, info, cons)) => {
            let _ = ready.send(Ok((info, cons)));
            while !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(20));
            }
            drop(stream);
        }
        Err(error) => {
            let _ = ready.send(Err(error));
        }
    }
}

fn build_input<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    mut prod: HeapProd<f32>,
    errors: impl FnMut(cpal::Error) + Send + 'static,
) -> anyhow::Result<cpal::Stream>
where
    T: SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let mut mono = Vec::<f32>::with_capacity(4096);
    Ok(device.build_input_stream(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            mono.clear();
            for frame in data.chunks(channels.max(1)) {
                let sum: f32 = frame.iter().map(|sample| sample.to_sample::<f32>()).sum();
                mono.push(sum / frame.len() as f32);
            }
            // Dropping on overflow keeps the realtime callback non-blocking.
            prod.push_slice(&mono);
        },
        errors,
        None,
    )?)
}

/// Renders mono speaker samples, handling prebuffering after underruns and clear requests.
struct Renderer {
    playback: HeapCons<f32>,
    reference: HeapProd<f32>,
    control: Arc<PlaybackControl>,
    starved: bool,
    prebuffer: usize,
}

impl Renderer {
    fn new(
        playback: HeapCons<f32>,
        reference: HeapProd<f32>,
        control: Arc<PlaybackControl>,
        rate: u32,
    ) -> Self {
        Self {
            playback,
            reference,
            control,
            starved: true,
            // 60 ms of jitter absorption before speech starts playing.
            prebuffer: rate as usize * 60 / 1000,
        }
    }

    fn render(&mut self, out: &mut [f32]) {
        if self.control.clear.swap(false, Ordering::AcqRel) {
            self.playback.clear();
            self.starved = true;
        }
        if self.starved && self.playback.occupied_len() >= self.prebuffer {
            self.starved = false;
        }
        let read = if self.starved {
            0
        } else {
            self.playback.pop_slice(out)
        };
        if read < out.len() {
            out[read..].fill(0.0);
            if read == 0 || self.playback.is_empty() {
                self.starved = true;
            }
        }
        self.reference.push_slice(out);
    }
}

fn run_device_output(
    stop: Arc<AtomicBool>,
    control: Arc<PlaybackControl>,
    ready: mpsc::Sender<OutputReady>,
    emitter: Emitter,
) {
    let result =
        (|| -> anyhow::Result<(cpal::Stream, EndpointInfo, HeapProd<f32>, HeapCons<f32>)> {
            let host = cpal::default_host();
            let device = host
                .default_output_device()
                .ok_or_else(|| anyhow::anyhow!("no speaker found"))?;
            let supported = device.default_output_config()?;
            let config = supported.config();
            let channels = config.channels as usize;
            let rate = config.sample_rate;
            let (playback_prod, playback_cons) = HeapRb::<f32>::new(rate as usize * 4).split();
            let (reference_prod, reference_cons) = HeapRb::<f32>::new(rate as usize).split();
            let renderer = Renderer::new(playback_cons, reference_prod, control, rate);
            let errors = stream_error(emitter.clone(), "speaker");
            let stream = match supported.sample_format() {
                cpal::SampleFormat::F32 => {
                    build_output::<f32>(&device, config, channels, renderer, errors)
                }
                cpal::SampleFormat::I16 => {
                    build_output::<i16>(&device, config, channels, renderer, errors)
                }
                cpal::SampleFormat::I32 => {
                    build_output::<i32>(&device, config, channels, renderer, errors)
                }
                cpal::SampleFormat::U16 => {
                    build_output::<u16>(&device, config, channels, renderer, errors)
                }
                cpal::SampleFormat::U8 => {
                    build_output::<u8>(&device, config, channels, renderer, errors)
                }
                cpal::SampleFormat::F64 => {
                    build_output::<f64>(&device, config, channels, renderer, errors)
                }
                other => anyhow::bail!("unsupported speaker sample format {other}"),
            }?;
            stream.play()?;
            let info = EndpointInfo {
                name: device_name(&device),
                rate,
                channels: channels as u16,
            };
            Ok((stream, info, playback_prod, reference_cons))
        })();
    match result {
        Ok((stream, info, playback, reference)) => {
            let _ = ready.send(Ok((info, playback, reference)));
            while !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(20));
            }
            drop(stream);
        }
        Err(error) => {
            let _ = ready.send(Err(error));
        }
    }
}

fn build_output<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channels: usize,
    mut renderer: Renderer,
    errors: impl FnMut(cpal::Error) + Send + 'static,
) -> anyhow::Result<cpal::Stream>
where
    T: SizedSample + FromSample<f32> + Send + 'static,
{
    let mut mono = Vec::<f32>::with_capacity(4096);
    Ok(device.build_output_stream(
        config,
        move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
            let frames = data.len() / channels.max(1);
            mono.resize(frames, 0.0);
            renderer.render(&mut mono);
            for (frame, sample) in data.chunks_mut(channels.max(1)).zip(&mono) {
                let value = T::from_sample(sample.clamp(-1.0, 1.0));
                frame.fill(value);
            }
        },
        errors,
        None,
    )?)
}

fn run_file_input(
    mut reader: hound::WavReader<std::io::BufReader<std::fs::File>>,
    rate: u32,
    mut prod: HeapProd<f32>,
    stop: Arc<AtomicBool>,
) {
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().filter_map(Result::ok).collect(),
        hound::SampleFormat::Int => {
            let scale = (1_i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .filter_map(Result::ok)
                .map(|sample| sample as f32 / scale)
                .collect()
        }
    };
    let mono: Vec<f32> = samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect();
    let chunk = (rate / 100) as usize;
    let silence = vec![0.0; chunk];
    let mut position = 0;
    let started = Instant::now();
    let mut sent = 0u64;
    while !stop.load(Ordering::Acquire) {
        // Pace delivery like a real microphone: one 10 ms chunk per 10 ms.
        let due = started + Duration::from_millis(sent * 10);
        let now = Instant::now();
        if due > now {
            std::thread::sleep(due - now);
        }
        if position < mono.len() {
            let end = (position + chunk).min(mono.len());
            prod.push_slice(&mono[position..end]);
            if end - position < chunk {
                prod.push_slice(&silence[..chunk - (end - position)]);
            }
            position = end;
        } else {
            prod.push_slice(&silence);
        }
        sent += 1;
    }
}

fn run_virtual_output(
    path: Option<String>,
    rate: u32,
    playback: HeapCons<f32>,
    reference: HeapProd<f32>,
    control: Arc<PlaybackControl>,
    stop: Arc<AtomicBool>,
) {
    let mut writer = path.and_then(|path| {
        hound::WavWriter::create(
            path,
            hound::WavSpec {
                channels: 1,
                sample_rate: rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .ok()
    });
    let mut renderer = Renderer::new(playback, reference, control, rate);
    let mut chunk = vec![0.0f32; (rate / 100) as usize];
    let started = Instant::now();
    let mut rendered = 0u64;
    while !stop.load(Ordering::Acquire) {
        let due = started + Duration::from_millis(rendered * 10);
        let now = Instant::now();
        if due > now {
            std::thread::sleep(due - now);
        }
        renderer.render(&mut chunk);
        if let Some(writer) = writer.as_mut() {
            for sample in &chunk {
                let _ = writer.write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
            }
        }
        rendered += 1;
    }
    if let Some(writer) = writer {
        let _ = writer.finalize();
    }
}
