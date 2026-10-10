struct ViewSettings {
  viewport: vec2f,
  bin_count: u32,
  history_rows: u32,
  next_row: u32,
  valid_rows: u32,
  floor_dbfs: f32,
  ceiling_dbfs: f32,
};

@group(0) @binding(0) var history: texture_2d<f32>;
@group(0) @binding(1) var<uniform> settings: ViewSettings;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[index], 0.0, 1.0);
}

fn color_scale(level: f32) -> vec3f {
  let colors = array<vec3f, 5>(
    vec3f(0.051, 0.082, 0.125),
    vec3f(0.094, 0.239, 0.514),
    vec3f(0.157, 0.710, 0.631),
    vec3f(0.965, 0.871, 0.467),
    vec3f(0.984, 0.502, 0.376),
  );
  let position = clamp(level, 0.0, 1.0) * 4.0;
  let lower = min(u32(position), 3u);
  return mix(colors[lower], colors[lower + 1u], position - f32(lower));
}

@fragment
fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = position.xy / settings.viewport;
  let age = min(u32(uv.y * f32(settings.history_rows)), settings.history_rows - 1u);

  if (age >= settings.valid_rows) {
    return vec4f(0.051, 0.082, 0.125, 1.0);
  }

  // Newest row at the top. Moving the ring cursor scrolls history without
  // copying old rows or uploading a full image on every frame.
  let row = (settings.next_row + settings.history_rows - 1u - age) % settings.history_rows;
  let bin = min(u32(uv.x * f32(settings.bin_count)), settings.bin_count - 1u);
  let dbfs = textureLoad(history, vec2i(i32(bin), i32(row)), 0).r;
  let level = (dbfs - settings.floor_dbfs) / (settings.ceiling_dbfs - settings.floor_dbfs);
  return vec4f(color_scale(level), 1.0);
}
