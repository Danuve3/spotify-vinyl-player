// Shaders for the view out of the glass wall: a real night photograph of
// Manhattan wrapped on a cylinder around the viewer, a procedural sky above it
// (moon, stars, drifting clouds) and GPU-animated point lights on top.

// Shared GLSL: integer hash and value noise
export const common = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHaze;
  uniform float uRain; // 0..1, eased

  uint pcg(uint v) {
    uint s = v * 747796405u + 2891336453u;
    uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
  }
  float hash(vec3 p) {
    uvec3 u = uvec3(ivec3(floor(p)));
    return float(pcg(u.x + pcg(u.y + pcg(u.z)))) / 4294967295.0;
  }
  float noise(vec2 p) {
    vec2 i = floor(p), q = fract(p);
    q = q * q * (3.0 - 2.0 * q);
    float a = hash(vec3(i, 7.0)), b = hash(vec3(i + vec2(1, 0), 7.0));
    float c = hash(vec3(i + vec2(0, 1), 7.0)), d = hash(vec3(i + vec2(1, 1), 7.0));
    return mix(mix(a, b, q.x), mix(c, d, q.x), q.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
`

// Direction from the eye: both the sky dome and the photo band are centred on it
export const dirVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const skyFragment = /* glsl */ `
  ${common}
  uniform vec3 uMoon;
  uniform vec3 uZenith;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Light pollution glow low down, fading to a deep night overhead
    // Matches the photo's sky where they meet (up to ~17 deg), then darkens
    vec3 col = mix(uHaze, uZenith * 1.8, smoothstep(0.3, 0.6, h));
    col = mix(col, uZenith, smoothstep(0.6, 0.95, h));
    if (h < 0.0) col = uHaze * 0.8;

    // A few stars, only where the glow lets them through
    vec3 sp = d * 380.0;
    float sr = hash(floor(sp));
    float star = step(0.9975, sr) * smoothstep(0.35, 0.05, length(fract(sp) - 0.5));
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + sr * 3.0) + sr * 80.0);
    col += vec3(0.8, 0.85, 1.0) * star * tw * (sr - 0.9975) * 300.0 * smoothstep(0.25, 0.6, h) * (1.0 - uRain);

    // Moon with halo
    float mc = dot(d, uMoon);
    float disc = smoothstep(0.99988, 0.99992, mc);
    vec2 mp = (d - uMoon * mc).xy * 900.0;
    float moon = 1.0 - uRain * 0.95; // hidden behind the rain clouds
    col += vec3(1.0, 0.96, 0.88) * disc * 3.0 * (0.82 + 0.18 * noise(mp * 0.9)) * moon;
    col += vec3(0.6, 0.62, 0.75) * (pow(max(mc, 0.0), 3000.0) * 0.3 + pow(max(mc, 0.0), 60.0) * 0.025) * moon;

    // Drifting clouds, lit from below by the city
    if (h > 0.0) {
      vec2 cp = d.xz / (h + 0.06) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
      // Rain: a low, almost continuous deck of cloud
      float dens = smoothstep(0.5 - 0.35 * uRain, 0.85 - 0.2 * uRain, fbm(cp)) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.5 + 0.4 * uRain, 0.95 + 0.05 * uRain, h));
      vec3 cloud = mix(uHaze * 1.5, uZenith * 2.5, smoothstep(0.05, 0.45, h));
      cloud += vec3(0.5, 0.55, 0.7) * pow(max(mc, 0.0), 30.0) * 0.2;
      col = mix(col, cloud, dens * 0.8);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const photoFragment = /* glsl */ `
  ${common}
  uniform sampler2D uPhoto;
  uniform vec2 uPhotoSize;  // pixels
  uniform float uHalfSpan;  // azimuth half-width (rad) the photo covers
  uniform vec2 uElevation;  // elevation (rad) of the photo's bottom and top edges
  uniform float uExposure;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float az = atan(d.z, d.x);           // 0 straight out of the glass, + to the right
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + az / (2.0 * uHalfSpan), (el - uElevation.x) / (uElevation.y - uElevation.x));
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;

    // In the rain the city softens (wet air) and a little mist hangs over it
    vec3 col = texture(uPhoto, clamp(uv, vec2(0.0), vec2(1.0)), uRain * 0.7).rgb;
    col = mix(col, uHaze * 1.6, uRain * 0.12 * (0.4 + 0.6 * smoothstep(0.35, 0.7, uv.y)));
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    vec2 px = uv * uPhotoSize;

    // Lit windows: a few switch off and on again every minute or so
    vec2 cell = floor(px / vec2(4.0, 5.0));
    float h = hash(vec3(cell, 3.0));
    if (lum > 0.28 && h < 0.05 && uv.y < 0.75) {
      float on = step(0.35, fract(uTime / (40.0 + h * 900.0) + h * 17.0));
      col *= mix(0.3, 1.0, on);
    }
    // Distant lights shimmer through the warm air near the horizon
    float far = smoothstep(0.55, 0.7, uv.y) * (1.0 - smoothstep(0.7, 0.76, uv.y));
    col *= 1.0 + far * step(0.3, lum) * 0.18 * sin(uTime * (2.0 + h * 5.0) + h * 60.0);

    // Bright sources glow a little more so the bloom picks them up
    col = col * uExposure + pow(lum, 3.0) * col * 0.8;

    // Soft edges: the top melts into the sky dome, the sides and bottom into haze
    float a = 1.0 - smoothstep(0.9, 1.0, uv.y);
    float side = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    col = mix(uHaze * 0.5, col, side);
    if (uv.y < 0.0) col = mix(uHaze * 0.35, col * 0.4, smoothstep(-0.25, 0.0, uv.y));

    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Glowing points: traffic along the avenues and aviation beacons on the
// towers in the photo, plus aircraft. Positions are animated on the GPU.
export const lightsVertex = /* glsl */ `
  ${common}
  uniform float uProj;  // pixels per unit at distance 1
  uniform float uUnit;  // world units per metre
  uniform float uHalfSpan;
  uniform vec2 uElevation;
  uniform float uPhotoR;
  attribute vec4 aA;
  attribute vec4 aB;
  attribute vec3 aColor;
  attribute float aKind; // 1 car, 2 beacon, 3 aircraft
  varying vec3 vColor;

  void main() {
    vec3 p = position;
    float size = aB.w;
    float k = 1.0;
    if (aKind < 1.5) {
      // Car on an avenue in the photo: aA = near (u, v) -> far (u, v), v from the top;
      // aB = (laps per second, phase, size near, size far) in pixels; position.x = -1 oncoming
      float t = fract(aB.y + uTime * aB.x);
      if (position.x < 0.0) t = 1.0 - t;
      vec2 uv = mix(aA.xy, aA.zw, t);
      float az = (uv.x - 0.5) * 2.0 * uHalfSpan;
      float el = uElevation.x + (1.0 - uv.y) * (uElevation.y - uElevation.x);
      p = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az)) * uPhotoR;
      k = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.85, t);
      vColor = aColor * k;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = k <= 0.001 ? 0.0 : mix(aB.z, aB.w, t) * uProj / 800.0;
      return;
    }
    if (aKind < 2.5) {
      // Beacon: aA.x = phase, aA.y = rate; slow red pulse
      k = 0.12 + 0.88 * pow(max(0.0, sin(uTime * aA.y + aA.x * 6.2832)), 8.0);
    } else {
      // Aircraft: aA = (centre x, altitude, centre z, speed); aB = (dir x, dir z, span, size);
      // position = (wing offset, strobe flag, nose offset)
      vec2 dir = normalize(aB.xy);
      float t = mod(uTime * aA.w, aB.z) - aB.z * 0.5;
      vec2 side = vec2(-dir.y, dir.x);
      p = vec3(aA.x + dir.x * t + side.x * position.x, aA.y, aA.z + dir.y * t + side.y * position.x);
      p.xz += dir * position.z;
      k = position.y > 0.5 ? step(0.92, fract(uTime * 0.9 + position.x * 0.01)) * 2.5 : 1.0;
    }
    vColor = aColor * k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = k <= 0.001 ? 0.0 : clamp(size * uUnit * uProj / -mv.z, 1.2, 16.0);
  }
`

export const lightsFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float a = exp(-dot(q, q) * 14.0);
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
