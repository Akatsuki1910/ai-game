import { defaultFilterVert, Filter, GlProgram, UniformGroup } from "pixi.js";

// 背景を彩る自作 GLSL シェーダ。時間経過で揺らめくオーロラ風グラデーション。
// テクスチャサンプリングを一切使わず vTextureCoord と uTime だけで色を作るため、
// フィルタのバウンディングボックスやパディングの影響を受けず安定して描画できる。
const backgroundFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform float uTime;

void main(void)
{
    vec2 uv = vTextureCoord;

    float wave1 = sin(uv.x * 5.0 + uTime * 0.5) * 0.5 + 0.5;
    float wave2 = sin((uv.x - uv.y) * 4.0 - uTime * 0.35) * 0.5 + 0.5;
    float wave3 = sin(uv.y * 7.0 + uTime * 0.25) * 0.5 + 0.5;

    vec3 colorA = vec3(0.02, 0.03, 0.06);
    vec3 colorB = vec3(0.05, 0.14, 0.20);
    vec3 colorC = vec3(0.10, 0.30, 0.28);

    vec3 col = mix(colorA, colorB, wave1 * (0.4 + 0.6 * uv.y));
    col = mix(col, colorC, wave2 * wave3 * 0.35);

    float vignette = smoothstep(1.1, 0.15, distance(uv, vec2(0.18, 0.5)));
    col *= mix(0.55, 1.0, vignette);

    finalColor = vec4(col, 1.0);
}
`;

export interface BackgroundFilter extends Filter {
  time: number;
}

export function createBackgroundFilter(): BackgroundFilter {
  const glProgram = GlProgram.from({
    vertex: defaultFilterVert,
    fragment: backgroundFragment,
    name: "prism-drift-background-filter",
  });

  const timeUniforms = new UniformGroup({
    uTime: { value: 0, type: "f32" },
  });

  const filter = new Filter({
    glProgram,
    resources: { timeUniforms },
  }) as BackgroundFilter;

  Object.defineProperty(filter, "time", {
    get() {
      return timeUniforms.uniforms.uTime;
    },
    set(value: number) {
      timeUniforms.uniforms.uTime = value;
    },
  });

  return filter;
}
