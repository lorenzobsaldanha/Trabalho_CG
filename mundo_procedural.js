"use strict";

var vertexShaderSource = `#version 300 es
in vec4 a_position;
in vec4 a_color;        // Novo atributo de cor
in vec3 a_normal; 

uniform mat4 u_matrix;
uniform mat4 u_world;

out vec4 v_color;       // Variável de saída para o fragment shader
out vec3 v_normal;

void main() {
  gl_Position = u_matrix * a_position;
  v_color = a_color;    // Passa a cor adiante
  v_normal = mat3(u_world) * a_normal;
}
`;

var fragmentShaderSource = `#version 300 es
precision highp float;
in vec4 v_color;        // Cor recebida do vertex shader
in vec3 v_normal;

uniform vec3 u_lightDirection;
out vec4 outColor;

void main() {
vec3 normal = normalize(v_normal);
float light = dot(normal, normalize(u_lightDirection));

  outColor = v_color;
  outColor.rgb *= max(light, 0.2);
}
`;

function drawTree(gl, meshProgramInfo, parts, worldMatrix, treeData, projectionMatrix) {
  
  let treePos = treeData.pos;
  let treeNormal = treeData.normal;
  let u_world = m4.multiply(worldMatrix, m4.translation(treePos[0], treePos[1], treePos[2]));
  
  let len = Math.sqrt(treeNormal[0]**2 + treeNormal[1]**2 + treeNormal[2]**2);
  let up = [treeNormal[0]/len, treeNormal[1]/len, treeNormal[2]/len];
  let target = treeNormal;
  let eye = [0, 0, 1];
  let lookAtMatrix = twgl.m4.lookAt(eye, target, up);
  
  u_world = m4.multiply(u_world, lookAtMatrix);
  u_world = m4.scale(u_world, 4.9, 4.9, 4.9); 

  const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

  for (const {bufferInfo, vao, material} of parts) {
    gl.bindVertexArray(vao);
    twgl.setUniforms(meshProgramInfo, {
      u_projection: projectionMatrix,  
      u_view: identity,                
      u_world: u_world,
      u_diffuse: material.u_diffuse,
      u_lightDirection: [-37.5, 5, -20.0],
    });
    twgl.drawBufferInfo(gl, bufferInfo);
  }
}

function isTreeVisible(treeData, worldMatrix) {
  let n = treeData.normal;
  let worldNormal = [
    worldMatrix[0]*n[0] + worldMatrix[4]*n[1] + worldMatrix[8]*n[2],
    worldMatrix[1]*n[0] + worldMatrix[5]*n[1] + worldMatrix[9]*n[2],
    worldMatrix[2]*n[0] + worldMatrix[6]*n[1] + worldMatrix[10]*n[2],
  ];

  let cameraDir = [0, 0, 1];
  let dot = worldNormal[0]*cameraDir[0] 
           + worldNormal[1]*cameraDir[1] 
           + worldNormal[2]*cameraDir[2];

  return dot > 0;
}

function parseOBJ(text) {
  const objPositions = [[0, 0, 0]];
  const objTexcoords = [[0, 0]];
  const objNormals = [[0, 0, 0]];

  const objVertexData = [
    objPositions,
    objTexcoords,
    objNormals,
  ];

  let webglVertexData = [
    [],   
    [],   
    [],  
  ];

  const materialLibs = [];
  const geometries = [];
  let geometry;
  let groups = ['default'];
  let material = 'default';
  let object = 'default';

  const noop = () => {};

  function newGeometry() {
    if (geometry && geometry.data.position.length) {
      geometry = undefined;
    }
  }

  function setGeometryOBJ() {
    if (!geometry) {
      const position = [];
      const texcoord = [];
      const normal = [];
      webglVertexData = [
        position,
        texcoord,
        normal,
      ];
      geometry = {
        object,
        groups,
        material,
        data: {
          position,
          texcoord,
          normal,
        },
      };
      geometries.push(geometry);
    }
  }

  function addVertex(vert) {
    const ptn = vert.split('/');
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) {
        return;
      }
      const objIndex = parseInt(objIndexStr);
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
    });
  }

  const keywords = {
    v(parts) {
      objPositions.push(parts.map(parseFloat));
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      objTexcoords.push(parts.map(parseFloat));
    },
    f(parts) {
      setGeometryOBJ();
      const numTriangles = parts.length - 2;
      for (let tri = 0; tri < numTriangles; ++tri) {
        addVertex(parts[0]);
        addVertex(parts[tri + 1]);
        addVertex(parts[tri + 2]);
      }
    },
    s: noop,    
    mtllib(parts, unparsedArgs) {
      materialLibs.push(unparsedArgs);
    },
    usemtl(parts, unparsedArgs) {
      material = unparsedArgs;
      newGeometry();
    },
    g(parts) {
      groups = parts;
      newGeometry();
    },
    o(parts, unparsedArgs) {
      object = unparsedArgs;
      newGeometry();
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      console.warn('unhandled keyword:', keyword);  
      continue;
    }
    handler(parts, unparsedArgs);
  }

  for (const geometry of geometries) {
    geometry.data = Object.fromEntries(
        Object.entries(geometry.data).filter(([, array]) => array.length > 0));
  }

  return {
    geometries,
    materialLibs,
  };
}

function parseMTL(text) {
  const materials = {};
  let material;

  const keywords = {
    newmtl(parts, unparsedArgs) {
      material = {};
      materials[unparsedArgs] = material;
    },
    Kd(parts) {
      material.u_diffuse = [...parts.map(parseFloat), 1];
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      continue;
    }
    handler(parts, unparsedArgs);
  }
  return materials;
}

function simpleNoise(x, y, z) {
    let n = Math.sin(x * 1.) * Math.cos(y * 1.) * Math.sin(z * 1.);
    return (n + 1) / 2; 
};

function randomNoise() {
    let n = Math.sin(Math.random()) * Math.cos(Math.random()) * Math.sin(Math.random());
    return n ; 
};

var treeLocations = []; 

async function main() {
  // Get A WebGL context
  /** @type {HTMLCanvasElement} */
  var canvas = document.querySelector("#canvas");
  var gl = canvas.getContext("webgl2");
  if (!gl) {
    return;
  }

  twgl.setAttributePrefix("a_");

  const treeVs = `#version 300 es
  in vec4 a_position;
  in vec3 a_normal;
  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;
  out vec3 v_normal;
  void main() {
    gl_Position = u_projection * u_view * u_world * a_position;
    v_normal = mat3(u_world) * a_normal;
  }
`;

const treeFs = `#version 300 es
  precision highp float;
  in vec3 v_normal;
  uniform vec4 u_diffuse;
  uniform vec3 u_lightDirection;
  out vec4 outColor;
  void main () {
    vec3 normal = normalize(v_normal);
    float light = dot(normalize(u_lightDirection), normal) * .5 + .5;
    outColor = vec4(u_diffuse.rgb * light, u_diffuse.a);
  }
`;

  gl.enable(gl.DEPTH_TEST); 
  gl.enable(gl.CULL_FACE);

  // Use our boilerplate utils to compile the shaders and link into a program
  var program = webglUtils.createProgramFromSources(gl,
      [vertexShaderSource, fragmentShaderSource]);

  // look up where the vertex data needs to go.
  var positionAttributeLocation = gl.getAttribLocation(program, "a_position");
  var normalAttributeLocation = gl.getAttribLocation(program, "a_normal");

  // look up uniform locations
  var colorAttributeLocation = gl.getAttribLocation(program, "a_color");
  var matrixLocation = gl.getUniformLocation(program, "u_matrix");
  var worldLocation = gl.getUniformLocation(program, "u_world");
  var lightDirLocation = gl.getUniformLocation(program, "u_lightDirection");
  // Create a buffer
  var positionBuffer = gl.createBuffer();

  // Create a vertex array object (attribute state)
  var vao = gl.createVertexArray();

  const meshProgramInfo = twgl.createProgramInfo(gl, [treeVs, treeFs]);
  const response = await fetch('treeOBJ.txt');  
  const text = await response.text();
  const obj = parseOBJ(text);

  const mtlResponse = await fetch('treeMTL.txt');
  const mtlText = await mtlResponse.text();
  const materials = parseMTL(mtlText);

  const defaultMaterial = {
    u_diffuse: [1, 1, 1, 1],
  };

  const parts = obj.geometries.map(({data, material}) => {
    const bufferInfo = twgl.createBufferInfoFromArrays(gl, data);
    const vaoOBJ = twgl.createVAOFromBufferInfo(gl, meshProgramInfo, bufferInfo);
    const materialData = materials[material] || defaultMaterial;
    return {
      material: { u_diffuse: materialData.u_diffuse },
      bufferInfo,
      vao: vaoOBJ,
    };
});

  // and make it the one we're currently working with
  gl.bindVertexArray(vao);

  // Turn on the attribute
  gl.enableVertexAttribArray(positionAttributeLocation);

  // Bind it to ARRAY_BUFFER (think of it as ARRAY_BUFFER = positionBuffer)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  
  // Set Geometry.
  let noise = "perlinNoise";
  var numVertices = setGeometry(gl, colorAttributeLocation, normalAttributeLocation, noise);

  
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
  var size = 3;          // 3 components per iteration
  var type = gl.FLOAT;   // the data is 32bit floats
  var normalize = false; // don't normalize the data
  var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
  var offset = 0;        // start at the beginning of the buffer
  gl.vertexAttribPointer(
      positionAttributeLocation, size, type, normalize, stride, offset);

  function radToDeg(r) {
    return r * 180 / Math.PI;
  }

  function degToRad(d) {
    return d * Math.PI / 180;
  }

  // First let's make some variables
  // to hold the translation,
  var translation = [200, 200, 0];
  var rotation = [degToRad(40), degToRad(25), degToRad(325)];
  var scale = [1, 1, 1];

  drawScene();

  // Setup a ui.
  webglLessonsUI.setupSlider("#x",      {value: translation[0], slide: updatePosition(0), max: gl.canvas.width });
  webglLessonsUI.setupSlider("#y",      {value: translation[1], slide: updatePosition(1), max: gl.canvas.height});
  webglLessonsUI.setupSlider("#z",      {value: translation[2], slide: updatePosition(2), max: gl.canvas.height});
  webglLessonsUI.setupSlider("#angleX", {value: radToDeg(rotation[0]), slide: updateRotation(0), max: 360});
  webglLessonsUI.setupSlider("#angleY", {value: radToDeg(rotation[1]), slide: updateRotation(1), max: 360});
  webglLessonsUI.setupSlider("#angleZ", {value: radToDeg(rotation[2]), slide: updateRotation(2), max: 360});
  webglLessonsUI.setupSlider("#scaleX", {value: scale[0], slide: updateScale(0), min: -5, max: 5, step: 0.01, precision: 2});
  webglLessonsUI.setupSlider("#scaleY", {value: scale[1], slide: updateScale(1), min: -5, max: 5, step: 0.01, precision: 2});
  webglLessonsUI.setupSlider("#scaleZ", {value: scale[2], slide: updateScale(2), min: -5, max: 5, step: 0.01, precision: 2});

  const selectElement = document.getElementById("noise");
  
  selectElement.addEventListener("change", (event) => {
    noise = event.target.value;

    numVertices = setGeometry(gl, colorAttributeLocation, normalAttributeLocation, noise);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    // Tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
    var size = 3;          // 3 components per iteration
    var type = gl.FLOAT;   // the data is 32bit floats
    var normalize = false; // don't normalize the data
    var stride = 0;        // 0 = move forward size * sizeof(type) each iteration to get the next position
    var offset = 0;        // start at the beginning of the buffer

    gl.vertexAttribPointer(
        positionAttributeLocation, size, type, normalize, stride, offset);
    drawScene();
  });
  
  
  function updatePosition(index) {
    return function(event, ui) {
      translation[index] = ui.value;
      drawScene();
    };
  }

  function updateRotation(index) {
    return function(event, ui) {
      var angleInDegrees = ui.value;
      var angleInRadians = degToRad(angleInDegrees);
      rotation[index] = angleInRadians;
      drawScene();
    };
  }

  function updateScale(index) {
    return function(event, ui) {
      scale[index] = ui.value;
      drawScene();
    };
  }

  // Draw the scene.
  function drawScene() {
    webglUtils.resizeCanvasToDisplaySize(gl.canvas);

    // Tell WebGL how to convert from clip space to pixels
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear the canvas
    gl.clearColor(0.555, 0.75, 0.8, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Tell it to use our program (pair of shaders)
    gl.useProgram(program);

    // Bind the attribute/buffer set we want.
    gl.bindVertexArray(vao);

    var matrix = m4.projection(gl.canvas.clientWidth, gl.canvas.clientHeight, 400);
    matrix = m4.translate(matrix, translation[0], translation[1], translation[2]);
    matrix = m4.xRotate(matrix, rotation[0]);
    matrix = m4.yRotate(matrix, rotation[1]);
    matrix = m4.zRotate(matrix, rotation[2]);
    matrix = m4.scale(matrix, scale[0], scale[1], scale[2]);

    var worldMatrix = m4.translation(translation[0], translation[1], translation[2]);
    worldMatrix = m4.xRotate(worldMatrix, rotation[0]);
    worldMatrix = m4.yRotate(worldMatrix, rotation[1]);
    worldMatrix = m4.zRotate(worldMatrix, rotation[2]);
    worldMatrix = m4.scale(worldMatrix, scale[0], scale[1], scale[2]);

    var projectionMatrix = m4.projection(gl.canvas.clientWidth, gl.canvas.clientHeight, 1000);
    var viewProjectionMatrix = m4.multiply(projectionMatrix, worldMatrix);

    gl.uniformMatrix4fv(matrixLocation, false, viewProjectionMatrix);
    gl.uniformMatrix4fv(worldLocation, false, worldMatrix);

    gl.uniform3fv(lightDirLocation, [-37.5, 5, -20.0]); 

    gl.uniformMatrix4fv(matrixLocation, false, matrix);

    // Draw the geometry.
    var primitiveType = gl.TRIANGLES;
    var offset = 0;
    var count = numVertices;
    gl.drawArrays(primitiveType, offset, count);

    // Agora desenha as árvores
    gl.useProgram(meshProgramInfo.program);

    for (const treeData of treeLocations) {
      if (isTreeVisible(treeData, worldMatrix)){
        drawTree(gl, meshProgramInfo, parts, worldMatrix, treeData, projectionMatrix);
      }
    }
  }
}


function setGeometry(gl, colorLocation, normalLocation, noise) {
  treeLocations = [];
  var points = [];
  var colors = [];
  var normals = [];

  var baseRadius = 120;
  var noiseStrength = 40;
  var latBands = 100;
  var longBands = 100;

  function getNormal(p1, p2, p3) {
    let v1 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]];
    let v2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
    let n = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0]
    ];
    let len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
    return [n[0]/len, n[1]/len, n[2]/len];
  }

  function getPointData(latIdx, longIdx) {
    var theta = latIdx * Math.PI / latBands;
    var phi = longIdx * 2 * Math.PI / longBands;

    var ux = Math.cos(phi) * Math.sin(theta);
    var uy = Math.cos(theta);
    var uz = Math.sin(phi) * Math.sin(theta);

    let n;
    switch (noise){
      case "simpleNoise": {
         n = simpleNoise(ux * 5, uy * 5, uz * 5); 
        break;
      };
      case "randomNoise": {
         n = randomNoise();
        break;
      };
      case "perlinNoise": {
        let freq = 1 + (Math.random()*0.001);
         n = perlinNoise(ux * freq, uy * freq, uz * freq);
         n = (n + 1) * 0.5;
        break;
      };
      default: {
         n = simpleNoise(ux * 5, uy * 5, uz * 5); 
        break;
      };
    };

    let currentRadius = baseRadius + (n * noiseStrength);
    let pos = [ux * currentRadius, uy * currentRadius, uz * currentRadius];

    let color;
    if (n < 0.4)      color = [0.1, 0.3, 0.8, 1]; // Oceano Profundo (Azul)
    else if (n < 0.5) color = [0.2, 0.5, 1.0, 1]; // Águas Rasas (Ciano)
    else if (n < 0.55)color = [0.9, 0.9, 0.6, 1]; // Areia/Praia (Amarelo)
    else if (n < 0.7) color = [0.2, 0.7, 0.2, 1]; // Floresta (Verde)
    else if (n < 0.85)color = [0.5, 0.4, 0.3, 1]; // Montanha (Marrom)
    else              color = [1.0, 1.0, 1.0, 1]; // Neve (Branco)

    let isForest = (n >= 0.55 && n < 0.7);

    if (isForest && Math.random() > 0.98) { 
      treeLocations.push({
        pos: pos,
        normal: [ux, uy, uz]
      });
    }

    return { pos, color };
  }

  for (var lat = 0; lat < latBands; lat++) {
    for (var lon = 0; lon < longBands; lon++) {
      let data1 = getPointData(lat, lon);
      let data2 = getPointData(lat + 1, lon);
      let data3 = getPointData(lat, lon + 1);
      let data4 = getPointData(lat + 1, lon + 1);

      // Triângulo 1
      let n1 = getNormal(data1.pos, data2.pos, data3.pos);
      points.push(...data1.pos, ...data2.pos, ...data3.pos);
      colors.push(...data1.color, ...data2.color, ...data3.color);
      normals.push(...n1, ...n1, ...n1);
      // Triângulo 2
      let n2 = getNormal(data3.pos, data2.pos, data4.pos);
      points.push(...data3.pos, ...data2.pos, ...data4.pos);
      colors.push(...data3.color, ...data2.color, ...data4.color);
      normals.push(...n2, ...n2, ...n2);
    }
  }

  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);

  var colorBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(colorLocation);
  gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0);

  var normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(normalLocation);
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);  


  return points.length / 3;
}



var m4 = {

  projection: function(width, height, depth) {
    // Note: This matrix flips the Y axis so 0 is at the top.
    return [
       2 / width, 0, 0, 0,
       0, -2 / height, 0, 0,
       0, 0, 2 / depth, 0,
      -1, 1, 0, 1,
    ];
  },

  multiply: function(a, b) {
    var a00 = a[0 * 4 + 0];
    var a01 = a[0 * 4 + 1];
    var a02 = a[0 * 4 + 2];
    var a03 = a[0 * 4 + 3];
    var a10 = a[1 * 4 + 0];
    var a11 = a[1 * 4 + 1];
    var a12 = a[1 * 4 + 2];
    var a13 = a[1 * 4 + 3];
    var a20 = a[2 * 4 + 0];
    var a21 = a[2 * 4 + 1];
    var a22 = a[2 * 4 + 2];
    var a23 = a[2 * 4 + 3];
    var a30 = a[3 * 4 + 0];
    var a31 = a[3 * 4 + 1];
    var a32 = a[3 * 4 + 2];
    var a33 = a[3 * 4 + 3];
    var b00 = b[0 * 4 + 0];
    var b01 = b[0 * 4 + 1];
    var b02 = b[0 * 4 + 2];
    var b03 = b[0 * 4 + 3];
    var b10 = b[1 * 4 + 0];
    var b11 = b[1 * 4 + 1];
    var b12 = b[1 * 4 + 2];
    var b13 = b[1 * 4 + 3];
    var b20 = b[2 * 4 + 0];
    var b21 = b[2 * 4 + 1];
    var b22 = b[2 * 4 + 2];
    var b23 = b[2 * 4 + 3];
    var b30 = b[3 * 4 + 0];
    var b31 = b[3 * 4 + 1];
    var b32 = b[3 * 4 + 2];
    var b33 = b[3 * 4 + 3];
    return [
      b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30,
      b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31,
      b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32,
      b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33,
      b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30,
      b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31,
      b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32,
      b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33,
      b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30,
      b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31,
      b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32,
      b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33,
      b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30,
      b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31,
      b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32,
      b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33,
    ];
  },

  translation: function(tx, ty, tz) {
    return [
       1,  0,  0,  0,
       0,  1,  0,  0,
       0,  0,  1,  0,
       tx, ty, tz, 1,
    ];
  },

  xRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ];
  },

  yRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ];
  },

  zRotation: function(angleInRadians) {
    var c = Math.cos(angleInRadians);
    var s = Math.sin(angleInRadians);

    return [
       c, s, 0, 0,
      -s, c, 0, 0,
       0, 0, 1, 0,
       0, 0, 0, 1,
    ];
  },

  scaling: function(sx, sy, sz) {
    return [
      sx, 0,  0,  0,
      0, sy,  0,  0,
      0,  0, sz,  0,
      0,  0,  0,  1,
    ];
  },

  translate: function(m, tx, ty, tz) {
    return m4.multiply(m, m4.translation(tx, ty, tz));
  },

  xRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.xRotation(angleInRadians));
  },

  yRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.yRotation(angleInRadians));
  },

  zRotate: function(m, angleInRadians) {
    return m4.multiply(m, m4.zRotation(angleInRadians));
  },

  scale: function(m, sx, sy, sz) {
    return m4.multiply(m, m4.scaling(sx, sy, sz));
  },

};


//Funções do perlin noise:
class Vector3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    dot(other) {
        return this.x * other.x + this.y * other.y + this.z * other.z;
    }
}

function Shuffle(arrayToShuffle) {
	for(let e = arrayToShuffle.length-1; e > 0; e--) {
		const index = Math.round(Math.random()*(e-1));
		const temp = arrayToShuffle[e];
		
		arrayToShuffle[e] = arrayToShuffle[index];
		arrayToShuffle[index] = temp;
	}
}

function MakePermutation() {
	const permutation = [];
	for(let i = 0; i < 256; i++) {
		permutation.push(i);
	}

	Shuffle(permutation);
	
	for(let i = 0; i < 256; i++) {
		permutation.push(permutation[i]);
	}
	
	return permutation;
}
const Permutation = MakePermutation();

function GetConstantVector3D(v) {
    const h = v & 15;
    switch(h) {
        case 0: return new Vector3(1, 1, 0);
        case 1: return new Vector3(-1, 1, 0);
        case 2: return new Vector3(1, -1, 0);
        case 3: return new Vector3(-1, -1, 0);
        case 4: return new Vector3(1, 0, 1);
        case 5: return new Vector3(-1, 0, 1);
        case 6: return new Vector3(1, 0, -1);
        case 7: return new Vector3(-1, 0, -1);
        case 8: return new Vector3(0, 1, 1);
        case 9: return new Vector3(0, -1, 1);
        case 10: return new Vector3(0, 1, -1);
        case 11: return new Vector3(0, -1, -1);
        case 12: return new Vector3(1, 1, 0);
        case 13: return new Vector3(-1, 1, 0);
        case 14: return new Vector3(0, -1, 1);
        case 15: return new Vector3(0, -1, -1);
    }
}

function Fade(t) {
	return ((6*t - 15)*t + 10)*t*t*t;
}

function Lerp(t, a1, a2) {
	return a1 + t*(a2-a1);
}

function perlinNoise(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);

    const d000 = new Vector3(xf, yf, zf);
    const d100 = new Vector3(xf - 1, yf, zf);
    const d010 = new Vector3(xf, yf - 1, zf);
    const d110 = new Vector3(xf - 1, yf - 1, zf);
    const d001 = new Vector3(xf, yf, zf - 1);
    const d101 = new Vector3(xf - 1, yf, zf - 1);
    const d011 = new Vector3(xf, yf - 1, zf - 1);
    const d111 = new Vector3(xf - 1, yf - 1, zf - 1);

    const p = Permutation;
    const aaa = p[p[p[X] + Y] + Z];
    const baa = p[p[p[X + 1] + Y] + Z];
    const aba = p[p[p[X] + Y + 1] + Z];
    const bba = p[p[p[X + 1] + Y + 1] + Z];
    const aab = p[p[p[X] + Y] + Z + 1];
    const bab = p[p[p[X + 1] + Y] + Z + 1];
    const abb = p[p[p[X] + Y + 1] + Z + 1];
    const bbb = p[p[p[X + 1] + Y + 1] + Z + 1];

    const dot000 = d000.dot(GetConstantVector3D(aaa));
    const dot100 = d100.dot(GetConstantVector3D(baa));
    const dot010 = d010.dot(GetConstantVector3D(aba));
    const dot110 = d110.dot(GetConstantVector3D(bba));
    const dot001 = d001.dot(GetConstantVector3D(aab));
    const dot101 = d101.dot(GetConstantVector3D(bab));
    const dot011 = d011.dot(GetConstantVector3D(abb));
    const dot111 = d111.dot(GetConstantVector3D(bbb));

    const u = Fade(xf);
    const v = Fade(yf);
    const w = Fade(zf);

    const x1 = Lerp(u, dot000, dot100);
    const x2 = Lerp(u, dot010, dot110);
    const x3 = Lerp(u, dot001, dot101);
    const x4 = Lerp(u, dot011, dot111);

    const y1 = Lerp(v, x1, x2);
    const y2 = Lerp(v, x3, x4);

    return Lerp(w, y1, y2);
};


main();
