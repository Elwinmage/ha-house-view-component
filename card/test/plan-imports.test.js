import { describe, it, expect } from 'vitest';
import { decodeStepString, footprint, minRect, parseIfc, parseStep } from '../src/engine/ifc-import.js';
import { parseSvgRooms, parseTransform, pathPoints, roomName, svgLevels, xmlTags } from '../src/engine/svg-import.js';
import { robotMapsWithRooms, robotPlanRooms, robotRooms } from '../src/robot-plan.js';
import { builderFromLevels, rectOf, sceneFromLevels } from '../src/plan-builder.js';
import { normalizeScene } from '../src/engine/scene-model.js';

// ---------------------------------------------------------------- IFC

// A storey of two spaces side by side (5 x 4 m and 3 x 4 m, millimetres), the walls around them (extruded
// rectangles), a door in the shared wall (faceted B-rep) and a window known by its overall sizes only.
const rectProfile = (id, x, y, xd, yd) => `#${id}=IFCRECTANGLEPROFILEDEF(.AREA.,$,#${id + 1},${xd}.,${yd}.);
#${id + 1}=IFCAXIS2PLACEMENT2D(#${id + 2},$);
#${id + 2}=IFCCARTESIANPOINT((${x}.,${y}.));`;
const IFC = `ISO-10303-21;
HEADER;FILE_DESCRIPTION((''),'2;1');ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCSITE('g',$,'Site',$,$,$,$,$,.ELEMENT.,(44,30,0,0),(1,0,0),0.,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#4,#5);
#4=IFCAXIS2PLACEMENT3D(#6,$,$);
#5=IFCDIRECTION((0.,1.));
#6=IFCCARTESIANPOINT((0.,0.,0.));
#10=IFCBUILDINGSTOREY('s',$,'RDC',$,$,#11,$,'Rez-de-chauss\\X2\\00E9\\X0\\e',.ELEMENT.,0.);
#11=IFCLOCALPLACEMENT($,#4);
/* living room: a polyline profile */
#20=IFCSPACE('a',$,'1','',$,#11,#21,'S\\X2\\00E9\\X0\\jour',.ELEMENT.,$,$);
#21=IFCPRODUCTDEFINITIONSHAPE($,$,(#22));
#22=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#23));
#23=IFCEXTRUDEDAREASOLID(#24,#4,#26,2500.);
#24=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#25);
#25=IFCPOLYLINE((#27,#28,#29,#30,#27));
#26=IFCDIRECTION((0.,0.,1.));
#27=IFCCARTESIANPOINT((100.,-100.));
#28=IFCCARTESIANPOINT((4950.,-100.));
#29=IFCCARTESIANPOINT((4950.,-3900.));
#30=IFCCARTESIANPOINT((100.,-3900.));
/* kitchen: an indexed poly curve */
#40=IFCSPACE('b',$,'Cuisine',$,$,#11,#41,$,.ELEMENT.,$,$);
#41=IFCPRODUCTDEFINITIONSHAPE($,$,(#42));
#42=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#43));
#43=IFCEXTRUDEDAREASOLID(#44,#4,#26,2500.);
#44=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#45);
#45=IFCINDEXEDPOLYCURVE(#46,$,$);
#46=IFCCARTESIANPOINTLIST2D(((5050.,-100.),(7900.,-100.),(7900.,-3900.),(5050.,-3900.)));
#50=IFCRELAGGREGATES('r',$,$,$,#10,(#20,#40));
/* walls */
#60=IFCWALL('w1',$,'N',$,$,#11,#61,$);
#61=IFCPRODUCTDEFINITIONSHAPE($,$,(#62));
#62=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#63));
#63=IFCEXTRUDEDAREASOLID(#64,#4,#26,2600.);
${rectProfile(64, 4000, 0, 8200, 200)}
#70=IFCWALL('w2',$,'S',$,$,#11,#71,$);
#71=IFCPRODUCTDEFINITIONSHAPE($,$,(#72));
#72=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#73));
#73=IFCEXTRUDEDAREASOLID(#74,#4,#26,2600.);
${rectProfile(74, 4000, -4000, 8200, 200)}
#80=IFCWALLSTANDARDCASE('w3',$,'mid',$,$,#11,#81,$);
#81=IFCPRODUCTDEFINITIONSHAPE($,$,(#82));
#82=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#83));
#83=IFCEXTRUDEDAREASOLID(#84,#4,#26,2600.);
${rectProfile(84, 5000, -2000, 100, 3800)}
#90=IFCRELCONTAINEDINSPATIALSTRUCTURE('c',$,$,$,(#60,#70,#80,#100,#120),#10);
/* door in the middle wall: a faceted brep box 1 m wide */
#100=IFCDOOR('d',$,'Porte',$,$,#11,#101,$,2100.,900.);
#101=IFCPRODUCTDEFINITIONSHAPE($,$,(#102));
#102=IFCSHAPEREPRESENTATION(#3,'Body','Brep',(#103));
#103=IFCFACETEDBREP(#104);
#104=IFCCLOSEDSHELL((#105,#106));
#105=IFCFACE((#107));
#106=IFCFACE((#108));
#107=IFCFACEOUTERBOUND(#109,.T.);
#108=IFCFACEOUTERBOUND(#110,.T.);
#109=IFCPOLYLOOP((#111,#112,#113,#114));
#110=IFCPOLYLOOP((#115,#116,#117,#118));
#111=IFCCARTESIANPOINT((4950.,-1500.,0.));
#112=IFCCARTESIANPOINT((5050.,-1500.,0.));
#113=IFCCARTESIANPOINT((5050.,-2500.,0.));
#114=IFCCARTESIANPOINT((4950.,-2500.,0.));
#115=IFCCARTESIANPOINT((4950.,-1500.,2100.));
#116=IFCCARTESIANPOINT((5050.,-1500.,2100.));
#117=IFCCARTESIANPOINT((5050.,-2500.,2100.));
#118=IFCCARTESIANPOINT((4950.,-2500.,2100.));
/* window of the north wall: no body, placed at 2 m, 1 m high */
#120=IFCWINDOW('x',$,'Fen',$,$,#121,$,$,1200.,1400.);
#121=IFCLOCALPLACEMENT(#11,#122);
#122=IFCAXIS2PLACEMENT3D(#123,$,$);
#123=IFCCARTESIANPOINT((2000.,50.,1000.));
ENDSEC;
END-ISO-10303-21;`;

describe('IFC import', () => {
  it('reads STEP records and strings', () => {
    expect(decodeStepString("l''x \\X2\\00E9\\X0\\ \\X\\E9 \\S\\i")).toBe("l'x é é é");
    const e = parseStep("DATA;\n#1=IFCX('a''b',#2,.T.,$,(1.,2.5E1),IFCLABEL('z'));\n#2 = IFCY();\nbad;\nENDSEC;");
    expect(e.get(1)).toEqual({ type: 'IFCX', args: ["a'b", { ref: 2 }, { enum: 'T' }, null, [1, 25], { type: 'IFCLABEL', args: ['z'] }] });
    expect(e.get(2)).toEqual({ type: 'IFCY', args: [] });
    expect(() => parseStep('nothing')).toThrow(/IFC/);
  });

  it('turns storeys, spaces, walls, doors and windows into a scene', () => {
    const { scene, report } = parseIfc(IFC, 'maison.ifc', 45);
    expect(report.counts).toEqual({ niveaux: 1, murs: 3, pièces: 2, fenêtres: 1, portes: 1 });
    expect(scene.name).toBe('maison');
    expect(scene.site.latitude).toBeCloseTo(44.5);
    expect(scene.site.northOffsetDeg).toBe(0);
    const lv = scene.levels[0];
    expect(lv.name).toBe('Rez-de-chaussée');
    expect(lv.rooms.map((r) => r.name)).toEqual(['Séjour', 'Cuisine']);
    // IFC y north -> scene z south
    expect(lv.rooms[0].poly[0]).toEqual([0.1, 0.1]);
    expect(lv.rooms[1].floor).toBe('#cfcfc8');
    const mid = lv.walls.find((w) => w.thickness === 0.1);
    expect(mid.a[0]).toBeCloseTo(5);
    expect(mid.exterior).toBe(false);
    expect(lv.walls.filter((w) => w.exterior)).toHaveLength(2);
    expect(lv.walls[0].height).toBe(2.6);
    const door = scene.openings.find((o) => o.type === 'door');
    expect(door).toMatchObject({ at: [5, 2], width: 1, height: 2.1, sill: 0 });
    expect(door.room).toBeTruthy();
    const win = scene.openings.find((o) => o.type === 'window');
    expect(win).toMatchObject({ width: 1.4, height: 1.2, sill: 1, room: 'r1' });
    expect(win.at).toEqual([2, 0]);
    expect(scene.lights).toHaveLength(2);
    const n = normalizeScene(structuredClone(scene));
    expect(n.openings.every((o) => o._wall >= 0)).toBe(true);
  });

  it('draws the walls around the spaces when the file has none', () => {
    const noWalls = IFC.replace(/IFCWALL(STANDARDCASE)?\(/g, 'IFCSLAB(');
    const { scene, report } = parseIfc(noWalls, 'x.ifc');
    expect(report.warnings[0]).toMatch(/Aucun mur/);
    expect(scene.levels[0].walls.length).toBeGreaterThan(4);
    expect(() => parseIfc('DATA;\nENDSEC;')).toThrow(/storey/);
  });

  it('finds outlines and rectangles', () => {
    const sq = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [0, 1, 0],
    ];
    expect(footprint([sq, sq.map((q) => [q[0], q[1], 3])])).toMatchObject({ zMin: 0, zMax: 3 });
    expect(footprint([[sq[0]]])).toBeNull();
    // no flat bottom face: the convex hull
    expect(
      footprint([
        [
          [0, 0, 0],
          [1, 0, 1],
          [0, 1, 2],
        ],
      ]).poly,
    ).toHaveLength(3);
    const r = minRect([
      [0, 0],
      [4, 0],
      [4, 0.2],
      [0, 0.2],
    ]);
    expect(r.len).toBeCloseTo(4);
    expect(r.wid).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------- SVG

const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000cm" height="500cm" viewBox="0 0 1000 500">
  <!-- outline of the house -->
  <rect id="house" x="0" y="0" width="1000" height="500" />
  <g transform="translate(10,20)">
    <rect id="area.living_room" x="0" y="0" width="500" height="400" />
    <rect x="500" y="0" width="300" height="400"><title>Cuisine</title></rect>
    <path id="bureau" d="M 800 0 h 150 v 400 h -150 Z" />
    <rect id="light.kitchen" x="1" y="1" width="2" height="2" />
    <rect x="0" y="0" width="5" height="5" />
  </g>
</svg>`;

describe('SVG import', () => {
  it('reads tags, transforms and paths', () => {
    const tags = xmlTags('<a x="1"><b y=\'2\'/>txt<!-- c --></a>');
    expect(tags.map((t) => [t.name, t.close, t.self])).toEqual([
      ['a', false, false],
      ['b', false, true],
      ['a', true, false],
    ]);
    expect(tags[1].text).toBe('txt');
    expect(parseTransform('translate(10) scale(2)')).toEqual([2, 0, 0, 2, 10, 0]);
    expect(parseTransform('rotate(90 1 1)').map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0, 2, 0]);
    expect(parseTransform('matrix(1,0,0,1,3,4) skewX(0) skewY(0)')).toEqual([1, 0, 0, 1, 3, 4]);
    expect(pathPoints('m 0 0 l 10 0 l 0 10 z')).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(pathPoints('M0,0 C 1 1 2 2 10 0 V 10 L 0 0')).toHaveLength(3);
    expect(pathPoints('M0,0 L 10 0')).toBeNull();
    expect(roomName('area.living_room')).toBe('Living room');
    expect(roomName('')).toBe('');
  });

  it('finds the named rooms and their scale', () => {
    const p = parseSvgRooms(SVG);
    expect(p.unitsPerMeter).toBe(100);
    expect(p.levels).toHaveLength(1);
    expect(p.levels[0].rooms.map((r) => r.name)).toEqual(['Living room', 'Cuisine', 'Bureau']);
    const lv = svgLevels(p)[0];
    expect(lv.rooms[0].poly).toEqual([
      [0, 0],
      [5, 0],
      [5, 4],
      [0, 4],
    ]);
    expect(svgLevels(p, 50)[0].rooms[1].poly[1]).toEqual([16, 0]);
    // rectangles: into the builder
    const b = builderFromLevels([lv]);
    expect(b.rooms.map((r) => [r.name, r.x, r.w])).toEqual([
      ['Living room', 0, 5],
      ['Cuisine', 5, 3],
      ['Bureau', 8, 1.5],
    ]);
    expect(() => parseSvgRooms('<svg><rect x="0" y="0" width="1" height="1"/></svg>')).toThrow(/room/);
    expect(() => parseSvgRooms('<html/>')).toThrow(/SVG/);
  });

  it('names the rooms with the texts of a drawing that carries none, and reads its millimetres', () => {
    // floors on one layer with no name of their own, names on another, a viewBox in mm and no width at all:
    // what a CAD tool exports (reported against ArchLang output). The page frame, the north arrow and the title
    // block must not come out as rooms.
    const svg = `<svg xmlns:inkscape="x" viewBox="-1324 -1324 9648 10213.6">
      <rect x="-1324" y="-1324" width="9648" height="10213.6" fill="#fff"/>
      <g id="A-FLOR" inkscape:groupmode="layer" inkscape:label="A-FLOR">
        <polygon points="0,0 4000,0 4000,6000 0,6000"/>
        <polygon points="4000,0 7000,0 7000,3000 4000,3000"/>
        <polygon points="4000,3000 7000,3000 7000,4400 4000,4400"/>
        <polygon points="4000,4400 7000,4400 7000,6000 4000,6000"/>
      </g>
      <g id="A-FURN" inkscape:groupmode="layer" inkscape:label="A-FURN"><polygon points="300,250 1100,250 1100,850 300,850"/></g>
      <g id="A-ANNO-TEXT" inkscape:groupmode="layer" inkscape:label="A-ANNO-TEXT">
        <text x="2000" y="2956.8">Living / Kitchen</text><text x="2000" y="3194.4">24.0 m²</text>
        <text x="6400" y="556.8">Bedroom</text><text x="6400" y="794.4">9.0 m²</text>
        <text x="5500" y="3656.8">Hall</text><text x="5500" y="3894.4">4.2 m²</text>
        <text x="5500" y="5156.8"><tspan>Ba</tspan>th</text><text x="5500" y="5394.4">4.8 m²</text>
      </g>
      <g id="A-ANNO-DIMS" inkscape:groupmode="layer" inkscape:label="A-ANNO-DIMS"><text x="3500" y="6700.8">7000</text></g>
      <g><text x="6776" y="-1246.96">N</text></g>
      <g><rect x="4652" y="7204.8" width="2448" height="1324.8"/><text x="4774.4" y="7370.4">PROJECT</text></g>
    </svg>`;
    const p = parseSvgRooms(svg);
    expect(p.unitsPerMeter).toBe(1000); // millimetres: a plan 96 m across would make no sense
    expect(p.levels).toHaveLength(1);
    const rooms = svgLevels(p)[0].rooms;
    expect(rooms.map((r) => r.name)).toEqual(['Living / Kitchen', 'Bedroom', 'Hall', 'Bath']);
    const size = (r) => {
      const xs = r.poly.map((q) => q[0]);
      const ys = r.poly.map((q) => q[1]);
      const r3 = (v) => Math.round(v * 1000) / 1000;
      return [r3(Math.max(...xs) - Math.min(...xs)), r3(Math.max(...ys) - Math.min(...ys))];
    };
    expect(rooms.map(size)).toEqual([
      [4, 6],
      [3, 3],
      [3, 1.4],
      [3, 1.6],
    ]);
  });

  it('leaves a shape unnamed when all it holds is a measurement', () => {
    const svg = `<svg xmlns:inkscape="x" viewBox="0 0 5000 5000">
      <g inkscape:groupmode="layer" inkscape:label="A-FLOR"><polygon points="0,0 4000,0 4000,4000 0,4000"/></g>
      <g inkscape:groupmode="layer" inkscape:label="A-ANNO"><text x="2000" y="2000">16.0 m²</text></g>
    </svg>`;
    expect(() => parseSvgRooms(svg)).toThrow(/room/);
  });

  it('guesses the units of a drawing that does not say, and keeps hundredths of a metre when they fit', () => {
    const plan = (vb, w, h) => `<svg viewBox="${vb}"><rect id="r" x="0" y="0" width="${w}" height="${h}"/></svg>`;
    expect(parseSvgRooms(plan('0 0 800 700', 700, 600)).unitsPerMeter).toBe(100); // 7 m: as it always was
    expect(parseSvgRooms(plan('0 0 8000 7000', 7000, 6000)).unitsPerMeter).toBe(1000); // millimetres
    expect(parseSvgRooms(plan('0 0 10 10', 7, 6)).unitsPerMeter).toBe(1); // metres
    expect(parseSvgRooms(plan('0 0 1e9 1e9', 1e8, 1e8)).unitsPerMeter).toBe(100); // nothing fits: left as it was
    // a width in a real unit still wins over the guess
    expect(
      parseSvgRooms('<svg width="210mm" viewBox="0 0 210 297"><rect id="r" x="0" y="0" width="100" height="90"/></svg>').unitsPerMeter,
    ).toBe(1000);
  });

  it('makes levels of Inkscape layers, bottom layer first', () => {
    const svg = `<svg xmlns:inkscape="x">
      <g inkscape:groupmode="layer" inkscape:label="RDC"><rect id="a" x="0" y="0" width="100" height="100"/></g>
      <g inkscape:groupmode="layer" inkscape:label="Étage"><polygon id="b" points="0,0 100,0 50,80"/></g>
      <g inkscape:groupmode="layer" inkscape:label="Notes"><circle id="n" cx="0" cy="0" r="5" /><ellipse cx="1" cy="1" rx="0" ry="1"/></g>
    </svg>`;
    const p = parseSvgRooms(svg);
    expect(p.levels.map((l) => l.name)).toEqual(['Notes', 'Étage', 'RDC']);
    const levels = svgLevels(p);
    expect(builderFromLevels(levels)).toBeNull(); // a triangle: not for the builder
    const sc = sceneFromLevels(levels, 44);
    expect(sc.levels.map((l) => [l.name, l.elevation])).toEqual([
      ['Notes', 0],
      ['Étage', 2.7],
      ['RDC', 5.4],
    ]);
    expect(
      rectOf([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBeNull();
    expect(builderFromLevels([{ name: '', rooms: [] }])).toBeNull();
  });
});

// ---------------------------------------------------------------- robot map

describe('plan from the map of a robot', () => {
  const attrs = {
    friendly_name: 'Carte',
    rooms: {
      16: { x0: 25000, y0: 25000, x1: 29000, y1: 28000, name: 'Cuisine' },
      17: { x0: 29000, y0: 25000, x1: 33000, y1: 28000 },
      18: {
        outline: [
          [25000, 28000],
          [27000, 28000],
          [26000, 30000],
        ],
      },
      19: { x0: 1, y0: 1, x1: 1, y1: 5 },
      20: null,
    },
    // 50 mm per pixel, robot y up on the picture
    calibration_points: [
      { vacuum: { x: 25000, y: 25000 }, map: { x: 0, y: 100 } },
      { vacuum: { x: 30000, y: 25000 }, map: { x: 100, y: 100 } },
      { vacuum: { x: 25000, y: 30000 }, map: { x: 0, y: 0 } },
    ],
  };

  it('lists the rooms of a map entity', () => {
    expect(robotRooms(attrs).map((r) => r.id)).toEqual(['16', '17', '18']);
    expect(robotRooms({ rooms: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] })[0].id).toBe('1');
    expect(robotRooms(null)).toEqual([]);
    expect(
      robotMapsWithRooms({ 'image.map': { attributes: attrs }, 'image.other': { attributes: {} }, 'light.x': { attributes: attrs } }),
    ).toEqual([{ entity: 'image.map', name: 'Carte', count: 3 }]);
  });

  it('lays the rooms out like the picture, in meters', () => {
    const rooms = robotPlanRooms(attrs);
    expect(rooms[0]).toEqual({
      name: 'Cuisine',
      // robot y up: its y0 edge is the lower one on the picture
      poly: [
        [0, 5],
        [4, 5],
        [4, 2],
        [0, 2],
      ],
    });
    expect(rooms[1].name).toBe('Pièce 2');
    // without calibration: robot mm, y up
    const raw = robotPlanRooms({ rooms: { 1: { x0: 0, y0: 0, x1: 2000, y1: 1000 } } });
    expect(raw[0].poly).toEqual([
      [0, 1],
      [2, 1],
      [2, 0],
      [0, 0],
    ]);
    expect(robotPlanRooms({})).toEqual([]);
  });
});
