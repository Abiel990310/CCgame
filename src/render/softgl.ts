/** Whether the browser is drawing WebGL on the CPU, where Canvas is the faster of the two. */
export function softwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

let probed: boolean | null = null;

/**
 * Whether this browser has no graphics card to composite with. Without one,
 * every full-screen blended layer is a pass over every pixel on the CPU.
 * Asked once and remembered, since it cannot change while the page is open.
 */
export function compositesInSoftware(): boolean {
  if (probed !== null) return probed;
  probed = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    probed = !gl || softwareGl(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    probed = true;
  }
  return probed;
}
