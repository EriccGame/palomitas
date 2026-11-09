/*
 * Catálogo tipo streaming para TV (webOS / navegador).
 * Solo muestra información: no reproduce nada.
 *
 * - El catálogo se carga de data/catalogo.json (o de la URL configurada en Ajustes).
 * - Los "id" del catálogo son IDs de TMDB y "urlImage" es la ruta del póster en TMDB.
 * - Sinopsis, calificación TMDB y dónde ver (JustWatch) vienen de la API de TMDB.
 * - Calificaciones de IMDb, Rotten Tomatoes y Metacritic vienen de OMDb.
 *
 * Escrito sin sintaxis moderna (sin async/await, ?. ni ??) para que funcione
 * en televisores webOS 4 o más recientes.
 */
(function () {
  'use strict';

  var IMG = 'https://image.tmdb.org/t/p/';
  var DEFAULT_CATALOG = 'data/catalogo.json';
  var ROW_SIZE = 40;
  var PAGE_SIZE = 60;

  // Índices de género del catálogo -> nombre (siguen el orden de la lista de géneros de TMDB).
  var GENRES = {
    1: 'Acción', 2: 'Aventura', 3: 'Animación', 4: 'Comedia', 5: 'Crimen',
    6: 'Documental', 7: 'Drama', 8: 'Familia', 9: 'Fantasía', 10: 'Historia',
    11: 'Terror', 12: 'Música', 13: 'Misterio', 14: 'Romance', 15: 'Ciencia ficción',
    16: 'Película de TV', 17: 'Suspense', 18: 'Bélica', 19: 'Western',
    20: 'Acción y aventura', 21: 'Infantil', 22: 'Noticias', 23: 'Reality',
    24: 'Ciencia ficción y fantasía', 25: 'Telenovela', 26: 'Talk show', 27: 'Bélica y política'
  };
  var MOVIE_ROWS = [1, 4, 7, 3, 11, 15, 17, 2, 8, 5, 14, 9, 13, 6, 10, 12, 18, 19];
  var SERIES_ROWS = [7, 4, 20, 24, 5, 3, 13, 21, 8, 6, 23, 25];

  var state = {
    movies: [],
    series: [],
    all: [],
    view: 'home',
    grid: { list: [], shown: 0 },
    lastFocus: null,
    cache: {}
  };

  var $main = document.getElementById('main');
  var $modal = document.getElementById('modal');
  var $modalCard = document.getElementById('modalCard');

  // ---------- Ajustes (guardados en el navegador) ----------
  function getSetting(key, def) {
    try { var v = localStorage.getItem('cat_' + key); return v === null ? def : v; }
    catch (e) { return def; }
  }
  function setSetting(key, value) {
    try { localStorage.setItem('cat_' + key, value); } catch (e) { /* almacenamiento no disponible */ }
  }

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(html) {
    var t = document.createElement('div');
    t.innerHTML = html.trim();
    return t.firstChild;
  }
  function byDateDesc(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }
  function today() { return new Date().toISOString().slice(0, 10); }
  function normalize(s) {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // ---------- Carga del catálogo ----------
  // El JSON no trae fecha de alta, pero los títulos vienen en orden de adición:
  // los del final del arreglo son los más recientes. "seq" guarda esa posición.
  function toItem(raw, kind, seq) {
    return {
      id: raw.id,
      kind: kind, // 'movie' | 'tv'
      seq: seq,
      isNew: false,
      title: raw.nameFile || 'Sin título',
      alt: raw.othersNames || '',
      date: raw.date || '',
      year: raw.date ? raw.date.slice(0, 4) : '',
      genreIds: raw.generos || [],
      poster: raw.urlImage || '',
      res: raw.resolutions || '',
      search: normalize((raw.nameFile || '') + ' ' + (raw.othersNames || ''))
    };
  }

  function loadCatalog() {
    var url = getSetting('catalogUrl', '') || DEFAULT_CATALOG;
    // Se lee como texto: algunos servidores lo envían como "x-gzip" aunque sea JSON plano.
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var data = JSON.parse(text);
      state.movies = (data.movies || []).map(function (m, i) { return toItem(m, 'movie', i); });
      state.series = (data.series || []).map(function (s, i) { return toItem(s, 'tv', i); });
      state.all = state.movies.concat(state.series);
      markNew(state.movies, 'movie');
      markNew(state.series, 'tv');
      document.getElementById('count').textContent =
        state.movies.length.toLocaleString('es-MX') + ' películas · ' +
        state.series.length.toLocaleString('es-MX') + ' series';
    });
  }

  // Compara contra la versión anterior del catálogo guardada en el navegador.
  // Las marcas "Nuevo" se conservan hasta que vuelva a cambiar el catálogo.
  function markNew(list, kind) {
    var ids = list.map(function (i) { return i.id; }).join(',');
    var signature = list.length + ':' + (list.length ? list[list.length - 1].id : '');
    var current = getSetting('ver_' + kind, '');
    var previousIds = getSetting('prev_' + kind, '');
    if (current !== signature) {
      previousIds = getSetting('ids_' + kind, '');
      setSetting('prev_' + kind, previousIds);
      setSetting('ids_' + kind, ids);
      setSetting('ver_' + kind, signature);
      setSetting('verDate_' + kind, today());
    }
    if (!previousIds) return; // primera vez: no hay con qué comparar
    var seen = {};
    previousIds.split(',').forEach(function (id) { seen[id] = true; });
    var count = 0;
    list.forEach(function (i) { if (!seen[i.id]) { i.isNew = true; count++; } });
    state['new_' + kind] = count;
  }

  function addedOrder(list) {
    return list.filter(function (i) { return i.poster; })
      .sort(function (a, b) { return b.seq - a.seq; });
  }

  function newItems(list) {
    return addedOrder(list).filter(function (i) { return i.isNew; });
  }

  // ---------- Tarjetas y filas ----------
  function cardHtml(item) {
    var img = item.poster
      ? '<img loading="lazy" src="' + IMG + 'w342' + esc(item.poster) + '" alt="">'
      : '<div class="noimg">' + esc(item.title) + '</div>';
    var badge = (item.kind === 'tv' ? '<span class="badge">Serie</span>' : '') +
      (item.isNew ? '<span class="badge new">Nuevo</span>' : '');
    return '<button class="card focusable" data-kind="' + item.kind + '" data-id="' + item.id +
      '" title="' + esc(item.title) + '">' + img + badge + '</button>';
  }

  function rowHtml(title, items, moreKey) {
    if (!items.length) return '';
    var more = moreKey
      ? '<button class="row-more focusable" data-more="' + moreKey + '">Ver todo ›</button>' : '';
    return '<section class="row"><div class="row-head"><h2 class="row-title">' + esc(title) +
      '</h2>' + more + '</div><div class="row-track">' + items.map(cardHtml).join('') +
      '</div></section>';
  }

  function recent(list) {
    var t = today();
    return list.filter(function (i) { return i.poster && i.date && i.date <= t; })
      .sort(byDateDesc);
  }

  function byGenre(list, gid) {
    return list.filter(function (i) { return i.genreIds.indexOf(gid) !== -1; });
  }

  function genreRows(list, ids, kind) {
    var rec = recent(list);
    return ids.map(function (gid) {
      return rowHtml(GENRES[gid], byGenre(rec, gid).slice(0, ROW_SIZE), kind + ':' + gid);
    }).join('');
  }

  // ---------- Vistas ----------
  function heroHtml() {
    var pool = recent(state.movies).slice(0, 30);
    if (!pool.length) return '';
    var item = pool[Math.floor(Math.random() * pool.length)];
    var genres = item.genreIds.map(function (g) { return GENRES[g]; }).filter(Boolean).slice(0, 3);
    return '<section class="hero">' +
      '<div class="hero-bg" style="background-image:url(\'' + IMG + 'w780' + esc(item.poster) + '\')"></div>' +
      '<img class="hero-poster" src="' + IMG + 'w342' + esc(item.poster) + '" alt="">' +
      '<div class="hero-info"><h1 class="hero-title">' + esc(item.title) + '</h1>' +
      '<div class="hero-meta">' + esc(item.year) + (genres.length ? ' · ' + esc(genres.join(', ')) : '') + '</div>' +
      '<button class="btn focusable" data-kind="movie" data-id="' + item.id + '">ⓘ Más información</button>' +
      '</div></section>';
  }

  function renderHome() {
    $main.innerHTML = heroHtml() +
      rowHtml('Nuevas películas desde la última actualización', newItems(state.movies).slice(0, ROW_SIZE), 'movie:new') +
      rowHtml('Nuevas series desde la última actualización', newItems(state.series).slice(0, ROW_SIZE), 'tv:new') +
      rowHtml('Películas recién agregadas', addedOrder(state.movies).slice(0, ROW_SIZE), 'movie:added') +
      rowHtml('Series recién agregadas', addedOrder(state.series).slice(0, ROW_SIZE), 'tv:added') +
      rowHtml('Estrenos recientes', recent(state.movies).slice(0, ROW_SIZE), 'movie:all') +
      genreRows(state.movies, MOVIE_ROWS.slice(0, 6), 'movie') +
      genreRows(state.series, SERIES_ROWS.slice(0, 4), 'tv');
  }

  function renderKind(kind) {
    var list = kind === 'movie' ? state.movies : state.series;
    var ids = kind === 'movie' ? MOVIE_ROWS : SERIES_ROWS;
    $main.innerHTML = '<div class="page-head"><h1 class="page-title">' +
      (kind === 'movie' ? 'Películas' : 'Series') + '</h1></div>' +
      rowHtml('Nuevos desde la última actualización', newItems(list).slice(0, ROW_SIZE), kind + ':new') +
      rowHtml('Recién agregados', addedOrder(list).slice(0, ROW_SIZE), kind + ':added') +
      rowHtml('Estrenos recientes', recent(list).slice(0, ROW_SIZE), kind + ':all') +
      genreRows(list, ids, kind);
  }

  // Cuadrícula con carga por partes (para listas de miles de títulos).
  function renderGrid(kind, gid) {
    var source = kind === 'movie' ? state.movies : state.series;
    var list = recent(source);
    var title = (kind === 'movie' ? 'Películas' : 'Series');
    if (gid === 'added') { list = addedOrder(source); title += ' · Recién agregados'; }
    else if (gid === 'new') { list = newItems(source); title += ' · Nuevos'; }
    else if (gid !== 'all') { list = byGenre(list, Number(gid)); title += ' · ' + GENRES[gid]; }
    var ids = kind === 'movie' ? MOVIE_ROWS : SERIES_ROWS;
    var special = [['all', 'Estrenos'], ['added', 'Recién agregados']];
    if (state['new_' + kind]) special.push(['new', 'Nuevos (' + state['new_' + kind] + ')']);
    var chips = special.map(function (s) {
      return '<button class="chip focusable' + (gid === s[0] ? ' active' : '') +
        '" data-more="' + kind + ':' + s[0] + '">' + s[1] + '</button>';
    }).join('') + ids.map(function (g) {
        return '<button class="chip focusable' + (String(g) === String(gid) ? ' active' : '') +
          '" data-more="' + kind + ':' + g + '">' + esc(GENRES[g]) + '</button>';
      }).join('');
    $main.innerHTML = '<div class="page-head"><h1 class="page-title">' + esc(title) +
      '</h1><span class="note">' + list.length.toLocaleString('es-MX') + ' títulos</span></div>' +
      '<div class="chips">' + chips + '</div><div class="grid" id="grid"></div>' +
      '<div class="more-wrap"><button class="btn secondary focusable hidden" id="loadMore">Cargar más</button></div>';
    state.grid = { list: list, shown: 0 };
    appendGrid();
  }

  function appendGrid() {
    var g = state.grid;
    var next = g.list.slice(g.shown, g.shown + PAGE_SIZE);
    document.getElementById('grid').insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
    g.shown += next.length;
    document.getElementById('loadMore').classList.toggle('hidden', g.shown >= g.list.length);
  }

  function renderSearch() {
    $main.innerHTML = '<div class="page-head"><h1 class="page-title">Buscar</h1></div>' +
      '<div style="padding:0 48px"><input id="q" class="search-box focusable" type="text" ' +
      'placeholder="Título de película o serie…" autocomplete="off"></div>' +
      '<div class="grid" id="results"></div>';
    var input = document.getElementById('q');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { runSearch(input.value); }, 250);
    });
    input.focus();
  }

  function runSearch(q) {
    var box = document.getElementById('results');
    var term = normalize(q.trim());
    if (term.length < 2) { box.innerHTML = ''; return; }
    var hits = state.all.filter(function (i) { return i.search.indexOf(term) !== -1; })
      .sort(byDateDesc).slice(0, 120);
    box.innerHTML = hits.length ? hits.map(cardHtml).join('')
      : '<div class="empty" style="padding:20px 6px">Sin resultados para "' + esc(q) + '".</div>';
  }

  function renderSettings() {
    $main.innerHTML = '<div class="settings"><h1 class="page-title">Ajustes</h1><br>' +
      field('tmdbKey', 'Clave de API de TMDB', 'Para sinopsis, reparto, calificación TMDB y dónde ver. ' +
        'Es gratis: crea una cuenta en themoviedb.org → Ajustes → API. Sirve la "API Key" o el "Token de lectura".') +
      field('omdbKey', 'Clave de API de OMDb', 'Para calificaciones de IMDb, Rotten Tomatoes y Metacritic. ' +
        'Gratis (1,000 consultas al día) en omdbapi.com → API Key.') +
      field('region', 'País para "Dónde ver"', 'Código de 2 letras: MX, US, ES, AR, CO…', 'MX') +
      field('catalogUrl', 'URL del catálogo (opcional)', 'Vacío = usa data/catalogo.json incluido en la app.') +
      '<button class="btn focusable" id="save">Guardar</button><span class="saved hidden" id="saved">Guardado ✓</span>' +
      '</div>';
    document.getElementById('save').addEventListener('click', function () {
      ['tmdbKey', 'omdbKey', 'region', 'catalogUrl'].forEach(function (k) {
        setSetting(k, document.getElementById('f_' + k).value.trim());
      });
      state.cache = {};
      document.getElementById('saved').classList.remove('hidden');
    });
  }

  function field(key, label, help, def) {
    return '<div class="field"><label for="f_' + key + '">' + label + '</label>' +
      '<input class="focusable" id="f_' + key + '" type="text" value="' + esc(getSetting(key, def || '')) + '">' +
      '<small>' + help + '</small></div>';
  }

  function show(view, arg) {
    state.view = view;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === view);
    }
    window.scrollTo(0, 0);
    if (view === 'home') renderHome();
    else if (view === 'movies') renderKind('movie');
    else if (view === 'series') renderKind('tv');
    else if (view === 'search') return renderSearch();
    else if (view === 'settings') renderSettings();
    else if (view === 'grid') renderGrid(arg.kind, arg.gid);
    var first = $main.querySelector('.focusable');
    if (first) first.focus();
  }

  // ---------- Detalle ----------
  function findItem(kind, id) {
    var list = kind === 'movie' ? state.movies : state.series;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }

  function tmdbFetch(path) {
    var key = getSetting('tmdbKey', '');
    if (!key) return Promise.resolve(null);
    var url = 'https://api.themoviedb.org/3' + path;
    var opts = {};
    // Token de lectura (v4, largo) por cabecera; API Key (v3, corta) por parámetro.
    if (key.length > 40) opts.headers = { Authorization: 'Bearer ' + key };
    else url += (url.indexOf('?') === -1 ? '?' : '&') + 'api_key=' + encodeURIComponent(key);
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('TMDB respondió ' + r.status);
      return r.json();
    });
  }

  function omdbFetch(imdbId) {
    var key = getSetting('omdbKey', '');
    if (!key || !imdbId) return Promise.resolve(null);
    return fetch('https://www.omdbapi.com/?i=' + encodeURIComponent(imdbId) + '&apikey=' + encodeURIComponent(key))
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.Response === 'True' ? d : null; });
  }

  function loadDetails(item) {
    var ck = item.kind + ':' + item.id;
    if (state.cache[ck]) return Promise.resolve(state.cache[ck]);
    var path = '/' + item.kind + '/' + item.id +
      '?language=es-MX&append_to_response=external_ids,credits,watch/providers';
    return tmdbFetch(path).then(function (tmdb) {
      var imdbId = tmdb && tmdb.external_ids ? tmdb.external_ids.imdb_id : null;
      return omdbFetch(imdbId).then(function (omdb) {
        var out = { tmdb: tmdb, omdb: omdb };
        state.cache[ck] = out;
        return out;
      }, function () { return { tmdb: tmdb, omdb: null }; });
    });
  }

  function openDetail(kind, id) {
    var item = findItem(kind, id);
    if (!item) return;
    state.lastFocus = document.activeElement;
    $modalCard.innerHTML = detailHtml(item, null, null);
    $modal.classList.remove('hidden');
    focusFirstInModal();
    if (!getSetting('tmdbKey', '') && !getSetting('omdbKey', '')) return;
    loadDetails(item).then(function (d) {
      if ($modal.classList.contains('hidden')) return;
      $modalCard.innerHTML = detailHtml(item, d, null);
      focusFirstInModal();
    }, function (err) {
      $modalCard.innerHTML = detailHtml(item, null, err.message);
      focusFirstInModal();
    });
  }

  function closeDetail() {
    $modal.classList.add('hidden');
    $modalCard.innerHTML = '';
    if (state.lastFocus && document.body.contains(state.lastFocus)) state.lastFocus.focus();
  }

  function focusFirstInModal() {
    var f = $modalCard.querySelector('.focusable');
    if (f) f.focus();
  }

  function ratingHtml(cls, src, val) {
    return '<div class="rating ' + cls + '"><div class="src">' + src + '</div><div class="val">' + esc(val) + '</div></div>';
  }

  function providersHtml(tmdb) {
    var all = tmdb && tmdb['watch/providers'] ? tmdb['watch/providers'].results : null;
    var region = (getSetting('region', 'MX') || 'MX').toUpperCase();
    var p = all ? all[region] : null;
    if (!p) return '<p class="note">Sin información de plataformas para ' + esc(region) + '.</p>';
    var groups = [['flatrate', 'Incluido en suscripción'], ['free', 'Gratis'], ['ads', 'Gratis con anuncios'],
      ['rent', 'Renta'], ['buy', 'Compra']];
    var html = '';
    groups.forEach(function (g) {
      var list = p[g[0]];
      if (!list || !list.length) return;
      html += '<div class="prov-group"><div class="prov-label">' + g[1] + '</div><div class="prov-list">' +
        list.map(function (x) {
          return '<div class="prov" title="' + esc(x.provider_name) + '">' +
            (x.logo_path ? '<img src="' + IMG + 'w92' + esc(x.logo_path) + '" alt="">' : '') +
            '<span>' + esc(x.provider_name) + '</span></div>';
        }).join('') + '</div></div>';
    });
    return (html || '<p class="note">No está disponible en plataformas en ' + esc(region) + '.</p>') +
      '<p class="note">Datos de disponibilidad: JustWatch (vía TMDB) · ' + esc(region) + '</p>';
  }

  function detailHtml(item, d, error) {
    var tmdb = d ? d.tmdb : null;
    var omdb = d ? d.omdb : null;
    var genres = tmdb && tmdb.genres
      ? tmdb.genres.map(function (g) { return g.name; })
      : item.genreIds.map(function (g) { return GENRES[g]; }).filter(Boolean);
    var title = (tmdb && (tmdb.title || tmdb.name)) || item.title;
    var meta = [];
    if (item.year) meta.push(item.year);
    meta.push(item.kind === 'movie' ? 'Película' : 'Serie');
    if (tmdb && tmdb.runtime) meta.push(Math.floor(tmdb.runtime / 60) + ' h ' + (tmdb.runtime % 60) + ' min');
    if (tmdb && tmdb.number_of_seasons) meta.push(tmdb.number_of_seasons + ' temporada' + (tmdb.number_of_seasons > 1 ? 's' : ''));
    if (omdb && omdb.Rated && omdb.Rated !== 'N/A') meta.push(omdb.Rated);
    if (item.res) meta.push(item.res);

    var ratings = '';
    if (omdb && omdb.imdbRating && omdb.imdbRating !== 'N/A') ratings += ratingHtml('imdb', 'IMDb', omdb.imdbRating + '/10');
    if (tmdb && tmdb.vote_count) ratings += ratingHtml('tmdb', 'TMDB', tmdb.vote_average.toFixed(1) + '/10');
    if (omdb && omdb.Ratings) omdb.Ratings.forEach(function (r) {
      if (r.Source === 'Rotten Tomatoes') ratings += ratingHtml('rt', 'Rotten Tomatoes', r.Value);
      if (r.Source === 'Metacritic') ratings += ratingHtml('mc', 'Metacritic', r.Value);
    });

    var credits = '';
    if (tmdb && tmdb.credits) {
      var directors = (tmdb.credits.crew || []).filter(function (c) { return c.job === 'Director'; })
        .map(function (c) { return c.name; });
      if (!directors.length && tmdb.created_by) directors = tmdb.created_by.map(function (c) { return c.name; });
      var cast = (tmdb.credits.cast || []).slice(0, 6).map(function (c) { return c.name; });
      if (directors.length) credits += '<div><b>' + (item.kind === 'movie' ? 'Dirección' : 'Creación') + ':</b> ' + esc(directors.join(', ')) + '</div>';
      if (cast.length) credits += '<div><b>Reparto:</b> ' + esc(cast.join(', ')) + '</div>';
    }

    var body;
    if (error) {
      body = '<p class="note">No se pudo cargar la información: ' + esc(error) + '. Revisa tus claves en Ajustes.</p>';
    } else if (!getSetting('tmdbKey', '') && !getSetting('omdbKey', '')) {
      body = '<p class="note">Agrega tus claves de TMDB y OMDb en Ajustes para ver sinopsis, calificaciones y dónde ver.</p>';
    } else if (!d) {
      body = '<p class="note">Cargando información…</p>';
    } else {
      body = (tmdb && tmdb.overview ? '<p class="overview">' + esc(tmdb.overview) + '</p>' : '<p class="note">Sin sinopsis en español.</p>') +
        (ratings ? '<div class="ratings">' + ratings + '</div>' : '') +
        (credits ? '<div class="credits">' + credits + '</div>' : '') +
        (tmdb ? '<h3 class="section-title">Dónde ver</h3>' + providersHtml(tmdb) : '');
    }

    var imdbId = tmdb && tmdb.external_ids ? tmdb.external_ids.imdb_id : null;
    var links = '<a href="https://www.themoviedb.org/' + item.kind + '/' + item.id + '" target="_blank" rel="noopener">TMDB ↗</a>' +
      (imdbId ? '<a href="https://www.imdb.com/title/' + esc(imdbId) + '/" target="_blank" rel="noopener">IMDb ↗</a>' : '');

    var poster = item.poster ? '<img class="detail-poster" src="' + IMG + 'w500' + esc(item.poster) + '" alt="">' : '';
    return poster + '<div class="detail-body">' +
      '<h2 class="detail-title">' + esc(title) + '</h2>' +
      (item.alt ? '<div class="detail-alt">' + esc(item.alt) + '</div>' : '') +
      '<div class="detail-meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>' +
      '<div class="tags">' + genres.map(function (g) { return '<span class="tag">' + esc(g) + '</span>'; }).join('') + '</div>' +
      body +
      '<div class="links">' + links + '</div><br>' +
      '<button class="btn secondary focusable" id="closeDetail">Cerrar</button>' +
      '</div>';
  }

  // ---------- Navegación con control remoto (flechas) ----------
  var KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  var BACK_KEYS = [8, 27, 461, 10009]; // Retroceso, Esc, Atrás de webOS (461) y Tizen (10009)

  function focusables() {
    var scope = $modal.classList.contains('hidden') ? document : $modalCard;
    return Array.prototype.slice.call(scope.querySelectorAll('.focusable')).filter(function (e) {
      return e.offsetParent !== null;
    });
  }

  function move(dir) {
    var cur = document.activeElement;
    var list = focusables();
    if (!cur || list.indexOf(cur) === -1) { if (list[0]) list[0].focus(); return; }
    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (e) {
      if (e === cur) return;
      var b = e.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var dx = bx - ax, dy = by - ay;
      var ok = (dir === 'left' && dx < -5) || (dir === 'right' && dx > 5) ||
               (dir === 'up' && dy < -5) || (dir === 'down' && dy > 5);
      if (!ok) return;
      // Distancia principal + penalización por desviarse del eje.
      var main = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      var cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      var score = main + cross * 3;
      if (score < bestScore) { bestScore = score; best = e; }
    });
    if (best) {
      best.focus();
      best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (dir === 'up' || dir === 'down') {
        var r = best.getBoundingClientRect();
        if (r.top < 90) window.scrollBy(0, r.top - 120);
      }
    }
  }

  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var typing = tag === 'INPUT';
    if (BACK_KEYS.indexOf(e.keyCode) !== -1 && !(typing && e.keyCode === 8)) {
      e.preventDefault();
      if (!$modal.classList.contains('hidden')) closeDetail();
      else if (state.view !== 'home') show('home');
      return;
    }
    var dir = KEYS[e.keyCode];
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) return; // mover el cursor dentro del texto
    e.preventDefault();
    move(dir);
  });

  // ---------- Clics (mouse, puntero Magic Remote o Enter) ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document && !t.getAttribute('data-id') && !t.getAttribute('data-view') &&
           !t.getAttribute('data-more') && t.id !== 'closeDetail' && t.id !== 'loadMore' &&
           t.id !== 'modalBackdrop') {
      t = t.parentNode;
    }
    if (!t || t === document) return;
    if (t.id === 'closeDetail' || t.id === 'modalBackdrop') return closeDetail();
    if (t.id === 'loadMore') return appendGrid();
    if (t.getAttribute('data-view')) return show(t.getAttribute('data-view'));
    if (t.getAttribute('data-more')) {
      var parts = t.getAttribute('data-more').split(':');
      return show('grid', { kind: parts[0], gid: parts[1] });
    }
    if (t.getAttribute('data-id')) openDetail(t.getAttribute('data-kind'), t.getAttribute('data-id'));
  });

  // ---------- Inicio ----------
  loadCatalog().then(function () {
    show('home');
  }, function (err) {
    $main.innerHTML = '<div class="empty">No se pudo cargar el catálogo (' + esc(err.message) +
      ').<br>Si abriste index.html directo desde el disco, usa un servidor local o revisa la URL en Ajustes.</div>';
  });
})();
