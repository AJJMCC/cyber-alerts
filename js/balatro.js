/* Balatro background: vanilla WebGL port of the React Bits component.
   Draws into #iri. Falls back to the CSS gradient on .pool if WebGL is unavailable. */
(function () {
  var cv = document.getElementById('iri');
  if (!cv) return;
  var gl = cv.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) return;

  var P = { color1: '#ae3c74', color2: '#48dccb', color3: '#162325', swirl: 0.25, pixelSize: 4.5,
    contrast: 4.2, lighting: 0.25, speed: 0.4, rotationSpeed: 0.025 };

  function rgb(h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }

  var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var fs = [
    'precision highp float;',
    'uniform float uTime,uSpin,uSpinSpeed,uSwirl,uPixel,uContrast,uLight;',
    'uniform vec3 uC1,uC2,uC3;uniform vec2 uRes;',
    'void main(){',
    ' float len=length(uRes);',
    ' float ps=len/uPixel;',
    ' vec2 uv=(floor(gl_FragCoord.xy/ps)*ps-.5*uRes)/len;',
    ' float ul=length(uv);',
    ' float sp=uTime*uSpin*.2+302.2;',
    ' float ang=atan(uv.y,uv.x)+sp-20.*(uSwirl*ul+(1.-uSwirl));',
    ' vec2 mid=(uRes/len)/2.;',
    ' uv=vec2(ul*cos(ang)+mid.x,ul*sin(ang)+mid.y)-mid;',
    ' uv*=30.;',
    ' float s=uTime*uSpinSpeed;',
    ' vec2 uv2=vec2(uv.x+uv.y);',
    ' for(int i=0;i<5;i++){',
    '  uv2+=sin(max(uv.x,uv.y))+uv;',
    '  uv+=.5*vec2(cos(5.1123314+.353*uv2.y+s*.131121),sin(uv2.x-.113*s));',
    '  uv-=cos(uv.x+uv.y)-sin(uv.x*.711-uv.y);}',
    ' float cm=.25*uContrast+.5*uSwirl+1.2;',
    ' float pr=min(2.,max(0.,length(uv)*.035*cm));',
    ' float c1=max(0.,1.-cm*abs(1.-pr));',
    ' float c2=max(0.,1.-cm*abs(pr));',
    ' float c3=1.-min(1.,c1+c2);',
    ' float li=(uLight-.2)*max(c1*5.-4.,0.)+uLight*max(c2*5.-4.,0.);',
    ' vec3 col=(.3/uContrast)*uC1+(1.-.3/uContrast)*(uC1*c1+uC2*c2+uC3*c3)+li;',
    ' gl_FragColor=vec4(clamp(col,0.,1.),1.);}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return;
  var pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uTime', 'uSpin', 'uSpinSpeed', 'uSwirl', 'uPixel', 'uContrast', 'uLight', 'uC1', 'uC2', 'uC3', 'uRes']
    .forEach(function (n) { U[n] = gl.getUniformLocation(pr, n); });
  gl.uniform3fv(U.uC1, rgb(P.color1)); gl.uniform3fv(U.uC2, rgb(P.color2)); gl.uniform3fv(U.uC3, rgb(P.color3));
  gl.uniform1f(U.uSwirl, P.swirl);
  gl.uniform1f(U.uPixel, 745 / P.pixelSize);
  gl.uniform1f(U.uContrast, P.contrast);
  gl.uniform1f(U.uLight, P.lighting);
  gl.uniform1f(U.uSpinSpeed, 7 * P.speed);
  gl.uniform1f(U.uSpin, -2 * P.rotationSpeed * 10);

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    var q = 0.5; /* chunky pixels anyway, so render small to stay light */
    cv.width = Math.max(2, Math.round(innerWidth * q));
    cv.height = Math.max(2, Math.round(innerHeight * q));
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(U.uRes, cv.width, cv.height);
  }
  addEventListener('resize', resize); resize();

  var t0 = performance.now(), raf = 0;
  function frame(now) {
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = still ? 0 : requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', function () {
    if (still) return;
    if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame);
  });
  cv.classList.add('on');
})();
