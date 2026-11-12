'use strict';

const colors = { t: '#285cda', v: '#168675' };
const edgeColors = { t: '#7799d9', v: '#78afa6', cross: '#8b98a7' };
const rad = Math.PI / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function groupOf(person) {
  // Şerife's Veryeri ancestry connects the two source tables.
  if (person.id === 'v130' && person.families.length > 1) return 'v';
  return person.families.includes('t') ? 't' : 'v';
}

function arrange(people, relations) {
  const byId = new Map(people.map(person => [person.id, person]));
  const children = new Map(people.map(person => [person.id, []]));
  const companions = new Map(people.map(person => [person.id, []]));
  const positions = new Map();
  const edgeKinds = new Map();
  for (const edge of relations) {
    const kind = edge.kind;
    if (kind === 'spouse' || kind === 'unclear') {
      edgeKinds.set(edge.source + '/' + edge.target, kind);
      edgeKinds.set(edge.target + '/' + edge.source, kind);
    }
  }
  for (const person of people) {
    const parent = person.layoutParent;
    if (!byId.has(parent)) continue;
    const kind = edgeKinds.get(parent + '/' + person.id);
    const branch = kind ? companions : children;
    branch.get(parent).push(person.id);
  }

  const weights = new Map();
  function weight(id) {
    if (!weights.has(id)) {
      const value = children.get(id).reduce((sum, child) => sum + weight(child), 1);
      weights.set(id, value);
    }
    return weights.get(id);
  }

  function set(id, x, y, fixed = false) {
    if (byId.has(id)) positions.set(id, { id, x, y, baseX: x, baseY: y, fixed });
  }

  function branch(id, start, end, distance) {
    const origin = positions.get(id);
    const middle = ((start + end) / 2) * rad;
    let offset = 0;
    for (const companion of companions.get(id)) {
      if (positions.has(companion)) continue;
      offset += 1;
      const angle = middle - Math.PI / 2;
      set(companion, origin.x + Math.cos(angle) * (42 + 19 * offset), origin.y + Math.sin(angle) * (42 + 19 * offset));
    }

    const next = children.get(id).filter(child => !positions.has(child));
    const total = next.reduce((sum, child) => sum + Math.sqrt(weight(child)), 0);
    let cursor = start;
    for (const child of next) {
      const span = (end - start) * Math.sqrt(weight(child)) / total;
      const angle = (cursor + span / 2) * rad;
      const length = distance + Math.min(32, Math.sqrt(weight(child)) * 8);
      set(child, origin.x + Math.cos(angle) * length, origin.y + Math.sin(angle) * length);
      const center = cursor + span / 2;
      const half = clamp(span * .61, 22, 67);
      branch(child, center - half, center + half, Math.max(45, distance * .73));
      cursor += span;
    }
  }

  const anchors = [
    ['v-recep', -267, -218], ['v-hava', -233, -277],
    ['v6', -145, -146], ['v-mevhize', -85, -178], ['v-step', -61, -105],
    ['v7', -85, -17], ['v9', -13, 53], ['v79', -130, 80],
    ['v99', 33, 8], ['v100', 17, -59],
    ['v11', -244, 118], ['v43', -20, 158], ['v81', 171, 74], ['v102', -320, -44],
    ['v130', 101, -131], ['v131', 179, -165],
    ['t5', 168, -298], ['t6', 99, -326], ['t-mehmet', -6, -387], ['t-serife', 66, -408],
    ['t23', 231, -376], ['t25', 313, -282],
  ];
  for (const [id, x, y] of anchors) set(id, x, y, true);
  branch('v-recep', 113, 265, 97);
  branch('v11', 75, 182, 99);
  branch('v43', 32, 133, 118);
  branch('v81', -18, 66, 104);
  branch('v102', 151, 237, 110);
  branch('v130', 327, 382, 103);
  branch('t25', 268, 353, 95);

  // Records added through the editor do not have positions in the source layout.
  const neighbors = new Map(people.map(person => [person.id, []]));
  for (const { source, target } of relations) {
    neighbors.get(source).push(target);
    neighbors.get(target).push(source);
  }
  const unplaced = new Set(people.filter(person => !positions.has(person.id)).map(person => person.id));
  const attached = new Map();
  let standalone = 0;
  while (unplaced.size) {
    const before = unplaced.size;
    for (const id of unplaced) {
      const neighbor = neighbors.get(id).find(id => positions.has(id));
      if (!neighbor) continue;
      const anchor = positions.get(neighbor);
      const offset = attached.get(neighbor) ?? 0;
      const angle = Math.atan2(anchor.y, anchor.x) + offset * 1.22;
      const distance = 74 + 12 * offset;
      set(id, anchor.x + Math.cos(angle) * distance, anchor.y + Math.sin(angle) * distance);
      attached.set(neighbor, offset + 1);
      unplaced.delete(id);
    }
    if (unplaced.size === before) {
      const id = unplaced.values().next().value;
      set(id, -560 + (standalone % 8) * 95, -470 - Math.floor(standalone / 8) * 88);
      standalone++;
      unplaced.delete(id);
    }
  }

  // Keep the main branches in place while separating nearby leaf nodes.
  const all = [...positions.values()];
  for (let pass = 0; pass < 65; pass++) {
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (a.fixed && b.fixed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || .001;
        if (distance >= 36) continue;
        const push = (36 - distance) * .37 / distance;
        if (!a.fixed) { a.x -= dx * push; a.y -= dy * push; }
        if (!b.fixed) { b.x += dx * push; b.y += dy * push; }
      }
      if (!a.fixed) {
        a.x += (a.baseX - a.x) * .042;
        a.y += (a.baseY - a.y) * .042;
      }
    }
  }

  for (const person of people) {
    const point = positions.get(person.id);
    person.x = point.x * 1.24;
    person.y = point.y;
  }
}

function createGraph(canvas, tooltip, people, relations, onSelect) {
  arrange(people, relations);
  let positions = new Map(people.map(person => [person.id, { x: person.x, y: person.y }]));
  const context = canvas.getContext('2d');
  let byId = new Map(people.map(person => [person.id, person]));
  let currentPeople = people;
  let currentRelations = relations;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let camera = { x: 0, y: 0, scale: 1 };
  let selected = null;
  let neighbors = new Set();
  let hover = null;
  let animation = 0;
  let points = new Map();
  const pointers = new Map();
  let gestureMoved = false;
  let start = null;
  let fitted = true;
  let needsDraw = false;
  let portrait = false;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const prominent = ['v7','v130','v131','v6','v-recep','v11','v43','v81','v102','t5','t25','t6'];
  const rank = new Map(prominent.map((id, index) => [id, prominent.length - index]));
  const priority = person => (rank.get(person.id) || 0) * 25 + person.degree;
  const view = person => ({ x: person.x * camera.scale + camera.x, y: person.y * camera.scale + camera.y });

  function frame() {
    if (needsDraw) return;
    needsDraw = true;
    requestAnimationFrame(() => {
      needsDraw = false;
      draw();
    });
  }

  function draw() {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const baseRadius = clamp(Math.sqrt(camera.scale), .68, 1.75);
    points = new Map(currentPeople.map(person => [
      person.id, { ...view(person), r: (2.9 + Math.sqrt(person.degree) * 1.48 + (rank.has(person.id) ? 2 : 0)) * baseRadius },
    ]));

    for (const edge of currentRelations) {
      const a = points.get(edge.source);
      const b = points.get(edge.target);
      const active = selected && (edge.source === selected || edge.target === selected);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance < a.r + b.r + 2) continue;
      const ux = dx / distance;
      const uy = dy / distance;
      const end = { x: b.x - ux * b.r, y: b.y - uy * b.r };
      const sourceFamily = groupOf(byId.get(edge.source));
      const group = sourceFamily === groupOf(byId.get(edge.target)) ? sourceFamily : 'cross';
      const isParent = edge.kind === 'parent';
      const color = { spouse: '#9462c5', step: '#a36c33', unclear: '#7b8492' }[edge.kind]
        || (active ? colors[group] ?? edgeColors[group] : edgeColors[group]);
      context.globalAlpha = selected ? (active ? .94 : .15) : .83;
      context.strokeStyle = color;
      context.lineWidth = active ? 1.55 : 1;
      context.setLineDash(isParent ? [] : edge.kind === 'spouse' ? [4, 3] : [1.4, 3.4]);
      context.beginPath();
      context.moveTo(a.x + ux * a.r, a.y + uy * a.r);
      context.lineTo(end.x, end.y);
      context.stroke();
      if (isParent && distance > 25) {
        const length = active ? 5.5 : 4.2;
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - ux * length - uy * length * .45, end.y - uy * length + ux * length * .45);
        context.lineTo(end.x - ux * length + uy * length * .45, end.y - uy * length - ux * length * .45);
        context.fill();
      }
    }
    context.setLineDash([]);

    for (const person of currentPeople) {
      const { x, y, r } = points.get(person.id);
      const color = colors[groupOf(person)];
      const focused = selected === person.id || hover === person.id;
      context.globalAlpha = selected && !neighbors.has(person.id) && !focused ? .22 : 1;
      if (focused || rank.has(person.id)) {
        context.fillStyle = color + (focused ? '27' : '14');
        context.beginPath();
        context.arc(x, y, r + (focused ? 7 : 4), 0, Math.PI * 2);
        context.fill();
      }
      context.beginPath();
      context.arc(x, y, r, 0, Math.PI * 2);
      context.fillStyle = person.unnamed ? '#fff' : color;
      context.fill();
      context.strokeStyle = person.unnamed ? color : '#fff';
      context.lineWidth = 1;
      context.stroke();
    }

    const crowded = width < 530;
    const candidates = currentPeople.filter(person => {
      if (person.id === selected || person.id === hover) return true;
      if (selected) return neighbors.has(person.id);
      return rank.has(person.id) || (!crowded && person.degree >= 4) || camera.scale >= .77;
    }).sort((a, b) => {
      const focusRank = person => person.id === selected ? 2000 : person.id === hover ? 1800 : priority(person);
      return focusRank(b) - focusRank(a);
    });
    const labels = [];
    for (const person of candidates) {
      const { x, y, r } = points.get(person.id);
      const focus = person.id === selected || person.id === hover;
      const main = rank.has(person.id);
      const size = focus ? 14 : main ? (crowded ? 11 : 14) : 11;
      const shortName = person.name.replace(/ \([^)]+\)/g, '');
      const name = focus || camera.scale > 1 ? person.name : shortName;
      context.font = `${focus || main ? 700 : 560} ${size}px "DM Sans", system-ui, sans-serif`;
      const textWidth = context.measureText(name).width;
      const gap = r + 5;
      const offsets = [
        [gap, 0], [-gap - textWidth, 0], [-textWidth / 2, gap + size / 2],
        [-textWidth / 2, -gap - size / 2],
      ];
      if (main) {
        offsets.push([gap + 8, size], [-gap - textWidth - 8, -size]);
      }
      for (const [ox, oy] of offsets) {
        const box = { x: x + ox - 2, y: y + oy - size / 2 - 2, w: textWidth + 4, h: size + 4 };
        if (box.x < 4 || box.y < 4 || box.x + box.w > width - 4 || box.y + box.h > height - 4) continue;
        if (labels.some(other => box.x < other.x + other.w && box.x + box.w > other.x
          && box.y < other.y + other.h && box.y + box.h > other.y)) continue;
        if (!focus && [...points.values()].some(point => point !== points.get(person.id)
          && box.x < point.x + point.r && box.x + box.w > point.x - point.r
          && box.y < point.y + point.r && box.y + box.h > point.y - point.r)) continue;
        labels.push(box);
        context.globalAlpha = 1;
        context.textBaseline = 'middle';
        context.lineWidth = 3.5;
        context.lineJoin = 'round';
        context.strokeStyle = '#fcfdff';
        context.fillStyle = main || focus ? colors[groupOf(person)] : '#40546a';
        context.strokeText(name, x + ox, y + oy);
        context.fillText(name, x + ox, y + oy);
        break;
      }
    }
    context.globalAlpha = 1;
  }

  function moveTo(target, animate = true) {
    cancelAnimationFrame(animation);
    if (!animate || reduceMotion) {
      camera = target;
      frame();
      return;
    }
    const origin = { ...camera };
    const startTime = performance.now();
    function step(time) {
      const elapsed = Math.min(1, (time - startTime) / 260);
      const ease = 1 - (1 - elapsed) ** 3;
      camera = {
        x: origin.x + (target.x - origin.x) * ease,
        y: origin.y + (target.y - origin.y) * ease,
        scale: origin.scale + (target.scale - origin.scale) * ease,
      };
      frame();
      if (elapsed < 1) animation = requestAnimationFrame(step);
    }
    animation = requestAnimationFrame(step);
  }

  function fit(group = currentPeople, animate = true) {
    if (!group.length || !width || !height) return;
    fitted = group === currentPeople;
    const xs = group.map(p => p.x);
    const ys = group.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = Math.min(width * .12, 92);
    const padY = Math.min(height * .12, 44);
    const maxScale = fitted ? 1.45 : 2.35;
    const scale = clamp(Math.min(
      (width - 2 * padX) / Math.max(maxX - minX, 100),
      (height - 2 * padY) / Math.max(maxY - minY, 100),
    ), .1, maxScale);
    moveTo({ x: width / 2 - (minX + maxX) * scale / 2, y: height / 2 - (minY + maxY) * scale / 2, scale }, animate);
  }

  function orientPositions() {
    for (const person of people) {
      const { x, y } = positions.get(person.id);
      person.x = portrait ? y : x;
      person.y = portrait ? -x : y;
    }
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const nextRatio = Math.min(devicePixelRatio || 1, 3);
    if (!bounds.width || !bounds.height) return;
    if (bounds.width === width && bounds.height === height && nextRatio === ratio) return;
    camera.x += (bounds.width - width) / 2;
    camera.y += (bounds.height - height) / 2;
    width = bounds.width;
    height = bounds.height;
    ratio = nextRatio;
    const nextPortrait = width < 560 && height > width * 1.2;
    if (portrait !== nextPortrait) {
      portrait = nextPortrait;
      orientPositions();
      fitted = true;
    }
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    if (fitted) fit(currentPeople, false);
    frame();
  }
  new ResizeObserver(resize).observe(canvas);
  document.fonts.ready.then(frame);

  function localPosition(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function hitAt({ x, y }) {
    let closest = null;
    let closestDistance = Infinity;
    for (const [id, point] of points) {
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance <= Math.max(10, point.r + 4) && distance < closestDistance) {
        closest = id;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function hideTooltip() {
    if (!hover) return;
    hover = null;
    tooltip.hidden = true;
    canvas.classList.remove('over-node');
    frame();
  }

  function zoom(factor, x = width / 2, y = height / 2, animate = true, originX = x, originY = y) {
    fitted = false;
    const scale = clamp(camera.scale * factor, .12, 5.5);
    const change = scale / camera.scale;
    moveTo({ x: x - (originX - camera.x) * change, y: y - (originY - camera.y) * change, scale }, animate);
  }

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const { x, y } = localPosition(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
    hideTooltip();
    zoom(Math.exp(-clamp(delta, -150, 150) * .0025), x, y, false);
  }, { passive: false });

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = localPosition(event);
    cancelAnimationFrame(animation);
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      start = point;
      gestureMoved = false;
    } else gestureMoved = true;
    hideTooltip();
  });

  canvas.addEventListener('pointermove', event => {
    const point = localPosition(event);
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType !== 'mouse' || pointers.size) return;
      const next = hitAt(point);
      if (!next) { hideTooltip(); return; }
      if (next !== hover) {
        hover = next;
        tooltip.textContent = byId.get(hover).name;
        tooltip.hidden = false;
        canvas.classList.add('over-node');
        frame();
      }
      tooltip.style.left = Math.max(4, Math.min(width - tooltip.offsetWidth - 4, point.x + 13)) + 'px';
      tooltip.style.top = Math.max(4, point.y - 34) + 'px';
      return;
    }
    pointers.set(event.pointerId, point);
    if (pointers.size > 1) {
      const other = [...pointers].find(([id]) => id !== event.pointerId)[1];
      const initial = Math.hypot(previous.x - other.x, previous.y - other.y);
      const next = Math.hypot(point.x - other.x, point.y - other.y);
      if (initial >= 2) zoom(next / initial, (point.x + other.x) / 2, (point.y + other.y) / 2,
        false, (previous.x + other.x) / 2, (previous.y + other.y) / 2);
      return;
    }
    if (!gestureMoved && Math.hypot(point.x - start.x, point.y - start.y) <= 4) return;
    gestureMoved = true;
    fitted = false;
    canvas.classList.add('dragging');
    camera.x += point.x - previous.x;
    camera.y += point.y - previous.y;
    frame();
  });

  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size) return;
    canvas.classList.remove('dragging');
    if (!gestureMoved && event.type === 'pointerup') onSelect(hitAt(localPosition(event)));
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('pointerleave', hideTooltip);
  canvas.addEventListener('dblclick', event => {
    const { x, y } = localPosition(event);
    if (!hitAt({ x, y })) zoom(1.45, x, y);
  });

  resize();

  return {
    replace(nextPeople, nextRelations) {
      arrange(nextPeople, nextRelations);
      people = nextPeople;
      byId = new Map(people.map(person => [person.id, person]));
      positions = new Map(people.map(person => [person.id, { x: person.x, y: person.y }]));
      orientPositions();
    },
    filter(visiblePeople, visibleRelations) {
      currentPeople = visiblePeople;
      currentRelations = visibleRelations;
      hideTooltip();
      fit();
      frame();
    },
    select(id) {
      selected = id;
      neighbors = new Set(id ? [id] : []);
      for (const edge of currentRelations) {
        if (edge.source === id) neighbors.add(edge.target);
        if (edge.target === id) neighbors.add(edge.source);
      }
      frame();
    },
    focus() { fit(currentPeople.filter(person => neighbors.has(person.id))); },
    reveal(id) {
      const person = byId.get(id);
      if (!person) return;
      const point = view(person);
      const within = point.x > 30 && point.x < width - 65 && point.y > 35 && point.y < height - 35;
      if (within) return;
      fitted = false;
      moveTo({ x: width / 2 - person.x * camera.scale, y: height / 2 - person.y * camera.scale, scale: camera.scale });
    },
    fit() { fit(); },
    zoom,
  };
}
