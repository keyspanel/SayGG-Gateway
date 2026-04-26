/**
 * Authoritative geography of India used by the checkout address form.
 *
 * Includes all 28 states and 8 union territories (current official names),
 * plus a curated set of real cities under each. The list is intentionally
 * the canonical source — the form rejects any city/state that doesn't match
 * one of these entries (case-insensitively), so users can't enter fake
 * places.
 *
 * All names follow the current official spelling (e.g. "Odisha" not
 * "Orissa", "Puducherry" not "Pondicherry"). A small alias map below
 * accepts a few legacy spellings only when prefilling old saved profiles.
 */

export const INDIAN_STATES: readonly string[] = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

/**
 * Legacy / alternate names that map to the current canonical state name.
 * Used only when reading an older saved billing profile so we don't lose
 * the user's previously-saved value.
 */
export const STATE_ALIASES: Readonly<Record<string, string>> = {
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand',
  'jammu & kashmir': 'Jammu and Kashmir',
  'andaman & nicobar islands': 'Andaman and Nicobar Islands',
  'nct of delhi': 'Delhi',
  'national capital territory of delhi': 'Delhi',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
};

export const CITIES_BY_STATE: Readonly<Record<string, readonly string[]>> = {
  'Andaman and Nicobar Islands': [
    'Bambooflat', 'Diglipur', 'Garacharma', 'Hut Bay', 'Mayabunder', 'Port Blair', 'Rangat',
  ],
  'Andhra Pradesh': [
    'Adoni', 'Anantapur', 'Bhimavaram', 'Chilakaluripet', 'Chittoor', 'Dharmavaram', 'Eluru',
    'Gudivada', 'Guntakal', 'Guntur', 'Hindupur', 'Kadapa', 'Kakinada', 'Kurnool',
    'Machilipatnam', 'Madanapalle', 'Nandyal', 'Narasaraopet', 'Nellore', 'Ongole',
    'Proddatur', 'Rajahmundry', 'Srikakulam', 'Tadepalligudem', 'Tadipatri', 'Tenali',
    'Tirupati', 'Vijayawada', 'Visakhapatnam', 'Vizianagaram',
  ],
  'Arunachal Pradesh': [
    'Aalo', 'Anini', 'Bomdila', 'Changlang', 'Daporijo', 'Itanagar', 'Khonsa',
    'Naharlagun', 'Pasighat', 'Roing', 'Tawang', 'Tezu', 'Yingkiong', 'Ziro',
  ],
  'Assam': [
    'Barpeta', 'Bongaigaon', 'Dhubri', 'Dibrugarh', 'Diphu', 'Goalpara', 'Golaghat',
    'Guwahati', 'Hailakandi', 'Jorhat', 'Karimganj', 'Lakhimpur', 'Mangaldoi', 'Nagaon',
    'Nalbari', 'North Lakhimpur', 'Sibsagar', 'Silchar', 'Sivasagar', 'Tezpur', 'Tinsukia',
  ],
  'Bihar': [
    'Arrah', 'Aurangabad', 'Begusarai', 'Bettiah', 'Bhagalpur', 'Bihar Sharif', 'Buxar',
    'Chapra', 'Danapur', 'Darbhanga', 'Dehri', 'Gaya', 'Hajipur', 'Jamalpur', 'Jehanabad',
    'Katihar', 'Kishanganj', 'Madhubani', 'Motihari', 'Munger', 'Muzaffarpur', 'Nawada',
    'Patna', 'Purnia', 'Saharsa', 'Samastipur', 'Sasaram', 'Siwan',
  ],
  'Chandigarh': [
    'Chandigarh', 'Manimajra',
  ],
  'Chhattisgarh': [
    'Ambikapur', 'Bhatapara', 'Bhilai', 'Bilaspur', 'Champa', 'Chirmiri', 'Dhamtari',
    'Durg', 'Jagdalpur', 'Janjgir', 'Kondagaon', 'Korba', 'Mahasamund', 'Raigarh',
    'Raipur', 'Rajnandgaon',
  ],
  'Dadra and Nagar Haveli and Daman and Diu': [
    'Daman', 'Diu', 'Silvassa',
  ],
  'Delhi': [
    'Delhi', 'Dwarka', 'Karawal Nagar', 'Karol Bagh', 'Mehrauli', 'Najafgarh', 'Narela',
    'New Delhi', 'Rohini', 'Saket', 'Shahdara', 'Sultanpur Majra',
  ],
  'Goa': [
    'Bicholim', 'Curchorem', 'Cuncolim', 'Mapusa', 'Margao', 'Panaji', 'Pernem', 'Ponda',
    'Quepem', 'Sanquelim', 'Valpoi', 'Vasco da Gama',
  ],
  'Gujarat': [
    'Ahmedabad', 'Amreli', 'Anand', 'Ankleshwar', 'Bharuch', 'Bhavnagar', 'Bhuj', 'Botad',
    'Dahod', 'Deesa', 'Gandhidham', 'Gandhinagar', 'Godhra', 'Jamnagar', 'Junagadh',
    'Kalol', 'Mehsana', 'Morbi', 'Nadiad', 'Navsari', 'Palanpur', 'Patan', 'Porbandar',
    'Rajkot', 'Surat', 'Surendranagar', 'Vadodara', 'Valsad', 'Vapi', 'Veraval',
  ],
  'Haryana': [
    'Ambala', 'Bahadurgarh', 'Bhiwani', 'Faridabad', 'Gurugram', 'Hansi', 'Hisar', 'Jind',
    'Kaithal', 'Karnal', 'Kurukshetra', 'Narnaul', 'Palwal', 'Panchkula', 'Panipat',
    'Pinjore', 'Rewari', 'Rohtak', 'Sirsa', 'Sonipat', 'Thanesar', 'Yamunanagar',
  ],
  'Himachal Pradesh': [
    'Baddi', 'Bilaspur', 'Chamba', 'Dharamshala', 'Hamirpur', 'Kangra', 'Kullu', 'Mandi',
    'Manali', 'Nahan', 'Palampur', 'Paonta Sahib', 'Shimla', 'Solan', 'Sundernagar', 'Una',
  ],
  'Jammu and Kashmir': [
    'Anantnag', 'Bandipore', 'Baramulla', 'Budgam', 'Doda', 'Ganderbal', 'Jammu', 'Kathua',
    'Kulgam', 'Kupwara', 'Poonch', 'Pulwama', 'Rajouri', 'Reasi', 'Samba', 'Sopore',
    'Srinagar', 'Udhampur',
  ],
  'Jharkhand': [
    'Adityapur', 'Bokaro', 'Chaibasa', 'Chirkunda', 'Deoghar', 'Dhanbad', 'Dumka', 'Giridih',
    'Godda', 'Hazaribagh', 'Jamshedpur', 'Jhumri Tilaiya', 'Lohardaga', 'Medininagar',
    'Pakur', 'Phusro', 'Ramgarh', 'Ranchi', 'Sahibganj', 'Saunda',
  ],
  'Karnataka': [
    'Bagalkot', 'Ballari', 'Belgaum', 'Bengaluru', 'Bhadravati', 'Bidar', 'Chikmagalur',
    'Chitradurga', 'Davanagere', 'Gadag-Betageri', 'Gangavathi', 'Gulbarga', 'Hassan',
    'Hospet', 'Hubli', 'Karwar', 'Kolar', 'Mandya', 'Mangalore', 'Mysuru', 'Raichur',
    'Ranibennur', 'Robertsonpet', 'Shimoga', 'Sirsi', 'Tumkur', 'Udupi', 'Vijayapura',
  ],
  'Kerala': [
    'Alappuzha', 'Aluva', 'Changanassery', 'Ernakulam', 'Kannur', 'Kasaragod', 'Kayamkulam',
    'Kochi', 'Kollam', 'Kottayam', 'Kozhikode', 'Malappuram', 'Manjeri', 'Nedumangad',
    'Neyyattinkara', 'Palakkad', 'Pathanamthitta', 'Ponnani', 'Punalur', 'Thalassery',
    'Thiruvananthapuram', 'Thrissur', 'Tirur', 'Vatakara',
  ],
  'Ladakh': [
    'Drass', 'Kargil', 'Leh', 'Nubra', 'Padum', 'Zanskar',
  ],
  'Lakshadweep': [
    'Agatti', 'Amini', 'Andrott', 'Kavaratti', 'Minicoy',
  ],
  'Madhya Pradesh': [
    'Bhind', 'Bhopal', 'Burhanpur', 'Chhatarpur', 'Chhindwara', 'Damoh', 'Dewas', 'Guna',
    'Gwalior', 'Hoshangabad', 'Indore', 'Itarsi', 'Jabalpur', 'Khandwa', 'Khargone',
    'Mandsaur', 'Murwara', 'Neemuch', 'Pithampur', 'Ratlam', 'Rewa', 'Sagar', 'Satna',
    'Sehore', 'Shivpuri', 'Singrauli', 'Ujjain', 'Vidisha',
  ],
  'Maharashtra': [
    'Ahmednagar', 'Akola', 'Ambernath', 'Amravati', 'Aurangabad', 'Beed', 'Bhiwandi',
    'Bhusawal', 'Chandrapur', 'Dhule', 'Ichalkaranji', 'Jalgaon', 'Jalna', 'Kalyan',
    'Kolhapur', 'Latur', 'Malegaon', 'Mira-Bhayandar', 'Mumbai', 'Nagpur', 'Nanded',
    'Nashik', 'Navi Mumbai', 'Panvel', 'Parbhani', 'Pimpri-Chinchwad', 'Pune',
    'Sangli-Miraj', 'Solapur', 'Thane', 'Ulhasnagar', 'Vasai-Virar', 'Wardha', 'Yavatmal',
  ],
  'Manipur': [
    'Bishnupur', 'Churachandpur', 'Imphal', 'Jiribam', 'Kakching', 'Lilong', 'Mayang Imphal',
    'Moreh', 'Nambol', 'Senapati', 'Thoubal', 'Ukhrul',
  ],
  'Meghalaya': [
    'Ampati', 'Baghmara', 'Jowai', 'Mairang', 'Nongpoh', 'Nongstoin', 'Resubelpara',
    'Shillong', 'Tura', 'Williamnagar',
  ],
  'Mizoram': [
    'Aizawl', 'Champhai', 'Kolasib', 'Lawngtlai', 'Lunglei', 'Mamit', 'Saiha', 'Serchhip',
  ],
  'Nagaland': [
    'Dimapur', 'Kiphire', 'Kohima', 'Longleng', 'Mokokchung', 'Mon', 'Peren', 'Phek',
    'Tuensang', 'Wokha', 'Zunheboto',
  ],
  'Odisha': [
    'Anandpur', 'Balasore', 'Barbil', 'Bargarh', 'Baripada', 'Bhadrak', 'Bhawanipatna',
    'Bhubaneswar', 'Brahmapur', 'Cuttack', 'Dhenkanal', 'Jeypore', 'Jharsuguda',
    'Kendrapara', 'Paradip', 'Puri', 'Rayagada', 'Rourkela', 'Sambalpur', 'Sunabeda',
  ],
  'Puducherry': [
    'Karaikal', 'Mahe', 'Ozhukarai', 'Puducherry', 'Yanam',
  ],
  'Punjab': [
    'Abohar', 'Amritsar', 'Barnala', 'Batala', 'Bathinda', 'Firozpur', 'Gurdaspur',
    'Hoshiarpur', 'Jalandhar', 'Kapurthala', 'Khanna', 'Ludhiana', 'Malerkotla', 'Mansa',
    'Moga', 'Mohali', 'Muktsar', 'Nabha', 'Pathankot', 'Patiala', 'Phagwara', 'Rajpura',
    'Sangrur', 'Sunam',
  ],
  'Rajasthan': [
    'Ajmer', 'Alwar', 'Banswara', 'Barmer', 'Beawar', 'Bharatpur', 'Bhilwara', 'Bhiwadi',
    'Bikaner', 'Chittorgarh', 'Churu', 'Dhaulpur', 'Ganganagar', 'Hanumangarh', 'Jaipur',
    'Jhunjhunu', 'Jodhpur', 'Kishangarh', 'Kota', 'Mount Abu', 'Nagaur', 'Pali', 'Pushkar',
    'Sawai Madhopur', 'Sikar', 'Tonk', 'Udaipur',
  ],
  'Sikkim': [
    'Gangtok', 'Gyalshing', 'Jorethang', 'Mangan', 'Namchi', 'Pakyong', 'Rangpo', 'Singtam',
    'Soreng',
  ],
  'Tamil Nadu': [
    'Ambattur', 'Ambur', 'Avadi', 'Chennai', 'Coimbatore', 'Cuddalore', 'Dindigul', 'Erode',
    'Hosur', 'Kanchipuram', 'Karaikkudi', 'Karur', 'Kumarapalayam', 'Kumbakonam', 'Madurai',
    'Nagapattinam', 'Nagercoil', 'Neyveli', 'Pallavaram', 'Pollachi', 'Pudukkottai',
    'Rajapalayam', 'Ranipet', 'Salem', 'Sivakasi', 'Tambaram', 'Thanjavur', 'Thoothukudi',
    'Tirunelveli', 'Tiruppur', 'Tiruvannamalai', 'Tiruchirappalli', 'Udhagamandalam',
    'Vaniyambadi', 'Vellore',
  ],
  'Telangana': [
    'Adilabad', 'Bhongir', 'Bodhan', 'Hyderabad', 'Jagtial', 'Karimnagar', 'Khammam',
    'Kothagudem', 'Mahbubnagar', 'Mancherial', 'Medak', 'Miryalaguda', 'Nalgonda',
    'Nirmal', 'Nizamabad', 'Ramagundam', 'Sangareddy', 'Siddipet', 'Suryapet',
    'Vikarabad', 'Wanaparthy', 'Warangal',
  ],
  'Tripura': [
    'Agartala', 'Amarpur', 'Ambassa', 'Belonia', 'Dharmanagar', 'Kailasahar', 'Khowai',
    'Kumarghat', 'Ranir Bazar', 'Sonamura', 'Teliamura', 'Udaipur',
  ],
  'Uttar Pradesh': [
    'Agra', 'Aligarh', 'Allahabad', 'Amroha', 'Ayodhya', 'Bahraich', 'Ballia', 'Banda',
    'Bareilly', 'Bulandshahr', 'Etawah', 'Faizabad', 'Fatehpur', 'Firozabad', 'Ghaziabad',
    'Gonda', 'Gorakhpur', 'Greater Noida', 'Hapur', 'Hardoi', 'Hathras', 'Jaunpur',
    'Jhansi', 'Kanpur', 'Lakhimpur', 'Lalitpur', 'Lucknow', 'Mathura', 'Mau', 'Meerut',
    'Mirzapur', 'Modinagar', 'Moradabad', 'Muzaffarnagar', 'Noida', 'Orai', 'Pilibhit',
    'Prayagraj', 'Raebareli', 'Rampur', 'Saharanpur', 'Sambhal', 'Shikohabad', 'Sitapur',
    'Unnao', 'Varanasi',
  ],
  'Uttarakhand': [
    'Almora', 'Dehradun', 'Haldwani', 'Haridwar', 'Kashipur', 'Manglaur', 'Mussoorie',
    'Nainital', 'Pauri', 'Pithoragarh', 'Ramnagar', 'Rishikesh', 'Roorkee', 'Rudrapur',
    'Sitarganj', 'Tehri',
  ],
  'West Bengal': [
    'Alipurduar', 'Asansol', 'Baharampur', 'Bally', 'Balurghat', 'Bankura', 'Barasat',
    'Bardhaman', 'Basirhat', 'Bhatpara', 'Bidhannagar', 'Chakdaha', 'Chinsurah',
    'Cooch Behar', 'Dankuni', 'Darjeeling', 'Dhulian', 'Durgapur', 'English Bazar',
    'Habra', 'Haldia', 'Howrah', 'Jalpaiguri', 'Kharagpur', 'Kolkata', 'Krishnanagar',
    'Kulti', 'Madhyamgram', 'Maheshtala', 'Medinipur', 'Nabadwip', 'Naihati',
    'North Dumdum', 'Panihati', 'Purulia', 'Raiganj', 'Rajpur Sonarpur', 'Ranaghat',
    'Serampore', 'Shantipur', 'Siliguri', 'Uluberia',
  ],
};

/** Case-insensitive canonicaliser for state names (handles known aliases). */
export function canonicalizeState(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const lc = trimmed.toLowerCase();
  for (const s of INDIAN_STATES) if (s.toLowerCase() === lc) return s;
  if (STATE_ALIASES[lc]) return STATE_ALIASES[lc];
  return '';
}

/**
 * Well-known city renames / English aliases. Keyed by lowercase alias →
 * current official name. Used by `canonicalizeCity` so that a value coming
 * from India Post (which often returns the older English form, e.g.
 * "Bangalore") snaps to the modern canonical entry in CITIES_BY_STATE.
 */
const CITY_ALIASES: Readonly<Record<string, string>> = {
  'bangalore': 'Bengaluru',
  'bombay': 'Mumbai',
  'calcutta': 'Kolkata',
  'madras': 'Chennai',
  'mysore': 'Mysuru',
  'cochin': 'Kochi',
  'trivandrum': 'Thiruvananthapuram',
  'gurgaon': 'Gurugram',
  'allahabad': 'Prayagraj',
  'pondicherry': 'Puducherry',
  'baroda': 'Vadodara',
  'poona': 'Pune',
  'kanpur nagar': 'Kanpur',
  'lucknow nagar': 'Lucknow',
  'tuticorin': 'Thoothukudi',
  'ootacamund': 'Udhagamandalam',
  'belgavi': 'Belgaum',
  'kalaburagi': 'Gulbarga',
  'ballari': 'Ballari',
  'vijayapura': 'Vijayapura',
};

/** Case-insensitive canonicaliser for a city within a given state. */
export function canonicalizeCity(rawCity: string, canonState: string): string {
  const trimmed = (rawCity || '').trim();
  if (!trimmed || !canonState) return '';
  const list = CITIES_BY_STATE[canonState];
  if (!list) return '';
  const lc = trimmed.toLowerCase();
  for (const c of list) if (c.toLowerCase() === lc) return c;
  // Try alias resolution (e.g. "Bangalore" → "Bengaluru") and re-match.
  const aliased = CITY_ALIASES[lc];
  if (aliased) {
    const aliasedLc = aliased.toLowerCase();
    for (const c of list) if (c.toLowerCase() === aliasedLc) return c;
  }
  return '';
}
