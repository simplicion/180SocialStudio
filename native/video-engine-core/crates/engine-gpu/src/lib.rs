use serde::{Deserialize, Serialize};

pub const TRANSFORM_WGSL: &str = include_str!("shaders/transform.wgsl");
pub const SPRING_ZOOM_WGSL: &str = include_str!("shaders/spring_zoom.wgsl");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpringState {
    pub position: f32,
    pub velocity: f32,
    pub target: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub mass: f32,
}

impl SpringState {
    pub fn new(initial: f32, target: f32, stiffness: f32, damping: f32, mass: f32) -> Self {
        Self {
            position: initial,
            velocity: 0.0,
            target,
            stiffness: if stiffness <= 0.0 { 100.0 } else { stiffness },
            damping: if damping < 0.0 { 10.0 } else { damping },
            mass: if mass <= 0.0 { 1.0 } else { mass },
        }
    }

    /// Solves continuous 2nd-order ODE damped harmonic oscillator
    pub fn evaluate(&self, t_seconds: f32) -> f32 {
        if t_seconds <= 0.0 {
            return self.position;
        }

        let m = self.mass;
        let k = self.stiffness;
        let c = self.damping;
        let x0 = self.position - self.target;
        let v0 = self.velocity;

        let discriminant = c * c - 4.0 * m * k;

        if discriminant.abs() < 1e-5 {
            // Critically damped
            let omega = c / (2.0 * m);
            let a = x0;
            let b = v0 + omega * x0;
            self.target + (a + b * t_seconds) * (-omega * t_seconds).exp()
        } else if discriminant < 0.0 {
            // Underdamped (oscillating bounce)
            let alpha = c / (2.0 * m);
            let omega_d = (-discriminant).sqrt() / (2.0 * m);
            let a = x0;
            let b = (v0 + alpha * x0) / omega_d;
            self.target + (-alpha * t_seconds).exp() * (a * (omega_d * t_seconds).cos() + b * (omega_d * t_seconds).sin())
        } else {
            // Overdamped
            let r1 = (-c + discriminant.sqrt()) / (2.0 * m);
            let r2 = (-c - discriminant.sqrt()) / (2.0 * m);
            let a = (v0 - r2 * x0) / (r1 - r2);
            let b = x0 - a;
            self.target + a * (r1 * t_seconds).exp() + b * (r2 * t_seconds).exp()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraViewportRect {
    pub center_x: f32,
    pub center_y: f32,
    pub zoom_scale: f32,
    pub rotation_deg: f32,
}

impl Default for CameraViewportRect {
    fn default() -> Self {
        Self {
            center_x: 0.5,
            center_y: 0.5,
            zoom_scale: 1.0,
            rotation_deg: 0.0,
        }
    }
}
