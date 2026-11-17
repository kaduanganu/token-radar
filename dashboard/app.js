// Token Radar's dashboard, model radar-2. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, a filterable
// table, and a per-protocol detail drawer with the model's own inputs and
// the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', band: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // Money, percentages and ages, each in one place so the table, the
  // detail drawer and the lede all print the same figures. The dollar
  // formatter keeps two decimals for billions (the board's top rows live
  // there) and one for millions, and falls back to the locale formatter
  // for the small numbers the board rarely shows.
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var USD_UNITS = [
    { limit: 1e9, divisor: 1e9, suffix: 'B', digits: 2 },
    { limit: 1e6, divisor: 1e6, suffix: 'M', digits: 1 },
    { limit: 1e3, divisor: 1e3, suffix: 'K', digits: 0 },
  ];
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    for (var i = 0; i < USD_UNITS.length; i++) {
      var u = USD_UNITS[i];
      if (Math.abs(n) >= u.limit) return '$' + (n / u.divisor).toFixed(u.digits) + u.suffix;
    }
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var sign = n > 0 ? '+' : '';
    return sign + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    if (days >= 30) return Math.round(days / 30) + 'mo';
    return Math.max(0, Math.round(days)) + 'd';
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic. radar-2 adds the chain
  // multiplier and penalises a falling TVL harder than it rewards a rising one.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? model.growth_weight_up : model.growth_weight_down;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chains = row.chains ? row.chains.length : 0;
    var chainMult = 1 + model.chain_step * Math.min(Math.max(chains - 1, 0), model.chain_max_steps);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
  }

  // A tiny element builder: el('td', { class: 'num', text: '1' }) makes a
  // cell, el('div', null, childA, childB) nests children. Attributes named
  // on* become listeners, 'text' sets the text content, 'class' the class,
  // and anything else becomes an attribute unless it is null. Children may
  // be nodes, strings, or arrays of either; null children are skipped so
  // conditional children read as plain expressions at the call site.
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      });
    }
    var args = Array.prototype.slice.call(arguments, 2);
    args.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    });
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  // Capital scales with the protocol's own TVL: a farm position is a
  // meaningful deposit for a small protocol and a rounding error for a
  // large one, so the suggested size rises in steps instead of staying flat.
  var CAPITAL_STEPS = [
    { atLeast: 5e9, capital: 250 },
    { atLeast: 1e9, capital: 150 },
    { atLeast: 1e8, capital: 100 },
  ];
  function capitalFor(p) {
    for (var i = 0; i < CAPITAL_STEPS.length; i++) {
      if (p.tvl_usd >= CAPITAL_STEPS[i].atLeast) return CAPITAL_STEPS[i].capital;
    }
    return 50;
  }
  // Young protocols need a longer hold: a position held 60 days on a
  // protocol listed three months ago is most of its history, while the same
  // hold on a three-year-old protocol is a footnote.
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // The farm action follows the protocol's category, first match wins, in
  // the order below. The order matters: 'Lending' beats 'Yield' when a
  // category names both, and the generic deposit is the last resort. Each
  // rule is a substring test on the lower-cased category, so a new category
  // falls through to the default instead of breaking the plan.
  var ACTION_RULES = [
    { match: ['lend', 'cdp', 'collateral'], text: function (p, capital, chain) { return 'Supply $' + capital + ' of USDC to ' + p.name + ' on ' + chain + ' and keep the position open.'; } },
    { match: ['dex', 'yield', 'leveraged farm'], text: function (p, capital, chain) { return 'Provide $' + capital + ' of liquidity to ' + p.name + "'s main pool on " + chain + ' and keep the position open.'; } },
    { match: ['bridge'], text: function (p, capital, chain) { return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + p.name + ' and use the bridged funds in its app.'; } },
    { match: ['staking', 'restak'], text: function (p, capital) { return "Stake $" + capital + " of the chain's staking asset through " + p.name + ' and keep the receipt.'; } },
    { match: ['perpetual', 'derivative'], text: function (p, capital) { return 'Deposit $' + capital + ' of USDC as margin on ' + p.name + ' and open one small hedge.'; } },
    { match: ['prediction'], text: function (p, capital) { return 'Fund $' + capital + ' and place one market position on ' + p.name + '.'; } },
    { match: ['curator', 'allocator'], text: function (p, capital, chain) { return 'Deposit $' + capital + ' into a ' + p.name + ' vault on ' + chain + ' and keep the shares.'; } },
    { match: ['stable'], text: function (p, capital, chain) { return 'Mint or deposit $' + capital + ' of the stable asset through ' + p.name + ' on ' + chain + '.'; } },
    { match: ['rwa'], text: function (p, capital, chain) { return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.'; } },
    { match: ['insurance'], text: function (p, capital, chain) { return 'Buy $' + capital + ' of cover from ' + p.name + ' on ' + chain + ' and keep the policy.'; } },
  ];
  function actionFor(p, capital, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTION_RULES.length; i++) {
      var rule = ACTION_RULES[i];
      for (var j = 0; j < rule.match.length; j++) {
        if (category.indexOf(rule.match[j]) >= 0) return rule.text(p, capital, chain);
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Open a fresh wallet that will hold only this farm\'s funds, write its seed phrase on paper, and keep that paper offline and apart from your phone.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action every week, such as a deposit, a borrow, a swap or a governance vote, and vary the action so the history reads as real use.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Leave the position untouched for at least ' + hold + ' days so the activity is counted in more than one snapshot, and do not withdraw early to chase another farm.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Read the protocol\'s own documentation and, where it has one, its audit report, before you add more capital than the first deposit.', cost: 'nothing to read', time: '20 minutes' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from the link it publishes itself, and claim only there.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Never connect this wallet to a claim link from a direct message, a search ad or a copied post, and never sign a transaction you cannot read.', cost: 'nothing, and it saves the whole position', time: '1 minute to check the link' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // The hash is the shareable state: every filter and the open protocol
  // round-trips through it, so a link to a filtered board or an open
  // detail opens the same view. Each field knows its parameter name, its
  // default, and how to read and write itself; readHash and writeHash walk
  // the same table in both directions so the two cannot drift apart.
  var HASH_FIELDS = [
    { param: 'q', key: 'q', def: '' },
    { param: 'p', key: 'selected', def: null },
    { param: 'category', key: 'category', def: 'all' },
    { param: 'chain', key: 'chain', def: 'all' },
    { param: 'band', key: 'band', def: 'all' },
    { param: 'watch', key: 'watchOnly', def: false, write: function (v) { return v ? '1' : null; }, read: function (v) { return v === '1'; } },
  ];
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    HASH_FIELDS.forEach(function (f) {
      var raw = params.get(f.param);
      if (raw === null) return;
      state[f.key] = f.read ? f.read(raw) : raw;
    });
  }
  function writeHash() {
    var params = new URLSearchParams();
    HASH_FIELDS.forEach(function (f) {
      var value = state[f.key];
      var out = f.write ? f.write(value) : value;
      if (out !== null && out !== undefined && out !== '' && out !== f.def) params.set(f.param, out);
    });
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.band !== 'all' && r.band !== state.band) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // Sorting keys, one per sortable column. A missing growth sorts as the
  // lowest possible value and a missing age as the highest, so unknown
  // figures sink to the bottom instead of floating to the top. Ties always
  // break on slug, which keeps the order stable between renders.
  var SORT_KEYS = {
    name: function (r) { return r.name.toLowerCase(); },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null ? Infinity : r.age_days; },
    implied: function (r) { return r.implied_value_usd; },
  };
  function sortedRows(list) {
    var pick = SORT_KEYS[state.sort] || SORT_KEYS.implied;
    return list.slice().sort(function (a, b) {
      var av = pick(a);
      var bv = pick(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    var sum = DATA.summary;
    var cats = (sum && sum.categories ? sum.categories.slice(0, 5) : []).map(function (c) {
      return el('span', { class: 'chip', text: c.category + ' ' + c.rows });
    });
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor the snapshot sets: its 40 protocols, each with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds every other rankable pre-token protocol below that floor — ' + DATA.early_size + ' of them — so the board is the watchlist plus the whole pre-token field beneath it. Sixty-three rankable pre-token protocols sit above the floor but outside the watchlist, mostly bridges and liquid-staking wrappers the snapshot leaves out; they are not ranked here. Implied value is a model, not a promise: it says a protocol records no token, never that it has none.' }),
        el('p', { class: 'top-pick', text: 'Top of the board: ' + (top ? top.name + ' at ' + fmtUsd(top.implied_value_usd) + ' implied value.' : '—') }),
        el('p', { class: 'band-line', text: 'Readiness: ' + (sum ? sum.hot_count + ' hot, ' + sum.warm_count + ' warm, ' + sum.watch_count + ' watch.' : '') + ' Hot means growing with a long record and no token; watch means falling hard or too young to judge.' }),
        el('div', { class: 'chips' }, el('span', { class: 'sub', text: 'Biggest categories: ' }), cats)
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Board TVL' }), el('b', { text: fmtUsd(sum ? sum.board_tvl_usd : 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(sum ? sum.median_implied_usd : 0) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (all, r) { return all.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var bandSelect = el('select', { id: 'band', 'aria-label': 'Filter by readiness band' },
      el('option', { value: 'all', text: 'All bands' }),
      ['hot', 'warm', 'watch'].map(function (b) { return el('option', { value: b, text: b.charAt(0).toUpperCase() + b.slice(1), selected: b === state.band ? 'selected' : null }); })
    );
    bandSelect.addEventListener('change', function () { state.band = bandSelect.value; writeHash(); render(); });
    var watchBtn = el('button', { type: 'button', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    var movers = el('button', { type: 'button', 'aria-pressed': state.tab === 'movers' ? 'true' : 'false', text: 'Top movers', onclick: function () { state.tab = 'movers'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('label', { for: 'band', text: 'Readiness' }), bandSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchBtn),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live, movers)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'movers' ? (DATA.movers ? DATA.movers.length : 0) + ' fastest growers' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.band = 'all'; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', { class: 'badges' },
          el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'watchlist' : 'early' }),
          el('span', { class: 'badge band-' + (r.band || 'watch'), text: r.band || 'watch' })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function moversTable() {
    var list = DATA.movers || [];
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num pos', text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
        el('td', null, el('span', { class: 'badge band-' + (r.band || 'watch'), text: r.band || 'watch' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'The ten pre-token protocols whose TVL grew fastest over seven days. Momentum before a token — select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Rank' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Age' }),
            el('th', { scope: 'col', text: 'Implied value' }),
            el('th', { scope: 'col', text: 'Readiness' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x growth x maturity x chains )'
      ),
      el('ul', { class: 'model-list' },
        el('li', { text: 'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight_up + ' on a gain, x ' + m.growth_weight_down + ' on a loss. A falling TVL is penalised harder than a rising one is rewarded.' }),
        el('li', { text: 'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + '. Age is the time since the protocol was first listed; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
        el('li', { text: 'chains = 1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_steps + '). More chains means more users reached and less dependence on one chain.' })
      ),
      el('p', { class: 'sub', text: 'The early radar is every rankable pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown. A protocol records no token; the snapshot cannot prove it has none.' }),
      el('p', { class: 'sub', text: 'Readiness is a reading aid, not a rank: hot when TVL is growing and the protocol has run a long time with no token, warm when it is holding its ground, watch when its TVL is falling hard or it is under 90 days old.' }),
      el('h3', { text: 'Where the board lives' }),
      el('div', { class: 'chainbars' }, (DATA.summary && DATA.summary.chains ? DATA.summary.chains : []).map(function (c) {
        var max = DATA.summary.chains[0] ? DATA.summary.chains[0].rows : 1;
        return el('div', { class: 'chainbar' },
          el('span', { text: c.chain }),
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.rows / max) * 100)) + '%' })),
          el('b', { class: 'num', text: String(c.rows) })
        );
      }))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early') + ' · ' + (row.band || 'watch') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('div', null,
        el('button', { class: 'close', type: 'button', 'aria-label': 'Copy a link to this protocol', text: 'Copy link', onclick: function (e) {
          var link = window.location.href;
          var done = function () { e.target.textContent = 'Copied'; setTimeout(function () { e.target.textContent = 'Copy link'; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, done);
          else done();
        } }),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
      )
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String(row.chains ? row.chains.length : 0) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. It records no token; that is not proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : state.tab === 'movers' ? moversTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
