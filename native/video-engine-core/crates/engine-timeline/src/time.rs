use serde::{Deserialize, Serialize};
use std::ops::{Add, Sub};

/// Exact rational time representation to prevent audio/video drift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RationalTime {
    pub value: i64,
    pub timescale: u32,
}

impl RationalTime {
    pub const ZERO: Self = Self { value: 0, timescale: 48000 };

    pub fn new(value: i64, timescale: u32) -> Self {
        assert!(timescale > 0, "Timescale must be strictly positive");
        Self::simplify(value, timescale)
    }

    pub fn from_seconds(seconds: f64, timescale: u32) -> Self {
        let value = (seconds * timescale as f64).round() as i64;
        Self::new(value, timescale)
    }

    pub fn to_seconds(&self) -> f64 {
        if self.timescale == 0 {
            0.0
        } else {
            self.value as f64 / self.timescale as f64
        }
    }

    pub fn from_frames(frame_index: i64, fps_num: u32, fps_den: u32, timescale: u32) -> Self {
        let seconds = (frame_index as f64 * fps_den as f64) / fps_num as f64;
        Self::from_seconds(seconds, timescale)
    }

    pub fn to_frames(&self, fps_num: u32, fps_den: u32) -> i64 {
        let seconds = self.to_seconds();
        ((seconds * fps_num as f64) / fps_den as f64).floor() as i64
    }

    fn simplify(mut value: i64, mut timescale: u32) -> Self {
        let divisor = gcd(value.unsigned_abs(), timescale as u64);
        if divisor > 1 {
            value /= divisor as i64;
            timescale /= divisor as u32;
        }
        Self { value, timescale }
    }
}

impl Add for RationalTime {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        if self.timescale == rhs.timescale {
            return Self::new(self.value + rhs.value, self.timescale);
        }
        let common = lcm(self.timescale as u64, rhs.timescale as u64) as u32;
        let v1 = self.value * (common / self.timescale) as i64;
        let v2 = rhs.value * (common / rhs.timescale) as i64;
        Self::new(v1 + v2, common)
    }
}

impl Sub for RationalTime {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        if self.timescale == rhs.timescale {
            return Self::new(self.value - rhs.value, self.timescale);
        }
        let common = lcm(self.timescale as u64, rhs.timescale as u64) as u32;
        let v1 = self.value * (common / self.timescale) as i64;
        let v2 = rhs.value * (common / rhs.timescale) as i64;
        Self::new(v1 - v2, common)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeRange {
    pub start: RationalTime,
    pub duration: RationalTime,
}

impl TimeRange {
    pub fn new(start: RationalTime, duration: RationalTime) -> Self {
        Self { start, duration }
    }

    pub fn end(&self) -> RationalTime {
        self.start + self.duration
    }

    pub fn contains(&self, time: RationalTime) -> bool {
        time.to_seconds() >= self.start.to_seconds() && time.to_seconds() <= self.end().to_seconds()
    }
}

fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let temp = b;
        b = a % b;
        a = temp;
    }
    a
}

fn lcm(a: u64, b: u64) -> u64 {
    if a == 0 || b == 0 {
        0
    } else {
        (a * b) / gcd(a, b)
    }
}
