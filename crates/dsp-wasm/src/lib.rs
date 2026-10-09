use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Spectrum {
    inner: sdr_dsp::Spectrum,
}

#[wasm_bindgen]
impl Spectrum {
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize) -> Result<Spectrum, JsValue> {
        Ok(Self {
            inner: sdr_dsp::Spectrum::new(size).map_err(JsValue::from_str)?,
        })
    }

    pub fn process(&mut self, iq: &[f32]) -> Result<Vec<f32>, JsValue> {
        self.inner.process(iq).map_err(JsValue::from_str)
    }
}
