//! Lowers other apps' audio for the length of a call, the way call apps do, and restores
//! it afterwards. The call's own audio is never lowered.
//!
//! - macOS: Apple's voice-processing unit with maximum "other audio" ducking (the system
//!   mechanism FaceTime uses). It ducks audio from other processes only.
//! - Windows: every other app's session volume (the Volume Mixer sliders).
//! - Linux: every other PipeWire/PulseAudio playback stream, via pactl.
//!
//! On Windows and Linux, streams that start during the call are lowered too, and a stream
//! is only restored if its volume is still what we set (the user may have changed it).

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::thread::JoinHandle;
use std::time::Duration;

/// Fraction of their volume other apps keep during a call.
#[allow(dead_code)]
const DUCKED: f32 = 0.2;
#[allow(dead_code)]
const RESCAN: Duration = Duration::from_millis(1500);

/// Ducking in effect until dropped.
pub struct Ducking {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Ducking {
    pub fn start() -> Option<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("duck".into())
            .spawn(move || {
                if let Err(error) = imp::run(&flag) {
                    eprintln!("duck: {error:#}");
                }
            })
            .ok()?;
        Some(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for Ducking {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Sleeps in small steps until `stop` is set or `duration` passes.
#[allow(dead_code)]
fn wait(stop: &AtomicBool, duration: Duration) {
    let step = Duration::from_millis(50);
    let mut left = duration;
    while !stop.load(Ordering::Acquire) && !left.is_zero() {
        let now = step.min(left);
        std::thread::sleep(now);
        left -= now;
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    #[repr(C)]
    struct AudioComponentDescription {
        component_type: u32,
        component_sub_type: u32,
        component_manufacturer: u32,
        component_flags: u32,
        component_flags_mask: u32,
    }

    #[repr(C)]
    struct DuckingConfiguration {
        enable_advanced_ducking: u8,
        ducking_level: u32,
    }

    #[repr(C)]
    struct AudioBuffer {
        channels: u32,
        size: u32,
        data: *mut c_void,
    }

    #[repr(C)]
    struct AudioBufferList {
        count: u32,
        buffers: [AudioBuffer; 1],
    }

    #[repr(C)]
    struct RenderCallback {
        proc_: extern "C" fn(
            *mut c_void,
            *mut u32,
            *const c_void,
            u32,
            u32,
            *mut AudioBufferList,
        ) -> i32,
        ref_con: *mut c_void,
    }

    type AudioUnit = *mut c_void;

    #[link(name = "AudioToolbox", kind = "framework")]
    unsafe extern "C" {
        fn AudioComponentFindNext(
            component: *mut c_void,
            description: *const AudioComponentDescription,
        ) -> *mut c_void;
        fn AudioComponentInstanceNew(component: *mut c_void, unit: *mut AudioUnit) -> i32;
        fn AudioComponentInstanceDispose(unit: AudioUnit) -> i32;
        fn AudioUnitSetProperty(
            unit: AudioUnit,
            id: u32,
            scope: u32,
            element: u32,
            data: *const c_void,
            size: u32,
        ) -> i32;
        fn AudioUnitInitialize(unit: AudioUnit) -> i32;
        fn AudioUnitUninitialize(unit: AudioUnit) -> i32;
        fn AudioOutputUnitStart(unit: AudioUnit) -> i32;
        fn AudioOutputUnitStop(unit: AudioUnit) -> i32;
    }

    const fn code(value: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*value)
    }

    const ENABLE_IO: u32 = 2003;
    const SET_RENDER_CALLBACK: u32 = 23;
    const OTHER_AUDIO_DUCKING: u32 = 2108;
    const DUCKING_MAX: u32 = 30;
    const SCOPE_GLOBAL: u32 = 0;
    const SCOPE_INPUT: u32 = 1;
    const OUTPUT_IS_SILENCE: u32 = 1 << 4;

    /// The unit's own output stays silent; the call plays through the normal speaker path.
    extern "C" fn silence(
        _: *mut c_void,
        flags: *mut u32,
        _: *const c_void,
        _: u32,
        _: u32,
        data: *mut AudioBufferList,
    ) -> i32 {
        // SAFETY: Core Audio passes a valid buffer list with `count` buffers.
        unsafe {
            if !data.is_null() {
                let list = &mut *data;
                let buffers =
                    std::slice::from_raw_parts_mut(list.buffers.as_mut_ptr(), list.count as usize);
                for buffer in buffers {
                    if !buffer.data.is_null() {
                        std::ptr::write_bytes(buffer.data as *mut u8, 0, buffer.size as usize);
                    }
                }
            }
            if !flags.is_null() {
                *flags |= OUTPUT_IS_SILENCE;
            }
        }
        0
    }

    fn check(status: i32, what: &str) -> anyhow::Result<()> {
        anyhow::ensure!(status == 0, "{what} failed ({status})");
        Ok(())
    }

    pub fn run(stop: &AtomicBool) -> anyhow::Result<()> {
        let description = AudioComponentDescription {
            component_type: code(b"auou"),
            component_sub_type: code(b"vpio"),
            component_manufacturer: code(b"appl"),
            component_flags: 0,
            component_flags_mask: 0,
        };
        let mut unit: AudioUnit = std::ptr::null_mut();
        // SAFETY: plain Core Audio calls on a unit owned by this function; it is stopped,
        // uninitialized and disposed before returning.
        unsafe {
            let component = AudioComponentFindNext(std::ptr::null_mut(), &description);
            anyhow::ensure!(!component.is_null(), "voice processing unit not available");
            check(
                AudioComponentInstanceNew(component, &mut unit),
                "creating voice processing unit",
            )?;
            let result = (|| -> anyhow::Result<()> {
                let one: u32 = 1;
                check(
                    AudioUnitSetProperty(
                        unit,
                        ENABLE_IO,
                        SCOPE_INPUT,
                        1,
                        &one as *const u32 as *const c_void,
                        4,
                    ),
                    "enabling input",
                )?;
                let callback = RenderCallback {
                    proc_: silence,
                    ref_con: std::ptr::null_mut(),
                };
                check(
                    AudioUnitSetProperty(
                        unit,
                        SET_RENDER_CALLBACK,
                        SCOPE_INPUT,
                        0,
                        &callback as *const RenderCallback as *const c_void,
                        std::mem::size_of::<RenderCallback>() as u32,
                    ),
                    "setting render callback",
                )?;
                let configuration = DuckingConfiguration {
                    enable_advanced_ducking: 0,
                    ducking_level: DUCKING_MAX,
                };
                // macOS 14+; older systems keep the default ducking level.
                let _ = AudioUnitSetProperty(
                    unit,
                    OTHER_AUDIO_DUCKING,
                    SCOPE_GLOBAL,
                    0,
                    &configuration as *const DuckingConfiguration as *const c_void,
                    std::mem::size_of::<DuckingConfiguration>() as u32,
                );
                check(
                    AudioUnitInitialize(unit),
                    "initializing voice processing unit",
                )?;
                check(AudioOutputUnitStart(unit), "starting voice processing unit")?;
                while !stop.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                AudioOutputUnitStop(unit);
                AudioUnitUninitialize(unit);
                Ok(())
            })();
            AudioComponentInstanceDispose(unit);
            result
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;

    use windows::Win32::Media::Audio::IAudioSessionControl2;
    use windows::Win32::Media::Audio::IAudioSessionManager2;
    use windows::Win32::Media::Audio::IMMDeviceEnumerator;
    use windows::Win32::Media::Audio::ISimpleAudioVolume;
    use windows::Win32::Media::Audio::MMDeviceEnumerator;
    use windows::Win32::Media::Audio::eConsole;
    use windows::Win32::Media::Audio::eRender;
    use windows::Win32::System::Com::CLSCTX_ALL;
    use windows::Win32::System::Com::COINIT_MULTITHREADED;
    use windows::Win32::System::Com::CoCreateInstance;
    use windows::Win32::System::Com::CoInitializeEx;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::core::Interface;

    use super::DUCKED;
    use super::RESCAN;
    use super::wait;

    struct Lowered {
        volume: ISimpleAudioVolume,
        original: f32,
        set: f32,
    }

    /// Every other app's session on the default speaker, keyed by session instance ID.
    unsafe fn sessions() -> windows::core::Result<Vec<(String, ISimpleAudioVolume)>> {
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eConsole)? };
        let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
        let list = unsafe { manager.GetSessionEnumerator()? };
        let own = std::process::id();
        let mut found = Vec::new();
        for index in 0..unsafe { list.GetCount()? } {
            let control = unsafe { list.GetSession(index)? };
            let Ok(control) = control.cast::<IAudioSessionControl2>() else {
                continue;
            };
            if unsafe { control.GetProcessId() }.unwrap_or(0) == own {
                continue;
            }
            let Ok(raw) = (unsafe { control.GetSessionInstanceIdentifier() }) else {
                continue;
            };
            let id = unsafe { raw.to_string() }.unwrap_or_default();
            unsafe { CoTaskMemFree(Some(raw.0 as *const _)) };
            if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                found.push((id, volume));
            }
        }
        Ok(found)
    }

    pub fn run(stop: &AtomicBool) -> anyhow::Result<()> {
        // SAFETY: COM is initialized for this thread, and every interface is used on it.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let mut lowered: HashMap<String, Lowered> = HashMap::new();
            while !stop.load(Ordering::Acquire) {
                if let Ok(found) = sessions() {
                    for (id, volume) in found {
                        if lowered.contains_key(&id) {
                            continue;
                        }
                        let Ok(original) = volume.GetMasterVolume() else {
                            continue;
                        };
                        let set = original * DUCKED;
                        if volume.SetMasterVolume(set, std::ptr::null()).is_ok() {
                            lowered.insert(
                                id,
                                Lowered {
                                    volume,
                                    original,
                                    set,
                                },
                            );
                        }
                    }
                }
                wait(stop, RESCAN);
            }
            for session in lowered.into_values() {
                // Leave sessions the user adjusted during the call alone.
                if session
                    .volume
                    .GetMasterVolume()
                    .is_ok_and(|now| (now - session.set).abs() < 0.01)
                {
                    let _ = session
                        .volume
                        .SetMasterVolume(session.original, std::ptr::null());
                }
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::HashMap;
    use std::process::Command;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;

    use super::DUCKED;
    use super::RESCAN;
    use super::wait;

    struct Lowered {
        original: u64,
        set: u64,
    }

    /// Other processes' playback streams as (index, volume in PulseAudio units).
    fn pactl_list(kind: &str) -> anyhow::Result<serde_json::Value> {
        let output = Command::new("pactl")
            .args(["-f", "json", "list", kind])
            .output()?;
        anyhow::ensure!(output.status.success(), "pactl failed");
        Ok(serde_json::from_slice(&output.stdout)?)
    }

    fn process_id(value: &serde_json::Value) -> Option<&str> {
        value
            .pointer("/properties/application.process.id")
            .and_then(|pid| pid.as_str())
    }

    fn streams() -> anyhow::Result<Vec<(u64, u64)>> {
        let list = pactl_list("sink-inputs")?;
        let own = std::process::id().to_string();
        // PipeWire's ALSA plugin puts the process ID on the client, not the stream, so our
        // own playback is only recognisable through its client.
        let own_clients: Vec<u64> = pactl_list("clients")?
            .as_array()
            .into_iter()
            .flatten()
            .filter(|client| process_id(client) == Some(own.as_str()))
            .filter_map(|client| client.get("index")?.as_u64())
            .collect();
        Ok(list
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|stream| {
                let client = stream.get("client").and_then(|client| client.as_u64());
                if process_id(stream) == Some(own.as_str())
                    || client.is_some_and(|client| own_clients.contains(&client))
                {
                    return None;
                }
                let index = stream.get("index")?.as_u64()?;
                // Channels are usually equal; use the loudest so restoring never lowers.
                let volume = stream
                    .get("volume")?
                    .as_object()?
                    .values()
                    .filter_map(|channel| channel.get("value")?.as_u64())
                    .max()?;
                Some((index, volume))
            })
            .collect())
    }

    fn set_volume(index: u64, volume: u64) -> bool {
        Command::new("pactl")
            .args([
                "set-sink-input-volume",
                &index.to_string(),
                &volume.to_string(),
            ])
            .status()
            .is_ok_and(|status| status.success())
    }

    pub fn run(stop: &AtomicBool) -> anyhow::Result<()> {
        let mut lowered: HashMap<u64, Lowered> = HashMap::new();
        while !stop.load(Ordering::Acquire) {
            if let Ok(found) = streams() {
                for (index, original) in found {
                    if lowered.contains_key(&index) {
                        continue;
                    }
                    let set = (original as f32 * DUCKED) as u64;
                    if set_volume(index, set) {
                        lowered.insert(index, Lowered { original, set });
                    }
                }
            }
            wait(stop, RESCAN);
        }
        let now: HashMap<u64, u64> = streams().unwrap_or_default().into_iter().collect();
        for (index, stream) in lowered {
            // Leave streams the user adjusted during the call alone.
            if now
                .get(&index)
                .is_some_and(|volume| volume.abs_diff(stream.set) <= 655)
            {
                set_volume(index, stream.original);
            }
        }
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod imp {
    pub fn run(_: &std::sync::atomic::AtomicBool) -> anyhow::Result<()> {
        Ok(())
    }
}
