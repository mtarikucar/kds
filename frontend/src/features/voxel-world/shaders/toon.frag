// Toon Shader - Fragment Shader
// TinyGlade/Townscaper-inspired stylized rendering

uniform vec3 baseColor;
uniform vec3 shadowColor;
uniform vec3 highlightColor;
uniform vec3 ambientColor;
uniform vec3 lightDirection;
uniform float ambientOcclusionStrength;
uniform float shadowSoftness;
uniform float rimStrength;
uniform float saturationBoost;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vViewPosition;
varying vec2 vUv;

// Soft step function for smoother toon shading
float softStep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Calculate ambient occlusion based on height
float calculateAO(vec3 position) {
  float heightAO = softStep(0.0, 0.5, position.y);
  return mix(1.0 - ambientOcclusionStrength, 1.0, heightAO);
}

// Boost color saturation
vec3 adjustSaturation(vec3 color, float saturation) {
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(gray), color, saturation);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 lightDir = normalize(lightDirection);
  vec3 viewDir = normalize(vViewPosition);

  // Basic diffuse lighting with soft transition
  float NdotL = dot(normal, lightDir);
  float diffuse = softStep(-shadowSoftness, shadowSoftness, NdotL);

  // Two-tone toon shading
  vec3 litColor = mix(shadowColor, baseColor, diffuse);

  // Add highlight on bright areas
  float highlight = softStep(0.7, 0.9, NdotL);
  litColor = mix(litColor, highlightColor, highlight * 0.3);

  // Ambient occlusion
  float ao = calculateAO(vPosition);
  litColor *= ao;

  // Add ambient light
  litColor += ambientColor * 0.3;

  // Rim lighting (fresnel effect)
  float rim = 1.0 - max(0.0, dot(normal, viewDir));
  rim = pow(rim, 3.0) * rimStrength;
  litColor += vec3(1.0) * rim * 0.2;

  // Boost saturation for more vibrant look
  litColor = adjustSaturation(litColor, 1.0 + saturationBoost);

  // Warm color tint (TinyGlade style)
  vec3 warmTint = vec3(1.0, 0.98, 0.95);
  litColor *= warmTint;

  gl_FragColor = vec4(litColor, 1.0);
}
