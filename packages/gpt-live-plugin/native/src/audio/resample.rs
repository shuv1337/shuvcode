//! Streaming mono sample-rate conversion with a pass-through fast path.

use std::collections::VecDeque;

use rubato::Resampler;
use rubato::audioadapter_buffers::direct::InterleavedSlice;

pub struct Converter {
    inner: Option<Inner>,
    output: VecDeque<f32>,
}

struct Inner {
    resampler: rubato::Async<f32>,
    input: VecDeque<f32>,
    scratch: Vec<f32>,
}

impl Converter {
    pub fn new(from: u32, to: u32) -> anyhow::Result<Self> {
        let inner = if from == to {
            None
        } else {
            let resampler = rubato::Async::new_sinc(
                f64::from(to) / f64::from(from),
                1.0,
                &rubato::SincInterpolationParameters::default(),
                from.div_ceil(100) as usize,
                1,
                rubato::FixedAsync::Input,
            )
            .map_err(|error| anyhow::anyhow!("failed to create resampler: {error}"))?;
            let scratch = vec![0.0; resampler.output_frames_max()];
            Some(Inner {
                resampler,
                input: VecDeque::new(),
                scratch,
            })
        };
        Ok(Self {
            inner,
            output: VecDeque::new(),
        })
    }

    pub fn push(&mut self, samples: &[f32]) -> anyhow::Result<()> {
        let Some(inner) = &mut self.inner else {
            self.output.extend(samples);
            return Ok(());
        };
        inner.input.extend(samples);
        while inner.input.len() >= inner.resampler.input_frames_next() {
            let input = inner.input.make_contiguous();
            let frames = input.len();
            let input = InterleavedSlice::new(input, 1, frames)
                .map_err(|_| anyhow::anyhow!("invalid resampler input"))?;
            let capacity = inner.scratch.len();
            let mut output = InterleavedSlice::new_mut(&mut inner.scratch, 1, capacity)
                .map_err(|_| anyhow::anyhow!("invalid resampler output"))?;
            let (consumed, produced) = inner
                .resampler
                .process_into_buffer(&input, &mut output, None)
                .map_err(|error| anyhow::anyhow!("resampling failed: {error}"))?;
            inner.input.drain(..consumed);
            self.output.extend(&inner.scratch[..produced]);
        }
        Ok(())
    }

    pub fn available(&self) -> usize {
        self.output.len()
    }

    /// Takes exactly `out.len()` samples when enough are buffered.
    pub fn take_exact(&mut self, out: &mut [f32]) -> bool {
        if self.output.len() < out.len() {
            return false;
        }
        let count = out.len();
        for (slot, sample) in out.iter_mut().zip(self.output.drain(..count)) {
            *slot = sample;
        }
        true
    }

    pub fn drain_all(&mut self) -> std::collections::vec_deque::Drain<'_, f32> {
        self.output.drain(..)
    }
}
