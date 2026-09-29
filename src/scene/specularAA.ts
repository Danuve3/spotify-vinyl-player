import * as THREE from 'three'

// Specular anti-aliasing for normal-mapped surfaces. three.js already widens
// the highlight where the *geometry* normal changes within a pixel; this also
// accounts for the perturbed normal (brushed metal, fabric), so sub-pixel
// highlights spread out instead of flickering from pixel to pixel as the
// camera moves. Import once, before any material compiles.

const anchor = 'material.roughness += geometryRoughness;'
const chunk = THREE.ShaderChunk.lights_physical_fragment
if (chunk.includes(anchor) && !chunk.includes('normalRoughness')) {
  THREE.ShaderChunk.lights_physical_fragment = chunk.replace(
    anchor,
    `${anchor}
vec3 nDxy = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
float normalRoughness = max( max( nDxy.x, nDxy.y ), nDxy.z );
material.roughness += normalRoughness * 0.5;`,
  )
}
