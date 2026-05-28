'use strict';

let currentFilterMode = 'union';
let currentRegionFilter = 'all';
let currentGenderFilter = 'all';
let activePekerjaan = new Set();
let PekerjaanButtons = {};
let BootstrapDataIsLoaded = false;

// 1. Fungsi Persiapan
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  if (typeof processHashChange === 'function') processHashChange();
}

// 2. Fungsi Pemuat Utama (Anti-Macet)
function loadPrimaryData() {
  doPreProcessing();

  fetch('data-tokoh.json')
    .then(response => {
        if (!response.ok) throw new Error("File 'data-tokoh.json' tidak ditemukan.");
        return response.json();
    })
    .then(data => {
      if (!data || !data.results || !data.results.bindings) throw new Error("Format JSON salah!");

      data.results.bindings.forEach(result => {
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

        if (result.provinsiLabel && record.tempatLahirQid) {
          PetaProvinsi[record.tempatLahirQid] = result.provinsiLabel.value;
        }
      });

      return populateProvinceMapping();
    })
    .then(() => {
      BootstrapDataIsLoaded = true;
      buildDynamicIndices();
      populateMapAndIndex();
      updateFeatureCounts();
      if (typeof enableApp === 'function') enableApp();
    })
    .catch(error => {
      console.error("Kesalahan Sistem:", error);
      alert("Memuat dalam Mode Darurat: Ada gangguan koneksi ke data (" + error.message + ").");
      
      BootstrapDataIsLoaded = true;
      buildDynamicIndices();
      populateMapAndIndex();
      updateFeatureCounts();
      if (typeof enableApp === 'function') enableApp();
    });
}

// 3. Fungsi Penyicil Provinsi
function populateProvinceMapping() {
  let tempatLahirSet = new Set();

  Object.values(Records).forEach(r => {
    if (r.tempatLahirQid && !PetaProvinsi[r.tempatLahirQid]) {
        tempatLahirSet.add(r.tempatLahirQid);
    }
  });

  if (tempatLahirSet.size === 0) return Promise.resolve();

  let qids = Array.from(tempatLahirSet);
  let chunks = [];
  for (let i = 0; i < qids.length; i += 150) {
      chunks.push(qids.slice(i, i + 150));
  }

  let chain = Promise.resolve();
  chunks.forEach((chunk) => {
      chain = chain.then(() => {
          let valuesClause = 'VALUES ?tempatLahir { ' + chunk.map(qid => `wd:${qid}`).join(' ') + ' }';
          let query = `SELECT DISTINCT ?tempatLahirQid ?provinsiLabel WHERE {
            VALUES ?provinsi { wd:Q1823 wd:Q3125978 wd:Q3540 wd:Q1890 wd:Q3741 wd:Q3630 wd:Q5067 wd:Q2051 wd:Q3724 wd:Q3557 wd:Q3586 wd:Q3916 wd:Q3906 wd:Q3891 wd:Q3899 wd:Q3903 wd:Q1866 wd:Q2223 wd:Q2110 wd:Q5093 wd:Q5094 wd:Q5062 wd:Q5061 wd:Q5095 wd:Q5096 wd:Q115253263 wd:Q112810104 wd:Q61439296 wd:Q12486766 wd:Q2175 wd:Q5082 wd:Q5078 wd:Q5065 wd:Q5075 wd:Q5068 wd:Q2772 wd:Q2271 wd:Q2140 }
            ${valuesClause}
            ?tempatLahir wdt:P131* ?provinsi .
            ?provinsi rdfs:label ?provLabel .
            FILTER(LANG(?provLabel) = "id")
            BIND (SUBSTR(STR(?tempatLahir), 32) AS ?tempatLahirQid) .
            BIND (STR(?provLabel) AS ?provinsiLabel) .
          }`;

          let url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query) + '&origin=*';
          return fetch(url)
          .then(res => res.json())
          .then(data => {
              if(data && data.results && data.results.bindings) {
                  data.results.bindings.forEach(result => {
                      PetaProvinsi[result.tempatLahirQid.value] = result.provinsiLabel.value;
                  });
              }
          })
          .catch(err => console.log("Gagal menyicil provinsi (Abaikan jika mode lokal):", err));
      });
  });

  return chain;
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

    if (record.lat && record.lon && typeof L !== 'undefined') {
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

  if (typeof Cluster !== 'undefined') Cluster.addLayers(mapMarkers);
  generateFilterSelect();
}

// 6. Pembuat Filter Dinamis UI
function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let containerPekerjaan = document.getElementById('filter-pekerjaan-buttons');
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  let modeSelect = document.getElementById('filter-mode-select');

  let applyFilters = function() {
    updateFeatureCounts();
    applyIntersectionFilter();
  };

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

    if (BirthplaceIndex['Indonesia (Umum)']) sortedRegions.push('Indonesia (Umum)');
    if (BirthplaceIndex['Luar Negeri']) sortedRegions.push('Luar Negeri');

    sortedRegions.forEach(lbl => {
      let option = document.createElement('option');
      option.value = lbl;
      option.textContent = `${lbl} – ${BirthplaceIndex[lbl].total} Tokoh`;
      selectRegion.appendChild(option);
    });

    selectRegion.addEventListener('change', function() { applyFilters(); this.blur(); });
  }

  if(selectGender) selectGender.addEventListener('change', function() { applyFilters(); this.blur(); });
  if (modeSelect) modeSelect.addEventListener('change', function() { applyFilters(); this.blur(); });

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

        if (activePekerjaan.size === 0) btnAllPekerjaan.classList.add('active');
        else btnAllPekerjaan.classList.remove('active');

        applyFilters();
      });

      containerPekerjaan.appendChild(btn);
      featButtons.push(btn);
    });

    btnAllPekerjaan.addEventListener('click', function() {
      activePekerjaan.clear();
      this.classList.add('active');
      featButtons.forEach(b => b.classList.remove('active'));
      applyFilters();
    });
  }
}

// 7. Kalkulator Tombol Angka Dinamis (Ditingkatkan Kecepatannya)
function updateFeatureCounts() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeSelect = document.getElementById('filter-mode-select');

  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
  let activeMode = modeSelect ? modeSelect.value : 'union';
  let activePkjArr = Array.from(activePekerjaan);
  let activePkjSize = activePkjArr.length;

  let totalUnion = 0; let totalIntersection = 0;
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
    if (activePkjSize > 0) {
      if (activeMode === 'union') matchPekerjaan = activePkjArr.some(pkj => record.pekerjaan.has(pkj));
      else matchPekerjaan = activePkjArr.every(pkj => record.pekerjaan.has(pkj));
    }

    if (matchRegion && matchGender) {
      record.pekerjaan.forEach(pkj => { if (tempJobCounts[pkj] !== undefined) tempJobCounts[pkj]++; });
      if (activePkjSize > 0) {
        if (activePkjArr.some(pkj => record.pekerjaan.has(pkj))) totalUnion++;
        if (activePkjArr.every(pkj => record.pekerjaan.has(pkj))) totalIntersection++;
      } else {
        totalUnion++; totalIntersection++;
      }
    }

    if (matchGender && matchPekerjaan) {
      tempRegionCounts['all']++;
      if (!record.areaTags.has('Luar Negeri')) tempRegionCounts['indonesia_only']++;
      record.areaTags.forEach(tag => { if (tempRegionCounts[tag] !== undefined) tempRegionCounts[tag]++; });
    }

    if (matchRegion && matchPekerjaan) {
      tempGenderCounts['all']++;
      if (record.jenisKelamin === 'Laki-laki') tempGenderCounts['Laki-laki']++;
      if (record.jenisKelamin === 'Perempuan') tempGenderCounts['Perempuan']++;
    }
  });

  if (selectRegion) {
    Array.from(selectRegion.options).forEach(opt => {
      let val = opt.value, count = tempRegionCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Tempat Lahir – ${count} Tokoh`;
      else if (val === 'indonesia_only') opt.textContent = `Seluruh Indonesia – ${count} Tokoh`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  if (selectGender) {
    Array.from(selectGender.options).forEach(opt => {
      let val = opt.value, count = tempGenderCounts[val] || 0;
      if (val === 'all') opt.textContent = `Semua Jenis Kelamin – ${count} Tokoh`;
      else opt.textContent = `${val} – ${count} Tokoh`;
    });
  }

  Object.keys(tempJobCounts).forEach(pkj => {
    if (PekerjaanButtons[pkj]) PekerjaanButtons[pkj].textContent = `${PekerjaanIndex[pkj].label} (${tempJobCounts[pkj]})`;
  });

  let sortedJobs = Object.keys(tempJobCounts).sort((a, b) => {
     if (tempJobCounts[b] !== tempJobCounts[a]) return tempJobCounts[b] - tempJobCounts[a];
     return PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label);
  });
  sortedJobs.forEach((pkj, index) => { if (PekerjaanButtons[pkj]) PekerjaanButtons[pkj].style.order = index + 1; });
  
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  if (btnAllPekerjaan) btnAllPekerjaan.style.order = 0;

  if (modeSelect) {
    modeSelect.options[0].textContent = `Tampilkan Semua – ${totalUnion} Tokoh`;
    modeSelect.options[1].textContent = `Hanya Irisan – ${totalIntersection} Tokoh (pilih min. 2 pekerjaan)`;
  }
}

// 8. Mesin Eksekutor Gabungan/Irisan
function applyIntersectionFilter() {
  let selectRegion = document.getElementById('filter-region');
  let selectGender = document.getElementById('filter-gender');
  let modeSelect = document.getElementById('filter-mode-select');

  let activeRegion = selectRegion ? selectRegion.value : 'all';
  let activeGender = selectGender ? selectGender.value : 'all';
  let activeMode = modeSelect ? modeSelect.value : 'union';
  let activePkjArr = Array.from(activePekerjaan);
  let activePkjSize = activePkjArr.length;

  if (typeof Cluster !== 'undefined') Cluster.clearLayers();
  
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
    if (activePkjSize > 0) {
      if (activeMode === 'union') matchPekerjaan = activePkjArr.some(pkj => record.pekerjaan.has(pkj));
      else matchPekerjaan = activePkjArr.every(pkj => record.pekerjaan.has(pkj));
    }

    return matchRegion && matchGender && matchPekerjaan;
  }).sort((a, b) => a.indexTitle.localeCompare(b.indexTitle));

  validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
    if (record.indexLi && ol) ol.appendChild(record.indexLi);
  });

  if (validMarkers.length > 0 && typeof Cluster !== 'undefined') {
    Cluster.addLayers(validMarkers);
    let bounds = Cluster.getBounds();
    if (bounds && Object.keys(bounds).length > 0 && typeof Map !== 'undefined') {
       Map.fitBounds(bounds);
    }
  }
}

// 9. Fungsi Pemantik Klik Tokoh
function activateSite(qid) {
  if (typeof displayRecordDetails === 'function') displayRecordDetails(qid);
  let record = Records[qid];

  if (record && record.mapMarker && typeof Cluster !== 'undefined' && typeof Map !== 'undefined') {
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      }
    );
  }
}

// 10, 11, 12, dst...
// (Anda bisa membiarkan sisa fungsi Class Record, API Wikipedia, dll seperti aslinya di bawah sini, tidak perlu diubah)
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
