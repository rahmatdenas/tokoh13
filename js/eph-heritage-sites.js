'use strict';

let currentFilterMode = 'union';
let currentRegionFilter = 'all';
let currentGenderFilter = 'all'; // <--- [BARU] Variabel untuk filter jenis kelamin
let activePekerjaan = new Set();
let PekerjaanButtons = {};

// 1. Fungsi Persiapan
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

// 2. Fungsi Pemuat Utama (Super Cepat dengan File Lokal)
function loadPrimaryData() {
  doPreProcessing();

  // Membaca kedua file JSON secara serentak (paralel) agar sangat cepat
  Promise.all([
    fetch('peta-provinsi.json').then(res => {
        if (!res.ok) throw new Error("File 'peta-provinsi.json' tidak ditemukan.");
        return res.json();
    }),
    fetch('data-tokoh.json').then(res => {
        if (!res.ok) throw new Error("File 'data-tokoh.json' tidak ditemukan.");
        return res.json();
    })
  ])
  .then(([dataProvinsi, dataTokoh]) => {
    // A. Menyusun kamus provinsi dari file yang baru Anda unduh
    if (dataProvinsi && dataProvinsi.results && dataProvinsi.results.bindings) {
       dataProvinsi.results.bindings.forEach(row => {
           if (row.tempatLahirQid && row.provinsiLabel) {
               PetaProvinsi[row.tempatLahirQid.value] = row.provinsiLabel.value;
           }
       });
    }

    // B. Mengeksekusi 21.000 data tokoh utama
    if (!dataTokoh || !dataTokoh.results || !dataTokoh.results.bindings) {
       throw new Error("Format JSON Tokoh salah!");
    }

    dataTokoh.results.bindings.forEach(result => {
      if (!result.site || !result.site.value) return;

      let qid = result.site.value.split('/').pop();
      if (!(qid in Records)) Records[qid] = new Record();
      let record = Records[qid];

      record.title = result.siteLabel ? result.siteLabel.value : `Tokoh (${qid})`;
      record.indexTitle = record.title;
      if (result.tempatLahirUrl) record.tempatLahirQid = result.tempatLahirUrl.value.split('/').pop();

      if (result.coord) {
        let wktBits = result.coord.value.split(/\(|\)| /);
        if (wktBits.length >= 3) {
            record.lat = parseFloat(wktBits[2]);
            record.lon = parseFloat(wktBits[1]);
        }
      }

      if (result.image && !record.imageFilename && typeof extractImageFilename === 'function') {
         record.imageFilename = extractImageFilename(result.image);
      }
      if (result.wikiTitle) record.articleTitle = decodeURIComponent(result.wikiTitle.value);

      if (result.genderUrl) {
         let genderQid = result.genderUrl.value.split('/').pop();
         if (typeof KAMUS_GENDER !== 'undefined' && KAMUS_GENDER[genderQid]) {
            record.jenisKelamin = KAMUS_GENDER[genderQid];
         }
      }

      if (result.pekerjaanList) {
         let jobs = result.pekerjaanList.value.split(',');
         jobs.forEach(jobUrl => {
             let jobQid = jobUrl.split('/').pop();
             if (typeof KAMUS_PEKERJAAN !== 'undefined' && KAMUS_PEKERJAAN[jobQid]) {
                record.pekerjaan.add(KAMUS_PEKERJAAN[jobQid]);
             }
         });
      }
      
      // Jika JSON tokoh kebetulan sudah membawa label provinsinya sendiri, gabungkan
      if (result.provinsiLabel && record.tempatLahirQid) {
         PetaProvinsi[record.tempatLahirQid] = result.provinsiLabel.value;
      }
    });

    // --- [BARU] PENCEGAT WILAYAH HISTORIS / KHUSUS ---
    // Memaksa QID entitas khusus ini agar memiliki label valid & tidak terbuang ke "Luar Negeri"
    // Penempatannya di sini memastikan data kotor dari Wikidata akan tertimpa secara permanen.
    PetaProvinsi['Q252'] = 'Indonesia (Umum)';
    PetaProvinsi['Q188161'] = 'Hindia Belanda';
    // -------------------------------------------------

    // C. Data selesai, bangun peta dan matikan layar loading
    BootstrapDataIsLoaded = true;
    buildDynamicIndices();
    populateMapAndIndex();
    updateFeatureCounts();
    if (typeof enableApp === 'function') enableApp();
  })
  .catch(error => {
    console.error("Kesalahan Sistem:", error);
    alert("Gagal memuat data: " + error.message);
  });
}

// 4. Pembangun Indeks
function buildDynamicIndices() {
  BirthplaceIndex = { all: new IndexEntry() };
  PekerjaanIndex = { all: new IndexEntry() };

  Object.values(Records).forEach(record => {
    BirthplaceIndex.all.total++;
    PekerjaanIndex.all.total++;

    let regionLabel = "Luar Negeri";
    if (record.tempatLahirQid && PetaProvinsi[record.tempatLahirQid]) {
      regionLabel = PetaProvinsi[record.tempatLahirQid];
    }

    record.provinsiLabel = regionLabel;
    record.areaTags.add(regionLabel);

    if (!(regionLabel in BirthplaceIndex)) {
      BirthplaceIndex[regionLabel] = new IndexEntry();
      BirthplaceIndex[regionLabel].label = regionLabel;
    }
    BirthplaceIndex[regionLabel].total++;

    record.pekerjaan.forEach(pkj => {
      if (!(pkj in PekerjaanIndex)) {
        PekerjaanIndex[pkj] = new IndexEntry();
        PekerjaanIndex[pkj].label = pkj;
      }
      PekerjaanIndex[pkj].total++;
    });
  });
}

// 5. Perenderan Peta & Marker
function populateMapAndIndex() {
  let listIndex = document.getElementById('index-list');
  let mapMarkers = [];

  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];

    if (record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: L.ExtraMarkers.icon({ icon: 'fa-user', markerColor : 'orange-dark', prefix: 'fa' }) }
      );
      record.mapMarker = mapMarker;
      mapMarker.bindPopup(record.title, { closeButton: false });

      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;

      mapMarkers.push(mapMarker);
    }

    let li = document.createElement('li');
    li.innerHTML = `<a href="#${qid}" id="idx-${qid}">${record.indexTitle}</a>`;
    record.indexLi = li;
    if(listIndex) listIndex.appendChild(li);
  });

  Cluster.addLayers(mapMarkers);
  generateFilterSelect();
  processHashChange();
}

// 6. Pembuat Filter Dinamis UI
function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender'); // <--- [BARU] Menangkap elemen select gender
  let containerPekerjaan = document.getElementById('filter-pekerjaan-buttons');
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');

  if(selectRegion) {
    let totalLuarNegeri = BirthplaceIndex['Luar Negeri'] ? BirthplaceIndex['Luar Negeri'].total : 0;
    let totalIndonesia = BirthplaceIndex.all.total - totalLuarNegeri;

    selectRegion.innerHTML = `
      <option value="all">Semua Tempat Lahir – ${BirthplaceIndex.all.total} Tokoh</option>
      <option value="indonesia_only">Seluruh Indonesia – ${totalIndonesia} Tokoh</option>
    `;

    let sortedRegions = Object.keys(BirthplaceIndex)
      .filter(lbl => lbl !== 'all' && lbl !== 'Luar Negeri' && lbl !== 'Indonesia (Umum)')
      .sort((a, b) => a.localeCompare(b));

    if (BirthplaceIndex['Indonesia (Umum)']) {
      sortedRegions.push('Indonesia (Umum)');
    }
    if (BirthplaceIndex['Luar Negeri']) {
      sortedRegions.push('Luar Negeri');
    }

    sortedRegions.forEach(lbl => {
      let option = document.createElement('option');
      option.value = lbl;
      option.textContent = `${lbl} – ${BirthplaceIndex[lbl].total} Tokoh`;
      selectRegion.appendChild(option);
    });

    selectRegion.addEventListener('change', function() {
      currentRegionFilter = this.value;
      updateFeatureCounts();
      applyIntersectionFilter();
      this.blur();
    });
  }

  // <--- [BARU] Event Listener untuk Filter Jenis Kelamin
  if(selectGender) {
    selectGender.addEventListener('change', function() {
      currentGenderFilter = this.value;
      updateFeatureCounts();
      applyIntersectionFilter();
      this.blur();
    });
  }

  if (containerPekerjaan && btnAllPekerjaan) {
    let sortedPekerjaan = Object.keys(PekerjaanIndex)
      .filter(label => label !== 'all')
      .sort((a, b) => PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label));

    let featButtons = [];
    PekerjaanButtons = {};

    sortedPekerjaan.forEach(pkj => {
      let btn = document.createElement('button');
      btn.className = 'feat-btn';
      btn.setAttribute('data-filter', pkj);
      btn.textContent = `${PekerjaanIndex[pkj].label} (${PekerjaanIndex[pkj].total})`;

      PekerjaanButtons[pkj] = btn;

      btn.addEventListener('click', function() {
        let filterType = this.getAttribute('data-filter');

        if (activePekerjaan.has(filterType)) {
          activePekerjaan.delete(filterType);
          this.classList.remove('active');
        } else {
          activePekerjaan.add(filterType);
          this.classList.add('active');
        }

        if (activePekerjaan.size === 0) {
          btnAllPekerjaan.classList.add('active');
        } else {
          btnAllPekerjaan.classList.remove('active');
        }

        updateFeatureCounts();
        applyIntersectionFilter();
      });

      containerPekerjaan.appendChild(btn);
      featButtons.push(btn);
    });

    btnAllPekerjaan.addEventListener('click', function() {
      activePekerjaan.clear();
      this.classList.add('active');
      featButtons.forEach(b => b.classList.remove('active'));
      updateFeatureCounts();
      applyIntersectionFilter();
    });
  }

  let modeSelect = document.getElementById('filter-mode-select');
  if (modeSelect) {
    modeSelect.addEventListener('change', function() {
      currentFilterMode = this.value;
      applyIntersectionFilter();
      this.blur();
    });
  }
}
// 7. Kalkulator Tombol Angka (Dinamis)
function updateFeatureCounts() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeSelect = document.getElementById('filter-mode-select');

  // BACA LANGSUNG DARI DOM
  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
  let activeMode = modeSelect ? modeSelect.value : 'union';

  let totalUnion = 0;
  let totalIntersection = 0;
  let tempJobCounts = {};
  let tempRegionCounts = { 'all': 0, 'indonesia_only': 0 };
  let tempGenderCounts = { 'all': 0, 'Laki-laki': 0, 'Perempuan': 0 };

  Object.keys(PekerjaanIndex).forEach(pkj => { if (pkj !== 'all') tempJobCounts[pkj] = 0; });
  Object.keys(BirthplaceIndex).forEach(region => { if (region !== 'all') tempRegionCounts[region] = 0; });

  Object.values(Records).forEach(record => {
    let matchRegion = false;
    if (activeRegion === 'all') matchRegion = true;
    else if (activeRegion === 'indonesia_only') matchRegion = !record.areaTags.has('Luar Negeri');
    else matchRegion = record.areaTags.has(activeRegion);

    let matchGender = false;
    if (activeGender === 'all') matchGender = true;
    else if (activeGender === record.jenisKelamin) matchGender = true;

    let matchPekerjaan = true;
    if (activePekerjaan.size > 0) {
      if (activeMode === 'union') {
        matchPekerjaan = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
      } else {
        matchPekerjaan = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
    }

    if (matchRegion && matchGender) {
      record.pekerjaan.forEach(pkj => {
        if (tempJobCounts[pkj] !== undefined) tempJobCounts[pkj]++;
      });
      let hasAny = true; let hasAll = true;
      if (activePekerjaan.size > 0) {
        hasAny = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
        hasAll = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
      if (hasAny) totalUnion++;
      if (hasAll) totalIntersection++;
    }

    if (matchGender && matchPekerjaan) {
      tempRegionCounts['all']++;
      if (!record.areaTags.has('Luar Negeri')) tempRegionCounts['indonesia_only']++;
      record.areaTags.forEach(tag => {
        if (tempRegionCounts[tag] !== undefined) tempRegionCounts[tag]++;
      });
    }

    if (matchRegion && matchPekerjaan) {
      tempGenderCounts['all']++;
      if (record.jenisKelamin === 'Laki-laki') tempGenderCounts['Laki-laki']++;
      if (record.jenisKelamin === 'Perempuan') tempGenderCounts['Perempuan']++;
    }
  });

  if (selectRegion) {
    Array.from(selectRegion.options).forEach(opt => {
      let val = opt.value;
      let count = tempRegionCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Tempat Lahir – ${count} Tokoh`;
      else if (val === 'indonesia_only') opt.textContent = `Seluruh Indonesia – ${count} Tokoh`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  if (selectGender) {
    Array.from(selectGender.options).forEach(opt => {
      let val = opt.value;
      let count = tempGenderCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Jenis Kelamin – ${count} Tokoh`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  Object.keys(tempJobCounts).forEach(pkj => {
    if (PekerjaanButtons[pkj]) {
      PekerjaanButtons[pkj].textContent = `${PekerjaanIndex[pkj].label} (${tempJobCounts[pkj]})`;
    }
  });

  let sortedJobs = Object.keys(tempJobCounts).sort((a, b) => {
     if (tempJobCounts[b] !== tempJobCounts[a]) return tempJobCounts[b] - tempJobCounts[a];
     return PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label);
  });

  sortedJobs.forEach((pkj, index) => {
     if (PekerjaanButtons[pkj]) PekerjaanButtons[pkj].style.order = index + 1;
  });

  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  if (btnAllPekerjaan) btnAllPekerjaan.style.order = 0;

  if (modeSelect) {
    modeSelect.options[0].textContent = `Tampilkan Semua – ${totalUnion} Tokoh`;
    modeSelect.options[1].textContent = `Hanya Irisan – ${totalIntersection} Tokoh (pilih min. 2 pekerjaan)`;
  }
}

// 8. Mesin Eksekutor Gabungan/Irisan
function applyIntersectionFilter() {
  // BACA LANGSUNG DARI DOM
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeSelect = document.getElementById('filter-mode-select');

  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
  let activeMode = modeSelect ? modeSelect.value : 'union';

  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  if(ol) ol.innerHTML = '';

  let validMarkers = [];

  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = false;
    if (activeRegion === 'all') matchRegion = true;
    else if (activeRegion === 'indonesia_only') matchRegion = !record.areaTags.has('Luar Negeri');
    else matchRegion = record.areaTags.has(activeRegion);

    let matchGender = false;
    if (activeGender === 'all') matchGender = true;
    else if (activeGender === record.jenisKelamin) matchGender = true;

    let matchPekerjaan = true;
    if (activePekerjaan.size > 0) {
      if (activeMode === 'union') {
        matchPekerjaan = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
      } else {
        matchPekerjaan = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
    }

    // Hanya merender yang benar-benar lolos TIGA filter di atas
    return matchRegion && matchGender && matchPekerjaan;
  }).sort((a, b) => {
    return a.indexTitle.localeCompare(b.indexTitle);
  });

  validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
    if (record.indexLi && ol) ol.appendChild(record.indexLi);
  });

  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    let bounds = Cluster.getBounds();
    if (bounds && Object.keys(bounds).length > 0) {
       Map.fitBounds(bounds);
    }
  }
}

// 10. Live Fetch Profil & Wikipedia dari Wikidata
function generateRecordDetails(qid) {
  let record = Records[qid];

  let titleHtml = `<h1 id="title-header-${qid}">Memuat nama...</h1>`;
  let figureHtml = generateFigure(record.imageFilename);

  let articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';

  let infoHtml = '<h2>Informasi Profil</h2><ul class="designations">';
  infoHtml += `<li><p><strong>Tempat Lahir:</strong> <span id="lokasi-${qid}">Memuat lokasi...</span> (${record.provinsiLabel})</p></li>`;

  if (record.jenisKelamin) infoHtml += `<li><p><strong>Jenis Kelamin:</strong> ${record.jenisKelamin}</p></li>`;

  if (record.pekerjaan.size > 0) {
    let pkjList = Array.from(record.pekerjaan).join(', ');
    infoHtml += `<li><p><strong>Pekerjaan:</strong> ${pkjList}</p></li>`;
  }
  infoHtml += '</ul>';

  let panelElem = document.createElement('div');
  panelElem.innerHTML =
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" target="_blank" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml + figureHtml + articleHtml + infoHtml;

  record.panelElem = panelElem;

  let queryIds = qid;
  if (record.tempatLahirQid) queryIds += `|${record.tempatLahirQid}`;

  fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${queryIds}&props=labels|sitelinks&languages=id|en&format=json&origin=*`)
    .then(res => res.json())
    .then(data => {
        let entPerson = data.entities[qid];
        if (entPerson) {
          let realName = entPerson.labels.id ? entPerson.labels.id.value : (entPerson.labels.en ? entPerson.labels.en.value : qid);

          let headerEl = document.getElementById(`title-header-${qid}`);
          if(headerEl) headerEl.textContent = realName;

          let idxEl = document.getElementById(`idx-${qid}`);
          if(idxEl) idxEl.textContent = realName;

          if(record.mapMarker) record.mapMarker.setPopupContent(realName);
          record.title = realName;
          record.indexTitle = realName;

          let articleContainer = panelElem.querySelector('.article');
          if (entPerson.sitelinks && entPerson.sitelinks.idwiki) {
              let wikiTitle = entPerson.sitelinks.idwiki.title;
              displayArticleExtract(wikiTitle, articleContainer);
          } else {
              articleContainer.innerHTML = '<p><em>Tokoh ini belum memiliki artikel Wikipedia berbahasa Indonesia.</em></p>';
              articleContainer.classList.remove('loading');
          }
        }

        if (record.tempatLahirQid) {
          let entCity = data.entities[record.tempatLahirQid];
          if (entCity) {
            let cityName = entCity.labels.id ? entCity.labels.id.value : (entCity.labels.en ? entCity.labels.en.value : record.tempatLahirQid);
            let lokEl = document.getElementById(`lokasi-${qid}`);
            if(lokEl) lokEl.textContent = cityName;
          }
        }
    })
    .catch(err => console.log("Gagal memuat API dari Wikidata", err));
}

// 11. Penarik Artikel Wikipedia
function displayArticleExtract(title, elem) {
  let apiUrl = `https://id.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&redirects=true&titles=${encodeURIComponent(title)}&origin=*`;

  fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
      let pages = data.query.pages;
      let pageId = Object.keys(pages)[0];
      let extract = pages[pageId].extract;

      if (extract) {
          let paragraphs = extract.match(/<p[^>]*>[\s\S]*?<\/p>/g);
          let validText = paragraphs ? paragraphs.find(text => text.length > 50) : extract;
          if (!validText) validText = extract;

          elem.innerHTML = validText +
            '<p class="wikipedia-link">' +
              `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
                '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
                '<span>Baca selengkapnya di Wikipedia</span>' +
              '</a>' +
            '</p>';
      } else {
          elem.innerHTML = '<p><em>Cuplikan artikel belum tersedia di Wikipedia.</em></p>';
      }

      elem.classList.remove('loading');
    })
    .catch(error => {
      console.error("Gagal menarik data Wikipedia:", error);
      elem.innerHTML = '<p><em>Gagal memuat cuplikan. Periksa koneksi internet Anda.</em></p>';
      elem.classList.remove('loading');
    });
}

// 12. Kelas Struktur Data
class IndexEntry {
  constructor() {
    this.label = '';
    this.total = 0;
  }
}

class Record {
  constructor() {
    this.title = undefined;
    this.imageFilename = '';
    this.articleTitle = undefined;

    this.tempatLahirQid = undefined;
    this.provinsiLabel = undefined;
    this.jenisKelamin = undefined;
    this.pekerjaan = new Set();

    this.lat = undefined;
    this.lon = undefined;
    this.mapMarker = undefined;
    this.popup = undefined;
    this.panelElem = undefined;
    this.indexLi = undefined;
    this.areaTags = new Set();
  }
}
