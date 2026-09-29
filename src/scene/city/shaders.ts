import { BLOCK, EYE, GRID_ANGLE, PITCH, RIVER_HALF, STREET } from './layout'

const f = (n: number) => n.toFixed(4)

// Shared GLSL: integer hash, value noise, grid transform, atmospheric haze
export const common = /* glsl */ `
  #define EYE ${f(EYE)}
  #define PITCH ${f(PITCH)}
  #define STREET ${f(STREET)}
  #define BLOCK ${f(BLOCK)}
  #define RIVER_HALF ${f(RIVER_HALF)}
  const vec2 GRID = vec2(${f(Math.cos(GRID_ANGLE))}, ${f(Math.sin(GRID_ANGLE))});

  uniform float uTime;
  uniform vec3 uHaze;

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
  // City space -> street grid space
  vec2 toGrid(vec2 p) { return vec2(p.x * GRID.x + p.y * GRID.y, -p.x * GRID.y + p.y * GRID.x); }
  vec2 fromGrid(vec2 g) { return vec2(g.x * GRID.x - g.y * GRID.y, g.x * GRID.y + g.y * GRID.x); }
  float riverZ(float x) { return 520.0 + 260.0 * sin(x / 820.0) + 90.0 * sin(x / 310.0 + 1.3); }

  vec3 haze(vec3 col, vec3 p) {
    float d = length(p);
    float fog = 1.0 - exp(-d * 0.00042);
    // Light pollution pools near the ground in the distance
    float low = exp(-max(p.y + EYE, 0.0) / 160.0) * smoothstep(300.0, 2600.0, d) * 0.45;
    return mix(col, uHaze, clamp(fog + low, 0.0, 0.94));
  }
`

export const buildingVertex = /* glsl */ `
  attribute vec4 aDims; // width, height, depth, base height
  attribute vec4 aInfo; // seed, style, building top, -
  varying vec3 vLocal;
  varying vec3 vNormalL;
  varying vec3 vCity;
  varying vec4 vInfo;
  void main() {
    vLocal = position * aDims.xyz;
    vLocal.y += aDims.w;
    vNormalL = normal;
    vInfo = aInfo;
    vec4 c = instanceMatrix * vec4(position, 1.0);
    vCity = c.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * c;
  }
`

export const buildingFragment = /* glsl */ `
  ${common}
  varying vec3 vLocal;
  varying vec3 vNormalL;
  varying vec3 vCity;
  varying vec4 vInfo;

  void main() {
    float seed = vInfo.x * 10000.0;
    int style = int(vInfo.y + 0.5);
    float top = vInfo.z;
    vec3 n = normalize(vNormalL);
    vec3 col;

    if (n.y > 0.5 || style == 3) {
      // Roofs and spires: near-black with a faint sky sheen
      col = vec3(0.010, 0.011, 0.015) + uHaze * 0.05;
    } else {
      float face = abs(n.x) > 0.5 ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
      float u = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
      float v = vLocal.y;

      // Facade layout per style: cell size (m), window fraction, share lit
      vec2 cell = vec2(3.4, 3.1); vec2 win = vec2(0.52, 0.5); float share = 0.05 + 0.17 * hash(vec3(seed, 1, 0));
      vec3 lamp = mix(vec3(1.0, 0.52, 0.22), vec3(1.0, 0.76, 0.48), hash(vec3(seed, 2, 0)));
      vec3 wall = vec3(0.018, 0.016, 0.017);
      if (style == 1) {
        cell = vec2(1.7, 3.9); win = vec2(0.88, 0.64); share = 0.03 + 0.2 * hash(vec3(seed, 1, 0));
        lamp = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.9, 0.72), hash(vec3(seed, 2, 0)));
        wall = vec3(0.01, 0.013, 0.02) + uHaze * 0.06 * (1.0 - v / max(top, 1.0));
      } else if (style == 2) {
        cell = vec2(1.3, 3.6); win = vec2(0.42, 0.78); share = 0.03 + 0.1 * hash(vec3(seed, 1, 0));
        lamp = mix(vec3(1.0, 0.7, 0.4), vec3(0.85, 0.9, 1.0), step(0.5, hash(vec3(seed, 2, 0))));
        wall = vec3(0.01, 0.01, 0.012);
      }

      // Late at night: a fair share of buildings are almost dark
      share *= mix(0.25, 1.0, step(0.3, hash(vec3(seed, 8, 0))));

      vec2 c = vec2(u, v) / cell;
      vec2 id = floor(c);
      vec2 fr = fract(c);
      vec2 fw = fwidth(c);
      vec2 lo = 0.5 - win * 0.5, hi = 0.5 + win * 0.5;
      vec2 m2 = smoothstep(lo - fw, lo + fw, fr) - smoothstep(hi - fw, hi + fw, fr);
      float mask = m2.x * m2.y;

      // Offices light whole floors; homes window by window
      float r = style == 1 ? hash(vec3(id.y, seed, face)) * 0.6 + hash(vec3(id, seed + face)) * 0.4
                           : hash(vec3(id, seed + face * 31.0));
      float lit = step(r, share);
      // Some windows switch on and off over a minute or two
      float r2 = hash(vec3(id + 17.0, seed * 0.37 + face));
      if (r2 < 0.14) {
        float period = 40.0 + r2 * 900.0;
        lit = step(0.45, fract(uTime / period + r2 * 13.7)) * step(r, share * 1.8);
      }
      float glow = (0.55 + 0.9 * hash(vec3(id, seed + 5.0))) * (0.8 + 0.4 * fr.y);
      vec3 wc = lamp * glow;
      // A few TVs flickering blue
      if (hash(vec3(id, seed + 9.0)) < 0.012) {
        float tv = 0.55 + 0.45 * sin(uTime * 7.0 + r * 50.0) * sin(uTime * 2.3 + r2 * 20.0);
        wc = vec3(0.35, 0.5, 1.0) * tv; lit = 1.0;
      }
      vec3 glass = wall * 1.6 + uHaze * 0.04;
      vec3 near = mix(wall, glass, mask) + wc * lit * mask * 1.35;
      // Windows smaller than a pixel would shimmer: first fall back to lit
      // groups of windows (keeps the city sparkling), then to a dim average
      float px = max(fw.x, fw.y);
      vec2 gid = floor(c / vec2(5.0, 1.0));
      float gl = step(hash(vec3(gid, seed + face * 7.0)), share * 0.6);
      vec3 warmLamp = mix(lamp, vec3(1.0, 0.62, 0.32), 0.5);
      vec3 mid = wall + warmLamp * gl * (0.35 + 0.65 * hash(vec3(gid, seed + 3.0))) * win.x * 0.9;
      vec3 far = wall + warmLamp * share * win.x * win.y * 0.22;
      col = mix(near, mid, smoothstep(0.35, 0.9, px));
      col = mix(col, far, smoothstep(0.5, 1.2, fw.y));

      // Shops at street level
      float shop = (1.0 - smoothstep(0.0, 5.0, v)) * step(hash(vec3(seed, face, 3)), 0.3);
      col += mix(vec3(1.0, 0.62, 0.3), vec3(0.7, 0.85, 1.0), hash(vec3(seed, face, 4))) * shop * 0.5;

      // Floodlit crowns on the tall towers; one of them slowly changes colour
      if (top > 170.0 && hash(vec3(seed, 5, 0)) < 0.3) {
        float hc = hash(vec3(seed, 6, 0));
        vec3 crown = hc < 0.65 ? vec3(1.0, 0.85, 0.65) : vec3(0.55, 0.85, 1.0);
        if (hash(vec3(seed, 7, 0)) < 0.2) crown = 0.6 + 0.35 * cos(6.2832 * (uTime * 0.012 + vec3(0.0, 0.33, 0.67)));
        float up = pow(smoothstep(top - 30.0, top, v), 4.0) * 0.1 + smoothstep(top - 1.5, top - 0.5, v) * 0.25;
        col += crown * up;
      }
    }

    col = haze(col, vCity);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const groundVertex = /* glsl */ `
  varying vec3 vCity;
  void main() {
    vCity = position; // the plane is authored in city space
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const groundFragment = /* glsl */ `
  ${common}
  varying vec3 vCity;

  void main() {
    vec2 p = vCity.xz;
    vec2 g = toGrid(p);
    vec2 cg = g / PITCH;
    vec2 ds = abs(fract(cg) - 0.5) * PITCH; // metres from the street centre line
    vec2 fwp = fwidth(g);
    vec2 st = 1.0 - smoothstep(STREET * 0.5 - fwp, STREET * 0.5 + fwp, ds);
    float street = max(st.x, st.y);
    float lod = smoothstep(0.08, 0.3, max(fwidth(cg).x, fwidth(cg).y));

    // Blocks: dark with the odd lit courtyard or car park
    vec3 col = vec3(0.012, 0.011, 0.011);
    col += vec3(1.0, 0.7, 0.4) * step(0.997, hash(vec3(floor(p / 9.0), 2.0))) * 0.6 * (1.0 - lod);
    // Streets: sodium light pools along the kerbs
    float kerb = exp(-pow((min(ds.x, ds.y) - STREET * 0.5 + 2.5) / 4.0, 2.0));
    vec3 road = vec3(0.03, 0.022, 0.016) + vec3(1.0, 0.55, 0.22) * (0.07 + 0.22 * kerb);
    vec3 roadAvg = vec3(1.0, 0.55, 0.22) * 0.06 * (STREET / PITCH) * 2.0;
    col = mix(mix(col, road, street), col + roadAvg, lod);

    // River: dark water with shimmering reflections and lit embankments
    float dz = abs(p.y - riverZ(p.x));
    if (dz < RIVER_HALF) {
      vec2 w = vec2(p.x * 0.045, p.y * 0.35 + uTime * 0.22);
      float ripple = noise(w) * noise(w * 2.7 + uTime * 0.1);
      vec3 water = vec3(0.008, 0.012, 0.02) + uHaze * 0.35 * (0.4 + ripple);
      float glint = step(0.93, hash(vec3(floor(vec2(p.x / 3.0, p.y / 1.2 + uTime * 0.6)), 4.0)));
      water += mix(vec3(1.0, 0.6, 0.3), vec3(0.7, 0.8, 1.0), hash(vec3(floor(p.x / 40.0), 5, 0))) * glint * ripple * 1.2;
      col = mix(water, col, street * 0.9); // bridges keep their deck
    }
    float bank = exp(-pow((dz - RIVER_HALF) / 2.5, 2.0));
    float bankLamps = step(0.5, fract(p.x / 22.0)) * bank;
    col += vec3(1.0, 0.72, 0.42) * mix(bankLamps * 1.5, bank * 0.4, lod);

    col = haze(col, vCity);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const skyFragment = /* glsl */ `
  ${common}
  uniform vec3 uMoon;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 zenith = vec3(0.003, 0.005, 0.016);
    vec3 mid = vec3(0.012, 0.018, 0.045);
    vec3 col = mix(uHaze * 1.05, mid, smoothstep(0.0, 0.2, h));
    col = mix(col, zenith, smoothstep(0.2, 0.75, h));
    if (h < 0.0) col = uHaze;

    // Stars, hidden by the glow near the horizon
    vec3 sp = d * 380.0;
    vec3 cell = floor(sp);
    float sr = hash(cell);
    float star = step(0.9965, sr) * smoothstep(0.35, 0.05, length(fract(sp) - 0.5));
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + sr * 3.0) + sr * 80.0);
    col += vec3(0.8, 0.85, 1.0) * star * tw * (sr - 0.9965) * 350.0 * smoothstep(0.08, 0.4, h);

    // Moon with halo
    float mc = dot(d, uMoon);
    float disc = smoothstep(0.99988, 0.99992, mc);
    vec2 mp = (d - uMoon * mc).xy * 900.0;
    float maria = 0.82 + 0.18 * noise(mp * 0.9);
    col += vec3(1.0, 0.97, 0.9) * disc * 3.2 * maria;
    col += vec3(0.55, 0.62, 0.85) * (pow(max(mc, 0.0), 3000.0) * 0.35 + pow(max(mc, 0.0), 60.0) * 0.03);

    // Drifting clouds, lit orange from below by the city
    if (h > 0.0) {
      vec2 cp = d.xz / (h + 0.06) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
      float cl = fbm(cp);
      float dens = smoothstep(0.52, 0.85, cl) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.45, 0.9, h));
      vec3 cloud = mix(uHaze * 1.6, vec3(0.02, 0.022, 0.035), smoothstep(0.02, 0.35, h));
      cloud += vec3(0.5, 0.55, 0.7) * pow(max(mc, 0.0), 30.0) * 0.25; // moonlit edges
      col = mix(col, cloud, dens * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// Glowing points: cars, street lamps, aviation beacons and aircraft.
// Positions are computed on the GPU so the lights move without CPU work.
export const lightsVertex = /* glsl */ `
  ${common}
  uniform float uProj;  // pixels per unit at distance 1
  uniform float uUnit;  // world units per metre
  attribute vec4 aA;    // meaning depends on aKind
  attribute vec4 aB;
  attribute vec3 aColor;
  attribute float aKind; // 0 static, 1 car, 2 beacon, 3 aircraft
  varying vec3 vColor;

  void main() {
    vec3 p = position;
    float size = aB.w;
    float k = 1.0;
    if (aKind > 0.5 && aKind < 1.5) {
      // Car: aA = (axis, line, lane offset, direction); aB = (speed, phase, length, size)
      float along = (mod(aB.y + aB.x * uTime, aB.z) - aB.z * 0.5) * aA.w;
      vec2 g = aA.x < 0.5 ? vec2(aA.y + aA.z, along) : vec2(along, aA.y + aA.z);
      vec2 xz = fromGrid(g);
      p = vec3(xz.x, -EYE + 1.0, xz.y);
      float dist = length(xz);
      k = step(0.0, xz.x) * (1.0 - smoothstep(2200.0, 2600.0, dist)) * step(120.0, dist);
      // Traffic lights: cars on one axis pause now and then
      k *= 0.85 + 0.15 * sin(uTime * 0.7 + aB.y);
    } else if (aKind > 1.5 && aKind < 2.5) {
      // Beacon: aA.x = phase; slow red pulse
      k = 0.15 + 0.85 * pow(max(0.0, sin(uTime * 2.4 + aA.x * 6.2832)), 8.0);
    } else if (aKind > 2.5) {
      // Aircraft: aA = (centre x, altitude, centre z, speed); aB = (dir x, dir z, span, size);
      // position = (wing offset, strobe flag, nose offset)
      vec2 dir = normalize(aB.xy);
      float t = mod(uTime * aA.w, aB.z) - aB.z * 0.5;
      vec2 side = vec2(-dir.y, dir.x);
      p = vec3(aA.x + dir.x * t + side.x * position.x, aA.y, aA.z + dir.y * t + side.y * position.x);
      p.xz += dir * position.z;
      float strobe = position.y; // 0 steady, 1 strobe
      k = strobe > 0.5 ? step(0.92, fract(uTime * 0.9 + position.x * 0.01)) * 2.5 : 1.0;
    }
    vColor = aColor * k * exp(-length(p) * 0.00028); // dim with the haze
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
