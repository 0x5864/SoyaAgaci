'use strict';

const get = id => document.getElementById(id);
const search = get('person-search');
const panel = get('people-panel');
const showPanel = get('show-panel');
const detail = get('person-detail');
const results = get('people-results');
const list = get('people-list');
const sources = get('sources');
const sidebar = get('sidebar-scroll');
const mobile = matchMedia('(max-width: 690px)');
const names = { t: 'Tunçgenç', v: 'Veryeri' };
const classes = { t: 'tun', v: 'ver' };
const sortNames = new Intl.Collator('tr');
let filter = 'all';
let selected = null;
let graph;
let people = [];
let relations = [];
let visiblePeople = [];
let visibleRelations = [];
let byId = new Map();
let publishedData;
let activeData;
let storedDraft = null;
let draft = { people: [], relations: [] };

const make = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
};

function fold(value) {
  return value.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

function years(person) {
  const year = field => {
    const values = new Set(recordedDates(person, field).map(value => value.slice(0, 4)));
    return values.size === 1 ? [...values][0] : '';
  };
  const birth = year('birth');
  const death = year('death');
  return birth && death ? birth + '–' + death : birth ? 'd. ' + birth : death ? 'ö. ' + death : '';
}

function personSummary(person) {
  return [names[groupOf(person)], years(person)].filter(Boolean).join(' · ');
}

function avatar(person) {
  const initials = person.name.replace(/\s*\([^)]+\)/g, '').split(/\s+/);
  const label = person.unnamed ? '?' : initials.length > 1 ? initials[0][0] + initials.at(-1)[0] : initials[0].slice(0, 2);
  const element = make('span', 'person-avatar ' + classes[groupOf(person)], label.toLocaleUpperCase('tr'));
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function personButton(person) {
  const button = make('button', 'person-button');
  button.type = 'button';
  button.dataset.person = person.id;
  const info = make('span');
  info.append(make('span', 'person-name', person.name), make('span', 'person-meta', personSummary(person)));
  const arrow = make('span', 'person-arrow', '›');
  arrow.setAttribute('aria-hidden', 'true');
  button.append(avatar(person), info, arrow);
  return button;
}

function matchedPeople() {
  const tokens = fold(search.value.trim()).split(/\s+/).filter(Boolean);
  if (!tokens.length) return visiblePeople;
  return visiblePeople.filter(person => tokens.every(token => person.searchable.includes(token)));
}

function renderList() {
  const matched = matchedPeople();
  const searching = Boolean(search.value.trim());
  const sorted = [...matched].sort((a, b) => sortNames.compare(a.name, b.name) || sortNames.compare(years(a), years(b)));
  const landmarks = ['v7', 'v130', 'v131', 'v-recep', 't5'];
  const featured = searching ? [] : filter === 'all'
    ? landmarks.map(id => byId.get(id))
    : [...matched].sort((a, b) => b.visibleDegree - a.visibleDegree).slice(0, 5);
  const listed = new Set(featured.map(person => person.id));
  const allRows = [...featured, ...sorted.filter(person => !listed.has(person.id))].map((person, index) => {
    const row = make('li');
    if (featured.length && index === featured.length) {
      row.append(make('p', 'list-heading list-divider', 'Diğer kayıtlar'));
    }
    row.append(personButton(person));
    return row;
  });
  list.replaceChildren(...allRows);
  get('list-count').textContent = matched.length;
  get('list-heading').textContent = searching ? 'Arama sonuçları' : 'Öne çıkan bağlantılar';
  get('empty-results').hidden = matched.length > 0;
}

function dateLabel(value) {
  const [year, month, day] = value.split('-');
  return day ? day + '.' + month + '.' + year : year;
}

function sourceRecord(source) {
  const record = make('div', 'record');
  record.append(make('b', '', names[source.family]), document.createTextNode(' · ' + source.cell));
  const values = [source.name].filter(Boolean);
  for (const [field, label] of [['birth', 'Doğum'], ['death', 'Ölüm']]) {
    if (!source[field]) continue;
    const placeholder = source.placeholderDates && source[field].startsWith('1900');
    values.push(label + ' ' + dateLabel(source[field]) + (placeholder ? ' (yer tutucu)' : ''));
  }
  record.append(make('div', '', values.join(' · ')));
  return record;
}

function renderDetails() {
  detail.hidden = !selected;
  results.hidden = Boolean(selected);
  if (!selected) return;
  const person = byId.get(selected);
  const card = make('article', 'detail');
  const back = make('button', 'back', '‹ Kişilere dön');
  back.type = 'button';
  back.dataset.action = 'back';
  const title = make('h3', 'detail-title', person.name);
  title.tabIndex = -1;
  const focus = make('button', 'plain-button', 'Bağlarına odaklan');
  focus.type = 'button';
  focus.dataset.action = 'focus';
  const edit = make('button', 'plain-button', 'Düzenle');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  const actions = make('div', 'detail-actions');
  actions.append(edit, focus);
  card.append(back, avatar(person), title, make('p', 'detail-summary', personSummary(person)), actions);

  const groupLabels = ['Üst kuşak', 'Eş', 'Alt kuşak', 'Üvey bağı', 'Bağ türü belirsiz'];
  const groups = new Map(groupLabels.map(label => [label, new Set()]));
  for (const edge of visibleRelations) {
    if (edge.source !== selected && edge.target !== selected) continue;
    const outgoing = edge.source === selected;
    const label = edge.kind === 'parent' ? (outgoing ? 'Alt kuşak' : 'Üst kuşak')
      : ({ spouse: 'Eş', step: 'Üvey bağı', unclear: 'Bağ türü belirsiz' })[edge.kind];
    groups.get(label).add(outgoing ? edge.target : edge.source);
  }
  for (const [label, group] of groups) {
    if (!group.size) continue;
    const section = make('section', 'detail-group');
    const items = make('ul', 'relations-list');
    for (const id of group) {
      const item = make('li');
      item.append(personButton(byId.get(id)));
      items.append(item);
    }
    section.append(make('h4', '', label), items);
    card.append(section);
  }
  if (person.dates) {
    const edits = make('section', 'detail-group');
    edits.append(make('h4', '', 'Düzenlenen tarihler'));
    for (const [field, label] of [['birth', 'Doğum'], ['death', 'Ölüm']]) {
      if (!Object.hasOwn(person.dates, field)) continue;
      const value = person.dates[field];
      edits.append(make('p', 'record', label + ' · ' + (value ? dateLabel(value) : 'Belirtilmedi')));
    }
    card.append(edits);
  }
  const recordSection = make('section', 'detail-group');
  recordSection.append(make('h4', '', 'Kaynak kayıtları'));
  const conflict = ['birth', 'death'].some(field => new Set(person.sources.map(source => source[field]).filter(Boolean)).size > 1);
  if (conflict) recordSection.append(make('p', 'date-conflict', 'Kaynaklardaki tarih değerleri farklı.'));
  recordSection.append(...person.sources.map(sourceRecord));
  if (person.sources.length) card.append(recordSection);
  detail.replaceChildren(card);
}

function togglePanel(open, focusSearch = false) {
  panel.classList.toggle('open', open);
  showPanel.setAttribute('aria-expanded', String(open));
  if (open && focusSearch) search.focus();
}

function select(id, focusDetails = false) {
  selected = id;
  graph.select(id);
  renderDetails();
  if (!id) return;
  graph.reveal(id);
  sidebar.scrollTop = 0;
  if (mobile.matches) togglePanel(true);
  if (focusDetails) detail.querySelector('h3').focus();
}

function applyFilter(next) {
  filter = next;
  visiblePeople = people.filter(person => filter === 'all' || groupOf(person) === filter);
  const visibleIds = new Set(visiblePeople.map(person => person.id));
  visibleRelations = filter === 'all' ? relations : relations.filter(edge =>
    visibleIds.has(edge.source) && visibleIds.has(edge.target));
  for (const person of visiblePeople) person.visibleDegree = 0;
  for (const edge of visibleRelations) {
    byId.get(edge.source).visibleDegree++;
    byId.get(edge.target).visibleDegree++;
  }
  if (!visiblePeople.some(person => person.id === selected)) selected = null;
  for (const button of get('filters').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  const unnamed = visiblePeople.filter(person => person.unnamed).length;
  const total = visiblePeople.length - unnamed;
  const summary = [total + ' kişi', unnamed ? unnamed + ' isimsiz kayıt' : '', visibleRelations.length + ' bağ'];
  get('map-count').textContent = summary.filter(Boolean).join(' · ');
  graph.filter(visiblePeople, visibleRelations);
  graph.select(selected);
  renderList();
  renderDetails();
  sidebar.scrollTop = 0;
}

function displayData(data) {
  activeData = data;
  people = data.people.map(person => ({ ...person }));
  relations = data.relations;
  byId = new Map(people.map(person => [person.id, person]));
  for (const person of people) {
    person.searchable = fold([person.name, ...person.sources.map(source => source.name)].join(' '));
    person.degree = 0;
  }
  for (const edge of relations) {
    byId.get(edge.source).degree++;
    byId.get(edge.target).degree++;
  }
  if (graph) graph.replace(people, relations);
  else graph = createGraph(get('network'), get('tooltip'), people, relations, id => select(id));
  applyFilter(filter);
}

function updateDraftStatus() {
  const pending = draft.people.length || draft.relations.length;
  get('show-publish').hidden = !pending;
  get('save-status').textContent = pending ? 'Taslak bu tarayıcıda kayıtlı.' : '';
}

function savePerson(person, links) {
  const next = changePerson(activeData, person, links);
  const nextDraft = makeDraft(publishedData, next);
  for (const field of ['people', 'relations']) {
    const earlier = new Map(draft[field].map(change => [change.key, change]));
    for (const change of nextDraft[field]) {
      const previous = earlier.get(change.key);
      if (previous && sameRecord(previous.after, change.after)) change.before = previous.before;
    }
  }
  let serialized;
  try {
    if (localStorage.getItem(draftKey) !== storedDraft) {
      throw new Error('Taslak başka bir sekmede değişmiş. Sayfayı yenileyip son taslağı aç.');
    }
    serialized = JSON.stringify(nextDraft);
    localStorage.setItem(draftKey, serialized);
  } catch (error) {
    if (error instanceof DOMException) throw new Error('Tarayıcı taslağı kaydedemedi. Depolama ayarlarını kontrol et.');
    throw error;
  }
  storedDraft = serialized;
  draft = nextDraft;
  if (filter !== 'all' && groupOf(person) !== filter) filter = 'all';
  displayData(next);
  select(person.id);
  updateDraftStatus();
}

async function readFamilyData(url, cache = 'no-cache') {
  const response = await fetch(url, { cache });
  if (!response.ok) throw new Error('Soy ağacı verisi açılamadı.');
  const data = await response.json();
  if (!Array.isArray(data.people) || !Array.isArray(data.relations)) throw new Error('Soy ağacı dosyasının biçimi geçersiz.');
  return data;
}

const publish = get('publish-editor');
const publishStatus = get('publish-status');
const publishContent = get('publish-content');
const publishData = get('publish-data');

get('close-publish').addEventListener('click', () => publish.close());
get('show-publish').addEventListener('click', async () => {
  publishContent.hidden = true;
  publishData.value = '';
  publishStatus.textContent = 'GitHub’daki son sürüm kontrol ediliyor…';
  publish.showModal();
  try {
    const raw = 'https://raw.githubusercontent.com/0x5864/SoyAgaci/main/web/data.json';
    const latest = await readFamilyData(raw + '?t=' + Date.now(), 'no-store');
    const next = applyDraft(latest, draft);
    if (sameRecord(latest, next)) {
      publishStatus.textContent = 'Bu değişiklikler GitHub’da zaten kayıtlı.';
      return;
    }
    publishData.value = JSON.stringify(next, null, 2) + '\n';
    publishStatus.textContent = '';
    publishContent.hidden = false;
  } catch (error) {
    publishStatus.textContent = error instanceof TypeError
      ? 'GitHub’a ulaşılamadı. Bağlantını kontrol edip tekrar dene.'
      : error.message;
  }
});
get('copy-publish-data').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(publishData.value);
    publishStatus.textContent = 'Veri kopyalandı.';
  } catch {
    publishData.select();
    publishStatus.textContent = 'Veri seçildi. Klavye kısayoluyla kopyalayabilirsin.';
  }
});

async function load() {
  publishedData = location.protocol === 'file:'
    ? JSON.parse(get('family-data').textContent)
    : await readFamilyData('./data.json');
  let data = publishedData;
  let storageError = '';
  try {
    storedDraft = localStorage.getItem(draftKey);
    if (storedDraft) {
      const saved = JSON.parse(storedDraft);
      data = applyDraft(publishedData, saved, true);
      draft = makeDraft(publishedData, data);
      for (const field of ['people', 'relations']) {
        const earlier = new Map(saved[field].map(change => [change.key, change.before]));
        for (const change of draft[field]) {
          if (earlier.has(change.key)) change.before = earlier.get(change.key);
        }
      }
    }
  } catch {
    storageError = 'Bu tarayıcıdaki taslak açılamadı.';
  }
  displayData(data);
  updateDraftStatus();
  if (storageError) get('save-status').textContent = storageError;

  const openEditor = createPersonEditor(savePerson);
  const addPerson = get('add-person');
  addPerson.disabled = false;
  addPerson.addEventListener('click', () => openEditor(activeData, null, filter));

  get('filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (button && button.dataset.filter !== filter) applyFilter(button.dataset.filter);
  });
  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.person) select(button.dataset.person, true);
    if (button.dataset.action === 'edit') {
      openEditor(activeData, activeData.people.find(person => person.id === selected), filter);
    }
    if (button.dataset.action === 'back') {
      select(null);
      search.focus();
    }
    if (button.dataset.action === 'focus') {
      graph.focus();
      if (mobile.matches) {
        togglePanel(false);
        showPanel.focus();
      }
    }
  });
  search.addEventListener('input', () => {
    select(null);
    sidebar.scrollTop = 0;
    renderList();
  });
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const first = list.querySelector('[data-person]');
    if (first) select(first.dataset.person, true);
  });
  get('zoom-in').addEventListener('click', () => graph.zoom(1.32));
  get('zoom-out').addEventListener('click', () => graph.zoom(1 / 1.32));
  get('fit').addEventListener('click', () => {
    select(null);
    graph.fit();
  });
}

showPanel.addEventListener('click', () => togglePanel(true, true));
get('hide-panel').addEventListener('click', () => {
  togglePanel(false);
  showPanel.focus();
});
get('show-sources').addEventListener('click', () => sources.showModal());
sources.querySelector('button').addEventListener('click', event => {
  event.preventDefault();
  sources.close();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || sources.open || get('person-editor').open || publish.open) return;
  if (mobile.matches && panel.classList.contains('open')) {
    togglePanel(false);
    showPanel.focus();
  } else if (graph) select(null);
});
if (!location.hash) location.replace('#anasayfa');

load().catch(error => {
  get('map-count').textContent = 'Veri yüklenemedi';
  get('graph-error').hidden = false;
  console.error(error);
});
