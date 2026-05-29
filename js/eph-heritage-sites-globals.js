'use strict';

const BASE_TITLE = 'Peta Persebaran Tokoh Indonesia Berdasarkan Tempat Kelahiran';

// 1. KAMUS PENERJEMAH LOKAL
const KAMUS_PEKERJAAN = {
  'Q82955': 'Politikus', 'Q13141064': 'Pemain Bulu Tangkis', 
  'Q177220': 'Penyanyi', 'Q937857': 'Pemain Sepak Bola', 
  'Q4610556': 'Peragawan', 'Q1930187': 'Jurnalis', 
  'Q193391': 'Diplomat', 'Q189459': 'Ulama', 
  'Q1028181': 'Pelukis', 'Q39631': 'Dokter',
  // KELOMPOK PEGAWAI NEGERI
  'Q212238': 'Pegawai Negeri', 'Q572700': 'Pegawai Negeri',
  // KELOMPOK PEMERAN
  'Q33999': 'Pemeran', 'Q10800557': 'Pemeran', 'Q10798782': 'Pemeran',
  // KELOMPOK MILITER
  'Q47064': 'Militer', 'Q189290': 'Militer',
  
  // KELOMPOK PENULIS
  'Q36180': 'Penulis', 
  
  // KELOMPOK PRAKTISI HUKUM
  'Q40348': 'Praktisi Hukum', 'Q16533': 'Praktisi Hukum', 'Q600751': 'Praktisi Hukum',  'Q189010': 'Praktisi Hukum',
  
  // KELOMPOK POLISI
  'Q384593': 'Polisi', 'Q35535': 'Polisi',
  
  // KELOMPOK PELAWAK
  'Q245068': 'Pelawak', 'Q18545066': 'Pelawak',
  
  // KELOMPOK PELAKU USAHA
  'Q43845': 'Pelaku Usaha', 'Q131524': 'Pelaku Usaha',  
  
  // KELOMPOK AKADEMISI / DOSEN
  'Q1622272': 'Akademisi/Dosen', 'Q1650915': 'Akademisi/Dosen', 
  'Q1569495': 'Akademisi/Dosen', 'Q462390': 'Akademisi/Dosen',
  'Q121594': 'Akademisi/Dosen', 'Q3400985': 'Akademisi/Dosen', 
  'Q901': 'Akademisi/Dosen',  'Q114316380': 'Akademisi/Dosen',
  
  // KELOMPOK MUSISI
  'Q753110': 'Musisi', 'Q639669': 'Musisi', 'Q36834': 'Musisi',  
  
  // KELOMPOK SINEAS
  'Q2526255': 'Sineas', 'Q28389': 'Sineas', 'Q3282637': 'Sineas',

  // KELOMPOK SENIMAN LAINNYA
  'Q483501': 'Seniman Lainnya',
  'Q5716684': 'Seniman Lainnya',
  'Q6625963': 'Seniman Lainnya',
  
  // KELOMPOK ATLET LAINNYA
  'Q3665646': 'Atlet Lainnya',
  'Q2066131': 'Atlet Lainnya', 'Q11513337': 'Atlet Lainnya', 'Q11338576': 'Atlet Lainnya', 
  'Q10833314': 'Atlet Lainnya', 'Q58825429': 'Atlet Lainnya', 'Q2309784': 'Atlet Lainnya'
};

// KAMUS PENERJEMAH GENDER
const KAMUS_GENDER = {
  'Q6581097': 'laki-laki', 
  'Q6581072': 'perempuan'
};

const ABOUT_SPARQL_QUERY = ``;

// ==========================================
// GLOBALS
// ==========================================
var BirthplaceIndex;
var PekerjaanIndex;
var PetaProvinsi = {};
