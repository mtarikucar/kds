// Toon Shader - Vertex Shader
// TinyGlade/Townscaper-inspired stylized rendering

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vPosition = (modelMatrix * vec4(position, 1.0)).xyz;

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  vUv = uv;

  gl_Position = projectionMatrix * mvPosition;
}
