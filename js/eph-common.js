'use strict';

// Constants and fixed parameters
const WDQS_API_URL            = 'https://query.wikidata.org/sparql';
const COMMONS_WIKI_URL_PREF   = 'https://commons.wikimedia.org/wiki/';
const COMMONS_API_URL         = 'https://commons.wikimedia.org/w/api.php';
const YEAR_PRECISION          = '9';
const OSM_LAYER_URL           = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_LAYER_ATTRIBUTION   = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const CARTO_LAYER_URL         = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
const CARTO_LAYER_ATTRIBUTION = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (data), <a href="https://carto.com/">CARTO</a> (style)';
const TILE_LAYER_MAX_ZOOM     = 16;
const MIN_PH_LAT              =   0.3;
const MAX_PH_LAT              =  -2;
const MIN_PH_LON              = 98;
const MAX_PH_LON              = 102;

// Globals
var Records = {};
var SparqlValuesClause;
var Map;
var Cluster;
var BootstrapDataIsLoaded = false;
var PrimaryDataIsLoaded   = false;

window.addEventListener('load', init);

function init() {
  initMap();
  loadPrimaryData();
  window.addEventListener('hashchange', processHashChange);
  Map.on('popupopen', function(e) { displayRecordDetails(e.popup._qid) });
}

function initMap() {
  Map = new L.map('map');
  Map.fitBounds([[MAX_PH_LAT, MAX_PH_LON], [MIN_PH_LAT, MIN_PH_LON]]);

  let cartoLayer = new L.tileLayer(CARTO_LAYER_URL, {
    attribution : CARTO_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  }).addTo(Map);
  
  let osmLayer = new L.tileLayer(OSM_LAYER_URL, {
    attribution : OSM_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  });
  
  let baseMaps = {
    'CARTO Voyager'       : cartoLayer,
    'OpenStreetMap Carto' : osmLayer,
  };
  L.control.layers(baseMaps, null, {position: 'topleft'}).addTo(Map);

  let powered = L.control({ position: 'bottomleft' });
  powered.onAdd = function(Map) {
    var divElem = L.DomUtil.create('div', 'powered');
    divElem.innerHTML = '<a href="https://www.wikidata.org/"><img src="img/powered_by_wikidata.png"></a>';
    return divElem;
  };
  powered.addTo(Map);

  Cluster = new L.markerClusterGroup({
    maxClusterRadius: function(z) {
      if (z <=  15) return 50;
      if (z === 16) return 40;
      if (z === 17) return 30;
      if (z === 18) return 20;
      if (z >=  19) return 10;
    },
  }).addTo(Map);
}

function queryWdqsThenProcess(query, processEachResult, postprocessCallback) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(xhr.status);
      }
    };
    xhr.open('POST', WDQS_API_URL, true);
    xhr.overrideMimeType('text/plain');
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });

  promise = promise.then(data => {
    data.results.bindings.forEach(processEachResult);
  });

  if (postprocessCallback) promise = promise.then(postprocessCallback);

  return promise;
}

function enableApp() {
  PrimaryDataIsLoaded = true;
  processHashChange();
}

function processHashChange() {
  let fragment = window.location.hash.replace('#', '');
  if (fragment === 'about') {
    document.title = 'About – ' + BASE_TITLE;
    displayPanelContent('about');
  } else {
    if (!BootstrapDataIsLoaded) {
      displayPanelContent('loading');
    } else {
      if (fragment === '' || !(fragment in Records)) {
        window.location.hash = '';
        document.title = BASE_TITLE;
        displayPanelContent('index');
      } else {
        activateMapMarker(fragment);
        displayRecordDetails(fragment);
      }
    }
  }
}

function activateMapMarker(qid) {
  let record = Records[qid];
  if (!record.mapMarker) return;
  Cluster.zoomToShowLayer(
    record.mapMarker,
    function() {
      Map.setView([record.lat, record.lon], Map.getZoom());
      if (!record.popup.isOpen()) record.mapMarker.openPopup();
    } // <--- KOMANYA SUDAH SAYA BUANG
  );
}

function displayPanelContent(id) {
  document.querySelectorAll('.panel-content').forEach(content => {
    content.style.display = (content.id === id) ? content.dataset.display : 'none';
  });
  document.querySelectorAll('nav li').forEach(li => {
    if (li.childNodes[0].getAttribute('href') === '#' + id) {
      li.classList.add('selected');
    } else {
      li.classList.remove('selected');
    }
  });
}

function displayRecordDetails(qid) {
  let record = Records[qid];
  window.location.hash = `#${qid}`;
  document.title = `${record.indexTitle} – ${BASE_TITLE}`;
  if (PrimaryDataIsLoaded) {
    if (!record.panelElem) generateRecordDetails(qid);
    let detailsElem = document.getElementById('details');
    detailsElem.replaceChild(record.panelElem, detailsElem.childNodes[0]);
    displayPanelContent('details');
  } else {
    displayPanelContent('loading');
  }
}

function generateFigure(filename, classNames = []) {
  if (filename) {
    let uniqueId = 'caption-' + Math.random().toString(36).substr(2, 9);
    let encodedFilename = encodeURIComponent(filename);

    let apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=File:${encodedFilename}&origin=*`;

    fetch(apiUrl)
      .then(res => res.json())
      .then(data => {
        let pages = data.query.pages;
        let pageId = Object.keys(pages)[0];
        
        if (pageId !== "-1" && pages[pageId].imageinfo) {
          let metadata = pages[pageId].imageinfo[0].extmetadata;
          let artistHtml = '';
          
          if (metadata.Artist) {
              artistHtml = metadata.Artist.value.trim();
              artistHtml = artistHtml.replace(/<(?!\/?a ?)[^>]+>/g, '');
              if (artistHtml.includes('Unknown author')) artistHtml = 'Tidak diketahui';
              artistHtml = artistHtml.replace(/href="(?:https?:)?\/\//g, 'href="https://');
          }

          let licenseHtml = '';
          if (metadata.AttributionRequired && metadata.AttributionRequired.value === 'true' && metadata.LicenseShortName) {
            licenseHtml = metadata.LicenseShortName.value.replace(/ /g, '&nbsp;').replace(/-/g, '&#8209;');
            licenseHtml = `[${licenseHtml}]`;
            if (metadata.LicenseUrl) licenseHtml = `<a href="${metadata.LicenseUrl.value}" target="_blank">${licenseHtml}</a>`;
            licenseHtml = ' ' + licenseHtml;
          }

          let targetCaption = document.getElementById(uniqueId);
          if (targetCaption) targetCaption.innerHTML = artistHtml + licenseHtml;
        } else {
          let targetCaption = document.getElementById(uniqueId);
          if (targetCaption) targetCaption.innerHTML = 'Keterangan tidak tersedia';
        }
      })
      .catch(err => {
        console.error("Gagal memuat caption Commons:", err);
        let targetCaption = document.getElementById(uniqueId);
        if (targetCaption) targetCaption.innerHTML = '';
      });

    return (
      `<figure class="${classNames.join(' ')}">` +
        `<a href="https://commons.wikimedia.org/wiki/File:${encodedFilename}" target="_blank">` +
          `<img class="loading" src="https://commons.wikimedia.org/wiki/Special:FilePath/${encodedFilename}?width=300" alt="" onload="this.className=''">` +
        '</a>' +
        `<figcaption id="${uniqueId}">(Memuat keterangan foto...)</figcaption>` +
      '</figure>'
    );
  } else {
    return `<figure class="${classNames.join(' ')} nodata">Belum ada foto</figure>`;
  }
}

function extractImageFilename(image) {
  let regex = /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;
  return decodeURIComponent(image.value.replace(regex, ''));
}

function parseDate(result, keyName) {
  let dateVal = result[keyName].value;
  if (result[keyName + 'Precision'].value === YEAR_PRECISION) {
    return dateVal.substr(0, 4);
  } else {
    let date = new Date(dateVal);
    return date.toLocaleDateString(
      'en-US',
      {
        month : 'long',
        day   : 'numeric',
        year  : 'numeric'
      } // <--- KOMANYA SUDAH SAYA BUANG
    );
  }
}
// <--- KURUNG KURAWAL SISA SUDAH SAYA HAPUS DI SINI
