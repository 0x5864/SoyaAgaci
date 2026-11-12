'use strict';

const draftKey = 'SoyAgaci.draft.v1';
const editableDates = ['birth', 'death'];
const relationshipOptions = [
  ['upper', 'Üst kuşak'], ['lower', 'Alt kuşak'], ['spouse', 'Eş'],
  ['step', 'Üvey bağı'], ['unclear', 'Bağ türü belirsiz'],
];

function recordedDates(person, field) {
  if (Object.hasOwn(person.dates ?? {}, field)) {
    return person.dates[field] ? [person.dates[field]] : [];
  }
  return [...new Set(person.sources
    .filter(source => !source.placeholderDates || !source[field]?.startsWith('1900'))
    .map(source => source[field])
    .filter(Boolean))];
}

function parseEditorDate(value) {
  const input = value.trim();
  if (!input) return null;
  if (/^[1-9]\d{3}$/.test(input)) return input;
  const localized = input.match(/^(\d{1,2})\.(\d{1,2})\.([1-9]\d{3})$/);
  const iso = localized
    ? [localized[3], localized[2].padStart(2, '0'), localized[1].padStart(2, '0')].join('-')
    : input;
  if (/^[1-9]\d{3}-\d{2}-\d{2}$/.test(iso)) {
    const parsed = new Date(iso + 'T00:00:00Z');
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(iso + 'T')) return iso;
  }
  throw new Error('Geçerli bir tarih gir. Örnek 24.04.1980 veya 1980.');
}

function relationshipKey(edge) {
  const endpoints = [edge.source, edge.target];
  if (edge.kind !== 'parent') endpoints.sort();
  return [edge.kind, ...endpoints].join('/');
}

function sameRecord(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diffRecords(before, after, keyFor) {
  const previous = new Map(before.map(record => [keyFor(record), record]));
  const next = new Map(after.map(record => [keyFor(record), record]));
  const keys = new Set([...previous.keys(), ...next.keys()]);
  return [...keys].flatMap(key => {
    const before = previous.get(key) ?? null;
    const after = next.get(key) ?? null;
    return sameRecord(before, after) ? [] : [{ key, before, after }];
  });
}

function makeDraft(before, after) {
  return {
    people: diffRecords(before.people, after.people, person => person.id),
    relations: diffRecords(before.relations, after.relations, relationshipKey),
  };
}

function applyDraft(base, draft, allowConflicts = false) {
  function apply(records, changes, keyFor) {
    const indexed = new Map(records.map(record => [keyFor(record), record]));
    for (const { key, before, after } of changes) {
      const current = indexed.get(key);
      if (sameRecord(current, after)) continue;
      if (!allowConflicts && !sameRecord(current, before)) {
        throw new Error('Bu kayıt GitHub’da da değişmiş. Yayımlamadan önce iki sürümdeki değişiklikleri birleştir.');
      }
      if (after) indexed.set(key, after);
      else indexed.delete(key);
    }
    return [...indexed.values()];
  }
  const people = apply(base.people, draft.people, person => person.id);
  const relations = apply(base.relations, draft.relations, relationshipKey);
  const ids = new Set(people.map(person => person.id));
  if (relations.some(edge => !ids.has(edge.source) || !ids.has(edge.target))) {
    throw new Error('Bir akrabalık bağının kişisi bulunamadı.');
  }
  const added = draft.relations.filter(change => !change.before && change.after).map(change => change.after);
  if (!allowConflicts && addsParentCycle(relations, added)) {
    throw new Error('Taslak ile GitHub’daki bağlar bir kuşak döngüsü oluşturuyor.');
  }
  return { people, relations };
}

function addsParentCycle(nextEdges, added) {
  if (!added.some(edge => edge.kind === 'parent')) return false;
  const children = new Map();
  for (const edge of nextEdges) {
    if (edge.kind !== 'parent') continue;
    if (!children.has(edge.source)) children.set(edge.source, []);
    children.get(edge.source).push(edge.target);
  }
  return added.some(edge => {
    if (edge.kind !== 'parent') return false;
    const pending = [edge.target];
    const checked = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === edge.source) return true;
      if (checked.has(id)) continue;
      checked.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    return false;
  });
}

function changePerson(data, updated, nextLinks) {
  const people = new Map(data.people.map(person => [person.id, person]));
  const previous = people.get(updated.id);
  people.set(updated.id, updated);
  const incident = edge => edge.source === updated.id || edge.target === updated.id;
  const originalLinks = new Map(data.relations.filter(incident).map(edge => [relationshipKey(edge), edge]));
  const kept = new Map();
  for (const link of nextLinks) {
    const key = relationshipKey(link);
    if (kept.has(key)) throw new Error('Aynı akrabalık bağı birden fazla kez eklenmiş.');
    const original = originalLinks.get(key);
    const sameFamily = sameRecord(updated.families, previous?.families);
    if (original && sameFamily) {
      kept.set(key, original);
      continue;
    }
    const other = people.get(link.source === updated.id ? link.target : link.source);
    if (!other || other.id === updated.id) throw new Error('Akrabalık bağı için başka bir kişi seç.');
    const families = updated.families.filter(family => other.families.includes(family));
    kept.set(key, original ? { ...original, families } : { ...link, families });
  }
  const remaining = data.relations.flatMap(edge => {
    if (!incident(edge)) return [edge];
    const key = relationshipKey(edge);
    if (!kept.has(key)) return [];
    const replacement = kept.get(key);
    kept.delete(key);
    return [replacement];
  });
  const added = [...kept.values()];
  const relations = [...remaining, ...added];
  if (addsParentCycle(relations, added)) {
    throw new Error('Üst ve alt kuşak bağları döngü oluşturuyor. Bağların yönünü kontrol et.');
  }
  return { people: [...people.values()], relations };
}

function createPersonEditor(onSave) {
  const dialog = get('person-editor');
  const form = get('editor-form');
  const fields = form.elements;
  const rows = get('editor-links');
  const error = get('editor-error');
  let person;
  let options = [];
  let initialDates;

  function addLinkRow(edge) {
    const row = make('div', 'editor-link');
    const personLabel = make('label', '', 'Kişi');
    const peer = make('select');
    peer.dataset.peer = '';
    peer.append(new Option('Kişi seç', ''));
    for (const option of options) peer.append(new Option(option.label, option.id));
    personLabel.append(peer);

    const typeLabel = make('label', '', 'Bağ');
    const type = make('select');
    type.dataset.kind = '';
    type.append(new Option('Bağ türü seç', ''));
    for (const [value, label] of relationshipOptions) type.append(new Option(label, value));
    typeLabel.append(type);

    if (edge) {
      const outgoing = edge.source === person.id;
      peer.value = outgoing ? edge.target : edge.source;
      type.value = edge.kind === 'parent' ? (outgoing ? 'lower' : 'upper') : edge.kind;
    }
    const remove = make('button', 'icon-button', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Bu bağı kaldır');
    remove.addEventListener('click', () => {
      row.remove();
      get('add-link').focus();
    });
    row.append(personLabel, typeLabel, remove);
    rows.append(row);
    return peer;
  }

  get('add-link').addEventListener('click', () => addLinkRow().focus());
  for (const id of ['close-editor', 'cancel-editor']) {
    get(id).addEventListener('click', () => dialog.close());
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.hidden = true;
    try {
      const name = fields.namedItem('name').value.trim();
      if (!name) throw new Error('Ad ve soyad alanını doldur.');
      const family = fields.namedItem('family').value;
      if (!['t', 'v'].includes(family)) throw new Error('Aile kolunu seç.');
      const families = person && groupOf(person) === family ? person.families : [family];
      const id = person?.id ?? 'user-' + crypto.randomUUID();
      const updated = { ...(person ?? { id, sources: [] }), name, families };
      if (!person?.unnamed || name !== person.name) delete updated.unnamed;
      const dates = { ...person?.dates };
      let datesChanged = false;
      for (const field of editableDates) {
        const input = fields.namedItem(field).value.trim();
        if (input === initialDates[field]) continue;
        dates[field] = parseEditorDate(input);
        datesChanged = true;
      }
      if (datesChanged) {
        updated.dates = dates;
        const [birth] = recordedDates(updated, 'birth');
        const [death] = recordedDates(updated, 'death');
        if (birth && death && birth > death && (birth.length === death.length || birth.slice(0, 4) !== death.slice(0, 4))) {
          throw new Error('Ölüm tarihi doğum tarihinden önce olamaz.');
        }
      }
      const links = [...rows.children].flatMap(row => {
        const peer = row.querySelector('[data-peer]').value;
        const type = row.querySelector('[data-kind]').value;
        if (!peer && !type) return [];
        if (!peer || !type) throw new Error('Her akrabalık bağı için kişi ve bağ türünü seç.');
        return [{
          source: type === 'upper' ? peer : id,
          target: type === 'upper' ? id : peer,
          kind: type === 'upper' || type === 'lower' ? 'parent' : type,
        }];
      });
      onSave(updated, links);
      dialog.close();
      detail.querySelector('h3')?.focus();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
    }
  });

  return function open(data, record, filter) {
    person = record;
    form.reset();
    rows.replaceChildren();
    error.hidden = true;
    get('editor-title').textContent = person ? 'Kişiyi düzenle' : 'Kişi ekle';
    fields.namedItem('name').value = person?.name ?? '';
    fields.namedItem('family').value = person ? groupOf(person) : filter === 'all' ? '' : filter;
    initialDates = {};
    const conflicts = [];
    for (const field of editableDates) {
      const values = person ? recordedDates(person, field) : [];
      initialDates[field] = values.length === 1 ? dateLabel(values[0]) : '';
      fields.namedItem(field).value = initialDates[field];
      if (values.length > 1) conflicts.push(field === 'birth' ? 'doğum' : 'ölüm');
    }
    const note = get('editor-date-note');
    note.hidden = !conflicts.length;
    note.textContent = conflicts.length
      ? 'Kaynaklardaki ' + conflicts.join(' ve ') + ' tarihleri farklı. Bir değer girerek tarihi güncelleyebilirsin.'
      : '';
    options = data.people.filter(candidate => candidate.id !== person?.id)
      .sort((a, b) => sortNames.compare(a.name, b.name))
      .map(candidate => ({
        id: candidate.id,
        label: [candidate.name, years(candidate) || candidate.sources[0]?.cell].filter(Boolean).join(' · '),
      }));
    if (person) {
      for (const edge of data.relations) {
        if (edge.source === person.id || edge.target === person.id) addLinkRow(edge);
      }
    }
    dialog.showModal();
    fields.namedItem('name').focus();
  };
}
