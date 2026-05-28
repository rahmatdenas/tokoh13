'use strict';

// Fungsi persiapan awal (JANGAN DIHAPUS)
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  if (anchorElem) anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

// Fungsi pembaca "Super JSON" (PENGGANTI SEMUA FUNGSI POPULATE)
function loadPrimaryData() {
  doPreProcessing(); // <-- Memanggil fungsi di atas

  fetch('data-tokoh.json')
    .then(response => response.json())
    .then(data => {
      data.results.bindings.forEach(result => {
        
        let qid = result.site.value.split('/').pop();
        if (!(qid in Records)) Records[qid] = new Record();
        let record = Records[qid];

        // 1. Nama & Tempat Lahir
        record.title = result.siteLabel ? result.siteLabel.value : `Tokoh (${qid})`;
        record.indexTitle = record.title;
        if (result.tempatLahirUrl) record.tempatLahirQid = result.tempatLahirUrl.value.split('/').pop();

        // 2. Koordinat
        if (result.coord) {
          let wktBits = result.coord.value.split(/\(|\)| /);
          record.lat = parseFloat(wktBits[2]);
          record.lon = parseFloat(wktBits[1]);
        }

        // 3. Foto & Wikipedia
        if (result.image && !record.imageFilename) record.imageFilename = extractImageFilename(result.image);
        if (result.wikiTitle) record.articleTitle = decodeURIComponent(result.wikiTitle.value);

        // 4. Demografi (Gender)
        if (result.genderUrl) {
           let genderQid = result.genderUrl.value.split('/').pop();
           if (KAMUS_GENDER[genderQid]) record.jenisKelamin = KAMUS_GENDER[genderQid];
        }

        // 5. Pekerjaan Ganda
        if (result.pekerjaanList) {
           let jobs = result.pekerjaanList.value.split(',');
           jobs.forEach(jobUrl => {
               let jobQid = jobUrl.split('/').pop();
               if (KAMUS_PEKERJAAN[jobQid]) {
                   record.pekerjaan.add(KAMUS_PEKERJAAN[jobQid]);
               }
           });
        }

        // 6. Pemetaan Provinsi
        if (result.provinsiLabel && record.tempatLahirQid) {
          PetaProvinsi[record.tempatLahirQid] = result.provinsiLabel.value;
        }
      });

      BootstrapDataIsLoaded = true;
      buildDynamicIndices();
      populateMapAndIndex();
      updateFeatureCounts();
      enableApp();
    })
    .catch(error => {
      console.error("Gagal membaca JSON lokal.", error);
    });
}

function buildDynamicIndices() {
  BirthplaceIndex = { all: new IndexEntry() };
  PekerjaanIndex = { all: new IndexEntry() };
  
  Object.values(Records).forEach(record => {
    BirthplaceIndex.all.total++;
    PekerjaanIndex.all.total++; 
    
    // MENENTUKAN KERANJANG PROVINSI ATAU LUAR NEGERI
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
let currentFilterMode = 'union';
let currentRegionFilter = 'all';
let activePekerjaan = new Set(); 
let PekerjaanButtons = {};

function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let containerPekerjaan = document.getElementById('filter-pekerjaan-buttons');
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  
  if(selectRegion) {
    // 1. Hitung jumlah tokoh khusus Indonesia (Total semua dikurangi Luar Negeri)
    let totalLuarNegeri = BirthplaceIndex['Luar Negeri'] ? BirthplaceIndex['Luar Negeri'].total : 0;
    let totalIndonesia = BirthplaceIndex.all.total - totalLuarNegeri;

    // 2. Ganti teks awal dan tambahkan opsi "Seluruh Indonesia"
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
      currentFilterMode = this.value; // set nilai union atau intersection
      applyIntersectionFilter();
      this.blur();
    });
  }
}

function updateFeatureCounts() {
  let totalUnion = 0;
  let totalIntersection = 0;
  let tempJobCounts = {};

  Object.keys(PekerjaanIndex).forEach(pkj => {
    if (pkj !== 'all') tempJobCounts[pkj] = 0;
  });

  Object.values(Records).forEach(record => {
    // LOGIKA FILTER WILAYAH
    let matchRegion = false;
    if (currentRegionFilter === 'all') {
        matchRegion = true;
    } else if (currentRegionFilter === 'indonesia_only') {
        matchRegion = !record.areaTags.has('Luar Negeri'); 
    } else {
        matchRegion = record.areaTags.has(currentRegionFilter);
    }
    
    if (matchRegion) {
      record.pekerjaan.forEach(pkj => {
        if (tempJobCounts[pkj] !== undefined) {
          tempJobCounts[pkj]++;
        }
      });

      let hasAny = true;
      let hasAll = true;
      
      if (activePekerjaan.size > 0) {
        hasAny = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
        hasAll = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }

      if (hasAny) totalUnion++;
      if (hasAll) totalIntersection++;
    }
  });

  // 1. Perbarui angka teks di masing-masing tombol profesi
  Object.keys(tempJobCounts).forEach(pkj => {
    if (PekerjaanButtons[pkj]) {
      PekerjaanButtons[pkj].textContent = `${PekerjaanIndex[pkj].label} (${tempJobCounts[pkj]})`;
    }
  });

  // =========================================================
  // 2. LOGIKA BARU: MENGURUTKAN TOMBOL SECARA DINAMIS
  // =========================================================
  
  // Ambil daftar profesi, lalu urutkan seperti membuat ranking kelas
  let sortedJobs = Object.keys(tempJobCounts).sort((a, b) => {
     // A. Urutkan dari angka terbesar ke terkecil
     if (tempJobCounts[b] !== tempJobCounts[a]) {
         return tempJobCounts[b] - tempJobCounts[a];
     }
     // B. Jika angkanya kebetulan sama besar, urutkan sesuai abjad nama profesinya
     return PekerjaanIndex[a].label.localeCompare(PekerjaanIndex[b].label);
  });

  // Terapkan nomor antrean (order) ke setiap tombol
  sortedJobs.forEach((pkj, index) => {
     if (PekerjaanButtons[pkj]) {
        // Antrean dimulai dari 1 (karena posisi 0 kita simpan untuk Semua Pekerjaan)
        PekerjaanButtons[pkj].style.order = index + 1; 
     }
  });

  // Kunci tombol "Semua Pekerjaan" di posisi mutlak paling pertama (nilai order = 0)
  let btnAllPekerjaan = document.getElementById('btn-all-pekerjaan');
  if (btnAllPekerjaan) btnAllPekerjaan.style.order = 0; 
  // =========================================================

  let modeSelect = document.getElementById('filter-mode-select');
  if (modeSelect) {
    modeSelect.options[0].textContent = `Tampilkan Semua – ${totalUnion} Tokoh`;
    modeSelect.options[1].textContent = `Hanya Irisan – ${totalIntersection} Tokoh (pilih min. 2 pekerjaan)`;
  }
}

function applyIntersectionFilter() {
  Cluster.clearLayers();
  
  let ol = document.getElementById('index-list');
  if(ol) ol.innerHTML = ''; 
  
  let validMarkers = [];
  
  let validRecords = Object.values(Records).filter(record => {
    // LOGIKA FILTER WILAYAH BARU
    let matchRegion = false;
    if (currentRegionFilter === 'all') {
        matchRegion = true;
    } else if (currentRegionFilter === 'indonesia_only') {
        matchRegion = !record.areaTags.has('Luar Negeri'); // Selama bukan Luar Negeri, berarti Indonesia
    } else {
        matchRegion = record.areaTags.has(currentRegionFilter);
    }

    let matchPekerjaan = true;
    
    if (activePekerjaan.size > 0) {
      if (currentFilterMode === 'union') {
        matchPekerjaan = Array.from(activePekerjaan).some(pkj => record.pekerjaan.has(pkj));
      } else if (currentFilterMode === 'intersection') {
        matchPekerjaan = Array.from(activePekerjaan).every(pkj => record.pekerjaan.has(pkj));
      }
    }
    
    return matchRegion && matchPekerjaan;
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

function activateSite(qid) {
  displayRecordDetails(qid);
  let record = Records[qid];

  if (record && record.mapMarker) {
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      },
    );
  }
}

function generateRecordDetails(qid) {
  let record = Records[qid];
  
  let titleHtml = `<h1 id="title-header-${qid}">Memuat nama...</h1>`;
let figureHtml = generateFigure(record.imageFilename);

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  } else {
    articleHtml = '<div class="article main-text nodata"><p>Tokoh ini belum memiliki artikel Wikipedia berbahasa Indonesia.</p></div>';
  }

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
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml + figureHtml + articleHtml + infoHtml;  
  
  record.panelElem = panelElem;

  let queryIds = qid;
  if (record.tempatLahirQid) queryIds += `|${record.tempatLahirQid}`;

  fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${queryIds}&props=labels&languages=id|en&format=json&origin=*`)
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
    .catch(err => console.log("Gagal memuat label", err));

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));
}

function displayArticleExtract(title, elem) {
  loadJsonp(
    'https://id.wikipedia.org/w/api.php',
    {
      action    : 'query',
      format    : 'json',
      prop      : 'extracts',
      exintro   : 1,
      redirects : true,
      titles    : title,
    },
    function(data) {
      let extract = Object.values(data.query.pages)[0].extract;
      if (extract) {
          let paragraphs = extract.match(/<p[^]+?<\/p>/g);
          let validText = paragraphs ? paragraphs.find(text => text.length > 50) : extract;
          elem.innerHTML = validText +
            '<p class="wikipedia-link">' +
              `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}">` +
                '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
                '<span>Baca selengkapnya di Wikipedia</span>' +
              '</a>' +
            '</p>';
      } else {
          elem.innerHTML = '<p>Gagal memuat cuplikan artikel.</p>';
      }
      elem.classList.remove('loading');
    }
  );
}

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
