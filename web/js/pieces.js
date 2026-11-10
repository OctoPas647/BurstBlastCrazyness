/* BurstBlastCrazyness — piece shapes.
 * Shapes are written as ASCII art: '#' = block, '.' = empty.
 * classic() is the Block Blast set and nothing else: single block, lines of
 * 2 to 5, 2×2 and 3×3 squares, 2×3 rectangle, small corner, L/J, T, S/Z and
 * the big 3×3 corner. All rotations are counted as separate shapes.
 * extended() holds the bigger shapes Block Blast doesn't have; they are only
 * in play when the "More Shapes" mod is on.
 */
(function (BBC) {
  'use strict';

  function fromArt(id, art, extra) {
    var cells = [];
    var w = 0;
    art.forEach(function (row, r) {
      for (var c = 0; c < row.length; c++) {
        if (row[c] === '#') {
          cells.push([r, c]);
          if (c + 1 > w) w = c + 1;
        }
      }
    });
    if (!cells.length) throw new Error('Shape "' + id + '" has no blocks');
    var shape = { id: id, cells: cells, w: w, h: art.length, kind: 'normal' };
    if (extra) for (var k in extra) shape[k] = extra[k];
    return shape;
  }

  /** Rotate a shape 90° clockwise, returns a new shape. */
  function rotate(shape, newId) {
    var cells = shape.cells.map(function (rc) {
      return [rc[1], shape.h - 1 - rc[0]];
    });
    var out = {};
    for (var k in shape) out[k] = shape[k];
    out.id = newId || shape.id + '_r';
    out.cells = cells;
    out.w = shape.h;
    out.h = shape.w;
    return out;
  }

  /** All 4 rotations (duplicates removed), ids suffixed _0.._3. */
  function rotations(id, art, extra) {
    var base = fromArt(id + '_0', art, extra);
    var list = [base];
    var seen = {};
    seen[key(base)] = true;
    var cur = base;
    for (var i = 1; i < 4; i++) {
      cur = rotate(cur, id + '_' + i);
      var k = key(cur);
      if (!seen[k]) {
        seen[k] = true;
        list.push(cur);
      }
    }
    return list;
  }

  function key(shape) {
    return shape.cells
      .map(function (rc) { return rc[0] + ',' + rc[1]; })
      .sort()
      .join(';');
  }

  function classic() {
    var s = [];
    s.push(fromArt('dot', ['#']));
    s = s.concat(rotations('i2', ['##']));
    s = s.concat(rotations('i3', ['###']));
    s = s.concat(rotations('i4', ['####']));
    s = s.concat(rotations('i5', ['#####']));
    s.push(fromArt('o2', ['##', '##']));
    s.push(fromArt('o3', ['###', '###', '###']));
    s = s.concat(rotations('rect23', ['###', '###']));
    s = s.concat(rotations('corner3', ['##', '#.']));
    s = s.concat(rotations('L4', ['#.', '#.', '##']));
    s = s.concat(rotations('J4', ['.#', '.#', '##']));
    s = s.concat(rotations('T4', ['###', '.#.']));
    s = s.concat(rotations('S4', ['.##', '##.']));
    s = s.concat(rotations('Z4', ['##.', '.##']));
    s = s.concat(rotations('corner5', ['###', '#..', '#..']));
    return s;
  }

  /** Bigger shapes that are not in Block Blast (used by the "More Shapes" mod). */
  function extended() {
    var s = [];
    s = s.concat(rotations('L5', ['#.', '#.', '#.', '##']));
    s = s.concat(rotations('J5', ['.#', '.#', '.#', '##']));
    s = s.concat(rotations('P5', ['##', '##', '#.']));
    s = s.concat(rotations('Q5', ['##', '##', '.#']));
    s = s.concat(rotations('T5', ['###', '.#.', '.#.']));
    s = s.concat(rotations('U5', ['#.#', '###']));
    s.push(fromArt('plus5', ['.#.', '###', '.#.']));
    s = s.concat(rotations('rect24', ['####', '####']));
    s = s.concat(rotations('S5', ['..#', '###', '#..']));
    s = s.concat(rotations('Z5', ['#..', '###', '..#']));
    return s;
  }

  BBC.Pieces = {
    fromArt: fromArt,
    rotate: rotate,
    rotations: rotations,
    classic: classic,
    extended: extended,
    key: key
  };
})((window.BBC = window.BBC || {}));
