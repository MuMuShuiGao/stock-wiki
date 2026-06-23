/**
 * 自定义 Sigma v3 节点渲染程序 — 光环 + 径向渐变
 *
 * 相比默认 NodeCircleProgram（纯色圆）：
 * - 内层径向渐变（中心微亮 → 边缘固有色）
 * - 外围光环环带（lighter 色，模拟发光边框）
 * - 平滑抗锯齿
 */
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { NodeProgram } from "sigma/rendering";
import { floatColor } from "sigma/utils";

// language=GLSL
const VERTEX_SHADER = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

const float bias = 255.0 / 254.0;
const float RING_SCALE = 1.22;

void main() {
  float totalSize = a_size * u_correctionRatio / u_sizeRatio * 4.0 * RING_SCALE;
  vec2 diffVector = totalSize * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );
  v_diffVector = diffVector;
  v_radius = totalSize / (2.0 * RING_SCALE);

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

// language=GLSL
const FRAGMENT_SHADER = /*glsl*/ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector);

  // 环带范围（相对于主圆半径）
  float ringInner = v_radius * 0.86;
  float ringOuter = v_radius * 1.16;

  #ifdef PICKING_MODE
  // 拾取模式：整个放大区域可点选
  if (dist < ringOuter + border)
    gl_FragColor = v_color;
  else
    discard;

  #else
  // ── 填充：径向渐变（中心亮 → 边缘固有色） ──
  float fillGrad = 1.0 + (1.0 - dist / v_radius) * 0.18;
  vec3 fillColor = v_color.rgb * clamp(fillGrad, 0.85, 1.20);

  // ── 光环：半透明亮色环带 ──
  float ringT = smoothstep(ringInner - border, ringInner + border, dist)
              * (1.0 - smoothstep(ringOuter - border, ringOuter + border, dist));
  vec3 ringColor = mix(v_color.rgb, vec3(1.0), 0.35);

  // ── 混合填充 & 光环 ──
  float fillAlpha = 1.0 - smoothstep(ringInner - border * 0.5, ringInner + border * 0.5, dist);
  float ringAlpha = ringT;
  float alpha = max(fillAlpha, ringAlpha);
  vec3 color = mix(fillColor, ringColor, ringAlpha / max(alpha, 0.001));

  gl_FragColor = vec4(color, alpha * v_color.a);
  #endif
}
`;

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_matrix"] as const;

export default class RingNodeProgram extends NodeProgram<
  (typeof UNIFORMS)[number]
> {
  static readonly ANGLE_1 = 0;
  static readonly ANGLE_2 = (2 * Math.PI) / 3;
  static readonly ANGLE_3 = (4 * Math.PI) / 3;

  getDefinition() {
    return {
      VERTICES: 3,
      VERTEX_SHADER_SOURCE: VERTEX_SHADER,
      FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
      METHOD: TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
      CONSTANT_DATA: [
        [RingNodeProgram.ANGLE_1],
        [RingNodeProgram.ANGLE_2],
        [RingNodeProgram.ANGLE_3],
      ],
    };
  }

  processVisibleItem(
    nodeIndex: number,
    startIndex: number,
    data: NodeDisplayData,
  ): void {
    const array = this.array;
    const color = floatColor(data.color);
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = color;
    array[startIndex++] = nodeIndex;
  }

  setUniforms(
    params: RenderParams,
    { gl, uniformLocations }: { gl: WebGLRenderingContext; uniformLocations: Record<string, WebGLUniformLocation> },
  ): void {
    gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
    gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
    gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
  }
}
