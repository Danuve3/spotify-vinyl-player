// Shaders for the view out of the glass wall: a real photograph wrapped on a
// band around the viewer, a procedural sky around it (moon, stars, clouds,
// smoke) and, for Manhattan, GPU-animated point lights on top.

// Shared GLSL: integer hash and value noise
export const common = /* glsl */ `
  uniform float uTime;
  uniform vec3 uHaze;
  uniform float uRain; // 0..1, eased
  uniform float uDay;  // 0 night .. 1 day, eased

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
  uniform float uMoonOn;   // draw a moon (when the photo has none)
  uniform float uStars;    // star density / brightness, 0 = none
  uniform float uTwinkle;  // 0 in airless skies
  uniform float uMilky;    // Milky Way band
  uniform float uClouds;   // drifting night clouds
  uniform float uSmoke;    // low, rolling smoke lit from below (wasteland)
  uniform vec3 uGlow;      // colour of that light from below
  uniform float uFlash;    // lightning, 0..1
  uniform float uAurora;   // northern lights, 0..1 (night only)
  uniform vec3 uMoon2;     // a second moon (fantasy); off when zero
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Glow low down (light pollution, fires...) fading to the night overhead;
    // matches the photo's sky where they meet
    vec3 col = mix(uHaze, uZenith * 1.8, smoothstep(0.3, 0.6, h));
    col = mix(col, uZenith, smoothstep(0.6, 0.95, h));
    if (h < 0.0) col = uHaze * 0.8;

    // Stars, only where the glow lets them through
    float clear = smoothstep(0.25, 0.6, h + uMilky * 0.5) * (1.0 - uRain) * (1.0 - uSmoke) * (1.0 - uDay);
    vec3 sp = d * 380.0;
    float sr = hash(floor(sp));
    float star = step(1.0 - 0.0025 * max(uStars, 1.0), sr) * smoothstep(0.35, 0.05, length(fract(sp) - 0.5));
    float tw = mix(1.0, 0.6 + 0.4 * sin(uTime * (1.5 + sr * 3.0) + sr * 80.0), uTwinkle);
    col += vec3(0.8, 0.85, 1.0) * star * tw * fract(sr * 977.0) * 0.8 * min(uStars, 3.0) * clear;
    // Milky Way: a soft, grainy band across the sky
    if (uMilky > 0.0) {
      vec3 axis = normalize(vec3(0.35, 0.55, -0.76));
      float band = exp(-pow(dot(d, axis) / 0.16, 2.0));
      float dust = fbm(vec2(atan(d.z, d.x) * 6.0, dot(d, axis) * 20.0));
      vec3 fine = d * 900.0;
      float speck = step(0.985, hash(floor(fine))) * 0.25;
      col += (vec3(0.05, 0.05, 0.06) * band * smoothstep(0.35, 0.8, dust) + vec3(0.6, 0.65, 0.8) * speck * band) * uMilky * clear;
    }

    // Moon with halo
    float mc = dot(d, uMoon);
    float moon = uMoonOn * (1.0 - uRain * 0.95) * (1.0 - uDay); // hidden behind the rain clouds
    float disc = smoothstep(0.99988, 0.99992, mc);
    vec2 mp = (d - uMoon * mc).xy * 900.0;
    col += vec3(1.0, 0.96, 0.88) * disc * 3.0 * (0.82 + 0.18 * noise(mp * 0.9)) * moon;
    col += vec3(0.6, 0.62, 0.75) * (pow(max(mc, 0.0), 3000.0) * 0.3 + pow(max(mc, 0.0), 60.0) * 0.025) * moon;

    // A second, smaller and warmer moon
    if (uMoon2.x != 0.0 || uMoon2.y != 0.0) {
      vec3 m2 = normalize(uMoon2);
      float c2 = dot(d, m2);
      float disc2 = smoothstep(0.99994, 0.99996, c2);
      vec2 mp2 = (d - m2 * c2).xy * 1400.0;
      float night = (1.0 - uDay) * (1.0 - uRain * 0.95);
      col += vec3(1.0, 0.78, 0.6) * disc2 * 2.2 * (0.75 + 0.25 * noise(mp2)) * night;
      col += vec3(0.7, 0.5, 0.45) * pow(max(c2, 0.0), 400.0) * 0.15 * night;
    }

    // Northern lights: slow curtains with vertical rays, green fading to violet at the top
    if (uAurora > 0.0 && h > 0.0) {
      float night = (1.0 - uDay) * (1.0 - uRain);
      float az = atan(d.z, d.x);
      float t = uTime * 0.03;
      vec3 aur = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        // The curtain's base line winds across the sky
        float base = 0.18 + 0.12 * fk + 0.08 * sin(az * (2.0 + fk) + t * (1.0 + fk * 0.3) + fk * 2.0) + 0.05 * fbm(vec2(az * 3.0 + t, fk * 7.0));
        float above = h - base;
        if (above < -0.02) continue;
        float rays = 0.5 + 0.5 * fbm(vec2(az * 60.0 + t * 8.0 + fk * 13.0, t * 2.0));
        float body = exp(-max(above, 0.0) * (6.0 + fk * 2.0)) * smoothstep(-0.02, 0.01, above);
        float fold = 0.5 + 0.5 * sin(az * 9.0 + t * 6.0 + fk * 3.0 + 2.0 * fbm(vec2(az * 4.0, t)));
        vec3 green = vec3(0.1, 0.9, 0.45);
        vec3 violet = vec3(0.55, 0.2, 0.8);
        aur += mix(green, violet, smoothstep(0.02, 0.18, above)) * body * rays * (0.4 + 0.6 * fold) * (0.9 - fk * 0.2);
      }
      col += aur * 0.22 * uAurora * night;
    }

    // Drifting clouds, lit from below
    if (h > 0.0 && uClouds > 0.0) {
      vec2 cp = d.xz / (h + 0.06) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
      // Rain: a low, almost continuous deck of cloud
      float dens = smoothstep(0.5 - 0.35 * uRain, 0.85 - 0.2 * uRain, fbm(cp)) * smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.5 + 0.4 * uRain, 0.95 + 0.05 * uRain, h));
      vec3 cloud = mix(uHaze * 1.5, uZenith * 2.5, smoothstep(0.05, 0.45, h));
      cloud += vec3(0.5, 0.55, 0.7) * pow(max(mc, 0.0), 30.0) * 0.2 * uMoonOn;
      // By day: white, sunlit clouds (grey ones when it rains)
      vec3 dayCloud = mix(uHaze, vec3(1.0), 0.55 - uRain * 0.35) * (1.0 - uRain * 0.35);
      cloud = mix(cloud, dayCloud, uDay);
      col = mix(col, cloud, dens * 0.8 * uClouds);
    }

    // Smoke: a heavy, churning ceiling, glowing from the fires underneath and
    // lit up from inside by lightning
    if (uSmoke > 0.0) {
      float hh = max(h, 0.0);
      vec2 sp2 = d.xz / (hh + 0.12) * 1.1;
      float t = uTime * 0.012;
      vec2 warp = vec2(fbm(sp2 * 0.7 + t), fbm(sp2 * 0.7 - t + 5.2));
      float billow = fbm(sp2 * 1.3 + warp * 1.6 + vec2(t * 1.7, -t * 0.6));
      float dens = smoothstep(0.25, 0.75, billow);
      vec3 under = uGlow * (0.35 + 1.4 * exp(-hh * 7.0)) * (0.55 + 0.45 * fbm(sp2 * 2.1 - t * 3.0));
      vec3 base = mix(vec3(0.012, 0.009, 0.008), uHaze * 0.55, uDay);
      vec3 smoke = mix(base, under, (1.0 - dens) * 0.6 + 0.4 * exp(-hh * 5.0));
      col = mix(col, smoke, uSmoke);
      // Lightning: a flicker that lights a patch of the clouds
      float lit = smoothstep(0.35, 0.95, fbm(sp2 * 0.5 + vec2(floor(uTime * 0.37) * 3.1, 1.7)));
      col += vec3(0.55, 0.6, 0.8) * uFlash * (0.25 + lit * 1.6) * (0.4 + dens);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const photoFragment = /* glsl */ `
  ${common}
  // Night photo and day photo, each with its own framing; faded by uDay
  uniform sampler2D uPhoto;
  uniform vec2 uPhotoSize;  // pixels
  uniform float uHalfSpan;  // azimuth half-width (rad) the photo covers
  uniform vec2 uElevation;  // elevation (rad) of the photo's bottom and top edges
  uniform float uExposure;
  uniform float uMirror;    // below the photo: 1 = its foreground mirrored, 0 = a dark fill
  uniform sampler2D uPhotoDay;
  uniform vec2 uPhotoSizeDay;
  uniform float uHalfSpanDay;
  uniform vec2 uElevationDay;
  uniform float uExposureDay;
  uniform float uMirrorDay;
  uniform float uCity;      // lit windows that switch off and on, shimmering lights
  uniform float uWind;      // grass stirring in the foreground
  uniform float uFlash;     // lightning
  uniform vec4 uFires[8];   // (u, v from the top, radius in u, strength) lighting the ground; strength < 0: smoke only
  uniform vec4 uLamps[24];  // night lights: (u, v from the top, glow radius in u, strength); strength < 0: floodlight, no visible bulb
  uniform vec3 uLampColor;
  uniform vec4 uWater;      // water: v from the top (top, bottom) and u (left, right): ripples and glints
  uniform float uShimmer;   // heat haze near the horizon by day
  uniform float uLava;      // glowing lava in the photo pulses
  uniform float uFog;       // drifting fog, thicker low down
  uniform vec3 uFogColor;
  varying vec3 vDir;

  struct Layer { vec3 col; float a; vec2 uv; bool inside; };

  Layer photo(sampler2D tex, vec2 size, float halfSpan, vec2 elev, float exposure, float mirror, float city, vec3 d) {
    Layer L;
    L.col = vec3(0.0);
    L.a = 0.0;
    float az = atan(d.z, d.x);           // 0 straight out of the glass, + to the right
    float el = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(0.5 + az / (2.0 * halfSpan), (el - elev.x) / (elev.y - elev.x));
    L.uv = uv;
    L.inside = !(uv.x < 0.0 || uv.x > 1.0 || uv.y > 1.0);
    if (!L.inside) return L;

    // Wind through the grass: the nearer (lower) it is, the more it stirs
    float horizon = -elev.x / (elev.y - elev.x);
    if (uWind > 0.0 && uv.y < horizon) {
      float near = pow(1.0 - uv.y / horizon, 1.5);
      float gust = 0.5 + 0.5 * sin(uTime * 0.7 + uv.x * 9.0 - uTime * 0.35);
      vec2 w = vec2(noise(vec2(uv.x * 60.0 - uTime * 1.3, uv.y * 40.0)) - 0.5, 0.0);
      uv += w * uWind * near * gust * 0.0025;
    }

    // Water: the reflection wavers, more near the shore of view
    float water = 0.0;
    if (uWater.y > uWater.x) {
      float fromTop = 1.0 - uv.y;
      water = smoothstep(uWater.x, uWater.x + 0.01, fromTop) * (1.0 - smoothstep(uWater.y - 0.01, uWater.y, fromTop))
        * smoothstep(uWater.z, uWater.z + 0.01, uv.x) * (1.0 - smoothstep(uWater.w - 0.01, uWater.w, uv.x));
      if (water > 0.0) {
        float near = (fromTop - uWater.x) / max(uWater.y - uWater.x, 0.001);
        vec2 q = vec2(uv.x * 90.0, fromTop * 900.0 / (0.3 + near));
        uv += vec2(noise(q + vec2(uTime * 0.6, -uTime * 1.4)) - 0.5, noise(q * 1.3 - uTime) - 0.5) * vec2(0.0012, 0.004) * (0.3 + near) * water;
      }
    }

    // Heat haze: the air shimmers just above the ground, by day
    if (uShimmer > 0.0) {
      float band = exp(-pow((uv.y - horizon) / 0.06, 2.0)) * uShimmer * uDay;
      uv.y += (noise(vec2(uv.x * 140.0, uv.y * 300.0 - uTime * 3.0)) - 0.5) * 0.0015 * band;
    }

    // In the rain it all softens (wet air) and a little mist hangs over it
    vec4 tex4 = texture(tex, clamp(uv, vec2(0.0), vec2(1.0)), uRain * 0.7);
    vec3 col = tex4.rgb;
    if (water > 0.0) {
      // Sparkles where the light catches the wavelets
      float g = pow(noise(vec2(uv.x * 700.0, (1.0 - uv.y) * 2500.0) + uTime * vec2(1.7, -2.3)), 12.0);
      col += col * g * 3.0 * water * (0.3 + dot(col, vec3(0.3, 0.6, 0.1)));
    }
    if (uLava > 0.0) {
      // Molten rock: bright, saturated red-orange; it throbs and flickers
      float hot = smoothstep(0.25, 0.5, col.r - max(col.g, col.b) * 0.6) * smoothstep(0.2, 0.5, col.r);
      float pulse = 0.75 + 0.35 * noise(vec2(uv.x * 30.0 + uTime * 0.8, uv.y * 20.0 - uTime * 1.5)) + 0.1 * sin(uTime * 9.0 + uv.x * 40.0);
      col *= mix(1.0, pulse * (1.0 + uLava), hot);
    }
    col = mix(col, uHaze * 1.6, uRain * 0.12 * (0.4 + 0.6 * smoothstep(0.35, 0.7, uv.y)));
    float lum = dot(col, vec3(0.3, 0.59, 0.11));

    if (city > 0.0) {
      // Lit windows: a few switch off and on again every minute or so
      vec2 cell = floor(uv * size / vec2(4.0, 5.0));
      float h = hash(vec3(cell, 3.0));
      if (lum > 0.28 && h < 0.05 && uv.y < 0.75) {
        float on = step(0.35, fract(uTime / (40.0 + h * 900.0) + h * 17.0));
        col *= mix(1.0, mix(0.3, 1.0, on), city);
      }
      // Distant lights shimmer through the warm air near the horizon
      float far = smoothstep(horizon - 0.1, horizon + 0.05, uv.y) * (1.0 - smoothstep(horizon + 0.05, horizon + 0.11, uv.y));
      col *= 1.0 + far * step(0.3, lum) * 0.18 * city * sin(uTime * (2.0 + h * 5.0) + h * 60.0);
    }

    // Bright sources glow a little more so the bloom picks them up
    col = col * exposure + pow(lum, 3.0) * col * 0.8 * (1.0 - uDay);

    // Soft edges: the top and the sides melt into the sky dome
    float a = tex4.a * (1.0 - smoothstep(0.9, 1.0, uv.y));
    a *= smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    if (uv.y < 0.0) {
      // Below the photo: its foreground mirrored and softened, so the ground
      // carries on (it is only seen looking steeply down), or a dark fill
      vec3 ground = textureLod(tex, vec2(uv.x, min(-uv.y, 0.25)), 1.5 - uv.y * 12.0).rgb * exposure;
      vec3 fill = textureLod(tex, vec2(uv.x, 0.02), 6.0).rgb * exposure * 0.5;
      col = mix(fill, ground, mirror) * mix(0.6, 1.0, smoothstep(-0.3, 0.0, uv.y));
    }
    L.col = col;
    L.a = a;
    return L;
  }

  void main() {
    vec3 d = normalize(vDir);
    Layer n = photo(uPhoto, uPhotoSize, uHalfSpan, uElevation, uExposure, uMirror, uCity * (1.0 - uDay), d);
    Layer y = n;
    if (uDay > 0.001) y = photo(uPhotoDay, uPhotoSizeDay, uHalfSpanDay, uElevationDay, uExposureDay, uMirrorDay, 0.0, d);
    if (!n.inside && !y.inside) discard;
    // Cross-fade, weighting by coverage so a missing edge does not darken
    float wn = n.a * (1.0 - uDay), wd = y.a * uDay;
    float a = wn + wd;
    vec3 col = a > 0.0001 ? (n.col * wn + y.col * wd) / a : vec3(0.0);
    vec2 uv = n.uv;

    // Lamps at night: a warm pool of light around each, and the glow itself
    vec3 lampLight = vec3(0.0);
    float aspectL = uPhotoSize.y / uPhotoSize.x;
    for (int i = 0; i < 24; i++) {
      vec4 l = uLamps[i];
      if (l.w == 0.0) continue;
      vec2 dv = (uv - vec2(l.x, 1.0 - l.y)) * vec2(1.0, aspectL);
      float r2 = dot(dv, dv);
      float fl = 0.85 + 0.15 * noise(vec2(uTime * 5.0, float(i) * 7.0));
      // Floodlights wash a wall with light; lamps also show their bright bulb
      float bulb = l.w > 0.0 ? exp(-r2 / (l.z * l.z * 0.02)) * 2.5 : 0.0;
      float pool = exp(-r2 / (l.z * l.z)) * (l.w > 0.0 ? 0.6 : 1.6);
      lampLight += abs(l.w) * fl * (pool + bulb);
    }
    // (the night photo is graded ~10x down: a lit surface gets back to its daylight colour)
    col += (col * lampLight * 12.0 + lampLight * 0.015) * uLampColor * (1.0 - uDay);

    // Fires light up what is around them, flickering
    vec3 fireLight = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      vec4 f = uFires[i];
      if (f.w <= 0.0) continue;
      vec2 dv = (uv - f.xy) * vec2(1.0, uPhotoSize.y / uPhotoSize.x);
      float fl = 0.75 + 0.25 * noise(vec2(uTime * 7.0, float(i) * 13.0)) + 0.15 * sin(uTime * 23.0 + float(i));
      fireLight += vec3(1.0, 0.42, 0.12) * f.w * fl * exp(-dot(dv, dv) / (f.z * f.z));
    }
    col += (col * fireLight * 6.0 + fireLight * 0.01) * (1.0 - uDay * 0.8);
    // Lightning shows the ruins for an instant
    col += (col * 2.5 + 0.006) * uFlash * vec3(0.8, 0.85, 1.0);

    // Smoke rising from each fire: a column of churning noise that widens and
    // drifts with the wind, lit orange at its foot
    float aspect = uPhotoSize.x / uPhotoSize.y;
    float side = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    for (int i = 0; i < 8; i++) {
      vec4 f = uFires[i];
      if (f.w == 0.0) continue;
      bool burning = f.w > 0.0;
      f.w = abs(f.w);
      float up = uv.y - (1.0 - f.y);                  // height above the fire (photo heights)
      if (up < -0.02) continue;
      float x = (uv.x - f.x) * aspect - up * up * 1.2; // leaning downwind
      float width = 0.014 + max(up, 0.0) * 0.4 * (0.6 + f.w * 0.4);
      float t = uTime * 0.05 + float(i) * 7.3;
      vec2 q = vec2(x / width * 0.9, up * 9.0 - t * 5.0) + float(i) * 11.0;
      q += vec2(fbm(q * 0.7 + t), fbm(q * 0.7 - t + 4.1)) * 1.3;
      float nn = fbm(q);
      float body = smoothstep(1.0, 0.25, abs(x) / width) * smoothstep(-0.02, 0.01, up) * (1.0 - smoothstep(0.35, 0.95, up));
      float dens = smoothstep(0.3, 0.7, nn) * body * (0.65 + f.w * 0.35) * side;
      // Black smoke by day; lit orange from below at night
      vec3 smoke = mix(vec3(0.03, 0.022, 0.02), vec3(0.55, 0.2, 0.05), exp(-max(up, 0.0) * 30.0) * (1.0 - uDay)) * (0.7 + 0.6 * nn);
      smoke = mix(smoke, vec3(0.05, 0.045, 0.042) * (0.6 + 0.8 * nn), uDay * 0.7);
      // Chimney smoke: pale grey by day, faintly lit by the moon at night
      if (!burning) smoke = mix(vec3(0.02, 0.022, 0.03), vec3(0.55, 0.55, 0.56), uDay) * (0.75 + 0.5 * nn);
      smoke += vec3(0.25, 0.27, 0.35) * uFlash * 0.4;
      col = mix(col, smoke, dens);
      a = max(a, dens);
    }

    // Fog drifting through, thicker low down
    if (uFog > 0.0) {
      float t = uTime * 0.015;
      float low = 1.0 - smoothstep(0.0, 0.75, uv.y);
      float f = fbm(vec2(uv.x * 7.0 - t * 3.0, uv.y * 5.0 + sin(t * 2.0) * 0.3)) * 0.7 + fbm(vec2(uv.x * 19.0 + t * 5.0, uv.y * 11.0)) * 0.3;
      float dens = smoothstep(0.35, 0.8, f) * (0.35 + 0.65 * low) * uFog;
      col = mix(col, uFogColor, dens);
    }

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
      vColor = aColor * k * (1.0 - uDay * 0.85);
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
    vColor = aColor * k * (1.0 - uDay * 0.85);
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
