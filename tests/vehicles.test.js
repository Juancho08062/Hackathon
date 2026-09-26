// Run with: node tests/vehicles.test.js
// Builds every vehicle at both detail levels and checks the size budgets the pair view relies on.
const assert = require("assert");
const T = require("../vendor/three.min.js");
const { Vehicles3D: V } = require("../src/vehicles3d.js");

let detailed = 0;
for (const kind of V.KINDS) {
  const d = V.build(T, kind, { level: "detailed" }), u = V.build(T, kind, { level: "ultra" });
  for (const g of [d, u]) {
    const box = new T.Box3().setFromObject(g), size = box.getSize(new T.Vector3());
    assert(Math.abs(box.min.y) < 0.05, `${kind} sits on the ground (min y ${box.min.y.toFixed(3)})`);
    assert(size.x > 4 && size.x < 40 && size.z > 1.8 && size.z < 8, `${kind} has a truck-sized footprint`);
    g.children.forEach(m => assert(m.geometry.attributes.position.array.every(Number.isFinite), `${kind} has finite vertices`));
  }
  assert(d.children.length <= 16, `${kind} detailed uses at most 16 draw calls (${d.children.length})`);
  assert(u.userData.tris > d.userData.tris * 1.5, `${kind} ultra adds geometry`);
  assert(u.children.some(m => m.material.type === "MeshPhysicalMaterial"), `${kind} ultra uses physical materials`);
  detailed += d.userData.tris;
}
assert(detailed < 40000, `all detailed vehicles together stay under 40k triangles (${detailed})`);
assert.strictEqual(V.levelFor("ultra"), "ultra");
assert.strictEqual(V.levelFor("high"), "detailed");
console.log(`vehicles: ${V.KINDS.length} kinds ok, detailed total ${detailed} triangles`);
